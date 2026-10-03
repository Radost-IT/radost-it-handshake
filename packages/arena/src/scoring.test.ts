import { money } from '@handshake/core';
import { describe, expect, it } from 'vitest';
import { scoreAttempt } from './scoring';

const maxBounty = money('5.00', 'USD');
const touched = { maxBounty, categoryUntouched: false };

describe('scoreAttempt', () => {
  it('pays no bounty when the agents held', () => {
    expect(scoreAttempt({ result: 'held' }, touched)).toEqual({ xp: 10, bounty: null });
  });

  it('pays no bounty for a near-duplicate of a known loophole', () => {
    const outcome = {
      result: 'loophole',
      severity: 'critical',
      novelty: 1,
      nearDuplicate: true,
    } as const;

    expect(scoreAttempt(outcome, { maxBounty, categoryUntouched: true })).toEqual({
      xp: 10,
      bounty: null,
    });
  });

  it('pays a known trick half the severity share and a new one all of it', () => {
    const known = {
      result: 'loophole',
      severity: 'high',
      novelty: 0,
      nearDuplicate: false,
    } as const;

    expect(scoreAttempt(known, touched).bounty).toEqual(money('1.50', 'USD'));
    expect(scoreAttempt({ ...known, novelty: 1 }, touched).bounty).toEqual(money('3.00', 'USD'));
  });

  it('pays more in a category where no one has found a loophole yet', () => {
    const outcome = {
      result: 'loophole',
      severity: 'low',
      novelty: 0.5,
      nearDuplicate: false,
    } as const;

    expect(scoreAttempt(outcome, touched).bounty).toEqual(money('0.75', 'USD'));
    expect(scoreAttempt(outcome, { maxBounty, categoryUntouched: true }).bounty).toEqual(
      money('1.75', 'USD'),
    );
  });

  it('never pays more than the cap, even for an out-of-range novelty', () => {
    const outcome = {
      result: 'loophole',
      severity: 'critical',
      novelty: 7,
      nearDuplicate: false,
    } as const;

    expect(scoreAttempt(outcome, { maxBounty, categoryUntouched: true })).toEqual({
      xp: 250,
      bounty: maxBounty,
    });
  });
});
