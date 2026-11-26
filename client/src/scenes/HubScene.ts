import * as Phaser from 'phaser';
import { accountKey, ApiRequestError, authMethods, deleteAccount, loginByKey, saveSession, session } from '../api/auth';
import { buyUnlock, buyUpgrade, claimAchievement, claimDaily, getProfile, startRun, type Profile } from '../api/game';
import { getCatalog } from '../content/catalog';
import { orderedLocations } from '../content/locations';
import { bundledContentHash } from '../content/hash';
import type { AchievementDefinition, HeroDefinition, PassiveDefinition, UpgradeDefinition, WeaponDefinition } from '../content/schemas';
import { heroTraits, statBonus } from '../content/statText';
import { ATLAS, HUB_MUSIC, TUNES } from '../assets';
import { upgradeCost } from '../economy';
import { applyCrt, settings, updateSettings } from '../settings';
import { fullscreenAvailable, isFullscreen, toggleFullscreen } from '../platform/fullscreen';
import { shelterState } from '../inputState';
import { playSfx, playTune } from '../sound';
import type { RunData } from './RunScene';

const TUNE_PLACES = [['hubTune', 'В убежище'], ['runTune', 'В забеге']] as const;
/** The door on the shelter picture, shares of its size. */
const DOOR = { left: 0.75, right: 0.89, top: 0.55, bottom: 0.93 };

const VOLUMES = [['music', 'Музыка'], ['sfx', 'Звуки']] as const;

const CATEGORIES: readonly [UpgradeDefinition['category'], string][] = [
  ['survival', 'Выживание'], ['combat', 'Бой'], ['scavenge', 'Добыча'], ['slots', 'Слоты'], ['special', 'Особое'],
];

/** 12×12 pixel icons for the tab rail, '#' is a lit pixel. */
const ICONS = {
  run: ['.######.....', '.#....#.....', '.#....#..#..', '.#....#..##.', '.#..########', '.#..########',
    '.#....#..##.', '.#....#..#..', '.#....#.....', '.#....#.....', '.######.....', '............'],
  daily: ['.##########.', '.#........#.', '.#..#.....#.', '.#.#..###.#.', '.##.......#.', '.#........#.',
    '.#..#.....#.', '.#.#..###.#.', '.##.......#.', '.#........#.', '.##########.', '............'],
  heroes: ['....####....', '...######...', '...######...', '....####....', '.....##.....', '..########..',
    '.##########.', '.#.######.#.', '.#.######.#.', '...##..##...', '...##..##...', '..###..###..'],
  upgrades: ['.....##.....', '....####....', '...######...', '..########..', '.####..####.', '.....##.....',
    '....####....', '...######...', '..########..', '.####..####.', '....####....', '....####....'],
  weapons: ['............', '..#.........', '.##########.', '.##########.', '.####.##....', '.###..#.....',
    '.###.##.....', '.###........', '.###........', '.###........', '............', '............'],
  passives: ['.......###..', '......###...', '.....###....', '....###.....', '...#######..', '.......###..',
    '......###...', '.....###....', '....###.....', '...##.......', '..#.........', '............'],
  emeralds: ['............', '...######...', '..#.#..#.#..', '.##########.', '.##.####.##.', '..##.##.##..',
    '...##..##...', '....####....', '.....##.....', '............', '............', '............'],
  achievements: ['.##########.', '##.######.##', '#..######..#', '#..######..#', '.#.######.#.', '..########..',
    '....####....', '.....##.....', '.....##.....', '...######...', '..########..', '............'],
  settings: ['.....##.....', '..#..##..#..', '.##########.', '..###..###..', '.###....###.', '####....####',
    '####....####', '.###....###.', '..###..###..', '.##########.', '..#..##..#..', '.....##.....'],
} as const;

