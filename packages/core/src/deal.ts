import { isSignedByBothParties, type SignedContract } from './contract';
import type { Mandate } from './mandate';
import { formatMoney, moneyEquals, type Money } from './money';

export const dealStates = [
  'DRAFT',
  'NEGOTIATING',
  'AGREED',
  'AWAITING_HUMAN_APPROVAL',
  'AUTHORIZING',
  'IN_ESCROW',
  'AWAITING_DELIVERY',
  'VERIFYING',
  'ESCALATED',
  'CAPTURING',
  'VOIDING',
  'SETTLED',
  'REFUSED',
  'CANCELLED',
  'ABANDONED',
] as const;

export type DealState = (typeof dealStates)[number];

const allowedTransitions: Record<DealState, readonly DealState[]> = {
  DRAFT: ['NEGOTIATING'],
  NEGOTIATING: ['AGREED', 'ABANDONED'],
  // Deals below the mandate's approval threshold skip the human step.
  AGREED: ['AWAITING_HUMAN_APPROVAL', 'AUTHORIZING'],
  AWAITING_HUMAN_APPROVAL: ['AUTHORIZING', 'CANCELLED'],
  // The buyer may never approve the PayPal checkout, or PayPal may decline it.
  AUTHORIZING: ['IN_ESCROW', 'CANCELLED'],
  IN_ESCROW: ['AWAITING_DELIVERY'],
  // Voiding here covers a seller who never delivers before the deadline.
  AWAITING_DELIVERY: ['VERIFYING', 'VOIDING'],
  VERIFYING: ['CAPTURING', 'VOIDING', 'ESCALATED'],
  ESCALATED: ['CAPTURING', 'VOIDING'],
  // A denied capture goes back to a person instead of retrying blindly.
  CAPTURING: ['SETTLED', 'ESCALATED'],
  VOIDING: ['REFUSED'],
  SETTLED: [],
  REFUSED: [],
  CANCELLED: [],
  ABANDONED: [],
};

const statesHoldingFunds: readonly DealState[] = [
  'IN_ESCROW',
  'AWAITING_DELIVERY',
  'VERIFYING',
  'ESCALATED',
];

export interface EscrowHold {
  orderId: string;
  authorizationId: string;
  amount: Money;
  /** When PayPal created this authorization. Its honor period counts from here. */
  authorizedAt: string;
  expiresAt: string;
}

export interface ConfirmedCapture {
  captureId: string;
  status: 'COMPLETED';
  amount: Money;
}

