import { compareMoney, formatMoney, hasSameCurrency, type Money } from './money';

export type NegotiationParty = 'buyer' | 'seller';

export type NegotiationMove =
  | { action: 'OFFER'; price: Money; message: string }
  /** Accepts the other party's latest offer. */
  | { action: 'ACCEPT'; message: string }
  | { action: 'WALK_AWAY'; message: string };

export interface NegotiationTurn {
  party: NegotiationParty;
  move: NegotiationMove;
  at: string;
}

export interface Negotiation {
  /** The seller opens with this price; the buyer moves first. */
  listPrice: Money;
  maxTurns: number;
  turns: NegotiationTurn[];
}

export type NegotiationStatus =
  | { status: 'OPEN'; nextParty: NegotiationParty }
  | { status: 'AGREED'; price: Money }
  | { status: 'ABANDONED'; reason: string };

export class InvalidNegotiationMoveError extends Error {
  override name = 'InvalidNegotiationMoveError';
}

const otherParty = (party: NegotiationParty): NegotiationParty =>
  party === 'buyer' ? 'seller' : 'buyer';

/** The price on the table for `party` to accept: the other party's latest offer. */
export function standingOffer(negotiation: Negotiation, party: NegotiationParty): Money {
  const offer = negotiation.turns.findLast(
    (turn) => turn.party === otherParty(party) && turn.move.action === 'OFFER',
  );
  if (offer?.move.action === 'OFFER') return offer.move.price;
  if (party === 'buyer') return negotiation.listPrice;
  throw new InvalidNegotiationMoveError('The buyer has not made an offer yet');
}

export function negotiationStatus(negotiation: Negotiation): NegotiationStatus {
  const last = negotiation.turns.at(-1);
  if (last?.move.action === 'ACCEPT') {
    return { status: 'AGREED', price: standingOffer(negotiation, last.party) };
  }
  if (last?.move.action === 'WALK_AWAY') {
    return { status: 'ABANDONED', reason: `The ${last.party} walked away` };
  }
  if (negotiation.turns.length >= negotiation.maxTurns) {
    return { status: 'ABANDONED', reason: `No agreement within ${negotiation.maxTurns} turns` };
  }
  return { status: 'OPEN', nextParty: last ? otherParty(last.party) : 'buyer' };
}

/** Records a move after checking that it is this party's turn and the offer is in the deal currency. */
export function addTurn(negotiation: Negotiation, turn: NegotiationTurn): Negotiation {
  const status = negotiationStatus(negotiation);
  if (status.status !== 'OPEN') {
    throw new InvalidNegotiationMoveError(`The negotiation is already ${status.status}`);
  }
  if (turn.party !== status.nextParty) {
    throw new InvalidNegotiationMoveError(`It is the ${status.nextParty}'s turn`);
  }
  if (turn.move.action === 'OFFER' && !hasSameCurrency(turn.move.price, negotiation.listPrice)) {
    throw new InvalidNegotiationMoveError(
      `Offers must be in ${negotiation.listPrice.currency}, got ${turn.move.price.currency}`,
    );
  }
  return { ...negotiation, turns: [...negotiation.turns, turn] };
}

/**
 * Keeps an agent inside its private limit: the seller never goes below its
 * floor and the buyer never above its maximum. A move that would cross the
 * limit becomes an offer at the limit, so a model mistake or a manipulated
 * model cannot agree to a price its owner never allowed.
 */
export function holdPriceLimit(
  negotiation: Negotiation,
  party: NegotiationParty,
  limit: Money,
  move: NegotiationMove,
): NegotiationMove {
  const price = move.action === 'OFFER' ? move.price : standingOffer(negotiation, party);
  if (move.action === 'WALK_AWAY' || isWithinLimit(party, price, limit)) return move;
  const side = party === 'seller' ? 'below' : 'above';
  return {
    action: 'OFFER',
    price: limit,
    message: `I cannot go ${side} ${formatMoney(limit)}. That is my best offer.`,
  };
}

function isWithinLimit(party: NegotiationParty, price: Money, limit: Money): boolean {
  const comparison = compareMoney(price, limit);
  return party === 'seller' ? comparison >= 0 : comparison <= 0;
}
