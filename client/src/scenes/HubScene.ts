import * as Phaser from 'phaser';
import { ApiRequestError, deleteAccount, session } from '../api/auth';
import { buyUpgrade, getProfile, startRun, type Profile } from '../api/game';
import { getCatalog } from '../content/catalog';
import { orderedLocations } from '../content/locations';
import { bundledContentHash } from '../content/hash';
import type { StatKey, UpgradeDefinition } from '../content/schemas';
import { ATLAS, HUB_MUSIC } from '../assets';
import { upgradeCost } from '../economy';
import { applyCrt, settings, updateSettings, type Settings } from '../settings';
import { playMusic, playSfx } from '../sound';
import type { RunData } from './RunScene';

const STAT_LABELS: Record<StatKey, string> = {
  maxHp: 'здоровье', armor: 'броня', regen: 'регенерация', moveSpeed: 'скорость',
  damage: 'урон', attackSpeed: 'скорость атаки', area: 'область', projectileCount: 'снаряды',
  duration: 'длительность', pickupRadius: 'радиус сбора', xpGain: 'опыт', luck: 'удача',
  radResist: 'защита от радиации',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  return `${minutes}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}

const LOCATION_KEY = 'wasteland.location.v1';

function loadSelectedLocation(): string {
  try { return localStorage.getItem(LOCATION_KEY) ?? ''; } catch { return ''; }
}

function saveSelectedLocation(id: string): void {
  try { localStorage.setItem(LOCATION_KEY, id); } catch { /* only a convenience */ }
}

function effectText(upgrade: UpgradeDefinition): string {
  const value = upgrade.mod === 'percent'
    ? `${Math.round(upgrade.perLevel * 100)}%` : String(upgrade.perLevel);
  return `+${value} ${STAT_LABELS[upgrade.stat]} за уровень`;
}

export class HubScene extends Phaser.Scene {
  private overlay: HTMLElement | null = null;
  private profile: Profile | null = null;
  private active = false;
  private busy = false;

  /** Location chosen in the list; remembered per browser. */
  private selected = loadSelectedLocation();

  constructor() { super('Hub'); }

  create(): void {
    this.active = true;
    this.profile = null;
    this.busy = false;
    this.overlay = document.createElement('main');
    this.overlay.className = 'auth-overlay';
    this.overlay.innerHTML = `
      <section class="auth-card hub-card" aria-labelledby="hub-title">
        <div class="auth-eyebrow">УБЕЖИЩЕ · ТЕРМИНАЛ</div>
        <h1 id="hub-title">ПУСТОШЬ</h1>
        <p id="hub-status" class="auth-status" role="status">Загружаем профиль…</p>
        <div id="hub-body" hidden>
          <dl class="hub-stats">
            <div><dt>Крышки</dt><dd><img id="hub-cap-icon" class="hub-cap" alt=""><span id="hub-caps"></span></dd></div>
            <div><dt>Лучшее время</dt><dd id="hub-best"></dd></div>
            <div><dt>Забегов</dt><dd id="hub-runs"></dd></div>
          </dl>
          <p id="hub-guest-hint" class="auth-warning" hidden>Вы играете как гость. Привяжите почту или Telegram, чтобы не потерять прогресс.</p>
          <h2>Куда идём</h2>
          <ul id="hub-locations" class="hub-locations"></ul>
          <button id="hub-start" class="auth-primary" type="button">Выйти из убежища</button>
          <p id="hub-location" class="hub-note"></p>
          <h2>Улучшения убежища</h2>
          <ul id="hub-upgrades" class="hub-upgrades"></ul>
          <fieldset class="hub-settings">
            <legend>Настройки</legend>
            <label><input type="checkbox" data-setting="music"> Музыка</label>
            <label><input type="checkbox" data-setting="sfx"> Звуки</label>
            <label><input type="checkbox" data-setting="crt"> ЭЛТ-эффект</label>
          </fieldset>
          <div class="hub-account">
            <button id="hub-link" class="auth-secondary" type="button"></button>
            <button id="hub-delete" class="auth-back hub-danger" type="button">Удалить аккаунт и данные</button>
          </div>
        </div>
        <button id="hub-retry" class="auth-secondary" type="button" hidden>Повторить</button>
      </section>`;
    document.body.append(this.overlay);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    this.el<HTMLImageElement>('hub-cap-icon').src = this.textures.getBase64(ATLAS, 'ui/cap');
    this.overlay.querySelectorAll<HTMLInputElement>('input[data-setting]').forEach((input) => {
      const key = input.dataset.setting as keyof Settings;
      input.checked = settings()[key];
      input.onchange = () => {
        updateSettings({ [key]: input.checked });
        applyCrt();
        if (key === 'music' && input.checked) playMusic(HUB_MUSIC);
        playSfx('sfx/ui_click');
      };
    });
    playMusic(HUB_MUSIC);
    this.el<HTMLButtonElement>('hub-start').onclick = () => void this.act(() => this.beginRun());
    this.el<HTMLButtonElement>('hub-retry').onclick = () => void this.loadProfile();
    this.el<HTMLButtonElement>('hub-link').onclick = () => this.scene.start('Auth', { linkAccount: true });
    this.el<HTMLButtonElement>('hub-delete').onclick = () => void this.act(() => this.removeAccount());
    this.el('hub-locations').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-location]');
      if (!button?.dataset.location || !this.profile) return;
      this.selected = button.dataset.location;
      saveSelectedLocation(this.selected);
      playSfx('sfx/ui_click');
      this.render(this.profile);
    };
    this.el('hub-upgrades').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-upgrade]');
      if (button?.dataset.upgrade) void this.act(() => this.buy(button.dataset.upgrade!));
    };
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.profile) void this.act(() => this.beginRun());
    });
    void this.loadProfile();
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.overlay!.querySelector<T>(`#${id}`)!;
  }

  private status(message: string, error = false): void {
    if (!this.active) return;
    const node = this.el('hub-status');
    node.textContent = message;
    node.classList.toggle('auth-error', error);
  }

  private async loadProfile(): Promise<void> {
    this.el('hub-retry').hidden = true;
    this.status('Загружаем профиль…');
    try {
      const profile = await getProfile();
      if (!this.active) return;
      this.render(profile);
      this.status('Готов к выходу.');
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('autostart')) {
        void this.act(() => this.beginRun());
      }
    } catch (error) {
      if (!this.active) return;
      if (error instanceof ApiRequestError && error.status === 401 && !session()) {
        this.scene.start('Auth');
        return;
      }
      this.status(this.message(error), true);
      this.el('hub-retry').hidden = false;
    }
  }

  private render(profile: Profile): void {
    this.profile = profile;
    const catalog = getCatalog();
    this.el('hub-body').hidden = false;
    this.el('hub-caps').textContent = String(profile.caps);
    this.el('hub-best').textContent = formatTime(profile.best_time_s);
    this.el('hub-runs').textContent = String(profile.runs_count);
    this.el('hub-guest-hint').hidden = !(profile.is_guest && profile.runs_count >= 3);
    this.el('hub-link').textContent = profile.is_guest ? 'Привязать вход' : 'Способы входа';
    const locations = orderedLocations(catalog);
    if (!profile.unlocked_locations.includes(this.selected)) {
      this.selected = locations.find((item) => profile.unlocked_locations.includes(item.id))?.id ?? '';
    }
    this.el('hub-locations').innerHTML = locations.map((location) => {
      const open = profile.unlocked_locations.includes(location.id);
      const chosen = location.id === this.selected;
      const beaten = profile.bosses_killed.includes(location.id) ? ' · босс повержен' : '';
      const lock = location.unlock.type === 'bossKilled'
        ? `Откроется после победы над боссом: ${catalog.locations[location.unlock.location]?.name ?? '?'}` : '';
      return `<li><button type="button" data-location="${escapeHtml(location.id)}"
        class="${chosen ? 'hub-location-chosen' : ''}" ${open ? '' : 'disabled'} aria-pressed="${chosen}">
        <strong>${escapeHtml(location.name)}</strong> <span class="hub-level">награда ×${location.rewardMultiplier}${beaten}</span>
        <small>${escapeHtml(open ? location.description : lock)}</small></button></li>`;
    }).join('');
    const location = catalog.locations[this.selected];
    const hero = location ? catalog.heroes[location.startingHero] : undefined;
    this.el('hub-location').textContent = location && hero
      ? `${location.name} · ${hero.name} · WASD / стрелки · тач · P — пауза` : '';
    this.el('hub-upgrades').innerHTML = Object.values(catalog.upgrades).map((upgrade) => {
      const level = profile.upgrades[upgrade.id] ?? 0;
      const maxed = level >= upgrade.maxLevel;
      const cost = maxed ? 0 : upgradeCost(upgrade, level);
      const label = maxed ? 'Максимум' : `Купить · ${cost}`;
      return `<li>
        <div><strong>${escapeHtml(upgrade.name)}</strong> <span class="hub-level">${level}/${upgrade.maxLevel}</span>
        <small>${escapeHtml(effectText(upgrade))}</small></div>
        <button type="button" data-upgrade="${escapeHtml(upgrade.id)}" ${maxed || cost > profile.caps ? 'disabled' : ''}>${label}</button>
      </li>`;
    }).join('');
  }

  private async buy(id: string): Promise<void> {
    if (!this.profile) return;
    try {
      this.render(await buyUpgrade(id, this.profile.version));
      playSfx('sfx/ui_buy');
      this.status('Улучшение установлено.');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        this.render(await getProfile());
      }
      throw error;
    }
  }

  private async beginRun(): Promise<void> {
    if (!this.profile) return;
    const catalog = getCatalog();
    const location = catalog.locations[this.selected];
    if (!location) throw new Error('Нет открытой локации');
    playSfx('sfx/ui_click');
    this.status('Открываем шлюз…');
    const [run, contentHash] = await Promise.all([
      startRun(location.id, location.startingHero), bundledContentHash(),
    ]);
    if (!this.active) return;
    const params = new URLSearchParams(window.location.search);
    const seedParam = params.get('seed');
    const waveParam = params.get('wave');
    const parsedSeed = seedParam === null ? NaN : Number(seedParam);
    const parsedWave = waveParam === null ? NaN : Number(waveParam);
    const seed = Number.isSafeInteger(parsedSeed) && parsedSeed >= 0 ? parsedSeed >>> 0 : run.seed >>> 0;
    const wave = Number.isSafeInteger(parsedWave) && parsedWave >= 0 ? parsedWave : 0;
    const data: RunData = {
      seed, wave, locationId: location.id, heroId: location.startingHero,
      runId: run.run_id, contentHash, upgrades: { ...this.profile.upgrades },
    };
    this.scene.start('Run', data);
  }

  private async removeAccount(): Promise<void> {
    if (!window.confirm('Удалить аккаунт, весь прогресс и способы входа? Это действие нельзя отменить.')) return;
    await deleteAccount();
    this.scene.start('Auth');
  }

  private async act(action: () => Promise<void>): Promise<void> {
    if (this.busy || !this.active) return;
    this.busy = true;
    try { await action(); }
    catch (error) {
      playSfx('sfx/ui_error');
      this.status(this.message(error), true);
    }
    finally { this.busy = false; }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Не удалось выполнить запрос.';
  }

  private cleanup(): void {
    this.active = false;
    this.input.keyboard?.off('keydown-SPACE');
    this.overlay?.remove();
    this.overlay = null;
  }
}
