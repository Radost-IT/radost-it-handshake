import { holdsFunds, isTerminalState, type Deal, type DealState } from '@handshake/core';

export type DemoResetStep =
  { action: 'delete'; stopExecution: boolean } | { action: 'keep'; reason: string };

// Up to here no PayPal order exists, so stopping the lifecycle cannot strand money.
const beforePayPal: readonly DealState[] = [
  'DRAFT',
  'NEGOTIATING',
  'AGREED',
  'AWAITING_HUMAN_APPROVAL',
];

/**
 * Decides what the demo reset does with one deal. It deletes only deals that
 * hold no money and never will: finished deals, and deals that have not
 * reached PayPal yet. A hold is never voided here, because policy lets a
 * person void only while the deal is being verified or is escalated.
 */
export function planDemoReset(deal: Deal): DemoResetStep {
  if (isTerminalState(deal.state)) return { action: 'delete', stopExecution: false };
  if (beforePayPal.includes(deal.state)) return { action: 'delete', stopExecution: true };
  if (holdsFunds(deal)) {
    return {
      action: 'keep',
      reason: 'it holds a PayPal authorization; settle it from the deal page first',
    };
  }
  if (deal.state === 'AUTHORIZING') {
    return {
      action: 'keep',
      reason: 'it waits for the PayPal checkout and cancels itself within an hour',
    };
  }
  return { action: 'keep', reason: `it is ${deal.state.toLowerCase()} the payment right now` };
}
