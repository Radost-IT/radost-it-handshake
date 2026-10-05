import type { DealEvent, PayPalCall, Webhook } from '../api';

export type StepStatus = 'done' | 'current' | 'pending' | 'stopped';

export interface EscrowStep {
  label: string;
  detail: string;
  status: StepStatus;
  at: string | null;
}

interface StepDefinition {
  label: string;
  detail: string;
  /** The deal state that completes this step. */
  completedBy: string;
}

const capturedStep: StepDefinition = {
  label: 'Payment captured',
  detail: 'PayPal moved the money to the seller.',
  completedBy: 'SETTLED',
};

const voidedStep: StepDefinition = {
  label: 'Authorization voided',
  detail: 'PayPal released the hold. The buyer paid nothing.',
  completedBy: 'REFUSED',
};

const leadingSteps: StepDefinition[] = [
  {
    label: 'Price agreed',
    detail: 'Both agents signed the same contract.',
    completedBy: 'AGREED',
  },
  {
    label: 'Funds held',
    detail: 'PayPal authorized the payment without capturing it.',
    completedBy: 'IN_ESCROW',
  },
  {
    label: 'Delivery claimed',
    detail: 'The seller sent delivery evidence.',
    completedBy: 'VERIFYING',
  },
];

const stoppedStates = ['CANCELLED', 'ABANDONED'];

/**
 * The escrow path of a deal, one step per milestone, built from its event log.
 * A voided deal ends on the void step; every other deal ends on the capture step.
 */
export function escrowSteps(state: string, events: DealEvent[]): EscrowStep[] {
  const reachedAt = new Map<string, string>();
  for (const event of events) {
    if (event.type === 'STATE_CHANGED' && !reachedAt.has(event.to)) {
      reachedAt.set(event.to, event.at);
    }
  }
  const definitions = [...leadingSteps, state === 'REFUSED' ? voidedStep : capturedStep];
  const firstOpen = definitions.findIndex((step) => !reachedAt.has(step.completedBy));

  return definitions.map((step, index) => {
    const at = reachedAt.get(step.completedBy) ?? null;
    return {
      label: step.label,
      detail: step.detail,
      at,
      status: statusOf(index, firstOpen, at, state),
    };
  });
}

function statusOf(index: number, firstOpen: number, at: string | null, state: string): StepStatus {
  if (at !== null) return 'done';
  if (index !== firstOpen) return 'pending';
  return stoppedStates.includes(state) ? 'stopped' : 'current';
}

export type PayPalActivity =
  | { kind: 'call'; at: string; call: PayPalCall }
  | { kind: 'webhook'; at: string; webhook: Webhook };

/** The deal's PayPal API calls and webhooks in one list, oldest first. */
export function paypalActivity(calls: PayPalCall[], webhooks: Webhook[]): PayPalActivity[] {
  const activity: PayPalActivity[] = [
    ...calls.map((call) => ({ kind: 'call' as const, at: call.at, call })),
    ...webhooks.map((webhook) => ({ kind: 'webhook' as const, at: webhook.at, webhook })),
  ];
  return activity.sort((a, b) => a.at.localeCompare(b.at));
}
