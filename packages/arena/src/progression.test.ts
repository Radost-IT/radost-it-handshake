import { describe, expect, it } from 'vitest';
import { rankForXp, rankProgress, xpForAttempt } from './progression';

describe('xpForAttempt', () => {
  it('gives 10 XP for a held attempt', () => {
    expect(xpForAttempt({ result: 'held' })).toBe(10);
  });

  it('gives 100 XP plus severity and novelty bonuses for a loophole', () => {
    expect(
      xpForAttempt({ result: 'loophole', severity: 'low', novelty: 0, nearDuplicate: false }),
    ).toBe(100);
    expect(
      xpForAttempt({ result: 'loophole', severity: 'high', novelty: 0.5, nearDuplicate: false }),
    ).toBe(175);
    expect(
      xpForAttempt({ result: 'loophole', severity: 'critical', novelty: 1, nearDuplicate: false }),
    ).toBe(250);
  });

  it('gives a near-duplicate loophole only the held amount', () => {
    expect(
      xpForAttempt({ result: 'loophole', severity: 'critical', novelty: 1, nearDuplicate: true }),
    ).toBe(10);
  });

  it('keeps novelty between 0 and 1', () => {
    expect(
      xpForAttempt({ result: 'loophole', severity: 'low', novelty: 3, nearDuplicate: false }),
    ).toBe(150);
    expect(
      xpForAttempt({ result: 'loophole', severity: 'low', novelty: -1, nearDuplicate: false }),
    ).toBe(100);
  });
});

describe('rankForXp', () => {
  it.each([
    [0, 'Newcomer'],
    [49, 'Newcomer'],
    [50, 'Explorer'],
    [199, 'Explorer'],
    [200, 'Investigator'],
    [499, 'Investigator'],
    [500, 'Puzzle Solver'],
    [999, 'Puzzle Solver'],
    [1000, 'Codebreaker'],
    [2499, 'Codebreaker'],
    [2500, 'Master Tester'],
    [100_000, 'Master Tester'],
  ])('%i XP is %s', (xp, rank) => {
    expect(rankForXp(xp)).toBe(rank);
  });
});

describe('rankProgress', () => {
  it('reports the XP to the next rank and the share of the way there', () => {
    expect(rankProgress(125)).toEqual({
      rank: 'Explorer',
      next: { rank: 'Investigator', xpToGo: 75 },
      fraction: 0.5,
    });
  });

  it('has no next rank at the top', () => {
    expect(rankProgress(3000)).toEqual({ rank: 'Master Tester', next: null, fraction: 1 });
  });
});
