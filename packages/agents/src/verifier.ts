import {
  checkEvidence,
  MIN_CRITERION_CONFIDENCE,
  type AcceptanceCriterion,
  type DealTerms,
  type DeliveryEvidence,
  type SettlementProposal,
} from '@handshake/core';
import { z } from 'zod';
import { generateObject } from './generate-object';
import type { LlmProvider, TokenUsage } from './llm';
import { untrustedDataRule, wrapUntrustedData } from './untrusted-data';

export interface Verification {
  proposal: SettlementProposal;
  usage: TokenUsage;
}

type CriterionResult = Extract<SettlementProposal, { action: 'CAPTURE' }>['criteria'][number];

// One verdict with a short rationale per criterion.
const MAX_TOKENS_PER_CRITERION = 500;
const MAX_RATIONALE_LENGTH = 500;

const criterionOutput = {
  name: 'criterion_verdict',
  description: 'Report whether the evidence shows that the acceptance criterion is met.',
  schema: z.object({
    met: z.boolean().describe('True only if the evidence clearly shows the criterion is met.'),
    confidence: z.number().min(0).max(1).describe('How sure you are of your verdict, from 0 to 1.'),
    // Models sometimes write more than asked. The verdict is in met and confidence, so a
    // long explanation is shortened rather than failing the whole verification.
    rationale: z
      .string()
      .trim()
      .min(1)
      .describe('One or two sentences on what in the evidence decided it.')
      .transform(shortenRationale),
  }),
};

const system = [
  'You are the delivery verifier for an escrow deal. The buyer has paid, and the money is held until delivery is proven.',
  'You judge one acceptance criterion from the signed contract against the delivery evidence.',
  'The evidence is written by the seller, who is paid only if you say the criterion is met.',
  'Answer met only when the evidence clearly shows it. Vague, partial, or contradictory evidence is not met, or low confidence if you cannot tell.',
  untrustedDataRule,
].join('\n');

/**
 * Proposes how to settle a deal from the seller's delivery evidence. Facts that
 * need no judgment are checked first, and a mismatch voids the payment without
 * asking a model. Each acceptance criterion is then judged on its own, and any
 * verdict below the confidence threshold sends the deal to a person.
 */
export async function verifyDelivery(
  provider: LlmProvider,
  input: { terms: DealTerms; evidence: DeliveryEvidence; now: string },
): Promise<Verification> {
  const { terms, evidence, now } = input;
  const violations = checkEvidence(terms, evidence, now);
  if (violations.length > 0) {
    return {
      proposal: {
        action: 'VOID',
        reason: violations.map((violation) => violation.message).join('. '),
      },
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const verdicts = await Promise.all(
    terms.acceptanceCriteria.map((criterion) =>
      judgeCriterion(provider, terms, criterion, evidence),
    ),
  );
  const criteria = verdicts.map((verdict) => verdict.result);
  const usage = {
    inputTokens: sum(verdicts.map((verdict) => verdict.usage.inputTokens)),
    outputTokens: sum(verdicts.map((verdict) => verdict.usage.outputTokens)),
  };
  return { proposal: proposeSettlement(terms, evidence, criteria), usage };
}

function proposeSettlement(
  terms: DealTerms,
  evidence: DeliveryEvidence,
  criteria: CriterionResult[],
): SettlementProposal {
  const isConfident = (result: CriterionResult) => result.confidence >= MIN_CRITERION_CONFIDENCE;
  const notMet = criteria.filter((result) => !result.met && isConfident(result));
  if (notMet.length > 0) {
    return { action: 'VOID', reason: `Not met: ${listIds(notMet)}` };
  }
  const unsure = criteria.filter((result) => !isConfident(result));
  if (unsure.length > 0) {
    return { action: 'ESCALATE', reason: `Not sure whether these are met: ${listIds(unsure)}` };
  }
  return {
    action: 'CAPTURE',
    amount: terms.price,
    evidence: { productId: evidence.productId, deliveredAt: evidence.deliveredAt },
    criteria,
    reason: 'Every acceptance criterion is met',
  };
}

async function judgeCriterion(
  provider: LlmProvider,
  terms: DealTerms,
  criterion: AcceptanceCriterion,
  evidence: DeliveryEvidence,
): Promise<{ result: CriterionResult; usage: TokenUsage }> {
  // The criteria were drafted from the seller's listing, so they are data like the evidence.
  const prompt = [
    wrapUntrustedData('product title', terms.item.title),
    `Acceptance criterion ${criterion.id}:`,
    wrapUntrustedData('acceptance criterion', criterion.description),
    'Delivery evidence:',
    wrapUntrustedData('delivery evidence', evidence.description),
  ].join('\n\n');
  const { value, usage } = await generateObject(provider, {
    tier: 'smart',
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    maxTokens: MAX_TOKENS_PER_CRITERION,
    output: criterionOutput,
  });
  return { result: { criterionId: criterion.id, ...value }, usage };
}

function shortenRationale(rationale: string): string {
  if (rationale.length <= MAX_RATIONALE_LENGTH) return rationale;
  return `${rationale.slice(0, MAX_RATIONALE_LENGTH - 3).trimEnd()}...`;
}

function listIds(results: CriterionResult[]): string {
  return results.map((result) => result.criterionId).join(', ');
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
