import { randomInt } from 'node:crypto';
import { hasValidSignature, signFormValue } from './signature';

// Long enough that a slowly written message does not expire before it is sent.
const CHALLENGE_TTL_MS = 60 * 60 * 1000;

export interface SpamChallenge {
  a: number;
  b: number;
  token: string;
}

// The token carries a signature of the answer, not the answer, so a bot has to
// read the sum to pass.
export function mintSpamChallenge(secret: string, now: number): SpamChallenge {
  const a = randomInt(1, 10);
  const b = randomInt(1, 10);
  const expiresAt = now + CHALLENGE_TTL_MS;
  return { a, b, token: `${expiresAt}.${signFormValue(secret, `${a + b}.${expiresAt}`)}` };
}

export function isSpamChallengeSolved(
  secret: string,
  token: string,
  answer: string,
  now: number,
): boolean {
  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature || Number(expiresAt) < now) return false;
  return hasValidSignature(secret, `${Number(answer.trim())}.${expiresAt}`, signature);
}
