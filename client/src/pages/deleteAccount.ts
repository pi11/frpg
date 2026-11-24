import './page';
import {
  deleteAccount, forgetStoredSession, initSession, isTransientError, pollTelegram, saveSession,
  session, startEmail, startTelegram, verifyEmail, type TelegramStart, type TokenPair,
} from '../api/auth';
import { browserTokenStore } from '../platform/tokenStore';
import { memoryTokenStore } from './memoryStore';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

let busy = false;
let pollTimer: number | null = null;

function status(message: string, error = false): void {
  el('delete-status').textContent = message;
  el('delete-status').classList.toggle('auth-error', error);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить запрос.';
}

async function act(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  try { await action(); }
  catch (error) { status(message(error), true); }
  finally { busy = false; }
}

/** Signing in here must neither link to the game's guest account nor replace its session. */
async function isolate(): Promise<void> {
  await initSession(memoryTokenStore());
}

function stopPolling(): void {
  if (pollTimer !== null) window.clearInterval(pollTimer);
  pollTimer = null;
}

function askConfirmation(): void {
  stopPolling();
  el('delete-login').hidden = true;
  el('delete-confirm').hidden = false;
  status('Аккаунт найден. Отменить удаление будет нельзя.');
}

function signedIn(pair: TokenPair): void {
  saveSession(pair);
  askConfirmation();
}

function watchTelegram(start: TelegramStart): void {
  stopPolling();
  let polling = false;
  pollTimer = window.setInterval(() => {
    if (polling) return;
    polling = true;
    pollTelegram(start).then((result) => {
      if (pollTimer === null) return;
      if (result.status === 'confirmed' && result.tokens) signedIn(result.tokens);
      if (result.status === 'expired') {
        stopPolling();
        status('Время ожидания истекло. Попробуйте ещё раз.', true);
      }
    }).catch((error: unknown) => {
      if (isTransientError(error)) return;
      stopPolling();
      status(message(error), true);
    }).finally(() => { polling = false; });
  }, 2000);
}

el<HTMLFormElement>('delete-email-form').onsubmit = (event) => {
  event.preventDefault();
  void act(async () => {
    await isolate();
    await startEmail(el<HTMLInputElement>('delete-email').value.trim());
    el('delete-code-form').hidden = false;
    status('Письмо отправлено. Введите код из него здесь, ссылку открывать не нужно.');
    el('delete-code').focus();
  });
};

el<HTMLFormElement>('delete-code-form').onsubmit = (event) => {
  event.preventDefault();
  void act(async () => signedIn(await verifyEmail({
    email: el<HTMLInputElement>('delete-email').value.trim(),
    code: el<HTMLInputElement>('delete-code').value.trim(),
  })));
};

el('delete-telegram').onclick = () => void act(async () => {
  await isolate();
  const start = await startTelegram();
  const holder = el('delete-telegram-link');
  holder.querySelector('a')!.href = start.deep_link;
  holder.hidden = false;
  status('Откройте бота и подтвердите вход.');
  watchTelegram(start);
});

el('delete-current').onclick = () => void act(async () => {
  await initSession(browserTokenStore);
  if (!session()) throw new Error('В этом браузере нет открытого аккаунта.');
  askConfirmation();
});

el('delete-confirm').onclick = () => void act(async () => {
  const userId = session()?.user_id;
  if (!userId) throw new Error('Сессия закончилась. Обновите страницу.');
  await deleteAccount();
  await forgetStoredSession(browserTokenStore, userId);
  el('delete-confirm').hidden = true;
  status('Аккаунт и все его данные удалены.');
});

await initSession(browserTokenStore);
el('delete-current').hidden = !session();
