import { createDeal, type Deal, type DealState } from '@handshake/core';
import {
  authorizingDeal,
  awaitingDeliveryDeal,
  mandate,
  verifyingDeal,
} from '@handshake/core/testing';
import { describe, expect, it } from 'vitest';
import { planDemoReset } from './demo-reset-plan';

const inState = (state: DealState): Deal => ({
  ...createDeal('deal-1', mandate, '2026-10-06T12:00:00Z').deal,
  state,
});

describe('planDemoReset', () => {
  it.each(['SETTLED', 'REFUSED', 'CANCELLED', 'ABANDONED'] as const)(
    'deletes a %s deal without touching its finished lifecycle',
    (state) => {
      expect(planDemoReset(inState(state))).toEqual({ action: 'delete', stopExecution: false });
    },
  );

  it.each(['DRAFT', 'NEGOTIATING', 'AGREED', 'AWAITING_HUMAN_APPROVAL'] as const)(
    'stops the lifecycle and deletes a %s deal, which has no PayPal order yet',
    (state) => {
      expect(planDemoReset(inState(state))).toEqual({ action: 'delete', stopExecution: true });
    },
  );

  it('keeps a deal that holds an authorization', () => {
    expect(planDemoReset(awaitingDeliveryDeal())).toMatchObject({ action: 'keep' });
    expect(planDemoReset(verifyingDeal())).toMatchObject({ action: 'keep' });
  });

  it('keeps a deal waiting for checkout, which cancels itself', () => {
    expect(planDemoReset(authorizingDeal())).toEqual({
      action: 'keep',
      reason: 'it waits for the PayPal checkout and cancels itself within an hour',
    });
  });

  it('keeps a deal that is moving money', () => {
    expect(planDemoReset({ ...verifyingDeal(), state: 'CAPTURING' })).toEqual({
      action: 'keep',
      reason: 'it is capturing the payment right now',
    });
  });
});
