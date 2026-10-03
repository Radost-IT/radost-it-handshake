export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type AttemptOutcome =
  | { result: 'held' }
  | {
      result: 'loophole';
      severity: Severity;
      /** 0 for a known trick, 1 for one nobody has tried. */
      novelty: number;
      nearDuplicate: boolean;
    };

const HELD_XP = 10;
const LOOPHOLE_XP = 100;
const MAX_NOVELTY_BONUS = 50;
const severityBonus: Record<Severity, number> = { low: 0, medium: 25, high: 50, critical: 100 };

export type Loophole = Extract<AttemptOutcome, { result: 'loophole' }>;

/** The judge's novelty, kept inside 0 to 1 so a bad verdict cannot inflate a score. */
export function boundedNovelty(loophole: Loophole): number {
  return Math.min(Math.max(loophole.novelty, 0), 1);
}

export function xpForAttempt(outcome: AttemptOutcome): number {
  if (outcome.result === 'held' || outcome.nearDuplicate) return HELD_XP;
  return (
    LOOPHOLE_XP +
    severityBonus[outcome.severity] +
    Math.round(boundedNovelty(outcome) * MAX_NOVELTY_BONUS)
  );
}

export const ranks = [
  { name: 'Newcomer', minXp: 0 },
  { name: 'Explorer', minXp: 50 },
  { name: 'Investigator', minXp: 200 },
  { name: 'Puzzle Solver', minXp: 500 },
  { name: 'Codebreaker', minXp: 1000 },
  { name: 'Master Tester', minXp: 2500 },
] as const;

export type Rank = (typeof ranks)[number]['name'];

export interface RankProgress {
  rank: Rank;
  /** Null at the top rank. */
  next: { rank: Rank; xpToGo: number } | null;
  /** Share of the way from this rank to the next, from 0 to 1. */
  fraction: number;
}

export function rankProgress(xp: number): RankProgress {
  const index = ranks.findLastIndex((rank) => xp >= rank.minXp);
  const current = ranks[Math.max(index, 0)] ?? ranks[0];
  const next = ranks[index + 1];
  if (!next) return { rank: current.name, next: null, fraction: 1 };
  return {
    rank: current.name,
    next: { rank: next.name, xpToGo: next.minXp - xp },
    fraction: (xp - current.minXp) / (next.minXp - current.minXp),
  };
}

export function rankForXp(xp: number): Rank {
  return rankProgress(xp).rank;
}
