import { describe, expect, it } from 'vitest';
import { identityLines } from './identities';

describe('identityLines', () => {
  it('names email and Telegram sign-ins', () => {
    expect(identityLines([
      { provider: 'email', subject: 'a@b.c' }, { provider: 'telegram', subject: '42' },
    ])).toEqual(['Почта: a@b.c', 'Telegram: ID 42']);
    expect(identityLines([])).toEqual([]);
  });
});
