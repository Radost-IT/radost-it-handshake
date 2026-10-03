import {
  checkBountyProposal,
  type BountyLimits,
  type BountyProposal,
  type Money,
  type PolicyViolation,
} from '@handshake/core';
import { createPayout, type PayoutBatch, type PayPalClient } from '@handshake/paypal';

export type BountyResult =
  { approved: false; violations: PolicyViolation[] } | { approved: true; payout: PayoutBatch };

/**
 * Pays a bounty, but only after policy approves it against the cap, the
 * daily budget and the allowed recipient. `paidToday` must include every
 * bounty already paid today. Paying the same attempt again replays PayPal's
 * first answer instead of paying twice.
 */
export async function payBounty(
  paypal: PayPalClient,
  proposal: BountyProposal,
  limits: BountyLimits,
  paidToday: Money,
): Promise<BountyResult> {
  const violations = checkBountyProposal(proposal, limits, paidToday);
  if (violations.length > 0) return { approved: false, violations };

  const payout = await createPayout(paypal, {
    attemptId: proposal.attemptId,
    amount: proposal.amount,
    recipientEmail: proposal.recipientEmail,
    note: proposal.reason,
  });
  return { approved: true, payout };
}
