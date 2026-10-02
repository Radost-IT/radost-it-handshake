import { createHash } from 'node:crypto';

export class InvalidChallengeDateError extends Error {
  override name = 'InvalidChallengeDateError';
}

/**
 * Picks the day's deal template from the UTC date alone, so every server
 * agrees on it and no scheduler is needed. A hash, rather than the day number,
 * keeps the order from repeating in an obvious cycle.
 */
export function pickDailyChallenge<Template>(
  date: string,
  templates: readonly [Template, ...Template[]],
): Template {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new InvalidChallengeDateError(`Expected a date like 2026-10-02, got "${date}"`);
  }
  const index = createHash('sha256').update(date).digest().readUInt32BE(0) % templates.length;
  return templates[index] ?? templates[0];
}
