import {
  formatMoney,
  InvalidTransitionError,
  moneyEquals,
  moneySchema,
  planDeliveryTimer,
  settlementProposalSchema,
  transitionDeal,
  type Deal,
  type DealEvent,
  type DealState,
  type PolicyViolation,
  type SettlementProposal,
} from '@handshake/core';
import { createAuthorizeOrder } from '@handshake/paypal';
import {
  authorizeEscrow,
  executeSettlement,
  renewEscrow,
  type SettlementContext,
} from '@handshake/settlement';
import {
  getCheckout,
  getDeal,
  saveCheckout,
  saveDeal,
  saveWait,
  type StoreTable,
} from '@handshake/store';
import { z } from 'zod';

export interface LifecycleContext extends SettlementContext {
  table: StoreTable;
  /** The web app, where PayPal sends the buyer back after checkout. */
  webUrl: string;
  honorPeriodMs: number;
}

const dealId = z.string().min(1);

/** The input the DealLifecycle state machine sends with each Lambda task. */
export const lifecycleTaskSchema = z.discriminatedUnion('task', [
  z.object({ task: z.literal('ReadState'), dealId }),
  // The negotiation step failed, for example because the daily token budget ran out.
  z.object({ task: z.literal('AbandonNegotiation'), dealId, reason: z.string().min(1) }),
  // The buyer's answer to a price above their approval threshold.
  z.object({ task: z.literal('DecidePurchase'), dealId, decision: z.unknown() }),
  z.object({ task: z.literal('CancelPurchase'), dealId, reason: z.string().min(1) }),
  z.object({ task: z.literal('StartCheckout'), dealId, taskToken: z.string().min(1) }),
  z.object({ task: z.literal('AuthorizePayment'), dealId, orderId: z.string().min(1) }),
  z.object({ task: z.literal('CancelCheckout'), dealId, reason: z.string().min(1) }),
  z.object({ task: z.literal('CheckDeliveryTimer'), dealId }),
  z.object({
    task: z.literal('AwaitSignal'),
    dealId,
    signal: z.enum(['purchase-approval', 'evidence', 'human-decision', 'capture']),
    taskToken: z.string().min(1),
  }),
  z.object({ task: z.literal('StartVerification'), dealId }),
  z.object({ task: z.literal('Escalate'), dealId, reason: z.string().min(1) }),
  // The capture resource of a signature-verified PayPal webhook.
  z.object({ task: z.literal('ConfirmCapture'), dealId, capture: z.unknown() }),
  // The proposal comes from a verifier agent or a person, so it is checked here.
  z.object({
    task: z.literal('Settle'),
    dealId,
    proposer: z.enum(['verifier', 'human']),
    proposal: z.unknown(),
  }),
]);

export type LifecycleTask = z.infer<typeof lifecycleTaskSchema>;

export interface LifecycleTaskResult {
  state: DealState;
  /** How long to wait for delivery evidence before the timer runs again. */
  waitSeconds?: number;
  /** Why a person's decision was refused. The deal waits for another one. */
  refusal?: string;
}

export class DealNotFoundError extends Error {
  override name = 'DealNotFoundError';
}

/** Policy refused a step that only the system proposes, which means a bug, not a bad actor. */
export class SystemProposalRejectedError extends Error {
  override name = 'SystemProposalRejectedError';
}

/**
 * Runs one step of a deal's lifecycle and saves the result. Step Functions
 * retries a failed step, so each step first checks that the deal is still
 * where the step expects it and otherwise just reports the current state.
 */
export async function runLifecycleTask(
  context: LifecycleContext,
  task: LifecycleTask,
): Promise<LifecycleTaskResult> {
  const deal = await loadDeal(context.table, task.dealId);
  switch (task.task) {
    case 'ReadState':
      return { state: deal.state };
    case 'AbandonNegotiation':
      return moveIfIn(context, deal, 'NEGOTIATING', 'ABANDONED', task.reason);
    case 'DecidePurchase':
      return decidePurchase(context, deal, task.decision);
    case 'CancelPurchase':
      return moveIfIn(context, deal, 'AWAITING_HUMAN_APPROVAL', 'CANCELLED', task.reason);
    case 'StartCheckout':
      return startCheckout(context, deal, task.taskToken);
    case 'AuthorizePayment':
      return authorizePayment(context, deal, task.orderId);
    case 'CancelCheckout':
      return moveIfIn(context, deal, 'AUTHORIZING', 'CANCELLED', task.reason);
    case 'CheckDeliveryTimer':
      return deal.state === 'AWAITING_DELIVERY'
        ? checkDeliveryTimer(context, deal)
        : { state: deal.state };
    case 'AwaitSignal':
      await saveWait(context.table, deal.id, task.signal, task.taskToken, new Date(context.now()));
      return { state: deal.state };
    case 'StartVerification':
      return moveIfIn(
        context,
        deal,
        'AWAITING_DELIVERY',
        'VERIFYING',
        'Delivery evidence received',
      );
    case 'Escalate':
      return escalate(context, deal, task.reason);
    case 'ConfirmCapture':
      return confirmCapture(context, deal, task.capture);
    case 'Settle':
      return task.proposer === 'verifier'
        ? settleByVerifier(context, deal, task.proposal)
        : settleByHuman(context, deal, task.proposal);
  }
}

