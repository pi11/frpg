import * as Phaser from 'phaser';
import { accountKey, ApiRequestError, authMethods, deleteAccount, loginByKey, saveSession, session, webPage } from '../api/auth';
import { VERSION } from '../changelog';
import { openExternal } from '../platform/native';
import { identityLines } from '../api/identities';
import { buyBoost, buyUnlock, buyUpgrade, claimAchievement, claimDaily, getProfile, startRun, type Profile } from '../api/game';
import { getCatalog } from '../content/catalog';
import { orderedLocations } from '../content/locations';
import { bundledContentHash } from '../content/hash';
import type {
  AchievementDefinition, BoostDefinition, ContractDefinition, HeroDefinition, PassiveDefinition, ProgressUnlock, UpgradeDefinition,
  WeaponDefinition,
} from '../content/schemas';
import { heroTraits, statBonus } from '../content/statText';
import { ATLAS, HUB_MUSIC, TUNES } from '../assets';
import { upgradeCost } from '../economy';
import { applyCrt, settings, updateSettings } from '../settings';
import { fullscreenAvailable, isFullscreen, toggleFullscreen } from '../platform/fullscreen';
import { shelterState } from '../inputState';
import { playSfx, playTune } from '../sound';
import { isGated, loadSeen, newSince, openedNow, saveSeen, tabHint, tabOpen, type Opened } from '../ui/progression';
import type { RunData } from './RunScene';

const TUNE_PLACES = [['hubTune', 'В убежище'], ['runTune', 'В забеге']] as const;
/** The door on the shelter picture, shares of its size. */
const DOOR = { left: 0.75, right: 0.89, top: 0.55, bottom: 0.93 };

const VOLUMES = [['music', 'Музыка'], ['sfx', 'Звуки']] as const;

/** Upgrades for caps; the emerald ones (slots, special) live on the emerald tab. */
const CATEGORIES: readonly [UpgradeDefinition['category'], string][] = [
  ['survival', 'Выживание'], ['combat', 'Бой'], ['scavenge', 'Добыча'],
];

/** Sections of the emerald tab; slots and special are upgrade categories. */
const SHOP_TABS = [
  ['weapons', 'Оружие'], ['passives', 'Перки'], ['boosts', 'На забег'], ['slots', 'Слоты'], ['special', 'Особое'],
  ['info', 'Где добыть'],
] as const;
type ShopTab = (typeof SHOP_TABS)[number][0];

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
  shop: ['............', '...######...', '..#.#..#.#..', '.##########.', '.##.####.##.', '..##.##.##..',
    '...##..##...', '....####....', '.....##.....', '............', '............', '............'],
  achievements: ['.##########.', '##.######.##', '#..######..#', '#..######..#', '.#.######.#.', '..########..',
    '....####....', '.....##.....', '.....##.....', '...######...', '..########..', '............'],
  settings: ['.....##.....', '..#..##..#..', '.##########.', '..###..###..', '.###....###.', '####....####',
    '####....####', '.###....###.', '..###..###..', '.##########.', '..#..##..#..', '.....##.....'],
} as const;

const LOCK = ['............', '....####....', '...#....#...', '...#....#...', '...#....#...', '..########..',
  '..###..###..', '..###..###..', '..####.###..', '..########..', '..########..', '............'] as const;

const TABS = [
  ['run', 'Вылазка', 'Выберите героя и локацию и отправляйтесь в Пустошь.'],
  ['daily', 'Задания', 'Новые каждый день, за выполнение — изумруды.'],
  ['heroes', 'Герои', 'У каждого своё оружие и характер. Новых героев открывают успехи в Пустоши.'],
  ['upgrades', 'Улучшения', 'Постоянные улучшения за крышки. Действуют в каждом забеге.'],
  ['shop', 'За изумруды', 'Новое оружие и перки для карточек забега, слоты и особые вещи.'],
  ['achievements', 'Достижения', 'Награды за подвиги и странные поступки.'],
  ['settings', 'Настройки', 'Звук, управление, ключ аккаунта и вход.'],
] as const;

/** Each rail icon has its own colour, so a thumb finds it without reading. */
const TAB_COLORS: Record<Tab, string> = {
  run: '#9bff6e', daily: '#f2c46b', heroes: '#ff9f5a', upgrades: '#6ec8ff',
  shop: '#3ee08a', achievements: '#ffd84a', settings: '#b9c6be',
};
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
/** '' is a full run; otherwise the id of the chosen contract. */
const CONTRACT_KEY = 'wasteland.contract.v1';
const SPEED_KEY = 'wasteland.speed.v1';

