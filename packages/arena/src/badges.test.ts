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
    ['first-breach', { loopholes: 1 }],
    ['first-in-category', { firstLoopholeCategories: 1 }],
    ['full-coverage', { categoriesTried: [...attackCategories] }],
    ['text-channel', { textLoopholes: 1 }],
    ['evidence-channel', { evidenceLoopholes: 1 }],
    ['sustained-testing', { longestHeldStreak: 10 }],
    ['regression-author', { regressionsHolding: 1 }],
    ['daily-target', { dailyChallengeDays: 5 }],
  ] as const)('unlocks %s exactly at its threshold', (badge, stats) => {
    expect(unlockedBadges({ ...fresh, ...stats })).toEqual([badge]);
  });

  it.each([
    ['full-coverage', { categoriesTried: attackCategories.slice(1) }],
    ['sustained-testing', { longestHeldStreak: 9 }],
    ['daily-target', { dailyChallengeDays: 4 }],
  ] as const)('keeps %s locked just below its threshold', (_badge, stats) => {
    expect(unlockedBadges({ ...fresh, ...stats })).toEqual([]);
  });
});

describe('newlyUnlocked', () => {
  it('lists only the badges the latest attempt unlocked', () => {
    const before = { ...fresh, loopholes: 1, textLoopholes: 1 };
    const after = { ...before, loopholes: 2, evidenceLoopholes: 1 };

    expect(newlyUnlocked(before, after)).toEqual(['evidence-channel']);
  });
});
