import { describe, expect, it } from 'vitest';
import { money } from './money';
import {
  addTurn,
  holdPriceLimit,
  InvalidNegotiationMoveError,
  negotiationStatus,
  type Negotiation,
  type NegotiationMove,
  type NegotiationParty,
} from './negotiation';

const usd = (value: string) => money(value, 'USD');
const at = '2026-10-02T12:00:00Z';

const open: Negotiation = { listPrice: usd('50.00'), maxTurns: 4, turns: [] };

const offer = (value: string): NegotiationMove => ({
  action: 'OFFER',
  price: usd(value),
  message: `How about ${value}?`,
});
const accept: NegotiationMove = { action: 'ACCEPT', message: 'Deal.' };

function play(...moves: NegotiationMove[]): Negotiation {
  return moves.reduce<Negotiation>((negotiation, move, index) => {
    const party: NegotiationParty = index % 2 === 0 ? 'buyer' : 'seller';
    return addTurn(negotiation, { party, move, at });
  }, open);
}

describe('negotiationStatus', () => {
  it('lets the buyer move first', () => {
    expect(negotiationStatus(open)).toEqual({ status: 'OPEN', nextParty: 'buyer' });
  });

  it('alternates turns', () => {
    expect(negotiationStatus(play(offer('40.00')))).toEqual({
      status: 'OPEN',
      nextParty: 'seller',
    });
  });

  it('agrees on the offer the last party accepted', () => {
    expect(negotiationStatus(play(offer('40.00'), offer('46.00'), accept))).toEqual({
      status: 'AGREED',
      price: usd('46.00'),
    });
  });

  it('agrees on the list price when the buyer accepts it outright', () => {
    expect(negotiationStatus(play(accept))).toEqual({ status: 'AGREED', price: usd('50.00') });
  });

  it('ends when a party walks away', () => {
    expect(
      negotiationStatus(play(offer('40.00'), { action: 'WALK_AWAY', message: 'No.' })),
    ).toEqual({ status: 'ABANDONED', reason: 'The seller walked away' });
  });

  it('ends without agreement at the turn cap', () => {
    expect(
      negotiationStatus(play(offer('40.00'), offer('48.00'), offer('42.00'), offer('47.00'))),
    ).toEqual({ status: 'ABANDONED', reason: 'No agreement within 4 turns' });
  });
});

describe('addTurn', () => {
  it('rejects a move out of turn', () => {
    expect(() => addTurn(open, { party: 'seller', move: offer('45.00'), at })).toThrow(
      "It is the buyer's turn",
    );
  });

  it('rejects a move after the negotiation ended', () => {
    expect(() => addTurn(play(accept), { party: 'seller', move: offer('45.00'), at })).toThrow(
      InvalidNegotiationMoveError,
    );
  });

  it('rejects an offer in another currency', () => {
    const euroOffer: NegotiationMove = {
      action: 'OFFER',
      price: money('40.00', 'EUR'),
      message: '',
    };

    expect(() => addTurn(open, { party: 'buyer', move: euroOffer, at })).toThrow('must be in USD');
  });
});

describe('holdPriceLimit', () => {
  const floor = usd('44.00');
  const maxPrice = usd('45.00');

  it('keeps a seller offer at or above the floor', () => {
    expect(holdPriceLimit(play(offer('40.00')), 'seller', floor, offer('44.00'))).toEqual(
      offer('44.00'),
    );
  });

  it('turns a seller offer below the floor into an offer at the floor', () => {
    expect(holdPriceLimit(play(offer('40.00')), 'seller', floor, offer('41.00'))).toEqual({
      action: 'OFFER',
      price: floor,
      message: 'I cannot go below 44.00 USD. That is my best offer.',
    });
  });

  it('stops the seller from accepting a buyer offer below the floor', () => {
    expect(holdPriceLimit(play(offer('40.00')), 'seller', floor, accept)).toMatchObject({
      action: 'OFFER',
      price: floor,
    });
  });

  it('stops the buyer from accepting a seller offer above the maximum', () => {
    expect(holdPriceLimit(open, 'buyer', maxPrice, accept)).toEqual({
      action: 'OFFER',
      price: maxPrice,
      message: 'I cannot go above 45.00 USD. That is my best offer.',
    });
  });

  it('lets the buyer accept a seller offer within the maximum', () => {
    const negotiation = play(offer('40.00'), offer('45.00'));

    expect(holdPriceLimit(negotiation, 'buyer', maxPrice, accept)).toEqual(accept);
  });

  it('always lets a party walk away', () => {
    const walkAway: NegotiationMove = { action: 'WALK_AWAY', message: 'Bye.' };

    expect(holdPriceLimit(open, 'buyer', maxPrice, walkAway)).toEqual(walkAway);
  });
});