function speedLabel(percent: number): string {
  return `×${String(percent / 100).replace('.', ',')}`;
}

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
  private contract = loadChoice(CONTRACT_KEY);
  /** Wanted game speed in percent; lowered to what the chosen location has open. */
  private speed = Number(loadChoice(SPEED_KEY)) || 100;
  private category: UpgradeDefinition['category'] = 'survival';
  private shopTab: ShopTab = 'weapons';
  private gemSrc: string | undefined;
  /** Tabs, items and heroes this browser has shown the player, for the "new" marks. */
  private seen: (Opened & { visited: string[] }) | null = null;

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
            <div id="hub-modes" class="hub-subtabs hub-modes" role="group" aria-label="Режим вылазки"></div>
            <p id="hub-mode-note" class="hub-note"></p>
            <div id="hub-speeds" class="hub-subtabs hub-speeds" role="group" aria-label="Скорость игры"></div>
            <p id="hub-speed-note" class="hub-note"></p>
            <label class="hub-autopilot"><input id="hub-autopilot" type="checkbox"> <span>Автопилот: героем управляет ИИ</span></label>
            <p id="hub-autopilot-note" class="hub-note"></p>
            <button id="hub-start" class="auth-primary" type="button">Отправиться на вылазку</button>
            <p id="hub-location" class="hub-note"></p>
            <p id="hub-boosts-ready" class="hub-note hub-boosts-ready" hidden></p>
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
          <section id="hub-panel-shop" role="tabpanel" aria-labelledby="hub-tab-shop">
            ${panelHead('shop')}
            <div id="hub-shop-tabs" class="hub-subtabs" role="group" aria-label="Покупки за изумруды"></div>
            <ul id="hub-weapons" class="hub-upgrades hub-items"></ul>
            <ul id="hub-passives" class="hub-upgrades hub-items"></ul>
            <ul id="hub-boosts" class="hub-upgrades hub-items"></ul>
            <ul id="hub-shop-upgrades" class="hub-upgrades"></ul>
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
            <ul id="hub-identities" class="hub-identities"></ul>
            <p class="hub-help">ID аккаунта: <span id="hub-user-id" class="hub-user-id"></span></p>
            <div class="hub-account">
              <button id="hub-link" class="auth-secondary" type="button" hidden></button>
              <button id="hub-admin" class="auth-secondary" type="button" hidden>Админ-панель</button>
              <button id="hub-delete" class="auth-back hub-danger" type="button">Удалить аккаунт и данные</button>
            </div>
            <h2>Об игре</h2>
            <p class="hub-help">Версия ${VERSION}</p>
            <div class="hub-account">
              <button id="hub-help" class="auth-secondary" type="button">Помощь</button>
              <button id="hub-changelog" class="auth-secondary" type="button">Что нового</button>
            </div>
          </section>
          <section id="hub-panel-locked" class="hub-locked-panel" role="tabpanel" hidden>
            ${pixelIcon(LOCK)}<h2 id="hub-locked-title"></h2><p id="hub-locked-hint" class="hub-help"></p>
          </section>
          </div>
          <nav class="hub-tabs" role="tablist" aria-label="Разделы убежища" aria-orientation="vertical">
            ${TABS.map(([id, title]) => `<button type="button" role="tab" id="hub-tab-${id}" title="${title}" style="--tab:${TAB_COLORS[id]}"
              aria-label="${title}" data-tab="${id}" aria-controls="hub-panel-${id}">${pixelIcon(ICONS[id])}<span class="hub-badge" hidden></span><span class="hub-lock">${pixelIcon(LOCK)}</span></button>`).join('')}
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
      if (button?.dataset.daily) void this.act(() => this.claimQuest(button.dataset.daily!, button.getBoundingClientRect()));
    };
    this.el('hub-achievements').onclick = (event) => {
      const all = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-claim-all]');
      if (all) {
        void this.act(() => this.claimAll(all.getBoundingClientRect()));
        return;
      }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-claim]');
      if (button?.dataset.claim) void this.act(() => this.claim(button.dataset.claim!, button.getBoundingClientRect()));
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
    this.el<HTMLButtonElement>('hub-admin').onclick = () => this.scene.start('Admin');
    this.el<HTMLButtonElement>('hub-help').onclick = () => void openExternal(webPage('/help'));
    this.el<HTMLButtonElement>('hub-changelog').onclick = () => void openExternal(webPage('/changelog'));
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
    this.el('hub-modes').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-contract]');
      if (!button || button.dataset.contract === undefined || !this.profile) return;
      this.contract = button.dataset.contract;
      saveChoice(CONTRACT_KEY, this.contract);
      playSfx('sfx/ui_click');
      this.render(this.profile);
    };
    this.el('hub-speeds').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-speed]');
      if (!button?.dataset.speed || !this.profile) return;
      this.speed = Number(button.dataset.speed);
      saveChoice(SPEED_KEY, String(this.speed));
      playSfx('sfx/ui_click');
      this.render(this.profile);
    };
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
    for (const list of ['hub-upgrades', 'hub-shop-upgrades']) {
      this.el(list).onclick = (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-upgrade]');
        if (button?.dataset.upgrade) void this.act(() => this.buy(button.dataset.upgrade!));
      };
    }
    this.el('hub-shop-tabs').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-shop]');
      const tab = SHOP_TABS.find(([id]) => id === button?.dataset.shop)?.[0];
      if (!tab || !this.profile) return;
      this.shopTab = tab;
      playSfx('sfx/ui_click');
      this.render(this.profile);
      this.el('hub-shop-tabs').querySelector<HTMLButtonElement>(`[data-shop="${tab}"]`)?.focus();
    };
    for (const list of ['hub-weapons', 'hub-passives']) {
      this.el(list).onclick = (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-unlock]');
        if (button?.dataset.unlock) void this.act(() => this.unlock(button.dataset.unlock!));
      };
    }
    this.el('hub-boosts').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-boost]');
      if (button?.dataset.boost) void this.act(() => this.buyBoost(button.dataset.boost!));
    };
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
    const locked = !this.isTabOpen(tab);
    for (const [id] of TABS) {
      const selected = id === tab;
      const button = this.el<HTMLButtonElement>(`hub-tab-${id}`);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      this.el(`hub-panel-${id}`).hidden = !selected || locked;
    }
    this.el('hub-panel-locked').hidden = !locked;
    if (locked && isGated(tab)) {
      this.el('hub-locked-title').textContent = `${TABS.find(([id]) => id === tab)![1]}: пока закрыто`;
      this.el('hub-locked-hint').textContent = `${tabHint(tab)}. Возвращайтесь из Пустоши — в убежище всё время появляется новое.`;
    }
    if (!locked) this.markVisited(tab);
    if (sound) {
      playSfx('sfx/ui_click');
      playTune(settings().hubTune, HUB_MUSIC);
    }
  }

  private isTabOpen(tab: Tab): boolean {
    if (!isGated(tab)) return true;
    if (!this.profile) return false;
    return tabOpen(tab, this.profile) || Boolean(this.seen?.tabs.includes(tab));
  }

  /** A newly opened tab glows until the player looks inside. */
  private markVisited(tab: Tab): void {
    if (!this.seen || !this.profile || this.seen.visited.includes(tab)) return;
    this.seen.visited.push(tab);
    saveSeen(this.profile.user_id, this.seen);
    this.el(`hub-tab-${tab}`).classList.remove('hub-new');
  }

  /**
   * Locks and "new" marks on the rail, and a window listing what opened since the last
   * visit. Opened tabs stay open in this browser even if the rule stops holding
   * (all emeralds spent).
   */
  private renderProgress(profile: Profile): void {
    const now = openedNow(profile);
    const before = this.seen ?? loadSeen(profile.user_id);
    now.tabs = [...new Set([...now.tabs, ...(before?.tabs ?? [])])];
    const fresh = newSince(before, now);
    const visited = before ? before.visited : [...now.tabs];
    this.seen = { ...now, visited };
    saveSeen(profile.user_id, this.seen);
    for (const [id] of TABS) {
      if (!isGated(id)) continue;
      const open = now.tabs.includes(id);
      const button = this.el(`hub-tab-${id}`);
      button.classList.toggle('hub-tab-locked', !open);
      button.classList.toggle('hub-new', open && !visited.includes(id));
      button.title = open ? TABS.find(([tab]) => tab === id)![1] : `${TABS.find(([tab]) => tab === id)![1]} — ${tabHint(id).toLowerCase()}`;
    }
    this.el('hub-hero').hidden = !now.tabs.includes('heroes');
    if (fresh.tabs.length || fresh.items.length || fresh.heroes.length) this.celebrate(fresh);
    if (!this.isTabOpen(this.tab)) this.openTab(this.tab, false);
    else this.el('hub-panel-locked').hidden = true;
  }

  /** "Открыто новое!": a window with what this visit brought, shown once. */
  private celebrate(fresh: Opened): void {
    const { weapons, passives, heroes } = getCatalog();
    const rows: string[] = [];
    const row = (picture: string, title: string, text: string): void => {
      rows.push(`<li style="--i:${rows.length}">${picture}<span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></span></li>`);
    };
    const sprite = (key: string): string => `<img alt="" src="${this.textures.getBase64(ATLAS, key)}">`;
    for (const id of fresh.tabs) {
      const tab = TABS.find(([key]) => key === id);
      if (tab) row(`<span class="hub-celebrate-icon" style="--tab:${TAB_COLORS[tab[0]]}">${pixelIcon(ICONS[tab[0]])}</span>`, `Новый раздел: ${tab[1]}`, tab[2]);
    }
    for (const id of fresh.heroes) {
      const hero = heroes[id];
      if (hero) row(sprite(hero.sprite), `Новый герой: ${hero.name}`, hero.description);
    }
    const items = [...fresh.items].sort((a, b) => Number(Boolean(weapons[b])) - Number(Boolean(weapons[a])));
    for (const id of items) {
      const item = weapons[id] ?? passives[id];
      // Bought ones the player chose themselves; only gifts of progress are news.
      if (!item || item.unlock.type === 'emeralds' || item.unlock.type === 'default') continue;
      row(sprite(item.sprite), `${weapons[id] ? 'Новое оружие' : 'Новый перк'}: ${item.name}`,
        `${item.description}. Теперь встречается в забегах.`);
    }
    if (!rows.length) return;
    this.overlay?.querySelector('.hub-celebrate')?.remove();
    const dialog = document.createElement('div');
    dialog.className = 'hub-celebrate';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'hub-celebrate-title');
    dialog.innerHTML = `<div class="hub-celebrate-card"><div class="hub-celebrate-rays" aria-hidden="true"></div>
      <h2 id="hub-celebrate-title">Открыто новое!</h2><ul>${rows.join('')}</ul>
      <button type="button">Отлично!</button></div>`;
    const close = (): void => {
      dialog.remove();
      playSfx('sfx/ui_click');
    };
    dialog.querySelector('button')!.onclick = close;
    dialog.onclick = (event) => { if (event.target === dialog) close(); };
    this.overlay?.append(dialog);
    dialog.querySelector('button')!.focus();
    playSfx('sfx/powerup');
  }

  /** Emeralds fly from the claim button into the counter, which counts up as they land. */
  private flyEmeralds(from: DOMRect, amount: number): void {
    const counter = this.el('hub-emeralds');
    const target = this.el('hub-emerald-icon').getBoundingClientRect();
    const total = this.profile?.emeralds ?? 0;
    const startValue = Math.max(0, total - amount);
    const x = from.left + from.width / 2;
    const y = from.top + from.height / 2;
    const float = document.createElement('div');
    float.className = 'hub-float';
    float.textContent = `+${amount}`;
    float.style.left = `${x}px`;
    float.style.top = `${y}px`;
    this.overlay?.append(float);
    float.addEventListener('animationend', () => float.remove());
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !target.width) {
      this.bump(counter, total);
      return;
    }
    counter.textContent = String(startValue);
    const count = Math.max(3, Math.min(amount, 14));
    const src = this.el<HTMLImageElement>('hub-emerald-icon').src;
    let landed = 0;
    for (let index = 0; index < count; index += 1) {
      const gem = document.createElement('img');
      gem.className = 'hub-fly';
      gem.alt = '';
      gem.src = src;
      gem.style.left = `${x}px`;
      gem.style.top = `${y}px`;
      this.overlay?.append(gem);
      const angle = (index / count) * Math.PI * 2;
      const spread = 30 + (index % 3) * 16;
      const dx = target.left + target.width / 2 - x;
      const dy = target.top + target.height / 2 - y;
      const animation = gem.animate([
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
        { transform: `translate(calc(-50% + ${Math.cos(angle) * spread}px), calc(-50% + ${Math.sin(angle) * spread}px)) scale(1.6) rotate(${index * 40}deg)`, opacity: 1, offset: 0.3 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.9) rotate(${index * 40 + 360}deg)`, opacity: 1 },
      ], { duration: 820 + index * 45, delay: index * 35, easing: 'cubic-bezier(.45,.05,.55,1)', fill: 'backwards' });
      animation.onfinish = () => {
        gem.remove();
        landed += 1;
        if (!this.active) return;
        this.bump(counter, landed === count ? total : startValue + Math.round(amount * landed / count));
        if (landed % 2 === 1 || landed === count) playSfx('sfx/xp_pickup', 0.5);
      };
    }
  }

  private bump(counter: HTMLElement, value: number): void {
    counter.textContent = String(value);
    const box = counter.closest('div');
    box?.classList.remove('hub-bump');
    void box?.offsetWidth;
    box?.classList.add('hub-bump');
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
    this.el('hub-link').textContent = profile.is_guest ? 'Привязать почту или Telegram' : 'Добавить способ входа';
    this.el('hub-admin').hidden = !profile.is_admin;
    this.el('hub-user-id').textContent = profile.user_id;
    const lines = identityLines(profile.identities);
    this.el('hub-identities').innerHTML = lines.length
      ? lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')
      : '<li class="hub-identities-none">Вход только по ключу аккаунта: почта и Telegram не привязаны.</li>';
    const locations = orderedLocations(catalog);
    if (!profile.unlocked_locations.includes(this.selected)) {
      this.selected = locations.find((item) => profile.unlocked_locations.includes(item.id))?.id ?? '';
    }
    // Open places and only the next closed one: the rest stay a surprise.
    const nextLocked = locations.find((item) => !profile.unlocked_locations.includes(item.id));
    const shown = locations.filter((item) => profile.unlocked_locations.includes(item.id) || item === nextLocked);
    const hiddenCount = locations.length - shown.length;
    this.el('hub-locations').innerHTML = shown.map((location) => {
      const open = profile.unlocked_locations.includes(location.id);
      const chosen = location.id === this.selected;
      const beaten = profile.bosses_killed.includes(location.id) ? ' · босс повержен' : '';
      const lock = location.unlock.type === 'bossKilled'
        ? `Откроется после победы над боссом: ${catalog.locations[location.unlock.location]?.name ?? '?'}` : '';
      return `<li><button type="button" data-location="${escapeHtml(location.id)}"
        class="${chosen ? 'hub-location-chosen' : ''}" ${open ? '' : 'disabled'} aria-pressed="${chosen}">
        <strong>${escapeHtml(location.name)}</strong> <span class="hub-level">награда ×${location.rewardMultiplier}${beaten}</span>
        <small>${escapeHtml(open ? location.description : lock)}</small>${open && location.specialRule
          ? `<small class="hub-rule">! ${escapeHtml(location.specialRule.name)}: ${escapeHtml(location.specialRule.description)}</small>` : ''}</button></li>`;
    }).join('') + (hiddenCount
      ? `<li class="hub-more"><small>Дальше по карте ещё ${hiddenCount} ${hiddenCount === 1 ? 'место' : hiddenCount < 5 ? 'места' : 'мест'}…</small></li>` : '');
    const location = catalog.locations[this.selected];
    this.renderModes();
    this.renderSpeeds(profile);
    this.renderHeroes(profile);
    const hero = catalog.heroes[this.hero];
    this.el('hub-location').textContent = location && hero
      ? `${location.name} · ${hero.name} · ${speedLabel(this.runSpeed(profile))} · пробел — начать` : '';
    this.renderItems(profile);
    this.renderPurchaseBadges(profile);
    this.renderEmeralds(profile);
    this.renderBoosts(profile);
    this.renderAchievements(profile);
    this.renderDaily(profile);
    const pilot = catalog.upgrades.autopilot;
    const bought = (profile.upgrades.autopilot ?? 0) > 0;
    // Early on the start screen is only hero, location and the button.
    const fast = Object.values(profile.speeds).some((open) => open.length > 1);
    this.el('hub-speeds').hidden = !fast;
    this.el('hub-speed-note').hidden = !fast && !profile.bosses_killed.length;
    this.el<HTMLElement>('hub-autopilot').closest('label')!.hidden = !bought;
    this.el('hub-autopilot-note').hidden = !bought && !this.isTabOpen('shop');
    this.el<HTMLInputElement>('hub-autopilot').disabled = !bought;
    this.el('hub-autopilot-note').innerHTML = bought
      ? 'Не закрывайте вкладку игры. В забеге переключается клавишей I.'
      : pilot ? `Купите за ${upgradeCost(pilot, 0)}${this.gem()}: вкладка «За изумруды», раздел «Особое».` : '';
    this.el('hub-categories').innerHTML = CATEGORIES.map(([category, title]) =>
      `<button type="button" data-category="${category}" aria-pressed="${category === this.category}">${title}</button>`).join('');
    const row = (upgrade: UpgradeDefinition): string => {
      // A level bought before the maximum was lowered still counts only up to the maximum.
      const level = Math.min(profile.upgrades[upgrade.id] ?? 0, upgrade.maxLevel);
      const maxed = level >= upgrade.maxLevel;
      const cost = maxed ? 0 : upgradeCost(upgrade, level);
      const emeralds = upgrade.currency === 'emeralds';
      const funds = emeralds ? profile.emeralds : profile.caps;
      const label = maxed ? 'Максимум' : `Купить · ${cost}${emeralds ? this.gem() : ''}`;
      return `<li>
        <div><strong>${escapeHtml(upgrade.name)}</strong> <span class="hub-level">${level}/${upgrade.maxLevel}</span>
        <small>${escapeHtml(effectText(upgrade, level))}</small></div>
        <button type="button" data-upgrade="${escapeHtml(upgrade.id)}" ${maxed || cost > funds ? 'disabled' : ''}>${label}</button>
      </li>`;
    };
    const all = Object.values(catalog.upgrades);
    this.el('hub-upgrades').innerHTML = all.filter((upgrade) => upgrade.category === this.category)
      .map(row).join('');
    this.el('hub-shop-upgrades').innerHTML = all.filter((upgrade) => upgrade.category === this.shopTab)
      .map(row).join('');
    this.renderShopTabs(profile);
    this.renderProgress(profile);
  }

  private renderShopTabs(profile: Profile): void {
    const counts = this.purchasable(profile);
    this.el('hub-shop-tabs').innerHTML = SHOP_TABS.map(([id, title]) => {
      const count = id === 'info' ? 0 : counts[id];
      return `<button type="button" data-shop="${id}" aria-pressed="${id === this.shopTab}">${title}${
        count ? ` <span class="hub-subcount">${count}</span>` : ''}</button>`;
    }).join('');
    this.el('hub-weapons').hidden = this.shopTab !== 'weapons';
    this.el('hub-passives').hidden = this.shopTab !== 'passives';
    this.el('hub-boosts').hidden = this.shopTab !== 'boosts';
    this.el('hub-shop-upgrades').hidden = this.shopTab !== 'slots' && this.shopTab !== 'special';
    this.el('hub-emerald-info').hidden = this.shopTab !== 'info';
  }

  /** The wanted speed, or the fastest open one below it here. */
  private runSpeed(profile: Profile): number {
    const open = profile.speeds[this.selected] ?? [100];
    return [...open].reverse().find((percent) => percent <= this.speed) ?? 100;
  }

  private renderSpeeds(profile: Profile): void {
    const { speeds } = getCatalog().balance;
    const open = profile.speeds[this.selected] ?? [100];
    const current = this.runSpeed(profile);
    this.el('hub-speeds').innerHTML = '<span class="hub-speeds-title">Скорость</span>' + speeds.map(({ percent }) => {
      const unlocked = open.includes(percent);
      return `<button type="button" data-speed="${percent}" aria-pressed="${percent === current}"
        ${unlocked ? '' : 'disabled'} aria-label="Скорость ${speedLabel(percent)}">${speedLabel(percent)}</button>`;
    }).join('');
    const next = speeds.find(({ percent }) => !open.includes(percent));
    const previous = next && speeds[speeds.indexOf(next) - 1];
    const bonus = speeds.find(({ percent }) => percent === current)?.firstWinEmeralds ?? 0;
    const beaten = Object.values(profile.wins[this.selected] ?? {}).some((value) => value >= current);
    const parts: string[] = [];
    if (current > 100) parts.push('Всё в забеге идёт быстрее, время на таймере — игровое.');
    if (bonus && !beaten) parts.push(`Первая победа над боссом на ${speedLabel(current)}: +${bonus}${this.gem()}`);
    if (next && previous) {
      parts.push(`${speedLabel(next.percent)} откроется после победы над боссом на ${speedLabel(previous.percent)}.`);
    }
    this.el('hub-speed-note').innerHTML = parts.join(' ');
  }

  private heroCondition(hero: HeroDefinition, profile: Profile): string {
    return hero.unlock.type === 'default' ? '' : this.progressText(hero.unlock, profile);
  }

  private progressText(unlock: ProgressUnlock, profile: Profile): string {
    const { locations } = getCatalog();
    switch (unlock.type) {
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
      const { unlock } = item;
      const open = profile.open_items.includes(item.id);
      let action = `<span class="hub-open">${unlock.type === 'emeralds' ? 'Открыто' : 'Доступно'}</span>`;
      if (open || unlock.type === 'default') {
        // Shown as open.
      } else if (unlock.type === 'emeralds') {
        action = `<button type="button" data-unlock="${escapeHtml(item.id)}" ${unlock.emeralds > profile.emeralds ? 'disabled' : ''}>Открыть · ${unlock.emeralds}${this.gem()}</button>`;
      } else {
        action = `<span class="hub-open hub-pending">${pixelIcon(LOCK)}</span>`;
        note = [`Откроется: ${this.progressText(unlock, profile)}`, note].filter(Boolean).join('\n');
      }
      return `<li class="${open ? '' : 'hub-locked'}">
        <img class="hub-icon" alt="" src="${this.textures.getBase64(ATLAS, item.sprite)}">
        <div><strong>${escapeHtml(item.name)}</strong>
        <small>${escapeHtml(item.description)}${note ? `<br>${escapeHtml(note).replace(/\n/g, '<br>')}` : ''}</small></div>${action}</li>`;
    };
    const section = (title: string, rows: string[]): string =>
      rows.length ? `<li class="hub-category">${title}</li>${rows.join('')}` : '';
    const byCost = <T extends WeaponDefinition | PassiveDefinition>(items: T[]): T[] =>
      items.sort((a, b) => (a.unlock.type === 'emeralds' ? a.unlock.emeralds : 0)
        - (b.unlock.type === 'emeralds' ? b.unlock.emeralds : 0));
    // Open ones first, then the closest locks.
    const byOpen = <T extends WeaponDefinition | PassiveDefinition>(items: T[]): T[] =>
      items.sort((a, b) => Number(profile.open_items.includes(b.id)) - Number(profile.open_items.includes(a.id)));
    const guns = Object.values(weapons);
    const heavy = byCost(guns.filter((weapon) => weapon.heavy));
    const evolutions = (weapon: WeaponDefinition): string => weapon.evolutions.map(({ into, passive }) =>
      `Эволюция: ${weapons[into]!.name} (перк «${passives[passive]!.name}»)`).join('\n');
    this.el('hub-weapons').innerHTML = section('Обычное оружие', byOpen(guns.filter((weapon) => !weapon.heavy && !weapon.evolved))
      .map((weapon) => row(weapon, evolutions(weapon))))
      + section('Тяжёлое оружие', heavy.map((weapon) => row(weapon, `С ${weapon.minHeroLevel} уровня героя, нужен слот «Лафет»`)));
    const perks = Object.values(passives);
    const note = (perk: PassiveDefinition): string =>
      `${statBonus(perk.stat, perk.perLevel, perk.mod)} за уровень, уровней: ${perk.maxLevel}`;
    const progress = (perk: PassiveDefinition): boolean => perk.unlock.type !== 'emeralds' && perk.unlock.type !== 'default';
    this.el('hub-passives').innerHTML = section('За изумруды',
      byCost(perks.filter((perk) => perk.unlock.type === 'emeralds')).map((perk) => row(perk, note(perk))))
      + section('Откроются в пути', byOpen(perks.filter(progress)).map((perk) => row(perk, note(perk))))
      + section('Доступны сразу',
        perks.filter((perk) => perk.unlock.type === 'default').map((perk) => row(perk, note(perk))));
  }

  /** One-run boosts: bought ones wait in the backpack and are shown on the start screen. */
  private renderBoosts(profile: Profile): void {
    const boosts = Object.values(getCatalog().boosts).sort((a, b) => a.emeralds - b.emeralds);
    const packed = new Set(profile.boosts);
    const effects = (boost: BoostDefinition): string => [
      ...boost.effects.map((effect) => statBonus(effect.stat, effect.value, effect.mod)),
      ...(boost.rewardBonus ? [`+${Math.round(boost.rewardBonus * 100)}% к награде крышками`] : []),
    ].join(', ');
    this.el('hub-boosts').innerHTML = `<li class="hub-category">Действуют один забег</li>
      <li class="hub-help-row"><small>Купленное ждёт в рюкзаке и тратится, как только начнётся следующий забег, даже если выйти из него раньше.</small></li>`
      + boosts.map((boost) => {
        const ready = packed.has(boost.id);
        const action = ready
          ? '<span class="hub-open">В рюкзаке</span>'
          : `<button type="button" data-boost="${escapeHtml(boost.id)}" ${boost.emeralds > profile.emeralds ? 'disabled' : ''}>Купить · ${boost.emeralds}${this.gem()}</button>`;
        return `<li class="${ready ? 'hub-packed' : ''}">
          <img class="hub-icon" alt="" src="${this.textures.getBase64(ATLAS, boost.sprite)}">
          <div><strong>${escapeHtml(boost.name)}</strong>
          <small>${escapeHtml(boost.description)}<br>${escapeHtml(effects(boost))}</small></div>${action}</li>`;
      }).join('');
    const ready = boosts.filter((boost) => packed.has(boost.id));
    const note = this.el('hub-boosts-ready');
    note.hidden = ready.length === 0;
    note.innerHTML = ready.length ? `С собой на один забег: ${ready.map((boost) =>
      `<img class="hub-gem" alt="" src="${this.textures.getBase64(ATLAS, boost.sprite)}">${escapeHtml(boost.name)}`).join(', ')}` : '';
  }

  /** A small emerald after a price or a reward, so it is clear what is paid or earned. */
  private gem(): string {
    this.gemSrc ??= this.textures.getBase64(ATLAS, 'ui/emerald');
    return `<img class="hub-gem" alt=" изумр." src="${this.gemSrc}">`;
  }

  /** What the emeralds on hand can buy right now, per section of the emerald tab. */
  private purchasable(profile: Profile): Record<Exclude<ShopTab, 'info'>, number> {
    const { upgrades, weapons, passives } = getCatalog();
    // Boosts are bought for one run and never run out, so they get no badge.
    const upgradesReady = (category: string): number => Object.values(upgrades).filter((upgrade) => {
      const level = profile.upgrades[upgrade.id] ?? 0;
      return upgrade.currency === 'emeralds' && upgrade.category === category
        && level < upgrade.maxLevel && upgradeCost(upgrade, level) <= profile.emeralds;
    }).length;
    const unlockable = (items: (WeaponDefinition | PassiveDefinition)[]): number => items.filter((item) =>
      item.unlock.type === 'emeralds' && !profile.unlocks.includes(item.id)
      && item.unlock.emeralds <= profile.emeralds).length;
    return {
      weapons: unlockable(Object.values(weapons)), passives: unlockable(Object.values(passives)),
      slots: upgradesReady('slots'), special: upgradesReady('special'), boosts: 0,
    };
  }

  /** The emerald tab shows how many things can be bought right now. */
  private renderPurchaseBadges(profile: Profile): void {
    const total = Object.values(this.purchasable(profile)).reduce((sum, count) => sum + count, 0);
    this.badge('shop', total, false);
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
      `<li class="${done ? 'hub-done' : ''}"><span>${escapeHtml(title)}</span><span>${done ? 'получено' : `+${amount}${this.gem()}`}</span></li>`;
    this.el('hub-emerald-info').innerHTML = `
      <p class="hub-help">За изумруды открывают тяжёлое оружие и редкие перки (они появляются среди карточек забега), докупают слоты и автопилот. Изумруды начисляются в конце забега, даже если герой погиб.</p>
      ${orderedLocations(catalog).filter((location, index, all) => profile.unlocked_locations.includes(location.id)
        || all.findIndex((item) => !profile.unlocked_locations.includes(item.id)) === index).map((location) => {
        const { elite, boss, firstBoss } = location.emeralds;
        const reached = profile.milestones[location.id] ?? [];
        return `<h2>${escapeHtml(location.name)}</h2><ul class="hub-goals">
          ${row('Каждый мини-босс', elite)}${row('Каждая победа над боссом', boss)}
          ${row('Первая победа над боссом', firstBoss, profile.bosses_killed.includes(location.id))}
          ${marks.map((mark) => row(`Впервые продержаться ${formatTime(mark.atSecond)}`, mark.amount, reached.some((value) => value >= mark.atSecond))).join('')}
          ${catalog.balance.speeds.filter((item) => item.firstWinEmeralds > 0).map((item) => row(
            `Первая победа над боссом на скорости ${speedLabel(item.percent)}`, item.firstWinEmeralds,
            Object.values(profile.wins[location.id] ?? {}).some((value) => value >= item.percent))).join('')}
        </ul>`;
      }).join('')}`;
  }

  private renderAchievements(profile: Profile): void {
    const all = Object.values(getCatalog().achievements);
    const owned = new Set(profile.achievements);
    const waiting = new Set(profile.achievements_unclaimed);
    this.badge('achievements', waiting.size, waiting.size > 0);
    const row = (item: AchievementDefinition): string => {
      const done = owned.has(item.id);
      const reward = waiting.has(item.id)
        ? `<button type="button" data-claim="${escapeHtml(item.id)}">Забрать +${item.emeralds}${this.gem()}</button>`
        : done ? 'получено' : `+${item.emeralds}${this.gem()}`;
      return `<li class="${done && !waiting.has(item.id) ? 'hub-done' : ''}"><span><strong>${escapeHtml(item.name)}</strong><br>${escapeHtml(item.description)}</span><span>${reward}</span></li>`;
    };
    const ready = all.filter((item) => waiting.has(item.id));
    // Achievements of places not reached yet would give away their bosses: they wait with the place.
    const places = (item: AchievementDefinition): string[] => {
      const { condition } = item;
      if (condition.type === 'victory') return condition.locations;
      return 'location' in condition && condition.location ? [condition.location] : [];
    };
    const ahead = (item: AchievementDefinition): boolean => !owned.has(item.id)
      && places(item).some((place) => !profile.unlocked_locations.includes(place));
    const later = all.filter((item) => !item.hidden && ahead(item)).length;
    const open = all.filter((item) => !item.hidden && !waiting.has(item.id) && !ahead(item));
    const hidden = all.filter((item) => item.hidden);
    const found = hidden.filter((item) => owned.has(item.id));
    const shown = found.filter((item) => !waiting.has(item.id));
    const left = hidden.length - found.length;
    this.el('hub-achievements').innerHTML = `
      <p class="hub-help">Получено ${all.filter((item) => owned.has(item.id)).length} из ${all.length}. Нажмите «Забрать», чтобы получить изумруды.</p>
      ${ready.length ? `<h2>Заберите награду</h2>${ready.length > 1 ? `<button type="button" class="auth-primary hub-claim-all" data-claim-all>Забрать всё · +${ready.reduce((sum, item) => sum + item.emeralds, 0)}${this.gem()}</button>` : ''}
        <ul class="hub-goals hub-ready">${ready.map(row).join('')}</ul><h2>Список</h2>` : ''}
      <ul class="hub-goals">${open.map(row).join('')}${later
        ? `<li><span>Ещё ${later} откроются вместе с новыми местами</span><span></span></li>` : ''}</ul>
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
        ? `<button type="button" data-daily="${escapeHtml(quest.id)}">Забрать +${quest.emeralds}${this.gem()}</button>`
        : `+${quest.emeralds}${this.gem()}`;
      return `<li class="${quest.claimed ? 'hub-done' : ''}"><span><strong>${escapeHtml(quest.text)}</strong>
        <span class="hub-bar"><span style="width:${Math.round(100 * Math.min(1, quest.progress / quest.goal))}%"></span></span>
        <small>${shown}</small></span><span>${reward}</span></li>`;
    }).join('');
  }

  private async claimQuest(id: string, from: DOMRect): Promise<void> {
    if (!this.profile) return;
    try {
      const before = this.profile.emeralds;
      this.render(await claimDaily(id, this.profile.version));
      playSfx('sfx/emerald');
      this.flyEmeralds(from, this.profile.emeralds - before);
      this.status('Награда за задание получена.');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        this.render(await getProfile());
      }
      throw error;
    }
  }

  private async claim(id: string, from: DOMRect): Promise<void> {
    if (!this.profile) return;
    try {
      const before = this.profile.emeralds;
      this.render(await claimAchievement(id, this.profile.version));
      playSfx('sfx/emerald');
      this.flyEmeralds(from, this.profile.emeralds - before);
      this.status(`«${getCatalog().achievements[id]?.name ?? id}»: +${this.profile.emeralds - before} изумр.`);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        this.render(await getProfile());
      }
      throw error;
    }
  }

  /** One request per achievement; the emeralds of all of them fly together at the end. */
  private async claimAll(from: DOMRect): Promise<void> {
    if (!this.profile) return;
    const before = this.profile.emeralds;
    const ids = [...this.profile.achievements_unclaimed];
    try {
      for (const id of ids) {
        this.profile = await claimAchievement(id, this.profile.version);
      }
    } finally {
      this.render(this.profile);
    }
    playSfx('sfx/emerald');
    this.flyEmeralds(from, this.profile.emeralds - before);
    this.status(`Награды за ${ids.length} достижений: +${this.profile.emeralds - before} изумр.`);
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

  private async buyBoost(id: string): Promise<void> {
    if (!this.profile) return;
    try {
      this.render(await buyBoost(id, this.profile.version));
      playSfx('sfx/ui_buy');
      this.status(`«${getCatalog().boosts[id]?.name ?? id}» уложено в рюкзак на следующий забег.`);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 409) {
        this.render(await getProfile());
      }
      throw error;
    }
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

  /** Contracts of the chosen location, or none; a contract of another place falls back to a full run. */
  private chosenContract(): ContractDefinition | null {
    const contract = getCatalog().contracts[this.contract];
    return contract && contract.location === this.selected ? contract : null;
  }

  /** «Полный забег / Контракт» for the chosen location, with the contract's terms under it. */
  private renderModes(): void {
    const catalog = getCatalog();
    const contracts = Object.values(catalog.contracts).filter((item) => item.location === this.selected);
    const chosen = this.chosenContract();
    this.el('hub-modes').hidden = !contracts.length;
    this.el('hub-mode-note').hidden = !chosen;
    this.el('hub-modes').innerHTML = contracts.length ? [
      `<button type="button" data-contract="" aria-pressed="${!chosen}">Полный забег</button>`,
      ...contracts.map((item) => `<button type="button" data-contract="${escapeHtml(item.id)}"
        aria-pressed="${chosen?.id === item.id}">Контракт: ${escapeHtml(item.name)}</button>`),
    ].join('') : '';
    if (chosen) {
      const enemy = catalog.enemies[chosen.objective.enemy]?.name ?? chosen.objective.enemy;
      const minutes = `${Math.floor(chosen.durationSeconds / 60)}:${String(chosen.durationSeconds % 60).padStart(2, '0')}`;
      this.el('hub-mode-note').textContent = `${chosen.description} Цель: убить «${enemy}» (появится около ${
        Math.floor(chosen.objective.atSecond / 60)}:${String(chosen.objective.atSecond % 60).padStart(2, '0')}) за ${minutes}. `
        + `За цель +${chosen.completionCaps} крышек. Изумрудов, босса и открытия локаций в контракте нет; `
        + 'купленные усиления расходуются при старте.';
    }
    this.el('hub-start').textContent = chosen ? 'Взять контракт' : 'Отправиться на вылазку';
  }

  private async beginRun(): Promise<void> {
    if (!this.profile) return;
    const catalog = getCatalog();
    const location = catalog.locations[this.selected];
    if (!location) throw new Error('Нет открытой локации');
    playSfx('sfx/ui_click');
    this.status('Открываем шлюз…');
    const [run, contentHash] = await Promise.all([
      startRun(location.id, this.hero, this.runSpeed(this.profile), this.chosenContract()?.id ?? null), bundledContentHash(),
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
      openItems: [...this.profile.open_items], achievements: [...this.profile.achievements],
      speed: this.runSpeed(this.profile), boosts: [...(run.boosts ?? [])],
      contractId: run.mode === 'contract' ? run.contract_id ?? undefined : undefined,
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
