import { z } from 'zod';
import { isSignedByBothParties, type DealTerms } from './contract';
import type { Deal, DealState, EscrowHold } from './deal';
import type { Mandate } from './mandate';
import {
  compareMoney,
  formatMoney,
  hasSameCurrency,
  moneyEquals,
  moneySchema,
  type Money,
} from './money';

/** Below this, a verifier's "met" verdict is not trusted to release money. */
export const MIN_CRITERION_CONFIDENCE = 0.8;

export type PolicyViolationCode =
  | 'WRONG_STATE'
  | 'NOT_ALLOWED_FOR_PROPOSER'
  | 'CONTRACT_NOT_SIGNED'
  | 'CURRENCY_MISMATCH'
  | 'PRICE_ABOVE_MANDATE'
  | 'CATEGORY_BLOCKED'
  | 'NO_ESCROW'
  | 'AUTHORIZATION_EXPIRED'
  | 'AMOUNT_MISMATCH'
  | 'PRODUCT_MISMATCH'
  | 'DELIVERED_AFTER_DEADLINE'
  | 'CRITERION_NOT_MET'
  | 'DEADLINE_NOT_PASSED';

export interface PolicyViolation {
  code: PolicyViolationCode;
  message: string;
}

export interface AgreementReview {
  violations: PolicyViolation[];
  requiresHumanApproval: boolean;
}

function checkTermsAgainstMandate(terms: DealTerms, mandate: Mandate): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  if (!hasSameCurrency(terms.price, mandate.maxPrice)) {
    violations.push({
      code: 'CURRENCY_MISMATCH',
      message: `Price is in ${terms.price.currency}, the mandate allows ${mandate.maxPrice.currency}`,
    });
  } else if (compareMoney(terms.price, mandate.maxPrice) > 0) {
    violations.push({
      code: 'PRICE_ABOVE_MANDATE',
      message: `Price ${formatMoney(terms.price)} is above the mandate maximum ${formatMoney(mandate.maxPrice)}`,
    });
  }

  const blocked = terms.item.categoryPath.find((slug) => mandate.blockedCategories.includes(slug));
  if (blocked !== undefined) {
    violations.push({ code: 'CATEGORY_BLOCKED', message: `Category "${blocked}" is blocked` });
  }

  return violations;
}

/** Checks agreed terms against the buyer's mandate before any money is authorized. */
export function reviewAgreement(terms: DealTerms, mandate: Mandate): AgreementReview {
  const violations = checkTermsAgainstMandate(terms, mandate);
  const requiresHumanApproval =
    hasSameCurrency(terms.price, mandate.humanApprovalThreshold) &&
    compareMoney(terms.price, mandate.humanApprovalThreshold) >= 0;
  return { violations, requiresHumanApproval };
}

const contractNotSigned: PolicyViolation = {
  code: 'CONTRACT_NOT_SIGNED',
  message: 'The contract is missing or was changed after signing',
};

/**
 * Checks a deal right before its payment is authorized. The terms are checked
 * again because the mandate, not the agreement step, is the last word.
 */
export function reviewAuthorization(deal: Deal): PolicyViolation[] {
  if (deal.state !== 'AUTHORIZING') {
    return [
      { code: 'WRONG_STATE', message: `Authorization is not allowed in state ${deal.state}` },
    ];
  }
  const contract = deal.contract;
  if (!contract || !isSignedByBothParties(contract)) return [contractNotSigned];
  return checkTermsAgainstMandate(contract.terms, deal.mandate);
}

const criterionResultSchema = z.object({
  criterionId: z.string().min(1).max(128),
  met: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(1000),
});

const reasonSchema = z.string().trim().min(1).max(1000);

/** What a verifier agent or a person proposes. Parse LLM output with this before evaluating it. */
export const settlementProposalSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('CAPTURE'),
    amount: moneySchema,
    evidence: z.object({
      productId: z.string().min(1).max(128),
      deliveredAt: z.iso.datetime({ offset: true }),
    }),
    criteria: z.array(criterionResultSchema).max(20),
    reason: reasonSchema,
  }),
  z.object({ action: z.literal('VOID'), reason: reasonSchema }),
  z.object({ action: z.literal('ESCALATE'), reason: reasonSchema }),
]);

export type SettlementProposal = z.infer<typeof settlementProposalSchema>;
type CaptureProposal = Extract<SettlementProposal, { action: 'CAPTURE' }>;

/** Who made the proposal. Set by the calling code, never by the model. */
export type Proposer = 'verifier' | 'human' | 'system';

/** What the settlement engine may execute. Amounts come from the deal, not from the proposal. */
export type SettlementInstruction =
  | { action: 'CAPTURE'; authorizationId: string; amount: Money }
  | { action: 'VOID'; authorizationId: string }
  | { action: 'ESCALATE' };

export type PolicyDecision =
  | { approved: true; instruction: SettlementInstruction }
  | { approved: false; violations: PolicyViolation[] };

const allowedStates: Record<
  SettlementProposal['action'],
  Record<Proposer, readonly DealState[]>
> = {
  CAPTURE: { verifier: ['VERIFYING'], human: ['ESCALATED'], system: [] },
  VOID: {
    verifier: ['VERIFYING'],
    human: ['VERIFYING', 'ESCALATED'],
    system: ['AWAITING_DELIVERY'],
  },
  // The system escalates when policy rejects a verifier's proposal, so a person decides.
  ESCALATE: { verifier: ['VERIFYING'], human: [], system: ['VERIFYING'] },
};