const TABS = [
  ['run', 'Вылазка', 'Выберите героя и локацию и отправляйтесь в Пустошь.'],
  ['daily', 'Задания', 'Новые каждый день, за выполнение — изумруды.'],
  ['heroes', 'Герои', 'У каждого своё оружие и характер. Новых героев открывают успехи в Пустоши.'],
  ['upgrades', 'Улучшения', 'Постоянные улучшения за крышки и изумруды. Действуют в каждом забеге.'],
  ['weapons', 'Оружие', 'Открытое оружие встречается среди карточек забега.'],
  ['passives', 'Перки', 'Перки усиливают героя в забеге, редкие открываются за изумруды.'],
  ['emeralds', 'Изумруды', 'Редкая валюта: откуда она берётся и на что её тратить.'],
  ['achievements', 'Достижения', 'Награды за подвиги и странные поступки.'],
  ['settings', 'Настройки', 'Звук, управление, ключ аккаунта и вход.'],
] as const;
type Tab = (typeof TABS)[number][0];

function pixelIcon(rows: readonly string[]): string {
  const cells = rows.flatMap((row, y) => [...row].map((cell, x) => (cell === '#' ? `M${x} ${y}h1v1h-1z` : '')));
  return `<svg viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges"><path fill="currentColor" d="${cells.join('')}"/></svg>`;
}

function panelHead(tab: Tab): string {
  const [, title, about] = TABS.find(([id]) => id === tab)!;
  return `<h2 class="hub-panel-title">${title}</h2><p class="hub-panel-about">${about}</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  return `${minutes}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
}

const LOCATION_KEY = 'wasteland.location.v1';
const HERO_KEY = 'wasteland.hero.v1';

