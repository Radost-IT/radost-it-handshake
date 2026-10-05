import { describe, expect, it } from 'vitest';
import { createDeal, transitionDeal } from './deal';
import { dealEventSchema, dealSchema, negotiationTurnSchema } from './deal-schema';
import { isSignedByBothParties } from './contract';
import { mandate, verifyingDeal } from './test-fixtures';

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

describe('dealEventSchema', () => {
  it('reads back the events of a deal', () => {
    const { event: created } = createDeal('deal-1', mandate, '2026-10-02T12:00:00Z');
    const { deal } = createDeal('deal-1', mandate, '2026-10-02T12:00:00Z');
    const { event: changed } = transitionDeal(
      deal,
      { to: 'NEGOTIATING' },
      '2026-10-02T12:00:01Z',
      'Opened',
    );

    for (const event of [created, changed]) {
      expect(dealEventSchema.parse(JSON.parse(JSON.stringify(event)))).toEqual(event);
    }
  });

  it('rejects an unknown event type', () => {
    expect(
      dealEventSchema.safeParse({ dealId: 'd', seq: 0, at: '2026-10-02T12:00:00Z', type: 'PAID' })
        .success,
    ).toBe(false);
  });
});

describe('negotiationTurnSchema', () => {
  it('reads an offer with its price', () => {
    const turn = {
      party: 'seller',
      move: { action: 'OFFER', price: { value: '40.00', currency: 'USD' }, message: 'Deal?' },
      at: '2026-10-02T12:00:00Z',
    };
    expect(negotiationTurnSchema.parse(turn)).toEqual(turn);
  });
});