export interface Deal {
  id: string;
  state: DealState;
  mandate: Mandate;
  contract: SignedContract | null;
  escrow: EscrowHold | null;
  capture: ConfirmedCapture | null;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

export type DealTransition =
  | { to: 'AGREED'; contract: SignedContract }
  | { to: 'IN_ESCROW'; escrow: EscrowHold }
  | { to: 'SETTLED'; capture: ConfirmedCapture }
  | {
      to: Exclude<DealState, 'DRAFT' | 'AGREED' | 'IN_ESCROW' | 'SETTLED'>;
    };

export type DealEvent =
  | { dealId: string; seq: number; at: string; type: 'CREATED' }
  | {
      dealId: string;
      seq: number;
      at: string;
      type: 'STATE_CHANGED';
      from: DealState;
      to: DealState;
      reason: string;
    }
  | {
      dealId: string;
      seq: number;
      at: string;
      type: 'AUTHORIZATION_RENEWED';
      authorizationId: string;
      expiresAt: string;
    };

export interface DealChange {
  deal: Deal;
  event: DealEvent;
}

export class InvalidTransitionError extends Error {
  override name = 'InvalidTransitionError';
}

/** True while an authorization holds the buyer's money for this deal. */
export function holdsFunds(deal: Deal): deal is Deal & { escrow: EscrowHold } {
  return deal.escrow !== null && statesHoldingFunds.includes(deal.state);
}

export function isTerminalState(state: DealState): boolean {
  return allowedTransitions[state].length === 0;
}

export function createDeal(id: string, mandate: Mandate, at: string): DealChange {
  const deal: Deal = {
    id,
    state: 'DRAFT',
    mandate,
    contract: null,
    escrow: null,
    capture: null,
    eventCount: 1,
    createdAt: at,
    updatedAt: at,
  };
  return { deal, event: { dealId: id, seq: 1, at, type: 'CREATED' } };
}

function requireContract(deal: Deal): SignedContract {
  if (!deal.contract) throw new InvalidTransitionError(`Deal ${deal.id} has no contract`);
  return deal.contract;
}

function assertContractCanBeAgreed(deal: Deal, contract: SignedContract): void {
  if (contract.terms.dealId !== deal.id) {
    throw new InvalidTransitionError(`Contract belongs to deal ${contract.terms.dealId}`);
  }
  if (!isSignedByBothParties(contract)) {
    throw new InvalidTransitionError('Contract is not signed by both parties');
  }
}

function assertAmountMatchesContract(deal: Deal, amount: Money, what: string): void {
  const price = requireContract(deal).terms.price;
  if (!moneyEquals(amount, price)) {
    throw new InvalidTransitionError(
      `${what} of ${formatMoney(amount)} does not match the contract price ${formatMoney(price)}`,
    );
  }
}

function applyTransitionData(deal: Deal, transition: DealTransition): Deal {
  switch (transition.to) {
    case 'AGREED':
      assertContractCanBeAgreed(deal, transition.contract);
      return { ...deal, contract: transition.contract };
    case 'IN_ESCROW':
      assertAmountMatchesContract(deal, transition.escrow.amount, 'Authorization');
      return { ...deal, escrow: transition.escrow };
    case 'SETTLED':
      assertAmountMatchesContract(deal, transition.capture.amount, 'Capture');
      return { ...deal, capture: transition.capture };
    default:
      return deal;
  }
}

/**
 * Moves a deal to its next state and returns the event to append. Throws
 * `InvalidTransitionError` for transitions the lifecycle does not allow, and
 * for data that breaks the contract: an unsigned contract, or an authorization
 * or capture amount that differs from the agreed price.
 */
export function transitionDeal(
  deal: Deal,
  transition: DealTransition,
  at: string,
  reason: string,
): DealChange {
  if (!allowedTransitions[deal.state].includes(transition.to)) {
    throw new InvalidTransitionError(
      `Deal ${deal.id} cannot go from ${deal.state} to ${transition.to}`,
    );
  }

  const seq = deal.eventCount + 1;
  const next: Deal = {
    ...applyTransitionData(deal, transition),
    state: transition.to,
    eventCount: seq,
    updatedAt: at,
  };
  return {
    deal: next,
    event: {
      dealId: deal.id,
      seq,
      at,
      type: 'STATE_CHANGED',
      from: deal.state,
      to: next.state,
      reason,
    },
  };
}

/**
 * Records a reauthorization of the escrow hold. This is not a state change:
 * the deal stays where it is while the new authorization replaces the old one.
 */
export function renewAuthorization(
  deal: Deal,
  renewed: Omit<EscrowHold, 'orderId'>,
  at: string,
): DealChange {
  if (!holdsFunds(deal)) {
    throw new InvalidTransitionError(`Deal ${deal.id} holds no funds in state ${deal.state}`);
  }
  assertAmountMatchesContract(deal, renewed.amount, 'Reauthorization');

  const seq = deal.eventCount + 1;
  return {
    deal: { ...deal, escrow: { ...deal.escrow, ...renewed }, eventCount: seq, updatedAt: at },
    event: {
      dealId: deal.id,
      seq,
      at,
      type: 'AUTHORIZATION_RENEWED',
      authorizationId: renewed.authorizationId,
      expiresAt: renewed.expiresAt,
    },
  };
}
