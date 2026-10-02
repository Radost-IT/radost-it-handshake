import { describe, expect, it } from 'vitest';
import { InvalidTransitionError, type Deal } from './deal';
import { EscrowExpiredError, planDeliveryTimer } from './delivery-timer';
import { buildEscrow, verifyingDeal } from './test-fixtures';

const threeDays = 3 * 24 * 60 * 60 * 1000;

function awaitingDelivery(overrides: Partial<Deal> = {}): Deal {
  return { ...verifyingDeal(), state: 'AWAITING_DELIVERY', ...overrides };
}

describe('planDeliveryTimer', () => {
  it('waits until the honor period ends when that comes before the deadline', () => {
    expect(planDeliveryTimer(awaitingDelivery(), '2026-10-03T00:00:00Z', threeDays)).toEqual({
      action: 'WAIT',
      until: '2026-10-05T12:00:00.000Z',
    });
  });

  it('reauthorizes once the honor period has ended', () => {
    expect(planDeliveryTimer(awaitingDelivery(), '2026-10-05T12:00:00Z', threeDays)).toEqual({
      action: 'REAUTHORIZE',
    });
  });

  it('waits until just after the deadline when that comes first', () => {
    const renewed = awaitingDelivery({
      escrow: buildEscrow({ authorizedAt: '2026-10-08T00:00:00Z' }),
    });
    expect(planDeliveryTimer(renewed, '2026-10-08T00:00:00Z', threeDays)).toEqual({
      action: 'WAIT',
      until: '2026-10-10T00:00:01.000Z',
    });
  });

  it('voids once the delivery deadline has passed', () => {
    expect(planDeliveryTimer(awaitingDelivery(), '2026-10-10T00:00:01Z', threeDays)).toEqual({
      action: 'VOID',
    });
  });

  it('fails when the hold expired before the deadline', () => {
    const expiring = awaitingDelivery({
      escrow: buildEscrow({ expiresAt: '2026-10-04T00:00:00Z' }),
    });
    expect(() => planDeliveryTimer(expiring, '2026-10-04T00:00:00Z', threeDays)).toThrow(
      EscrowExpiredError,
    );
  });

  it('refuses a deal that is not waiting for delivery', () => {
    expect(() => planDeliveryTimer(verifyingDeal(), '2026-10-03T00:00:00Z', threeDays)).toThrow(
      InvalidTransitionError,
    );
  });
});
