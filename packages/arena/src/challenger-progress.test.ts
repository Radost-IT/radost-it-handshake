import { describe, expect, it } from 'vitest';
import { applyAttempt, newChallengerProgress, type JudgedAttempt } from './challenger-progress';

const held: JudgedAttempt = {
  category: 'fake-urgency',
  channel: 'message',
  outcome: { result: 'held' },
  firstInCategory: false,
  dailyChallengeDate: null,
};
const loophole: JudgedAttempt = {
  category: 'swapped-item',
  channel: 'evidence',
  outcome: { result: 'loophole', severity: 'high', novelty: 1, nearDuplicate: false },
  firstInCategory: true,
  dailyChallengeDate: null,
};

function play(...attempts: JudgedAttempt[]) {
  return attempts.reduce(
    ({ progress }, attempt) => applyAttempt(progress, attempt),
    applyAttempt(newChallengerProgress, held),
  );
}

describe('applyAttempt', () => {
  it('counts a held attempt toward XP, categories tried and the held streak', () => {
    const { progress, xpGained } = applyAttempt(newChallengerProgress, held);

    expect(xpGained).toBe(10);
    expect(progress).toMatchObject({
      xp: 10,
      currentHeldStreak: 1,
      stats: { loopholes: 0, categoriesTried: ['fake-urgency'], longestHeldStreak: 1 },
    });
  });

  it('counts a first evidence loophole and resets the held streak', () => {
    const { progress } = play(held, loophole);

    expect(progress).toMatchObject({
      xp: 220,
      currentHeldStreak: 0,
      stats: {
        loopholes: 1,
        firstLoopholeCategories: 1,
        evidenceLoopholes: 1,
        textLoopholes: 0,
        longestHeldStreak: 2,
        categoriesTried: ['fake-urgency', 'swapped-item'],
      },
    });
  });

  it('counts a text loophole that was not first in its category', () => {
    const { progress } = play({ ...loophole, channel: 'listing', firstInCategory: false });

    expect(progress.stats).toMatchObject({ textLoopholes: 1, firstLoopholeCategories: 0 });
  });

  it('adds up daily challenge XP per day and counts each day once', () => {
    const daily = { ...held, dailyChallengeDate: '2026-10-02' };
    const { progress } = play(daily, daily, { ...daily, dailyChallengeDate: '2026-10-03' });

    expect(progress.daily).toEqual({ date: '2026-10-03', xp: 10 });
    expect(progress.stats.dailyChallengeDays).toBe(2);
  });

  it('keeps the daily score when a non-daily attempt follows', () => {
    const { progress } = play({ ...held, dailyChallengeDate: '2026-10-02' }, held);

    expect(progress.daily).toEqual({ date: '2026-10-02', xp: 10 });
  });
});
