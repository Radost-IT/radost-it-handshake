import { describe, expect, it } from 'vitest';
import { newlyUnlocked, unlockedBadges, type ChallengerStats } from './badges';
import { attackCategories } from './catalog';

const fresh: ChallengerStats = {
  loopholes: 0,
  firstLoopholeCategories: 0,
  categoriesTried: [],
  textLoopholes: 0,
  evidenceLoopholes: 0,
  longestHeldStreak: 0,
  regressionsHolding: 0,
  dailyChallengeDays: 0,
};

describe('unlockedBadges', () => {
  it('unlocks nothing for a new challenger', () => {
    expect(unlockedBadges(fresh)).toEqual([]);
  });

  it.each([
    ['eureka', { loopholes: 1 }],
    ['trailblazer', { firstLoopholeCategories: 1 }],
    ['map-maker', { categoriesTried: [...attackCategories] }],
    ['wordsmith', { textLoopholes: 1 }],
    ['sharp-eye', { evidenceLoopholes: 1 }],
    ['never-give-up', { longestHeldStreak: 10 }],
    ['shield-builder', { regressionsHolding: 1 }],
    ['daily-regular', { dailyChallengeDays: 5 }],
  ] as const)('unlocks %s exactly at its threshold', (badge, stats) => {
    expect(unlockedBadges({ ...fresh, ...stats })).toEqual([badge]);
  });

  it.each([
    ['map-maker', { categoriesTried: attackCategories.slice(1) }],
    ['never-give-up', { longestHeldStreak: 9 }],
    ['daily-regular', { dailyChallengeDays: 4 }],
  ] as const)('keeps %s locked just below its threshold', (_badge, stats) => {
    expect(unlockedBadges({ ...fresh, ...stats })).toEqual([]);
  });
});

describe('newlyUnlocked', () => {
  it('lists only the badges the latest attempt unlocked', () => {
    const before = { ...fresh, loopholes: 1, textLoopholes: 1 };
    const after = { ...before, loopholes: 2, evidenceLoopholes: 1 };

    expect(newlyUnlocked(before, after)).toEqual(['sharp-eye']);
  });
});
