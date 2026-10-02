import { describe, expect, it } from 'vitest';
import { concludeAgreement } from './agreement';
import { isSignedByBothParties } from './contract';
import { createDeal, transitionDeal, InvalidTransitionError, type Deal } from './deal';
import { money } from './money';
import { buildTerms, mandate } from './test-fixtures';

const now = '2026-10-02T12:00:00Z';

function negotiatingDeal(): Deal {
  const { deal } = createDeal('deal-1', mandate, now);
  return transitionDeal(deal, { to: 'NEGOTIATING' }, now, 'Started').deal;
}

describe('concludeAgreement', () => {
  it('signs the contract and goes straight to authorizing below the approval threshold', () => {
    const { deal, events } = concludeAgreement(negotiatingDeal(), buildTerms(), now);

    expect(deal.state).toBe('AUTHORIZING');
    expect(deal.contract && isSignedByBothParties(deal.contract)).toBe(true);
    expect(events.map((event) => event.type === 'STATE_CHANGED' && event.to)).toEqual([
      'AGREED',
      'AUTHORIZING',
    ]);
  });

  it('waits for a person when the price reaches the approval threshold', () => {
    const terms = buildTerms({ price: money('50.00', 'USD') });

    const { deal } = concludeAgreement(negotiatingDeal(), terms, now);

    expect(deal.state).toBe('AWAITING_HUMAN_APPROVAL');
  });

  it('abandons terms that break the mandate without signing them', () => {
    const terms = buildTerms({ price: money('120.00', 'USD') });

    const { deal, events } = concludeAgreement(negotiatingDeal(), terms, now);

    expect(deal.state).toBe('ABANDONED');
    expect(deal.contract).toBeNull();
    expect(events[0]).toMatchObject({
      to: 'ABANDONED',
      reason: 'Price 120.00 USD is above the mandate maximum 100.00 USD',
    });
  });

  it('refuses a deal that is not negotiating', () => {
    const { deal } = createDeal('deal-1', mandate, now);

    expect(() => concludeAgreement(deal, buildTerms(), now)).toThrow(InvalidTransitionError);
  });
});
