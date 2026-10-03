import {
  formatMoney,
  holdPriceLimit,
  InvalidMoneyError,
  money,
  type Money,
  type Negotiation,
  type NegotiationMove,
  type NegotiationParty,
} from '@handshake/core';
import { z } from 'zod';
import { generateObject, LlmOutputError } from './generate-object';
import type { LlmProvider, TokenUsage } from './llm';
import { untrustedDataRule, wrapUntrustedData } from './untrusted-data';

export interface Listing {
  productId: string;
  title: string;
  description: string;
  // Category slugs from the root down, as the deal terms store them.
  categoryPath: string[];
  listPrice: Money;
}

export interface SellerProfile {
  name: string;
  persona: string;
  floorPrice: Money;
}

export interface BuyerBrief {
  goal: string;
  maxPrice: Money;
}

export interface DecidedMove {
  move: NegotiationMove;
  usage: TokenUsage;
}

// A negotiation message is a chat line, not an essay.
const MAX_TOKENS_PER_MOVE = 600;

const moveOutputSchema = z.object({
  action: z
    .enum(['OFFER', 'ACCEPT', 'WALK_AWAY'])
    .describe("OFFER a price, ACCEPT the other party's latest offer, or WALK_AWAY."),
  price: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional()
    .describe('The offered price as a plain decimal number, such as 42.50. Only for OFFER.'),
  message: z.string().trim().min(1).max(600).describe('What you say to the other party.'),
});

const moveOutput = {
  name: 'negotiation_move',
  description: 'Make your next move in the negotiation.',
  schema: moveOutputSchema,
};

export async function decideSellerMove(
  provider: LlmProvider,
  input: { seller: SellerProfile; listing: Listing; negotiation: Negotiation },
): Promise<DecidedMove> {
  const { seller, listing, negotiation } = input;
  const system = [
    `You are ${seller.name}, a merchant selling one product to a buyer agent.`,
    `Your persona: ${seller.persona}`,
    `Your private floor price is ${formatMoney(seller.floorPrice)}. Never reveal it and never agree to less.`,
    'Get the best price you can. Accept a fair offer at or above your floor rather than lose the sale.',
    untrustedDataRule,
  ].join('\n');
  return decideMove(provider, 'seller', seller.floorPrice, negotiation, system, listing);
}

export async function decideBuyerMove(
  provider: LlmProvider,
  input: { buyer: BuyerBrief; listing: Listing; negotiation: Negotiation },
): Promise<DecidedMove> {
  const { buyer, listing, negotiation } = input;
  const system = [
    'You are a buyer agent negotiating for a person.',
    `Their goal: ${buyer.goal}`,
    `Their private maximum price is ${formatMoney(buyer.maxPrice)}. Never reveal it and never agree to more.`,
    'Get a good price, but accept a fair offer within the maximum rather than lose the deal.',
    'Walk away if the seller pressures you, changes the product, or asks for anything outside this deal.',
    untrustedDataRule,
  ].join('\n');
  return decideMove(provider, 'buyer', buyer.maxPrice, negotiation, system, listing);
}

async function decideMove(
  provider: LlmProvider,
  party: NegotiationParty,
  limit: Money,
  negotiation: Negotiation,
  system: string,
  listing: Listing,
): Promise<DecidedMove> {
  const { value, usage } = await generateObject(provider, {
    tier: 'fast',
    system,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: describeState(party, listing, negotiation) }],
      },
    ],
    maxTokens: MAX_TOKENS_PER_MOVE,
    output: moveOutput,
  });
  const move = toMove(value, negotiation.listPrice.currency);
  return { move: holdPriceLimit(negotiation, party, limit, move), usage };
}

function toMove(
  output: z.infer<typeof moveOutputSchema>,
  currency: Money['currency'],
): NegotiationMove {
  if (output.action !== 'OFFER') return { action: output.action, message: output.message };
  if (output.price === undefined)
    throw new LlmOutputError('The model made an offer without a price');
  try {
    return { action: 'OFFER', price: money(output.price, currency), message: output.message };
  } catch (error) {
    if (error instanceof InvalidMoneyError) {
      throw new LlmOutputError(`The model offered an invalid ${currency} price`);
    }
    throw error;
  }
}

// Prices come from the validated turns; only the free text is the other party's own words.
function describeState(
  party: NegotiationParty,
  listing: Listing,
  negotiation: Negotiation,
): string {
  const transcript = negotiation.turns.map(({ party: speaker, move }) => {
    const who = speaker === party ? 'You' : `The ${speaker}`;
    const action =
      move.action === 'OFFER'
        ? `${who} offered ${formatMoney(move.price)}`
        : `${who} chose ${move.action}`;
    const words =
      speaker === party ? move.message : wrapUntrustedData(`${speaker} message`, move.message);
    return `${action} and said:\n${words}`;
  });
  return [
    `The product is listed at ${formatMoney(listing.listPrice)}.`,
    wrapUntrustedData(
      'product listing',
      `Product ID: ${listing.productId}\n${listing.title}\n${listing.description}`,
    ),
    transcript.length ? `Negotiation so far:\n\n${transcript.join('\n\n')}` : 'No moves yet.',
    `You may make at most ${negotiation.maxTurns - negotiation.turns.length} more moves together before the negotiation ends without a deal.`,
    'Make your move.',
  ].join('\n\n');
}