async function loadDeal(table: StoreTable, id: string): Promise<Deal> {
  const deal = await getDeal(table, id);
  if (!deal) throw new DealNotFoundError(`Deal ${id} does not exist`);
  return deal;
}

async function save(
  context: LifecycleContext,
  deal: Deal,
  events: DealEvent[],
): Promise<LifecycleTaskResult> {
  await saveDeal(context.table, deal, events);
  return { state: deal.state };
}

async function moveIfIn(
  context: LifecycleContext,
  deal: Deal,
  from: DealState,
  to: 'ABANDONED' | 'AUTHORIZING' | 'CANCELLED' | 'VERIFYING' | 'ESCALATED',
  reason: string,
): Promise<LifecycleTaskResult> {
  if (deal.state !== from) return { state: deal.state };
  const change = transitionDeal(deal, { to }, context.now(), reason);
  return save(context, change.deal, [change.event]);
}

const purchaseDecisionSchema = z.object({ approved: z.boolean() });

async function decidePurchase(
  context: LifecycleContext,
  deal: Deal,
  decision: unknown,
): Promise<LifecycleTaskResult> {
  if (deal.state !== 'AWAITING_HUMAN_APPROVAL') return { state: deal.state };
  const parsed = purchaseDecisionSchema.safeParse(decision);
  if (!parsed.success) {
    return { state: deal.state, refusal: `The decision is not valid: ${parsed.error.message}` };
  }
  return parsed.data.approved
    ? moveIfIn(context, deal, deal.state, 'AUTHORIZING', 'The buyer approved the price')
    : moveIfIn(context, deal, deal.state, 'CANCELLED', 'The buyer declined the price');
}

async function startCheckout(
  context: LifecycleContext,
  deal: Deal,
  taskToken: string,
): Promise<LifecycleTaskResult> {
  if (deal.state !== 'AUTHORIZING' || !deal.contract) {
    throw new InvalidTransitionError(`Deal ${deal.id} is not ready for checkout`);
  }
  const { terms } = deal.contract;
  const dealUrl = `${context.webUrl}/deals/${encodeURIComponent(deal.id)}`;
  const order = await createAuthorizeOrder(context.paypal, {
    dealId: deal.id,
    attempt: deal.eventCount,
    amount: terms.price,
    description: terms.item.title,
    returnUrl: `${dealUrl}?checkout=approved`,
    cancelUrl: `${dealUrl}?checkout=cancelled`,
  });
  if (!order.approveUrl) {
    throw new InvalidTransitionError(`Order ${order.id} is ${order.status} and needs no approval`);
  }
  await Promise.all([
    saveCheckout(context.table, deal.id, { orderId: order.id, approveUrl: order.approveUrl }),
    saveWait(context.table, deal.id, 'checkout', taskToken, new Date(context.now())),
  ]);
  return { state: deal.state };
}

async function authorizePayment(
  context: LifecycleContext,
  deal: Deal,
  orderId: string,
): Promise<LifecycleTaskResult> {
  if (deal.state !== 'AUTHORIZING') return { state: deal.state };
  // Only the order this deal created may be authorized, never one named by an event alone.
  const checkout = await getCheckout(context.table, deal.id);
  if (checkout?.orderId !== orderId) {
    throw new InvalidTransitionError(`Order ${orderId} is not the checkout of deal ${deal.id}`);
  }
  const result = await authorizeEscrow(context, deal, orderId);
  if (result.approved) return save(context, result.deal, result.events);
  // The buyer approved an order the mandate does not allow. Nothing is held yet.
  return moveIfIn(context, deal, 'AUTHORIZING', 'CANCELLED', describe(result.violations));
}

async function checkDeliveryTimer(
  context: LifecycleContext,
  deal: Deal,
): Promise<LifecycleTaskResult> {
  const now = context.now();
  const step = planDeliveryTimer(deal, now, context.honorPeriodMs);
  switch (step.action) {
    case 'WAIT':
      return { state: deal.state, waitSeconds: secondsBetween(now, step.until) };
    case 'REAUTHORIZE': {
      const change = await renewEscrow(context, deal);
      await saveDeal(context.table, change.deal, [change.event]);
      return checkDeliveryTimer(context, change.deal);
    }
    case 'VOID':
      return settleBySystem(context, deal, {
        action: 'VOID',
        reason: 'The delivery deadline passed without evidence',
      });
  }
}

// Policy decides escalations while the money is held. During a capture
// nothing is left to decide, so a person takes over directly.
function escalate(
  context: LifecycleContext,
  deal: Deal,
  reason: string,
): Promise<LifecycleTaskResult> {
  switch (deal.state) {
    case 'VERIFYING':
      return settleBySystem(context, deal, { action: 'ESCALATE', reason });
    case 'CAPTURING':
      return moveIfIn(context, deal, 'CAPTURING', 'ESCALATED', reason);
    default:
      return Promise.resolve({ state: deal.state });
  }
}

