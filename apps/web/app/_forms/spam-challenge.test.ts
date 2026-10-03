import { describe, expect, it } from 'vitest';
import { isSpamChallengeSolved, mintSpamChallenge } from './spam-challenge';

const SECRET = 'a'.repeat(64);
const NOW = 1_800_000_000_000;

describe('spam challenge', () => {
  it('accepts the right sum before the token expires', () => {
    const { a, b, token } = mintSpamChallenge(SECRET, NOW);

    expect(isSpamChallengeSolved(SECRET, token, ` ${a + b} `, NOW + 1000)).toBe(true);
  });

  it('rejects a wrong sum', () => {
    const { a, b, token } = mintSpamChallenge(SECRET, NOW);

    expect(isSpamChallengeSolved(SECRET, token, String(a + b + 1), NOW)).toBe(false);
  });

  it('rejects an expired token', () => {
    const { a, b, token } = mintSpamChallenge(SECRET, NOW);

    expect(isSpamChallengeSolved(SECRET, token, String(a + b), NOW + 61 * 60 * 1000)).toBe(false);
  });

  it('rejects a token with a moved expiry', () => {
    const { a, b, token } = mintSpamChallenge(SECRET, NOW);
    const [, signature] = token.split('.');

    expect(isSpamChallengeSolved(SECRET, `${NOW * 2}.${signature}`, String(a + b), NOW)).toBe(
      false,
    );
  });

  it('rejects a token signed with another secret', () => {
    const { a, b, token } = mintSpamChallenge('b'.repeat(64), NOW);

    expect(isSpamChallengeSolved(SECRET, token, String(a + b), NOW)).toBe(false);
  });

  it('rejects a malformed token', () => {
    expect(isSpamChallengeSolved(SECRET, 'garbage', '4', NOW)).toBe(false);
  });
});
