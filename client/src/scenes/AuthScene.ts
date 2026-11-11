import * as Phaser from 'phaser';
import QRCode from 'qrcode';
import {
  createGuest, pollTelegram, restoreSession, saveSession, session,
  startEmail, startTelegram, verifyEmail,
  type TelegramStart, type TokenPair,
} from '../api/auth';

export class AuthScene extends Phaser.Scene {
  private overlay: HTMLElement | null = null;
  private pollTimer: number | null = null;
  private active = false;
  private linking = false;
  private busy = false;

  constructor() { super('Auth'); }

  init(data: { linkAccount?: boolean }): void {
    this.linking = Boolean(data?.linkAccount);
  }

  create(): void {
    this.active = true;
    this.overlay = document.createElement('main');
    this.overlay.className = 'auth-overlay';
    this.overlay.innerHTML = `
      <section class="auth-card" aria-labelledby="auth-title">
        <div class="auth-eyebrow">УБЕЖИЩЕ · ДОСТУП</div>
        <h1 id="auth-title">ПУСТОШЬ</h1>
        <p class="auth-intro">${this.linking ? 'Привяжите вход, чтобы сохранить доступ к аккаунту.' : 'Выживите за пределами убежища. Войдите, чтобы начать.'}</p>
        <p id="auth-status" class="auth-status" role="status">Подключаемся к серверу…</p>
        <div id="auth-methods" hidden>
          <button id="auth-guest" class="auth-primary" type="button">Играть сразу · гость</button>
          <button id="auth-continue" class="auth-primary" type="button" hidden>Продолжить текущий аккаунт</button>
          <p id="auth-link-warning" class="auth-warning" hidden>Если этот адрес или Telegram уже принадлежит другому аккаунту, откроется он. Прогресс текущего гостя не перенесётся.</p>
          <form id="auth-email-form" class="auth-form">
            <label for="auth-email">Вход по почте</label>
            <div class="auth-row"><input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com"><button type="submit">Отправить код</button></div>
          </form>
          <form id="auth-code-form" class="auth-form" hidden>
            <label for="auth-code">Код из письма</label>
            <div class="auth-row"><input id="auth-code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000"><button type="submit">Войти</button></div>
          </form>
          <button id="auth-telegram" class="auth-secondary" type="button">Войти через Telegram</button>
          <div id="auth-telegram-details" class="auth-telegram-details" hidden>
            <a id="auth-telegram-link" target="_blank" rel="noopener noreferrer">Открыть бота в Telegram</a>
            <img id="auth-telegram-qr" alt="QR-код для входа через Telegram">
            <small>Нажмите «Войти в игру» в сообщении бота. Ожидание — 5 минут.</small>
          </div>
          <button id="auth-back" class="auth-back" type="button" hidden>Вернуться в игру</button>
        </div>
      </section>`;
    document.body.append(this.overlay);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    this.el<HTMLButtonElement>('auth-guest').onclick = () => void this.act(async () => this.finish(await createGuest()));
    this.el<HTMLButtonElement>('auth-continue').onclick = () => void this.act(async () => {
      const restored = await restoreSession();
      if (restored) this.finish(restored);
    });
    this.el<HTMLFormElement>('auth-email-form').onsubmit = (event) => {
      event.preventDefault();
      void this.act(async () => {
        const email = this.el<HTMLInputElement>('auth-email').value.trim();
        await startEmail(email);
        this.el('auth-code-form').hidden = false;
        this.status('Письмо отправлено. Откройте ссылку или введите код. В dev ссылка и код есть в логе сервера.');
        this.el<HTMLInputElement>('auth-code').focus();
      });
    };
    this.el<HTMLFormElement>('auth-code-form').onsubmit = (event) => {
      event.preventDefault();
      void this.act(async () => this.finish(await verifyEmail({
        email: this.el<HTMLInputElement>('auth-email').value.trim(),
        code: this.el<HTMLInputElement>('auth-code').value.trim(),
      })));
    };
    this.el<HTMLButtonElement>('auth-telegram').onclick = () => void this.act(async () => {
      this.stopPolling();
      const start = await startTelegram();
      this.el<HTMLAnchorElement>('auth-telegram-link').href = start.deep_link;
      this.el<HTMLImageElement>('auth-telegram-qr').src = await QRCode.toDataURL(start.deep_link, {
        width: 160, margin: 1, color: { dark: '#17211c', light: '#f1ecda' },
      });
      this.el('auth-telegram-details').hidden = false;
      this.status('Откройте бота и подтвердите вход.');
      this.pollTimer = window.setInterval(() => void this.poll(start), 2000);
    });
    this.el<HTMLButtonElement>('auth-back').onclick = () => this.scene.start('Boot');
    void this.initialize();
  }

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    return this.overlay!.querySelector<T>(`#${id}`)!;
  }

  private status(message: string, error = false): void {
    if (!this.active) return;
    const node = this.el('auth-status');
    node.textContent = message;
    node.classList.toggle('auth-error', error);
  }

  private showMethods(): void {
    this.el('auth-methods').hidden = false;
    this.el('auth-guest').hidden = this.linking || Boolean(session());
    this.el('auth-continue').hidden = this.linking || !session();
    this.el('auth-back').hidden = !this.linking;
    this.el('auth-link-warning').hidden = !this.linking;
  }

  private async initialize(): Promise<void> {
    const magicToken = new URLSearchParams(window.location.search).get('token');
    if (magicToken) {
      this.status('Проверяем ссылку из письма…');
      try {
        this.finish(await verifyEmail({ token: magicToken }));
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        window.history.replaceState({}, '', url);
        return;
      } catch (error) {
        this.status(this.message(error), true);
      }
    } else if (!this.linking && session()) {
      try {
        const restored = await restoreSession();
        if (restored && this.active) { this.scene.start('Boot'); return; }
      } catch (error) {
        this.status(this.message(error), true);
      }
    }
    if (!this.active) return;
    this.showMethods();
    if (!magicToken && !session()) this.status('Выберите способ входа.');
    if (this.linking) this.status('Выберите способ привязки.');
  }

  private async act(action: () => Promise<void>): Promise<void> {
    if (this.busy || !this.active) return;
    this.busy = true;
    this.status('Подождите…');
    try { await action(); }
    catch (error) { this.status(this.message(error), true); }
    finally { this.busy = false; }
  }

  private pollBusy = false;
  private async poll(start: TelegramStart): Promise<void> {
    if (this.pollBusy || !this.active) return;
    this.pollBusy = true;
    try {
      const result = await pollTelegram(start);
      if (!this.active) return;
      if (result.status === 'confirmed' && result.tokens) this.finish(result.tokens);
      if (result.status === 'expired') {
        this.stopPolling();
        this.status('Время ожидания истекло. Запросите новую ссылку.', true);
      }
    } catch (error) {
      if (this.active) {
        this.stopPolling();
        this.status(this.message(error), true);
      }
    } finally { this.pollBusy = false; }
  }

  private finish(pair: TokenPair): void {
    if (!this.active) return;
    saveSession(pair);
    this.scene.start('Boot');
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Не удалось выполнить запрос.';
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private cleanup(): void {
    this.active = false;
    this.stopPolling();
    this.overlay?.remove();
    this.overlay = null;
  }
}