const webhookCaptureSchema = z.object({
  id: z.string().min(1),
  status: z.string().min(1),
  amount: z
    .object({ currency_code: z.string(), value: z.string() })
    .transform(({ currency_code, value }) => ({ currency: currency_code, value }))
    .pipe(moneySchema),
});

type WebhookCapture = z.infer<typeof webhookCaptureSchema>;

function confirmCapture(
  context: LifecycleContext,
  deal: Deal,
  resource: unknown,
): Promise<LifecycleTaskResult> {
  const capture = webhookCaptureSchema.parse(resource);
  switch (deal.state) {
    case 'CAPTURING':
      return confirmPendingCapture(context, deal, capture);
    case 'ESCALATED':
      return confirmLateCapture(context, deal, capture);
    default:
      return Promise.resolve({ state: deal.state });
  }
}

async function confirmPendingCapture(
  context: LifecycleContext,
  deal: Deal,
  capture: WebhookCapture,
): Promise<LifecycleTaskResult> {
  if (capture.status === 'PENDING') return { state: deal.state };
  if (capture.status !== 'COMPLETED') {
    return moveIfIn(context, deal, 'CAPTURING', 'ESCALATED', `Capture ${capture.status}`);
  }
  if (!capturesContractPrice(deal, capture)) {
    return moveIfIn(
      context,
      deal,
      'CAPTURING',
      'ESCALATED',
      `PayPal captured ${formatMoney(capture.amount)}, not the contract price`,
    );
  }
  const change = settleWithCapture(context, deal, capture);
  return save(context, change.deal, [change.event]);
}

// PayPal completed a capture after its wait timed out and a person took over.
// The money has moved, so the deal settles instead of waiting for a decision
// that can no longer change anything. Anything else stays with the person.
async function confirmLateCapture(
  context: LifecycleContext,
  deal: Deal,
  capture: WebhookCapture,
): Promise<LifecycleTaskResult> {
  if (capture.status !== 'COMPLETED' || !capturesContractPrice(deal, capture)) {
    return { state: deal.state };
  }
  const capturing = transitionDeal(
    deal,
    { to: 'CAPTURING' },
    context.now(),
    'PayPal completed the capture after it was escalated',
  );
  const settled = settleWithCapture(context, capturing.deal, capture);
  return save(context, settled.deal, [capturing.event, settled.event]);
}

function capturesContractPrice(deal: Deal, capture: WebhookCapture): boolean {
  const price = deal.contract?.terms.price;
  return price !== undefined && moneyEquals(capture.amount, price);
}

function settleWithCapture(context: LifecycleContext, deal: Deal, capture: WebhookCapture) {
  return transitionDeal(
    deal,
    {
      to: 'SETTLED',
      capture: { captureId: capture.id, status: 'COMPLETED', amount: capture.amount },
    },
    context.now(),
    'Payment captured',
  );
}

async function settleBySystem(
  context: LifecycleContext,
  deal: Deal,
  proposal: SettlementProposal,
): Promise<LifecycleTaskResult> {
  const result = await executeSettlement(context, deal, proposal, 'system');
  if (!result.approved) throw new SystemProposalRejectedError(describe(result.violations));
  return save(context, result.deal, result.events);
}

async function settleByVerifier(
  context: LifecycleContext,
  deal: Deal,
  proposal: unknown,
): Promise<LifecycleTaskResult> {
  if (deal.state !== 'VERIFYING') return { state: deal.state };
  const parsed = settlementProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return settleBySystem(context, deal, {
      action: 'ESCALATE',
      reason: 'The verifier returned a proposal that is not valid',
    });
  }
  const result = await executeSettlement(context, deal, parsed.data, 'verifier');
  if (result.approved) return save(context, result.deal, result.events);
  return settleBySystem(context, deal, {
    action: 'ESCALATE',
    reason: `Policy refused the verifier: ${describe(result.violations)}`,
  });
}

async function settleByHuman(
  context: LifecycleContext,
  deal: Deal,
  proposal: unknown,
): Promise<LifecycleTaskResult> {
  if (deal.state !== 'ESCALATED') return { state: deal.state };
  const parsed = settlementProposalSchema.safeParse(proposal);
  if (!parsed.success) {
    return { state: deal.state, refusal: `The decision is not valid: ${parsed.error.message}` };
  }
  const result = await executeSettlement(context, deal, parsed.data, 'human');
  if (result.approved) return save(context, result.deal, result.events);
  return { state: deal.state, refusal: describe(result.violations) };
}

function describe(violations: PolicyViolation[]): string {
  return violations.map((violation) => violation.message).join('; ');
}

// Step Functions needs a positive timeout, even when the moment is already here.
function secondsBetween(from: string, until: string): number {
  return Math.max(1, Math.ceil((Date.parse(until) - Date.parse(from)) / 1000));
}
