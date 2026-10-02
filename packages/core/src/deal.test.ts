import { describe, expect, it } from 'vitest';
import {
  createDeal,
  dealStates,
  InvalidTransitionError,
  isTerminalState,
  renewAuthorization,
  transitionDeal,
  type Deal,
} from './deal';
import { money } from './money';
import { buildEscrow, buildTerms, mandate, signBoth, verifyingDeal } from './test-fixtures';

const at = '2026-10-03T09:00:00Z';

function capturingDeal(): Deal {
  return transitionDeal(verifyingDeal(), { to: 'CAPTURING' }, at, 'policy approved').deal;
}

describe('createDeal', () => {
  it('starts in DRAFT with a CREATED event', () => {
    const { deal, event } = createDeal('deal-1', mandate, at);

    expect(deal.state).toBe('DRAFT');
    expect(event).toEqual({ dealId: 'deal-1', seq: 1, at, type: 'CREATED' });
  });
});

describe('transitionDeal', () => {
  it('walks the happy path to SETTLED with one event per step', () => {
    const { deal, event } = transitionDeal(
      capturingDeal(),
      {
        to: 'SETTLED',
        capture: { captureId: 'cap-1', status: 'COMPLETED', amount: money('42.50', 'USD') },
      },
      at,
      'capture completed',
    );

    expect(deal.state).toBe('SETTLED');
    expect(deal.capture?.captureId).toBe('cap-1');
    expect(deal.eventCount).toBe(9);
    expect(event).toEqual({
      dealId: 'deal-1',
      seq: 9,
      at,
      type: 'STATE_CHANGED',
      from: 'CAPTURING',
      to: 'SETTLED',
      reason: 'capture completed',
    });
  });

  it('does not mutate the original deal', () => {
    const before = verifyingDeal();
    const snapshot = structuredClone(before);

    transitionDeal(before, { to: 'ESCALATED' }, at, 'low confidence');

    expect(before).toEqual(snapshot);
  });

  it.each([
    ['DRAFT', 'SETTLED'],
    ['NEGOTIATING', 'AUTHORIZING'],
    ['VERIFYING', 'SETTLED'],
    ['AWAITING_DELIVERY', 'CAPTURING'],
  ] as const)('rejects %s -> %s', (from, to) => {
    const deal = { ...verifyingDeal(), state: from };
    expect(() => transitionDeal(deal, { to } as never, at, 'skip')).toThrow(InvalidTransitionError);
  });

  it('refuses to agree on a contract that is not signed by both parties', () => {
    let { deal } = createDeal('deal-1', mandate, at);
    deal = transitionDeal(deal, { to: 'NEGOTIATING' }, at, 'start').deal;
    const contract = { ...signBoth(buildTerms()), signatures: [] };

    expect(() => transitionDeal(deal, { to: 'AGREED', contract }, at, 'agreed')).toThrow(
      'Contract is not signed by both parties',
    );
  });

  it('refuses a contract that belongs to another deal', () => {
    let { deal } = createDeal('deal-2', mandate, at);
    deal = transitionDeal(deal, { to: 'NEGOTIATING' }, at, 'start').deal;

    expect(() =>
      transitionDeal(deal, { to: 'AGREED', contract: signBoth(buildTerms()) }, at, 'agreed'),
    ).toThrow('Contract belongs to deal deal-1');
  });

  it('refuses an authorization for a different amount than agreed', () => {
    const authorizing = { ...verifyingDeal(), state: 'AUTHORIZING' as const, escrow: null };
    const escrow = buildEscrow({ amount: money('420.00', 'USD') });

    expect(() =>
      transitionDeal(authorizing, { to: 'IN_ESCROW', escrow }, at, 'authorized'),
    ).toThrow('Authorization of 420.00 USD does not match the contract price 42.50 USD');
  });

  it('never settles without a capture for the contract amount', () => {
    const capture = { captureId: 'cap-1', status: 'COMPLETED' as const, amount: money('1', 'USD') };

    expect(() => transitionDeal(capturingDeal(), { to: 'SETTLED', capture }, at, 'done')).toThrow(
      InvalidTransitionError,
    );
  });
});

describe('isTerminalState', () => {
  it('marks exactly the four end states as terminal', () => {
    expect(dealStates.filter(isTerminalState)).toEqual([
      'SETTLED',
      'REFUSED',
      'CANCELLED',
      'ABANDONED',
    ]);
  });
});

describe('renewAuthorization', () => {
  const renewed = {
    authorizationId: 'auth-2',
    amount: money('42.50', 'USD'),
    expiresAt: '2026-11-30T00:00:00Z',
  };

  it('replaces the authorization without changing state', () => {
    const deal = verifyingDeal();
    const { deal: next, event } = renewAuthorization(deal, renewed, at);

    expect(next.state).toBe('VERIFYING');
    expect(next.escrow).toEqual({ ...buildEscrow(), ...renewed });
    expect(event).toMatchObject({ type: 'AUTHORIZATION_RENEWED', seq: deal.eventCount + 1 });
  });

  it('refuses when no funds are held', () => {
    expect(() => renewAuthorization(capturingDeal(), renewed, at)).toThrow(InvalidTransitionError);
  });

  it('refuses a reauthorization for a different amount', () => {
    const different = { ...renewed, amount: money('43', 'USD') };
    expect(() => renewAuthorization(verifyingDeal(), different, at)).toThrow(
      InvalidTransitionError,
    );
  });
});