function loadChoice(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

function saveChoice(key: string, id: string): void {
  try { localStorage.setItem(key, id); } catch { /* only a convenience */ }
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
  private selected = loadChoice(LOCATION_KEY);
  private hero = loadChoice(HERO_KEY);
  private category: UpgradeDefinition['category'] = 'survival';

  constructor() { super('Hub'); }

  create(): void {
    this.active = true;
    this.profile = null;
    this.busy = false;
    // Text fields here need every key, also ones a run may have captured before.
    this.input.keyboard?.clearCaptures();
    this.overlay = document.createElement('main');
    this.overlay.className = 'auth-overlay';
    this.overlay.innerHTML = `
      <section class="auth-card hub-card" aria-labelledby="hub-title">
        <button id="hub-fullscreen" class="hub-fullscreen" type="button" hidden></button>
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
          <div class="hub-layout"><div class="hub-main">
          <section id="hub-panel-run" role="tabpanel" aria-labelledby="hub-tab-run">
            ${panelHead('run')}
            <div class="shelter-view" role="img" aria-label="Закат над пустошью и вход в убежище"></div>
            <button id="hub-hero" class="hub-hero" type="button"></button>
            <ul id="hub-locations" class="hub-locations"></ul>
            <label class="hub-autopilot"><input id="hub-autopilot" type="checkbox"> <span>Автопилот: героем управляет ИИ</span></label>
            <p id="hub-autopilot-note" class="hub-note"></p>
            <button id="hub-start" class="auth-primary" type="button">Отправиться на вылазку</button>
            <p id="hub-location" class="hub-note"></p>
          </section>
          <section id="hub-panel-daily" role="tabpanel" aria-labelledby="hub-tab-daily">
            ${panelHead('daily')}
            <p id="hub-daily-reset" class="hub-help"></p>
            <ul id="hub-daily" class="hub-goals hub-daily"></ul>
          </section>
          <section id="hub-panel-heroes" role="tabpanel" aria-labelledby="hub-tab-heroes">
            ${panelHead('heroes')}
            <ul id="hub-heroes" class="hub-heroes"></ul>
          </section>
          <section id="hub-panel-upgrades" role="tabpanel" aria-labelledby="hub-tab-upgrades">
            ${panelHead('upgrades')}
            <div id="hub-categories" class="hub-subtabs" role="group" aria-label="Виды улучшений"></div>
            <ul id="hub-upgrades" class="hub-upgrades"></ul>
          </section>
          <section id="hub-panel-weapons" role="tabpanel" aria-labelledby="hub-tab-weapons">
            ${panelHead('weapons')}
            <ul id="hub-weapons" class="hub-upgrades hub-items"></ul>
          </section>
          <section id="hub-panel-passives" role="tabpanel" aria-labelledby="hub-tab-passives">
            ${panelHead('passives')}
            <ul id="hub-passives" class="hub-upgrades hub-items"></ul>
          </section>
          <section id="hub-panel-emeralds" role="tabpanel" aria-labelledby="hub-tab-emeralds">
            ${panelHead('emeralds')}
            <div id="hub-emerald-info"></div>
          </section>
          <section id="hub-panel-achievements" role="tabpanel" aria-labelledby="hub-tab-achievements">
            ${panelHead('achievements')}
            <div id="hub-achievements"></div>
          </section>
          <section id="hub-panel-settings" role="tabpanel" aria-labelledby="hub-tab-settings">
            ${panelHead('settings')}
            <fieldset class="hub-settings">
              <legend>Звук и картинка</legend>
              ${VOLUMES.map(([key, title]) => `<label class="hub-volume">${title}
                <input type="range" min="0" max="100" step="5" data-volume="${key}"><output></output></label>`).join('')}
              ${TUNE_PLACES.map(([key, title]) => `<label class="hub-volume">${title}
                <select data-tune="${key}">${key === 'runTune' ? '<option value="auto">По локации</option>' : ''}${
                  TUNES.map(([tune, name]) => `<option value="${tune}">${name}</option>`).join('')}</select></label>`).join('')}
              <label><input type="checkbox" data-setting="crt"> ЭЛТ-эффект</label>
            </fieldset>
            <h2>Управление</h2>
            <p class="hub-help">Мышь: клик — идти в точку, удержание — идти за курсором.<br>Клавиши: WASD или стрелки.<br>Телефон: джойстик под пальцем.<br>Esc, P или II — пауза, громкость и возврат в убежище. R — перебросить карточки. F — во весь экран. I — автопилот, если куплен.<br>Наведите мышь на слот в забеге, чтобы увидеть описание.</p>
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
              <button id="hub-link" class="auth-secondary" type="button" hidden></button>
              <button id="hub-delete" class="auth-back hub-danger" type="button">Удалить аккаунт и данные</button>
            </div>
          </section>
          </div>
          <nav class="hub-tabs" role="tablist" aria-label="Разделы убежища" aria-orientation="vertical">
            ${TABS.map(([id, title]) => `<button type="button" role="tab" id="hub-tab-${id}" title="${title}"
              aria-label="${title}" data-tab="${id}" aria-controls="hub-panel-${id}">${pixelIcon(ICONS[id])}<span class="hub-badge" hidden></span></button>`).join('')}
          </nav></div>
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
    this.overlay.querySelectorAll<HTMLSelectElement>('select[data-tune]').forEach((select) => {
      const key = select.dataset.tune as 'hubTune' | 'runTune';
      select.value = settings()[key];
      if (select.selectedIndex < 0) select.selectedIndex = 0;
      select.onchange = () => {
        updateSettings({ [key]: select.value });
        // Both lists play a sample; leaving the tab brings the shelter tune back.
        playTune(select.value, HUB_MUSIC);
      };
    });
    this.overlay.querySelector<HTMLElement>('.shelter-view')!.onclick = (event) => {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      const door = x > DOOR.left && x < DOOR.right && y > DOOR.top && y < DOOR.bottom;
      shelterState.knocks = door ? shelterState.knocks + 1 : 0;
      if (door) playSfx('sfx/crate_break', 0.6);
    };
    this.el('hub-daily').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-daily]');
      if (button?.dataset.daily) void this.act(() => this.claimQuest(button.dataset.daily!));
    };
    this.el('hub-achievements').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-claim]');
      if (button?.dataset.claim) void this.act(() => this.claim(button.dataset.claim!));
    };
    const full = this.el<HTMLButtonElement>('hub-fullscreen');
    const label = (): void => {
      full.textContent = isFullscreen() ? 'Окно' : 'Во весь экран';
    };
    full.hidden = !fullscreenAvailable();
    label();
    full.onclick = () => void toggleFullscreen();
    document.addEventListener('fullscreenchange', label);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => document.removeEventListener('fullscreenchange', label));
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
    playTune(settings().hubTune, HUB_MUSIC);
    this.el<HTMLButtonElement>('hub-start').onclick = () => void this.act(() => this.beginRun());
    this.el<HTMLButtonElement>('hub-retry').onclick = () => void this.loadProfile();
    this.el<HTMLButtonElement>('hub-link').onclick = () => this.scene.start('Auth', { linkAccount: true });
    this.el<HTMLButtonElement>('hub-delete').onclick = () => void this.act(() => this.removeAccount());
    this.el('hub-locations').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-location]');
      if (!button?.dataset.location || !this.profile) return;
      this.selected = button.dataset.location;
      saveChoice(LOCATION_KEY, this.selected);
      playSfx('sfx/ui_click');
      this.render(this.profile);
    };
    this.el('hub-hero').onclick = () => this.openTab('heroes', true);
    this.el('hub-heroes').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-hero]');
      if (!button?.dataset.hero || !this.profile) return;
      this.hero = button.dataset.hero;
      saveChoice(HERO_KEY, this.hero);
      playSfx('sfx/ui_click');
      this.render(this.profile);
    };
    this.el('hub-categories').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-category]');
      const category = CATEGORIES.find(([id]) => id === button?.dataset.category)?.[0];
      if (!category || !this.profile) return;
      this.category = category;
      playSfx('sfx/ui_click');
      this.render(this.profile);
      this.el('hub-categories').querySelector<HTMLButtonElement>(`[data-category="${category}"]`)?.focus();
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
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
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
    void authMethods().then(({ email, telegram }) => {
      if (this.active) this.el('hub-link').hidden = !email && !telegram;
    });
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
    if (sound) {
      playSfx('sfx/ui_click');
      playTune(settings().hubTune, HUB_MUSIC);
    }
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
    this.renderHeroes(profile);
    const hero = catalog.heroes[this.hero];
    this.el('hub-location').textContent = location && hero
      ? `${location.name} · ${hero.name} · пробел — начать` : '';
    this.renderItems(profile);
    this.renderPurchaseBadges(profile);
    this.renderEmeralds(profile);
    this.renderAchievements(profile);
    this.renderDaily(profile);
    const pilot = catalog.upgrades.autopilot;
    const bought = (profile.upgrades.autopilot ?? 0) > 0;
    this.el<HTMLInputElement>('hub-autopilot').disabled = !bought;
    this.el('hub-autopilot-note').textContent = bought
      ? 'Не закрывайте вкладку игры. В забеге переключается клавишей I.'
      : pilot ? `Купите за ${upgradeCost(pilot, 0)} изумр. на вкладке «Улучшения».` : '';
    this.el('hub-categories').innerHTML = CATEGORIES.map(([category, title]) =>
      `<button type="button" data-category="${category}" aria-pressed="${category === this.category}">${title}</button>`).join('');
    this.el('hub-upgrades').innerHTML = Object.values(catalog.upgrades)
      .filter((upgrade) => upgrade.category === this.category).map((upgrade) => {
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
    }).join('');
  }

  private heroCondition(hero: HeroDefinition, profile: Profile): string {
    const { unlock } = hero;
    const { locations } = getCatalog();
    switch (unlock.type) {
      case 'default': return '';
      case 'runs': return `Сыграйте ${unlock.count} забегов (${Math.min(profile.runs_count, unlock.count)}/${unlock.count})`;
      case 'achievements': return `Получите ${unlock.count} достижений (${Math.min(profile.achievements.length, unlock.count)}/${unlock.count})`;
      case 'bossKilled': return `Победите босса: ${locations[unlock.location]!.name}`;
      case 'milestone': return `Продержитесь ${formatTime(unlock.atSecond)}: ${locations[unlock.location]!.name}`;
    }
  }

  private renderHeroes(profile: Profile): void {
    const { heroes, weapons } = getCatalog();
    const list = Object.values(heroes);
    const basic = list.find((hero) => hero.unlock.type === 'default')!;
    if (!profile.unlocked_heroes.includes(this.hero)) this.hero = basic.id;
    const picture = (hero: HeroDefinition, frame = ''): string =>
      this.textures.getBase64(ATLAS, `${hero.sprite}${frame}`);
    const ordered = [basic, ...list.filter((hero) => hero !== basic)
      .sort((a, b) => Number(profile.unlocked_heroes.includes(b.id)) - Number(profile.unlocked_heroes.includes(a.id)))];
    this.el('hub-heroes').innerHTML = ordered.map((hero) => {
      const open = profile.unlocked_heroes.includes(hero.id);
      const chosen = hero.id === this.hero;
      const { good, bad } = heroTraits(hero, basic);
      const traits = (items: string[], mark: string): string => items.map((item) =>
        `<li class="${mark}">${escapeHtml(item)}</li>`).join('');
      return `<li><button type="button" data-hero="${escapeHtml(hero.id)}" aria-pressed="${chosen}"
        class="${chosen ? 'hub-hero-chosen' : ''}${open ? '' : ' hub-hero-locked'}" ${open ? '' : 'disabled'}>
        <span class="hub-hero-stage" style="--sheet-a:url('${picture(hero, '/idle_0')}');--sheet-b:url('${picture(hero, '/idle_2')}')"></span>
        <span class="hub-hero-text"><strong>${escapeHtml(hero.name)}</strong>${chosen ? ' <em>выбран</em>' : ''}
        <small>${escapeHtml(hero.description)}</small>
        <small>Оружие: ${escapeHtml(weapons[hero.startingWeapon]!.name)}</small>
        ${open ? '' : `<small class="hub-hero-lock">${escapeHtml(this.heroCondition(hero, profile))}</small>`}
        <ul>${traits(good, 'good')}${traits(bad, 'bad')}</ul></span></button></li>`;
    }).join('');
    const hero = heroes[this.hero]!;
    this.el('hub-hero').innerHTML = `<img alt="" src="${picture(hero)}"><span><strong>${escapeHtml(hero.name)}</strong>
      <small>${escapeHtml(hero.description)}</small></span><span class="hub-level">Сменить</span>`;
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

  /** Counts of what the emeralds on hand can buy right now, on the rail icons. */
  private renderPurchaseBadges(profile: Profile): void {
    const { upgrades, weapons, passives } = getCatalog();
    const upgradesReady = Object.values(upgrades).filter((upgrade) => {
      const level = profile.upgrades[upgrade.id] ?? 0;
      return upgrade.currency === 'emeralds' && level < upgrade.maxLevel
        && upgradeCost(upgrade, level) <= profile.emeralds;
    }).length;
    const unlockable = (items: (WeaponDefinition | PassiveDefinition)[]): number => items.filter((item) =>
      item.unlock.type === 'emeralds' && !profile.unlocks.includes(item.id)
      && item.unlock.emeralds <= profile.emeralds).length;
    this.badge('upgrades', upgradesReady, false);
    this.badge('weapons', unlockable(Object.values(weapons)), false);
    this.badge('passives', unlockable(Object.values(passives)), false);
  }

  private badge(tab: Tab, count: number, blink: boolean): void {
    const button = this.el(`hub-tab-${tab}`);
    const mark = button.querySelector<HTMLElement>('.hub-badge')!;
    mark.hidden = count === 0;
    mark.textContent = String(count);
    button.classList.toggle('hub-blink', blink);
    const title = TABS.find(([id]) => id === tab)![1];
    button.setAttribute('aria-label', count ? `${title}: ${count}` : title);
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
          ${marks.map((mark) => row(`Впервые продержаться ${formatTime(mark.atSecond)}`, mark.amount, reached.some((value) => value >= mark.atSecond))).join('')}
        </ul>`;
      }).join('')}`;
  }

  /** The tab stays a secret until the first achievement. */
  private renderAchievements(profile: Profile): void {
    const all = Object.values(getCatalog().achievements);
    const owned = new Set(profile.achievements);
    const waiting = new Set(profile.achievements_unclaimed);
    const tab = this.el('hub-tab-achievements');
    tab.hidden = owned.size === 0;
    this.badge('achievements', waiting.size, waiting.size > 0);
    const row = (item: AchievementDefinition): string => {
      const done = owned.has(item.id);
      const reward = waiting.has(item.id)
        ? `<button type="button" data-claim="${escapeHtml(item.id)}">Забрать +${item.emeralds}</button>`
        : done ? 'получено' : `+${item.emeralds}`;
      return `<li class="${done && !waiting.has(item.id) ? 'hub-done' : ''}"><span><strong>${escapeHtml(item.name)}</strong><br>${escapeHtml(item.description)}</span><span>${reward}</span></li>`;
    };
    const ready = all.filter((item) => waiting.has(item.id));
    const open = all.filter((item) => !item.hidden && !waiting.has(item.id));
    const hidden = all.filter((item) => item.hidden);
    const found = hidden.filter((item) => owned.has(item.id));
    const shown = found.filter((item) => !waiting.has(item.id));
    const left = hidden.length - found.length;
    this.el('hub-achievements').innerHTML = `
      <p class="hub-help">Получено ${all.filter((item) => owned.has(item.id)).length} из ${all.length}. Нажмите «Забрать», чтобы получить изумруды.</p>
      ${ready.length ? `<h2>Заберите награду</h2><ul class="hub-goals">${ready.map(row).join('')}</ul><h2>Список</h2>` : ''}
      <ul class="hub-goals">${open.map(row).join('')}</ul>
      <h2>Скрытые: ${found.length} из ${hidden.length}</h2>
      <ul class="hub-goals">${shown.map(row).join('')}${left
        ? `<li><span>??? Ещё не найдено: ${left}</span><span></span></li>` : ''}</ul>`;
  }

  private renderDaily(profile: Profile): void {
    const { quests, resets_at: reset } = profile.daily;
    const ready = quests.filter((quest) => quest.progress >= quest.goal && !quest.claimed).length;
    this.badge('daily', ready, ready > 0);
    const hours = Math.max(0, Math.ceil((Date.parse(reset) - Date.now()) / 3600000));
    this.el('hub-daily-reset').textContent = `Одинаковые для всех игроков. Новые задания через ${hours} ч. Забеги с автопилотом не считаются.`;
    this.el('hub-daily').innerHTML = quests.map((quest) => {
      const done = quest.progress >= quest.goal;
      const shown = quest.metric === 'survive'
        ? `${formatTime(quest.progress)} / ${formatTime(quest.goal)}` : `${quest.progress} / ${quest.goal}`;
      const reward = quest.claimed ? 'получено' : done
        ? `<button type="button" data-daily="${escapeHtml(quest.id)}">Забрать +${quest.emeralds}</button>`
        : `+${quest.emeralds}`;
      return `<li class="${quest.claimed ? 'hub-done' : ''}"><span><strong>${escapeHtml(quest.text)}</strong>
        <span class="hub-bar"><span style="width:${Math.round(100 * Math.min(1, quest.progress / quest.goal))}%"></span></span>
        <small>${shown}</small></span><span>${reward}</span></li>`;
    }).join('');
  }

  private async claimQuest(id: string): Promise<void> {
    if (!this.profile) return;
    try {
      this.render(await claimDaily(id, this.profile.version));
      playSfx('sfx/emerald');
      this.status('Награда за задание получена.');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        this.render(await getProfile());
      }
      throw error;
    }
  }

  private async claim(id: string): Promise<void> {
    if (!this.profile) return;
    try {
      this.render(await claimAchievement(id, this.profile.version));
      playSfx('sfx/emerald');
      this.status(`Изумруды получены: +${getCatalog().achievements[id]?.emeralds ?? 0}.`);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        this.render(await getProfile());
      }
      throw error;
    }
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
      startRun(location.id, this.hero), bundledContentHash(),
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
      seed, wave, locationId: location.id, heroId: this.hero,
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
