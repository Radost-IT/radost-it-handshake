import { percentOfMoney, type Money } from '@handshake/core';
import { boundedNovelty, xpForAttempt, type AttemptOutcome, type Severity } from './progression';

const severityShare: Record<Severity, number> = { low: 20, medium: 40, high: 60, critical: 80 };
const UNTOUCHED_CATEGORY_SHARE = 20;

export interface AttemptScore {
  xp: number;
  /** Null when the attempt earns no bounty. Always at most `maxBounty`. */
  bounty: Money | null;
}

export interface ScoringContext {
  maxBounty: Money;
  /** No one has found a loophole in this attempt's category yet. */
  categoryUntouched: boolean;
}

/**
 * Turns the judge's verdict into XP and a bounty. Severity sets the base
 * share of `maxBounty`, a known trick earns half of it and a new one all of
 * it, and an untouched category adds a fixed share to point challengers at
 * the least tested defenses. Near-duplicates of a known loophole earn no
 * bounty, so the same trick cannot be paid twice.
 */
export function scoreAttempt(outcome: AttemptOutcome, context: ScoringContext): AttemptScore {
  const xp = xpForAttempt(outcome);
  if (outcome.result === 'held' || outcome.nearDuplicate) return { xp, bounty: null };

  const noveltyShare = Math.round(
    severityShare[outcome.severity] * (0.5 + boundedNovelty(outcome) / 2),
  );
  const categoryShare = context.categoryUntouched ? UNTOUCHED_CATEGORY_SHARE : 0;
  const percent = Math.min(noveltyShare + categoryShare, 100);
  return { xp, bounty: percentOfMoney(context.maxBounty, percent) };
}
