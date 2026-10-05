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
    [0, 'Observer'],
    [49, 'Observer'],
    [50, 'Analyst'],
    [199, 'Analyst'],
    [200, 'Tester'],
    [499, 'Tester'],
    [500, 'Red Teamer'],
    [999, 'Red Teamer'],
    [1000, 'Senior Red Teamer'],
    [2499, 'Senior Red Teamer'],
    [2500, 'Principal Red Teamer'],
    [100_000, 'Principal Red Teamer'],
  ])('%i XP is %s', (xp, rank) => {
    expect(rankForXp(xp)).toBe(rank);
  });
});

describe('rankProgress', () => {
  it('reports the XP to the next rank and the share of the way there', () => {
    expect(rankProgress(125)).toEqual({
      rank: 'Analyst',
      next: { rank: 'Tester', xpToGo: 75 },
      fraction: 0.5,
    });
  });

  it('has no next rank at the top', () => {
    expect(rankProgress(3000)).toEqual({ rank: 'Principal Red Teamer', next: null, fraction: 1 });
  });
});
