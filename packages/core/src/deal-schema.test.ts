import { describe, expect, it } from 'vitest';
import { dealSchema } from './deal-schema';
import { isSignedByBothParties } from './contract';
import { verifyingDeal } from './test-fixtures';

describe('dealSchema', () => {
  it('reads back a deal that went through JSON', () => {
    const deal = verifyingDeal();
    const stored: unknown = JSON.parse(JSON.stringify(deal));

    const parsed = dealSchema.parse(stored);

    expect(parsed).toEqual(deal);
    expect(parsed.contract && isSignedByBothParties(parsed.contract)).toBe(true);
  });

  it('rejects an unknown state', () => {
    expect(dealSchema.safeParse({ ...verifyingDeal(), state: 'PAID' }).success).toBe(false);
  });
});
