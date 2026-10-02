import {
  evaluateProposal,
  type ConfirmedCapture,
  type Deal,
  type DealEvent,
  type PolicyViolation,
  type Proposer,
  type SettlementInstruction,
  type SettlementProposal,
} from '@handshake/core';
import {
  captureAuthorization,
  PayPalApiError,
  voidAuthorization,
  type PayPalClient,
} from '@handshake/paypal';
import { advance, type Progress } from './progress';

export interface SettlementContext {
  paypal: PayPalClient;
  now: () => string;
}

export type SettlementResult =
  | { approved: false; violations: PolicyViolation[] }
  | { approved: true; deal: Deal; events: DealEvent[] };

/** PayPal confirmed the void call but did not report the authorization as voided. */
export class VoidNotConfirmedError extends Error {
  override name = 'VoidNotConfirmedError';
}

/**
 * Executes a settlement proposal, but only after the policy engine approves
 * it. Returns the deal and the events to persist; the deal reaches SETTLED
 * only with a COMPLETED capture. A pending capture leaves the deal in
 * CAPTURING until the PayPal webhook confirms it.
 *
 * The PayPal request ID uses the deal's event count, so running the same
 * proposal again on the same stored deal replays PayPal's first answer
 * instead of moving money twice.
 */
export async function executeSettlement(
  context: SettlementContext,
  deal: Deal,
  proposal: SettlementProposal,
  proposer: Proposer,
): Promise<SettlementResult> {
  const decision = evaluateProposal(deal, proposal, proposer, context.now());
  if (!decision.approved) return decision;

  const start = { deal, events: [] };
  const settled = await executeInstruction(context, start, decision.instruction, proposal.reason);
  return { approved: true, ...settled };
}

function executeInstruction(
  context: SettlementContext,
  progress: Progress,
  instruction: SettlementInstruction,
  reason: string,
): Promise<Progress> {
  switch (instruction.action) {
    case 'ESCALATE':
      return Promise.resolve(advance(progress, { to: 'ESCALATED' }, context.now(), reason));
    case 'VOID':
      return voidEscrow(context, progress, instruction.authorizationId, reason);
    case 'CAPTURE':
      return captureEscrow(context, progress, instruction, reason);
  }
}

async function voidEscrow(
  context: SettlementContext,
  progress: Progress,
  authorizationId: string,
  reason: string,
): Promise<Progress> {
  const attempt = progress.deal.eventCount;
  const voiding = advance(progress, { to: 'VOIDING' }, context.now(), reason);
  const voided = await voidAuthorization(context.paypal, {
    dealId: voiding.deal.id,
    authorizationId,
    attempt,
  });
  if (voided.status !== 'VOIDED') {
    throw new VoidNotConfirmedError(`Authorization ${authorizationId} is ${voided.status}`);
  }
  return advance(voiding, { to: 'REFUSED' }, context.now(), 'Payment voided');
}

async function captureEscrow(
  context: SettlementContext,
  progress: Progress,
  instruction: Extract<SettlementInstruction, { action: 'CAPTURE' }>,
  reason: string,
): Promise<Progress> {
  const attempt = progress.deal.eventCount;
  const capturing = advance(progress, { to: 'CAPTURING' }, context.now(), reason);
  try {
    const capture = await captureAuthorization(context.paypal, {
      dealId: capturing.deal.id,
      authorizationId: instruction.authorizationId,
      attempt,
      amount: instruction.amount,
    });
    if (capture.status === 'PENDING') return capturing;
    if (capture.status !== 'COMPLETED') {
      return advance(capturing, { to: 'ESCALATED' }, context.now(), `Capture ${capture.status}`);
    }
    const confirmed: ConfirmedCapture = {
      captureId: capture.id,
      status: 'COMPLETED',
      amount: capture.amount,
    };
    return advance(
      capturing,
      { to: 'SETTLED', capture: confirmed },
      context.now(),
      'Payment captured',
    );
  } catch (error) {
    // PayPal refused this capture for good (for example an expired
    // authorization), so a person decides. Server errors propagate and retry.
    if (error instanceof PayPalApiError && error.statusCode === 422) {
      return advance(capturing, { to: 'ESCALATED' }, context.now(), error.message);
    }
    throw error;
  }
}
