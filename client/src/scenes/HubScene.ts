import * as Phaser from 'phaser';
import { accountKey, ApiRequestError, deleteAccount, loginByKey, saveSession, session } from '../api/auth';
import { buyUnlock, buyUpgrade, getProfile, startRun, type Profile } from '../api/game';
import { getCatalog } from '../content/catalog';
import { orderedLocations } from '../content/locations';
import { bundledContentHash } from '../content/hash';
import type { AchievementDefinition, PassiveDefinition, UpgradeDefinition, WeaponDefinition } from '../content/schemas';
import { statBonus } from '../content/statText';
import { ATLAS, HUB_MUSIC } from '../assets';
import { upgradeCost } from '../economy';
import { applyCrt, settings, updateSettings } from '../settings';
import { playMusic, playSfx } from '../sound';
import type { RunData } from './RunScene';

const VOLUMES = [['music', 'Музыка'], ['sfx', 'Звуки']] as const;

const CATEGORIES: readonly [UpgradeDefinition['category'], string][] = [
  ['slots', 'Слоты в забеге'], ['special', 'Особое'], ['survival', 'Выживание'], ['combat', 'Бой'], ['scavenge', 'Добыча и опыт'],
];

const TABS = [
  ['run', 'Вылазка'], ['upgrades', 'Улучшения'], ['weapons', 'Оружие'], ['passives', 'Перки'],
  ['emeralds', 'Изумруды'],
  ['achievements', 'Достижения'], ['settings', 'Настройки'],
] as const;
type Tab = (typeof TABS)[number][0];

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

function effectText(upgrade: UpgradeDefinition, level: number): string {
  const now = level ? statBonus(upgrade.stat, upgrade.perLevel * level, upgrade.mod) : '';
  if (level >= upgrade.maxLevel) return now;
  const next = statBonus(upgrade.stat, upgrade.perLevel * (level + 1), upgrade.mod);
  return now ? `${now} > ${next}` : next;
}

