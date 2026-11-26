import type { Profile } from './game';

/** Human-readable sign-in methods of the account, one line each. */
export function identityLines(identities: Profile['identities']): string[] {
  return identities.map(({ provider, subject }) => {
    if (provider === 'email') return `Почта: ${subject}`;
    if (provider === 'telegram') return `Telegram: ID ${subject}`;
    return `${provider}: ${subject}`;
  });
}
