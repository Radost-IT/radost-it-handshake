const stateLabels: Record<string, string> = {
  DRAFT: 'Draft',
  NEGOTIATING: 'Negotiating',
  AGREED: 'Agreed',
  AWAITING_HUMAN_APPROVAL: 'Waiting for your approval',
  AUTHORIZING: 'Waiting for PayPal checkout',
  IN_ESCROW: 'Funds held',
  AWAITING_DELIVERY: 'Waiting for delivery',
  VERIFYING: 'Checking delivery',
  ESCALATED: 'Needs your decision',
  CAPTURING: 'Capturing payment',
  VOIDING: 'Releasing the hold',
  SETTLED: 'Settled',
  REFUSED: 'Refused, no charge',
  CANCELLED: 'Cancelled',
  ABANDONED: 'No deal',
};

export type StateTone = 'active' | 'held' | 'escalated' | 'settled' | 'stopped';

const stateTones: Record<string, StateTone> = {
  IN_ESCROW: 'held',
  AWAITING_DELIVERY: 'held',
  VERIFYING: 'held',
  CAPTURING: 'held',
  AWAITING_HUMAN_APPROVAL: 'escalated',
  ESCALATED: 'escalated',
  SETTLED: 'settled',
  REFUSED: 'stopped',
  CANCELLED: 'stopped',
  ABANDONED: 'stopped',
  VOIDING: 'stopped',
};

export function dealStateLabel(state: string): string {
  return stateLabels[state] ?? state;
}

export function dealStateTone(state: string): StateTone {
  return stateTones[state] ?? 'active';
}
