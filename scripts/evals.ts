import {
  decideBuyerMove,
  decideSellerMove,
  runNegotiation,
  verifyDelivery,
  type LlmProvider,
  type NegotiationAgent,
  type TokenUsage,
} from '@handshake/agents';
import {
  compareMoney,
  dealTermsSchema,
  deliveryEvidenceSchema,
  formatMoney,
  moneySchema,
  type Negotiation,
  type NegotiationMove,
} from '@handshake/core';
import { z } from 'zod';

const listingSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  categoryPath: z.array(z.string().min(1)),
  listPrice: moneySchema,
});

const scriptedMoveSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('OFFER'), price: moneySchema, message: z.string().min(1) }),
  z.object({ action: z.enum(['ACCEPT', 'WALK_AWAY']), message: z.string().min(1) }),
]);

const negotiationScenarioSchema = z.object({
  kind: z.literal('negotiation'),
  name: z.string().min(1),
  description: z.string().min(1),
  listing: listingSchema,
  buyer: z.object({ goal: z.string().min(1), maxPrice: moneySchema }),
  // A model plays the seller, or the seller follows a fixed script to test the buyer.
  seller: z.union([
    z.object({ name: z.string().min(1), persona: z.string().min(1), floorPrice: moneySchema }),
    z.object({ script: z.array(scriptedMoveSchema).min(1) }),
  ]),
  maxTurns: z.number().int().min(2).max(20),
  expect: z.discriminatedUnion('outcome', [
    z.object({ outcome: z.literal('agreed'), minPrice: moneySchema, maxPrice: moneySchema }),
    z.object({ outcome: z.literal('no-deal') }),
  ]),
});

const verificationScenarioSchema = z.object({
  kind: z.literal('verification'),
  name: z.string().min(1),
  description: z.string().min(1),
  terms: dealTermsSchema,
  evidence: deliveryEvidenceSchema,
  now: z.iso.datetime({ offset: true }),
  // Some cases have more than one safe answer, such as voiding or asking a person.
  expect: z.object({ actions: z.array(z.enum(['CAPTURE', 'VOID', 'ESCALATE'])).min(1) }),
});

export const evalScenarioSchema = z.discriminatedUnion('kind', [
  negotiationScenarioSchema,
  verificationScenarioSchema,
]);

export type EvalScenario = z.infer<typeof evalScenarioSchema>;
type NegotiationScenario = z.infer<typeof negotiationScenarioSchema>;
type VerificationScenario = z.infer<typeof verificationScenarioSchema>;

export interface EvalResult {
  name: string;
  passed: boolean;
  outcome: string;
  usage: TokenUsage;
}

export function runEvalScenario(
  provider: LlmProvider,
  scenario: EvalScenario,
): Promise<EvalResult> {
  return scenario.kind === 'negotiation'
    ? runNegotiationScenario(provider, scenario)
    : runVerificationScenario(provider, scenario);
}

async function runNegotiationScenario(
  provider: LlmProvider,
  scenario: NegotiationScenario,
): Promise<EvalResult> {
  const { listing, buyer, seller } = scenario;
  const start: Negotiation = {
    listPrice: listing.listPrice,
    maxTurns: scenario.maxTurns,
    turns: [],
  };
  const sellerAgent: NegotiationAgent =
    'script' in seller
      ? scriptedSeller(seller.script)
      : (negotiation) => decideSellerMove(provider, { seller, listing, negotiation });
  const { status, usage } = await runNegotiation(
    start,
    {
      buyer: (negotiation) => decideBuyerMove(provider, { buyer, listing, negotiation }),
      seller: sellerAgent,
    },
    { now: () => new Date().toISOString(), onTurn: () => Promise.resolve() },
  );

  const outcome =
    status.status === 'AGREED'
      ? `agreed at ${formatMoney(status.price)}`
      : `no deal: ${status.reason}`;
  const { expect } = scenario;
  const passed =
    expect.outcome === 'no-deal'
      ? status.status !== 'AGREED'
      : status.status === 'AGREED' &&
        compareMoney(status.price, expect.minPrice) >= 0 &&
        compareMoney(status.price, expect.maxPrice) <= 0;
  return { name: scenario.name, passed, outcome, usage };
}

// The scripted seller makes its moves in order and walks away when the script runs out.
function scriptedSeller(script: NegotiationMove[]): NegotiationAgent {
  return (negotiation) => {
    const sellerTurns = negotiation.turns.filter((turn) => turn.party === 'seller').length;
    const move = script[sellerTurns] ?? { action: 'WALK_AWAY', message: 'That is all I have.' };
    return Promise.resolve({ move, usage: { inputTokens: 0, outputTokens: 0 } });
  };
}

async function runVerificationScenario(
  provider: LlmProvider,
  scenario: VerificationScenario,
): Promise<EvalResult> {
  const { terms, evidence, now } = scenario;
  const { proposal, usage } = await verifyDelivery(provider, { terms, evidence, now });
  return {
    name: scenario.name,
    passed: scenario.expect.actions.includes(proposal.action),
    outcome: `${proposal.action}: ${proposal.reason}`,
    usage,
  };
}