export class HubScene extends Phaser.Scene {
  private overlay: HTMLElement | null = null;
  private profile: Profile | null = null;
  private active = false;
  private busy = false;
  private tab: Tab = 'run';

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
            <div><dt>Изумруды</dt><dd><img id="hub-emerald-icon" class="hub-cap" alt=""><span id="hub-emeralds"></span></dd></div>
            <div><dt>Лучшее время</dt><dd id="hub-best"></dd></div>
            <div><dt>Забегов</dt><dd id="hub-runs"></dd></div>
          </dl>
          <p id="hub-guest-hint" class="auth-warning" hidden>Сохраните ключ аккаунта (вкладка «Настройки»): с ним можно продолжить на другом устройстве.</p>
          <div class="hub-tabs" role="tablist" aria-label="Разделы убежища">
            ${TABS.map(([id, title]) => `<button type="button" role="tab" id="hub-tab-${id}"
              data-tab="${id}" aria-controls="hub-panel-${id}">${title}</button>`).join('')}
          </div>
          <section id="hub-panel-run" role="tabpanel" aria-labelledby="hub-tab-run">
            <ul id="hub-locations" class="hub-locations"></ul>
            <label class="hub-autopilot"><input id="hub-autopilot" type="checkbox"> <span>Автопилот: героем управляет ИИ</span></label>
            <p id="hub-autopilot-note" class="hub-note"></p>
            <button id="hub-start" class="auth-primary" type="button">Отправиться на вылазку</button>
            <p id="hub-location" class="hub-note"></p>
          </section>
          <section id="hub-panel-upgrades" role="tabpanel" aria-labelledby="hub-tab-upgrades">
            <ul id="hub-upgrades" class="hub-upgrades"></ul>
          </section>
          <section id="hub-panel-weapons" role="tabpanel" aria-labelledby="hub-tab-weapons">
            <ul id="hub-weapons" class="hub-upgrades hub-items"></ul>
          </section>
          <section id="hub-panel-passives" role="tabpanel" aria-labelledby="hub-tab-passives">
            <ul id="hub-passives" class="hub-upgrades hub-items"></ul>
          </section>
          <section id="hub-panel-emeralds" role="tabpanel" aria-labelledby="hub-tab-emeralds">
            <div id="hub-emerald-info"></div>
          </section>
          <section id="hub-panel-achievements" role="tabpanel" aria-labelledby="hub-tab-achievements">
            <div id="hub-achievements"></div>
          </section>
          <section id="hub-panel-settings" role="tabpanel" aria-labelledby="hub-tab-settings">
            <fieldset class="hub-settings">
              <legend>Звук и картинка</legend>
              ${VOLUMES.map(([key, title]) => `<label class="hub-volume">${title}
                <input type="range" min="0" max="100" step="5" data-volume="${key}"><output></output></label>`).join('')}
              <label><input type="checkbox" data-setting="crt"> ЭЛТ-эффект</label>
            </fieldset>
            <h2>Управление</h2>
            <p class="hub-help">Мышь: клик — идти в точку, удержание — идти за курсором.<br>Клавиши: WASD или стрелки.<br>Телефон: джойстик под пальцем.<br>Esc, P или II — пауза, громкость и возврат в убежище. R — перебросить карточки. I — автопилот, если куплен.<br>Наведите мышь на слот в забеге, чтобы увидеть описание.</p>
            <h2>Ключ аккаунта</h2>
            <p class="hub-help">Введите этот ключ на другом устройстве, и игра продолжится с того же места. Храните его как пароль: по нему откроется ваш аккаунт.</p>
            <div class="auth-row"><input id="hub-key" type="text" readonly value="•••••-•••••-•••••-•••••" aria-label="Ключ аккаунта"><button id="hub-key-show" type="button">Показать</button><button id="hub-key-copy" type="button" hidden>Копировать</button></div>
            <button id="hub-key-renew" class="auth-back" type="button">Сменить ключ (старый перестанет работать)</button>
            <form id="hub-key-form" class="auth-form">
              <label for="hub-key-other">Перейти в другой аккаунт по ключу</label>
              <div class="auth-row"><input id="hub-key-other" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="40" required placeholder="XXXXX-XXXXX-XXXXX-XXXXX"><button type="submit">Войти</button></div>
            </form>
            <h2>Аккаунт</h2>
            <div class="hub-account">
              <button id="hub-link" class="auth-secondary" type="button"></button>
              <button id="hub-delete" class="auth-back hub-danger" type="button">Удалить аккаунт и данные</button>
            </div>
          </section>
        </div>
        <button id="hub-retry" class="auth-secondary" type="button" hidden>Повторить</button>
      </section>`;
    document.body.append(this.overlay);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    this.el<HTMLImageElement>('hub-cap-icon').src = this.textures.getBase64(ATLAS, 'ui/cap');
    this.el<HTMLImageElement>('hub-emerald-icon').src = this.textures.getBase64(ATLAS, 'ui/emerald');
    this.overlay.querySelectorAll<HTMLInputElement>('input[data-setting]').forEach((input) => {
      input.checked = settings().crt;
      input.onchange = () => {
        updateSettings({ crt: input.checked });
        applyCrt();
        playSfx('sfx/ui_click');
      };
    });
    this.overlay.querySelectorAll<HTMLInputElement>('input[data-volume]').forEach((input) => {
      const key = input.dataset.volume as 'music' | 'sfx';
      const output = input.nextElementSibling as HTMLOutputElement;
      const show = (): void => { output.textContent = `${input.value}%`; };
      input.value = String(Math.round(settings()[key] * 100));
      show();
      input.oninput = () => {
        updateSettings({ [key]: Number(input.value) / 100 });
        show();
      };
      // A sample of the new loudness.
      if (key === 'sfx') input.onchange = () => playSfx('sfx/ui_buy');
    });
    const autopilot = this.el<HTMLInputElement>('hub-autopilot');
    autopilot.checked = settings().autopilot;
    autopilot.onchange = () => {
      updateSettings({ autopilot: autopilot.checked });
      playSfx('sfx/ui_click');
    };
    this.el('hub-key-show').onclick = () => void this.act(() => this.showKey(false));
    this.el('hub-key-renew').onclick = () => void this.act(async () => {
      if (window.confirm('Сменить ключ? Старый больше не подойдёт ни на одном устройстве.')) await this.showKey(true);
    });
    this.el('hub-key-copy').onclick = () => void this.act(async () => {
      const input = this.el<HTMLInputElement>('hub-key');
      try { await navigator.clipboard.writeText(input.value); }
      catch {
        input.select();
        throw new Error('Не удалось скопировать. Ключ выделен, скопируйте вручную.');
      }
      this.status('Ключ скопирован.');
    });
    this.el<HTMLFormElement>('hub-key-form').onsubmit = (event) => {
      event.preventDefault();
      void this.act(() => this.switchAccount());
    };
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
    for (const list of ['hub-weapons', 'hub-passives']) {
      this.el(list).onclick = (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-unlock]');
        if (button?.dataset.unlock) void this.act(() => this.unlock(button.dataset.unlock!));
      };
    }
    const tabs = this.overlay.querySelector<HTMLElement>('.hub-tabs')!;
    tabs.onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
      const tab = TABS.find(([id]) => id === button?.dataset.tab)?.[0];
      if (tab) this.openTab(tab, true);
    };
    tabs.onkeydown = (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      const open = TABS.filter(([id]) => !this.el(`hub-tab-${id}`).hidden);
      const index = open.findIndex(([id]) => id === this.tab);
      const next = open[(index + step + open.length) % open.length]![0];
      this.openTab(next, true);
      this.el(`hub-tab-${next}`).focus();
    };
    this.openTab('run', false);
    this.input.keyboard?.on('keydown-SPACE', (event: KeyboardEvent) => {
      // A focused button already reacts to the space bar.
      if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement) return;
      if (this.tab === 'run' && this.profile) void this.act(() => this.beginRun());
    });
    void this.loadProfile();
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.overlay!.querySelector<T>(`#${id}`)!;
  }

  private openTab(tab: Tab, sound: boolean): void {
    this.tab = tab;
    for (const [id] of TABS) {
      const selected = id === tab;
      const button = this.el<HTMLButtonElement>(`hub-tab-${id}`);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      this.el(`hub-panel-${id}`).hidden = !selected;
    }
    if (sound) playSfx('sfx/ui_click');
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
      this.status('Готов к вылазке.');
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
    this.el('hub-emeralds').textContent = String(profile.emeralds);
    this.el('hub-best').textContent = formatTime(profile.best_time_s);
    this.el('hub-runs').textContent = String(profile.runs_count);
    this.el('hub-guest-hint').hidden = !(profile.is_guest && profile.runs_count >= 1);
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
      ? `${location.name} · ${hero.name} · пробел — начать` : '';
    this.renderItems(profile);
    this.renderEmeralds(profile);
    this.renderAchievements(profile);
    const pilot = catalog.upgrades.autopilot;
    const bought = (profile.upgrades.autopilot ?? 0) > 0;
    this.el<HTMLInputElement>('hub-autopilot').disabled = !bought;
    this.el('hub-autopilot-note').textContent = bought
      ? 'Не закрывайте вкладку игры. В забеге переключается клавишей I.'
      : pilot ? `Купите за ${upgradeCost(pilot, 0)} изумр. на вкладке «Улучшения».` : '';
    this.el('hub-upgrades').innerHTML = CATEGORIES.map(([category, title]) =>
      `<li class="hub-category">${title}</li>${Object.values(catalog.upgrades)
        .filter((upgrade) => upgrade.category === category).map((upgrade) => {
      const level = profile.upgrades[upgrade.id] ?? 0;
      const maxed = level >= upgrade.maxLevel;
      const cost = maxed ? 0 : upgradeCost(upgrade, level);
      const emeralds = upgrade.currency === 'emeralds';
      const funds = emeralds ? profile.emeralds : profile.caps;
      const label = maxed ? 'Максимум' : `Купить · ${cost}${emeralds ? ' изумр.' : ''}`;
      return `<li>
        <div><strong>${escapeHtml(upgrade.name)}</strong> <span class="hub-level">${level}/${upgrade.maxLevel}</span>
        <small>${escapeHtml(effectText(upgrade, level))}</small></div>
        <button type="button" data-upgrade="${escapeHtml(upgrade.id)}" ${maxed || cost > funds ? 'disabled' : ''}>${label}</button>
      </li>`;
    }).join('')}`).join('');
  }

  private renderItems(profile: Profile): void {
    const { weapons, passives } = getCatalog();
    const row = (item: WeaponDefinition | PassiveDefinition, note: string): string => {
      const cost = item.unlock.type === 'emeralds' ? item.unlock.emeralds : 0;
      const open = !cost || profile.unlocks.includes(item.id);
      const action = open ? `<span class="hub-open">${cost ? 'Открыто' : 'Доступно'}</span>`
        : `<button type="button" data-unlock="${escapeHtml(item.id)}" ${cost > profile.emeralds ? 'disabled' : ''}>Открыть · ${cost}</button>`;
      return `<li class="${open ? '' : 'hub-locked'}">
        <img class="hub-icon" alt="" src="${this.textures.getBase64(ATLAS, item.sprite)}">
        <div><strong>${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(item.description)}${note ? `<br>${escapeHtml(note)}` : ''}</small></div>${action}</li>`;
    };
    const section = (title: string, rows: string[]): string =>
      `<li class="hub-category">${title}</li>${rows.join('')}`;
    const byCost = <T extends WeaponDefinition | PassiveDefinition>(items: T[]): T[] =>
      items.sort((a, b) => (a.unlock.type === 'emeralds' ? a.unlock.emeralds : 0)
        - (b.unlock.type === 'emeralds' ? b.unlock.emeralds : 0));
    const guns = Object.values(weapons);
    const heavy = byCost(guns.filter((weapon) => weapon.heavy));
    this.el('hub-weapons').innerHTML = section('Тяжёлое оружие', heavy.map((weapon) =>
      row(weapon, `Встречается в забеге с ${weapon.minHeroLevel} уровня`)))
      + section('Обычное оружие', guns.filter((weapon) => !weapon.heavy && !weapon.evolved).map((weapon) =>
        row(weapon, weapon.evolution
          ? `Эволюция: ${weapons[weapon.evolution.into]!.name} (перк «${passives[weapon.evolution.passive]!.name}»)` : '')));
    const perks = Object.values(passives);
    const note = (perk: PassiveDefinition): string =>
      `${statBonus(perk.stat, perk.perLevel, perk.mod)} за уровень, уровней: ${perk.maxLevel}`;
    this.el('hub-passives').innerHTML = section('За изумруды',
      byCost(perks.filter((perk) => perk.unlock.type === 'emeralds')).map((perk) => row(perk, note(perk))))
      + section('Доступны сразу',
        perks.filter((perk) => perk.unlock.type === 'default').map((perk) => row(perk, note(perk))));
  }

  private renderEmeralds(profile: Profile): void {
    const catalog = getCatalog();
    const marks = catalog.balance.reward.emeraldMilestones;
    const row = (title: string, amount: number, done = false): string =>
      `<li class="${done ? 'hub-done' : ''}"><span>${escapeHtml(title)}</span><span>${done ? 'получено' : `+${amount}`}</span></li>`;
    this.el('hub-emerald-info').innerHTML = `
      <p class="hub-help">За изумруды открывают тяжёлое оружие и редкие перки (они появляются среди карточек забега) и докупают слоты (вкладка «Улучшения»). Изумруды начисляются в конце забега, даже если герой погиб.</p>
      ${orderedLocations(catalog).map((location) => {
        const { elite, boss, firstBoss } = location.emeralds;
        const reached = profile.milestones[location.id] ?? [];
        return `<h2>${escapeHtml(location.name)}</h2><ul class="hub-goals">
          ${row('Каждый мини-босс', elite)}${row('Каждая победа над боссом', boss)}
          ${row('Первая победа над боссом', firstBoss, profile.bosses_killed.includes(location.id))}
          ${marks.map((mark) => row(`Впервые продержаться ${formatTime(mark.atSecond)}`, mark.amount, reached.includes(mark.atSecond))).join('')}
        </ul>`;
      }).join('')}`;
  }

  /** The tab stays a secret until the first achievement. */
  private renderAchievements(profile: Profile): void {
    const all = Object.values(getCatalog().achievements);
    const owned = new Set(profile.achievements);
    this.el('hub-tab-achievements').hidden = owned.size === 0;
    const row = (item: AchievementDefinition): string => {
      const done = owned.has(item.id);
      return `<li class="${done ? 'hub-done' : ''}"><span><strong>${escapeHtml(item.name)}</strong><br>${escapeHtml(item.description)}</span><span>${done ? 'получено' : `+${item.emeralds}`}</span></li>`;
    };
    const open = all.filter((item) => !item.hidden);
    const hidden = all.filter((item) => item.hidden);
    const found = hidden.filter((item) => owned.has(item.id));
    const left = hidden.length - found.length;
    this.el('hub-achievements').innerHTML = `
      <p class="hub-help">Получено ${all.filter((item) => owned.has(item.id)).length} из ${all.length}. Награда в изумрудах выдаётся один раз в конце забега.</p>
      <ul class="hub-goals">${open.map(row).join('')}</ul>
      <h2>Скрытые: ${found.length} из ${hidden.length}</h2>
      <ul class="hub-goals">${found.map(row).join('')}${left
        ? `<li><span>??? Ещё не найдено: ${left}</span><span></span></li>` : ''}</ul>`;
  }

  private async showKey(renew: boolean): Promise<void> {
    const key = await accountKey(renew);
    if (!this.active) return;
    this.el<HTMLInputElement>('hub-key').value = key;
    this.el('hub-key-show').hidden = true;
    this.el('hub-key-copy').hidden = false;
    this.render(await getProfile());
    this.status(renew ? 'Ключ сменён. Сохраните новый.' : 'Сохраните ключ в надёжном месте.');
  }

  private async switchAccount(): Promise<void> {
    if (this.profile?.is_guest && !window.confirm(
      'Ключ текущего аккаунта не сохранён. После перехода вернуться в него будет нельзя. Продолжить?')) return;
    const pair = await loginByKey(this.el<HTMLInputElement>('hub-key-other').value);
    saveSession(pair);
    this.scene.restart();
  }

  private async unlock(id: string): Promise<void> {
    if (!this.profile) return;
    try {
      this.render(await buyUnlock(id, this.profile.version));
      playSfx('sfx/emerald');
      this.status('Открыто. Теперь встретится в забегах.');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        this.render(await getProfile());
      }
      throw error;
    }
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
      unlocks: [...this.profile.unlocks], achievements: [...this.profile.achievements],
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
