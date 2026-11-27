import * as Phaser from 'phaser';
import {
  adminActions, adminGrant, adminRuns, adminStats, adminUser, adminUsers,
  type AdminCount, type AdminRun, type AdminUser, type AdminUserDetail,
} from '../api/admin';
import { identityLines } from '../api/identities';
import { getCatalog } from '../content/catalog';
import { playSfx } from '../sound';

const SECTIONS = [
  ['stats', 'Статистика'], ['users', 'Игроки'], ['runs', 'Забеги'], ['actions', 'Журнал'],
] as const;
type Section = (typeof SECTIONS)[number][0];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function when(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function clock(seconds: number | null): string {
  if (seconds === null) return '—';
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function short(id: string): string {
  return id.slice(0, 8);
}

/**
 * Admin panel over the game canvas: statistics, players with currency grants, suspicious runs and
 * the audit trail. The server checks `is_admin` on every request; this screen only hides itself.
 */
export class AdminScene extends Phaser.Scene {
  private overlay: HTMLElement | null = null;
  private active = false;
  private busy = false;
  private query = '';
  private flaggedOnly = true;

  constructor() { super('Admin'); }

  create(): void {
    this.active = true;
    this.input.keyboard?.clearCaptures();
    this.overlay = document.createElement('main');
    this.overlay.className = 'auth-overlay';
    this.overlay.innerHTML = `
      <section class="auth-card hub-card admin-card" aria-labelledby="admin-title">
        <button id="admin-back" class="hub-fullscreen" type="button">В убежище</button>
        <div class="auth-eyebrow">УБЕЖИЩЕ · АДМИН</div>
        <h1 id="admin-title">ПАНЕЛЬ</h1>
        <p id="admin-status" class="auth-status" role="status">Загружаем…</p>
        <div id="admin-sections" class="hub-subtabs" role="group" aria-label="Разделы админ-панели">
          ${SECTIONS.map(([id, title]) => `<button type="button" data-section="${id}">${title}</button>`).join('')}
        </div>
        <div id="admin-body"></div>
      </section>`;
    document.body.append(this.overlay);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
    this.el('admin-back').onclick = () => this.scene.start('Hub');
    this.el('admin-sections').onclick = (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-section]');
      const section = SECTIONS.find(([id]) => id === button?.dataset.section)?.[0];
      if (!section) return;
      playSfx('sfx/ui_click');
      this.open(section);
    };
    this.el('admin-body').onclick = (event) => this.onBodyClick(event);
    this.el('admin-body').onsubmit = (event) => this.onBodySubmit(event);
    this.open('stats');
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.overlay!.querySelector<T>(`#${id}`)!;
  }

  private status(message: string, error = false): void {
    if (!this.active) return;
    const node = this.el('admin-status');
    node.textContent = message;
    node.classList.toggle('auth-error', error);
  }

  private open(section: Section): void {
    this.el('admin-sections').querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.section === section));
    });
    void this.act(async () => {
      if (section === 'stats') await this.showStats();
      else if (section === 'users') await this.showUsers();
      else if (section === 'runs') await this.showRuns();
      else await this.showActions();
    });
  }

  private async act(action: () => Promise<void>): Promise<void> {
    if (this.busy || !this.active) return;
    this.busy = true;
    this.status('Загружаем…');
    try {
      await action();
      this.status('Готово.');
    } catch (error) {
      playSfx('sfx/ui_error');
      this.status(error instanceof Error ? error.message : 'Не удалось выполнить запрос.', true);
    } finally { this.busy = false; }
  }

  private body(html: string): void {
    if (this.active) this.el('admin-body').innerHTML = html;
  }

  private name(kind: 'locations' | 'heroes', id: string): string {
    return getCatalog()[kind][id]?.name ?? id;
  }

  private async showStats(): Promise<void> {
    const stats = await adminStats();
    const tile = (title: string, value: string | number): string =>
      `<div><dt>${title}</dt><dd>${value}</dd></div>`;
    const most = Math.max(1, ...stats.days.map((day) => day.runs));
    const table = (title: string, rows: AdminCount[], label: (key: string) => string): string => `
      <h2>${title}</h2>
      <ul class="hub-goals">${rows.length ? rows.map((row) => `<li><span>${escapeHtml(label(row.key))}</span>
        <span>${row.runs} заб. · ${row.bosses} побед</span></li>`).join('') : '<li><span>Нет забегов</span><span></span></li>'}</ul>`;
    this.body(`
      <h2>Игроки</h2>
      <dl class="hub-stats">
        ${tile('Всего', stats.users_total)}${tile('Гости', stats.users_guests)}
        ${tile('Новые сегодня', stats.users_new_today)}${tile('Новые за 7 дн.', stats.users_new_week)}
        ${tile('Заходили сегодня', stats.active_today)}${tile('За 7 дней', stats.active_week)}
        ${tile('Админы', stats.users_admins)}
      </dl>
      <h2>Забеги</h2>
      <dl class="hub-stats">
        ${tile('Всего', stats.runs_total)}${tile('Идут сейчас', stats.runs_in_progress)}
        ${tile('Сегодня', stats.runs_today)}${tile('За 7 дней', stats.runs_week)}
        ${tile('Побед над боссом', stats.boss_kills_week)}${tile('Средняя длина', clock(stats.avg_duration_week))}
        ${tile('Подозрительных', stats.flagged_week)}
      </dl>
      <h2>Экономика</h2>
      <dl class="hub-stats">${tile('Крышек у всех', stats.caps_total)}${tile('Изумрудов у всех', stats.emeralds_total)}</dl>
      <h2>Забеги по дням</h2>
      <ul class="admin-days">${stats.days.map((day) => `<li><span>${day.day.slice(5)}</span>
        <span class="admin-bar"><span style="width:${Math.round(100 * day.runs / most)}%"></span></span>
        <span>${day.runs} / ${day.players} игр.</span></li>`).join('')}</ul>
      ${table('Локации за 7 дней', stats.locations_week, (key) => this.name('locations', key))}
      ${table('Герои за 7 дней', stats.heroes_week, (key) => this.name('heroes', key))}
      ${table('Скорость за 7 дней', stats.speeds_week, (key) => `×${Number(key) / 100}`)}`);
  }

  private userRow(user: AdminUser): string {
    const sign = identityLines(user.identities).join(', ') || (user.is_guest ? 'гость' : '—');
    return `<li><button type="button" class="admin-user" data-user="${user.id}">
      <strong>${short(user.id)}</strong>${user.is_admin ? ' <em>админ</em>' : ''}
      <small>${escapeHtml(sign)}</small>
      <small>Крышки ${user.caps} · изумруды ${user.emeralds} · забегов ${user.runs_count} · лучшее ${clock(user.best_time_s)}</small>
      <small>Был ${when(user.last_seen_at)} · с ${when(user.created_at)}</small></button></li>`;
  }

  private async showUsers(): Promise<void> {
    const { total, users } = await adminUsers(this.query);
    this.body(`
      <form id="admin-search" class="auth-form"><label for="admin-q">Почта, ID в Telegram или полный ID игрока</label>
        <div class="auth-row"><input id="admin-q" type="search" maxlength="320" value="${escapeHtml(this.query)}">
        <button type="submit">Найти</button></div></form>
      <p class="hub-help">Найдено: ${total}${total > users.length ? `, показаны первые ${users.length}` : ''}</p>
      <ul class="admin-users">${users.map((user) => this.userRow(user)).join('')}</ul>`);
  }

  private runRows(runs: AdminRun[], withUser: boolean): string {
    if (!runs.length) return '<p class="hub-help">Забегов нет.</p>';
    return `<ul class="hub-goals admin-runs">${runs.map((run) => `<li><span>
      <strong>${escapeHtml(this.name('locations', run.location_id))}</strong> · ${escapeHtml(this.name('heroes', run.hero_id))} · ×${run.speed / 100}
      <small>${when(run.started_at)} · ${clock(run.duration_s)} · убито ${run.kills ?? '—'}${run.boss_killed ? ' · босс' : ''} · ${run.status}</small>
      ${run.flags.length ? `<small class="admin-flags">${run.flags.map(escapeHtml).join(', ')}</small>` : ''}
      ${withUser ? `<small><button type="button" class="admin-link" data-user="${run.user_id}">игрок ${short(run.user_id)}</button></small>` : ''}
      </span><span>${run.reward_caps ?? 0} кр.${run.emeralds ? ` · ${run.emeralds} изум.` : ''}</span></li>`).join('')}</ul>`;
  }

  private async showRuns(): Promise<void> {
    const runs = await adminRuns(this.flaggedOnly);
    this.body(`
      <label class="hub-autopilot"><input id="admin-flagged" type="checkbox" ${this.flaggedOnly ? 'checked' : ''}>
        <span>Только подозрительные (сервер урезал время, убийства, крышки или босса)</span></label>
      ${this.runRows(runs, true)}`);
    this.el<HTMLInputElement>('admin-flagged').onchange = (event) => {
      this.flaggedOnly = (event.target as HTMLInputElement).checked;
      void this.act(() => this.showRuns());
    };
  }

  private async showActions(): Promise<void> {
    const actions = await adminActions();
    const names: Record<string, string> = { grant: 'Выдача', grant_admin: 'Права админа', revoke_admin: 'Снятие прав' };
    this.body(actions.length ? `<ul class="hub-goals">${actions.map((item) => `<li><span>
      <strong>${names[item.action] ?? escapeHtml(item.action)}</strong> · ${when(item.created_at)}
      <small>${item.admin_id ? `админ ${short(item.admin_id)}` : 'из консоли сервера'} →
        ${item.user_id ? `<button type="button" class="admin-link" data-user="${item.user_id}">игрок ${short(item.user_id)}</button>` : '—'}</small>
      <small>${escapeHtml(JSON.stringify(item.details))}</small></span><span></span></li>`).join('')}</ul>`
      : '<p class="hub-help">Пока ничего не менялось.</p>');
  }

  private showUser(detail: AdminUserDetail): void {
    const { user } = detail;
    const sign = identityLines(user.identities);
    const bosses = user.bosses_killed.map((id) => this.name('locations', id)).join(', ') || 'нет';
    const upgrades = Object.entries(detail.upgrades).map(([id, level]) =>
      `${getCatalog().upgrades[id]?.name ?? id} ${level}`).join(', ') || 'нет';
    this.body(`
      <button type="button" class="auth-back admin-back-list" data-back="users">← К списку игроков</button>
      <h2>Игрок ${short(user.id)}${user.is_admin ? ' · админ' : ''}</h2>
      <p class="hub-help admin-id">ID: ${user.id}<br>${sign.length ? sign.map(escapeHtml).join('<br>') : 'Вход только по ключу (гость)'}<br>
        Создан ${when(user.created_at)}, был ${when(user.last_seen_at)}</p>
      <dl class="hub-stats">
        <div><dt>Крышки</dt><dd>${user.caps}</dd></div><div><dt>Изумруды</dt><dd>${user.emeralds}</dd></div>
        <div><dt>Забегов</dt><dd>${user.runs_count}</dd></div><div><dt>Лучшее</dt><dd>${clock(user.best_time_s)}</dd></div>
      </dl>
      <p class="hub-help">Боссы: ${escapeHtml(bosses)}<br>Улучшения: ${escapeHtml(upgrades)}<br>
        Открыто за изумруды: ${detail.unlocks.length} · достижений: ${detail.achievements.length}</p>
      <h2>Выдать или забрать</h2>
      <form id="admin-grant" class="auth-form" data-user="${user.id}">
        <div class="auth-row">
          <input id="admin-caps" type="number" step="1" value="0" aria-label="Крышки (минус — забрать)">
          <input id="admin-emeralds" type="number" step="1" value="0" aria-label="Изумруды (минус — забрать)">
        </div>
        <label for="admin-note">Крышки · изумруды (минус — забрать). Причина для журнала:</label>
        <div class="auth-row"><input id="admin-note" type="text" maxlength="200" placeholder="компенсация за сбой">
        <button type="submit">Применить</button></div>
      </form>
      <h2>Последние забеги</h2>
      ${this.runRows(detail.runs, false)}`);
  }

  private onBodyClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const user = target.closest<HTMLElement>('[data-user]:not(form)')?.dataset.user;
    if (user) {
      playSfx('sfx/ui_click');
      void this.act(async () => this.showUser(await adminUser(user)));
      return;
    }
    if (target.closest('[data-back]')) this.open('users');
  }

  private onBodySubmit(event: SubmitEvent): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (form.id === 'admin-search') {
      this.query = this.el<HTMLInputElement>('admin-q').value.trim();
      void this.act(() => this.showUsers());
      return;
    }
    if (form.id !== 'admin-grant' || !form.dataset.user) return;
    const caps = Math.trunc(Number(this.el<HTMLInputElement>('admin-caps').value) || 0);
    const emeralds = Math.trunc(Number(this.el<HTMLInputElement>('admin-emeralds').value) || 0);
    if (!caps && !emeralds) {
      this.status('Укажите, сколько крышек или изумрудов изменить.', true);
      return;
    }
    const note = this.el<HTMLInputElement>('admin-note').value;
    const sign = (value: number): string => (value > 0 ? `+${value}` : String(value));
    if (!window.confirm(`Изменить игроку ${short(form.dataset.user)}: крышки ${sign(caps)}, изумруды ${sign(emeralds)}?`)) return;
    const id = form.dataset.user;
    void this.act(async () => {
      this.showUser(await adminGrant(id, caps, emeralds, note));
      playSfx('sfx/ui_buy');
    });
  }

  private cleanup(): void {
    this.active = false;
    this.overlay?.remove();
    this.overlay = null;
  }
}
