import { InvalidTransitionError, type Deal } from './deal';

export type DeliveryTimerStep =
  { action: 'VOID' } | { action: 'REAUTHORIZE' } | { action: 'WAIT'; until: string };

/** The hold lapsed before the delivery deadline, so no money can move any more. */
export class EscrowExpiredError extends Error {
  override name = 'EscrowExpiredError';
}

// Policy allows the system to void only after the deadline, not at it.
const VOID_AFTER_DEADLINE_MS = 1000;

/**
 * Decides what a deal waiting for delivery needs at `now`: a void once the
 * delivery deadline has passed, a reauthorization once the hold's honor period
 * has ended, or otherwise a wait until the earlier of the two.
 */
export function planDeliveryTimer(
  deal: Deal,
  now: string,
  honorPeriodMs: number,
): DeliveryTimerStep {
  if (deal.state !== 'AWAITING_DELIVERY' || !deal.escrow || !deal.contract) {
    throw new InvalidTransitionError(`Deal ${deal.id} is not waiting for delivery`);
  }
  const nowMs = Date.parse(now);
  const voidFrom = Date.parse(deal.contract.terms.deliveryDeadline) + VOID_AFTER_DEADLINE_MS;
  if (nowMs >= voidFrom) return { action: 'VOID' };

  const expiresAt = Date.parse(deal.escrow.expiresAt);
  if (nowMs >= expiresAt) {
    throw new EscrowExpiredError(
      `Authorization ${deal.escrow.authorizationId} expired at ${deal.escrow.expiresAt}`,
    );
  }

  const honorPeriodEnds = Date.parse(deal.escrow.authorizedAt) + honorPeriodMs;
  if (nowMs >= honorPeriodEnds) return { action: 'REAUTHORIZE' };

  const until = Math.min(voidFrom, honorPeriodEnds, expiresAt);
  return { action: 'WAIT', until: new Date(until).toISOString() };
}