function checkProposerAndState(
  deal: Deal,
  action: SettlementProposal['action'],
  proposer: Proposer,
): PolicyViolation[] {
  const states = allowedStates[action][proposer];
  if (states.length === 0) {
    return [
      { code: 'NOT_ALLOWED_FOR_PROPOSER', message: `A ${proposer} cannot propose ${action}` },
    ];
  }
  if (!states.includes(deal.state)) {
    return [{ code: 'WRONG_STATE', message: `${action} is not allowed in state ${deal.state}` }];
  }
  return [];
}

const noEscrow: PolicyViolation = {
  code: 'NO_ESCROW',
  message: 'The deal has no authorized payment',
};

function checkEscrowIsLive(escrow: EscrowHold | null, now: string): PolicyViolation[] {
  if (!escrow) return [noEscrow];
  if (Date.parse(escrow.expiresAt) <= Date.parse(now)) {
    return [
      { code: 'AUTHORIZATION_EXPIRED', message: `Authorization expired at ${escrow.expiresAt}` },
    ];
  }
  return [];
}

function checkCriteria(terms: DealTerms, results: CaptureProposal['criteria']): PolicyViolation[] {
  return terms.acceptanceCriteria.flatMap((criterion) => {
    const result = results.find((candidate) => candidate.criterionId === criterion.id);
    if (!result?.met) {
      return [
        { code: 'CRITERION_NOT_MET' as const, message: `Criterion ${criterion.id} is not met` },
      ];
    }
    if (result.confidence < MIN_CRITERION_CONFIDENCE) {
      return [
        {
          code: 'CRITERION_NOT_MET' as const,
          message: `Criterion ${criterion.id} confidence ${result.confidence} is below ${MIN_CRITERION_CONFIDENCE}`,
        },
      ];
    }
    return [];
  });
}

function checkCapture(
  deal: Deal,
  proposal: CaptureProposal,
  proposer: Proposer,
  now: string,
): PolicyViolation[] {
  const contract = deal.contract;
  if (!contract || !isSignedByBothParties(contract)) return [contractNotSigned];
  const { terms } = contract;
  const violations = [
    ...checkTermsAgainstMandate(terms, deal.mandate),
    ...checkEscrowIsLive(deal.escrow, now),
  ];

  if (!moneyEquals(proposal.amount, terms.price)) {
    violations.push({
      code: 'AMOUNT_MISMATCH',
      message: `Proposed ${formatMoney(proposal.amount)} differs from the contract price ${formatMoney(terms.price)}`,
    });
  }
  if (deal.escrow && !moneyEquals(deal.escrow.amount, terms.price)) {
    violations.push({
      code: 'AMOUNT_MISMATCH',
      message: `Authorized ${formatMoney(deal.escrow.amount)} differs from the contract price ${formatMoney(terms.price)}`,
    });
  }
  if (proposal.evidence.productId !== terms.item.productId) {
    violations.push({ code: 'PRODUCT_MISMATCH', message: 'Evidence is for a different product' });
  }
  if (Date.parse(proposal.evidence.deliveredAt) > Date.parse(terms.deliveryDeadline)) {
    violations.push({
      code: 'DELIVERED_AFTER_DEADLINE',
      message: 'Delivery was after the contract deadline',
    });
  }
  // A person resolving an escalation has looked at the evidence; the verifier has not convinced us yet.
  if (proposer === 'verifier') violations.push(...checkCriteria(terms, proposal.criteria));

  return violations;
}

function checkVoid(deal: Deal, proposer: Proposer, now: string): PolicyViolation[] {
  if (!deal.escrow) return [noEscrow];
  const deadline = deal.contract?.terms.deliveryDeadline;
  if (
    proposer === 'system' &&
    (deadline === undefined || Date.parse(now) <= Date.parse(deadline))
  ) {
    return [{ code: 'DEADLINE_NOT_PASSED', message: 'The delivery deadline has not passed yet' }];
  }
  return [];
}

/**
 * The gate between agents and money. Approves a proposal only when it is
 * consistent with the deal state, the signed contract, the buyer's mandate,
 * and a live authorization. The returned instruction carries amounts from the
 * deal itself, so a proposal can never change how much is captured.
 */
export function evaluateProposal(
  deal: Deal,
  proposal: SettlementProposal,
  proposer: Proposer,
  now: string,
): PolicyDecision {
  const violations = checkProposerAndState(deal, proposal.action, proposer);
  if (violations.length === 0) {
    if (proposal.action === 'CAPTURE')
      violations.push(...checkCapture(deal, proposal, proposer, now));
    if (proposal.action === 'VOID') violations.push(...checkVoid(deal, proposer, now));
  }

  if (violations.length > 0) return { approved: false, violations };
  if (proposal.action === 'ESCALATE')
    return { approved: true, instruction: { action: 'ESCALATE' } };
  if (!deal.escrow) return { approved: false, violations: [noEscrow] };

  const { authorizationId, amount } = deal.escrow;
  const instruction: SettlementInstruction =
    proposal.action === 'VOID'
      ? { action: 'VOID', authorizationId }
      : { action: 'CAPTURE', authorizationId, amount };
  return { approved: true, instruction };
}
