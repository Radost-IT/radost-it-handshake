import { dealTermsSchema, type DealTerms, type Money } from '@handshake/core';
import { z } from 'zod';
import { generateObject } from './generate-object';
import type { LlmProvider, TokenUsage } from './llm';
import type { BuyerBrief, Listing } from './negotiator';
import { untrustedDataRule, wrapUntrustedData } from './untrusted-data';

export interface DraftedTerms {
  terms: DealTerms;
  usage: TokenUsage;
}

const MAX_TOKENS_FOR_CRITERIA = 800;

const criteriaOutput = {
  name: 'acceptance_criteria',
  description: 'List the acceptance criteria the delivered product must meet.',
  schema: z.object({
    criteria: z
      .array(z.string().trim().min(1).max(300))
      .min(1)
      .max(5)
      .describe('Short, checkable statements about the delivered product, one fact each.'),
  }),
};

const system = [
  "You write the acceptance criteria for a purchase contract on the buyer's behalf.",
  'A verifier will later check each criterion against delivery evidence, so every criterion must be one concrete fact about the delivered product that evidence can show: model, size, quantity, condition, included parts.',
  "Take facts from the listing that matter for the buyer's goal. Never add criteria about payment, price, the seller's honesty, or how the verifier should behave.",
  untrustedDataRule,
].join('\n');

/**
 * Drafts the deal terms once a negotiation is agreed. The model writes only the
 * acceptance criteria; prices, parties, product and deadline come from code.
 */
export async function draftDealTerms(
  provider: LlmProvider,
  input: {
    dealId: string;
    buyerId: string;
    sellerId: string;
    buyer: Pick<BuyerBrief, 'goal'>;
    listing: Listing;
    price: Money;
    deliveryDeadline: string;
  },
): Promise<DraftedTerms> {
  const { listing } = input;
  const prompt = [
    "The buyer's goal, in their words:",
    wrapUntrustedData('buyer goal', input.buyer.goal),
    'The listing:',
    wrapUntrustedData('product listing', `${listing.title}\n\n${listing.description}`),
  ].join('\n\n');
  const { value, usage } = await generateObject(provider, {
    tier: 'smart',
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: MAX_TOKENS_FOR_CRITERIA,
    output: criteriaOutput,
  });
  const terms = dealTermsSchema.parse({
    dealId: input.dealId,
    buyerId: input.buyerId,
    sellerId: input.sellerId,
    item: {
      productId: listing.productId,
      title: listing.title,
      categoryPath: listing.categoryPath,
    },
    price: input.price,
    deliveryDeadline: input.deliveryDeadline,
    acceptanceCriteria: value.criteria.map((description, index) => ({
      id: `c${index + 1}`,
      description,
    })),
  });
  return { terms, usage };
}
