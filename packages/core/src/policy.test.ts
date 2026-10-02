import { describe, expect, it } from 'vitest';
import type { Deal } from './deal';
import { money } from './money';
import {
  evaluateProposal,
  reviewAgreement,
  settlementProposalSchema,
  type PolicyDecision,
  type SettlementProposal,
} from './policy';
import { buildEscrow, buildTerms, mandate, signBoth, verifyingDeal } from './test-fixtures';

const now = '2026-10-05T12:00:00Z';

const capture: SettlementProposal = {
  action: 'CAPTURE',
  amount: money('42.50', 'USD'),
  evidence: { productId: 'prod-1', deliveredAt: '2026-10-05T09:00:00Z' },
  criteria: [
    { criterionId: 'c1', met: true, confidence: 0.95, rationale: 'Label shows 750 ml' },
    { criterionId: 'c2', met: true, confidence: 0.9, rationale: 'Lid visible in photo' },
  ],
  reason: 'All criteria met',
};

function violationCodes(decision: PolicyDecision): string[] {
  return decision.approved ? [] : decision.violations.map((violation) => violation.code);
}

describe('reviewAgreement', () => {
  it('accepts terms within the mandate and below the approval threshold', () => {
    expect(reviewAgreement(buildTerms({ price: money('49.99', 'USD') }), mandate)).toEqual({
      violations: [],
      requiresHumanApproval: false,
    });
  });

  it('requires a person at or above the threshold', () => {
    const review = reviewAgreement(buildTerms({ price: money('50', 'USD') }), mandate);
    expect(review.requiresHumanApproval).toBe(true);
  });

  it('flags prices above the mandate and blocked categories', () => {
    const terms = buildTerms({
      price: money('100.01', 'USD'),
      item: { productId: 'p', title: 'Knife', categoryPath: ['outdoor', 'weapons'] },
    });
    expect(reviewAgreement(terms, mandate).violations.map((violation) => violation.code)).toEqual([
      'PRICE_ABOVE_MANDATE',
      'CATEGORY_BLOCKED',
    ]);
  });

  it('flags currency confusion instead of comparing across currencies', () => {
    const review = reviewAgreement(buildTerms({ price: money('40', 'EUR') }), mandate);
    expect(review.violations.map((violation) => violation.code)).toEqual(['CURRENCY_MISMATCH']);
  });
});

describe('evaluateProposal: capture', () => {
  it('approves a verified capture and takes the amount from the deal', () => {
    expect(evaluateProposal(verifyingDeal(), capture, 'verifier', now)).toEqual({
      approved: true,
      instruction: { action: 'CAPTURE', authorizationId: 'auth-1', amount: money('42.50', 'USD') },
    });
  });

  it('rejects a capture for a different amount than agreed', () => {
    const inflated = { ...capture, amount: money('420', 'USD') };
    expect(violationCodes(evaluateProposal(verifyingDeal(), inflated, 'verifier', now))).toEqual([
      'AMOUNT_MISMATCH',
    ]);
  });

  it('rejects evidence for a swapped item', () => {
    const swapped = { ...capture, evidence: { ...capture.evidence, productId: 'prod-cheap' } };
    expect(violationCodes(evaluateProposal(verifyingDeal(), swapped, 'verifier', now))).toEqual([
      'PRODUCT_MISMATCH',
    ]);
  });

  it('rejects late delivery', () => {
    const late = {
      ...capture,
      evidence: { ...capture.evidence, deliveredAt: '2026-10-11T00:00:00Z' },
    };
    expect(violationCodes(evaluateProposal(verifyingDeal(), late, 'verifier', now))).toEqual([
      'DELIVERED_AFTER_DEADLINE',
    ]);
  });

  it('rejects partial delivery claimed as complete: a missing or unmet criterion', () => {
    const partial = { ...capture, criteria: capture.criteria.slice(0, 1) };
    expect(violationCodes(evaluateProposal(verifyingDeal(), partial, 'verifier', now))).toEqual([
      'CRITERION_NOT_MET',
    ]);
  });

  it('rejects low-confidence verdicts', () => {
    const unsure = {
      ...capture,
      criteria: capture.criteria.map((result) => ({ ...result, confidence: 0.79 })),
    };
    expect(violationCodes(evaluateProposal(verifyingDeal(), unsure, 'verifier', now))).toEqual([
      'CRITERION_NOT_MET',
      'CRITERION_NOT_MET',
    ]);
  });

  it('rejects a capture once the authorization has expired', () => {
    const deal = { ...verifyingDeal(), escrow: buildEscrow({ expiresAt: now }) };
    expect(violationCodes(evaluateProposal(deal, capture, 'verifier', now))).toEqual([
      'AUTHORIZATION_EXPIRED',
    ]);
  });

  it('rejects a capture when the contract was altered after signing', () => {
    const contract = signBoth(buildTerms());
    const altered: Deal = {
      ...verifyingDeal(),
      contract: { ...contract, terms: { ...contract.terms, price: money('420', 'USD') } },
    };
    expect(violationCodes(evaluateProposal(altered, capture, 'verifier', now))).toEqual([
      'CONTRACT_NOT_SIGNED',
    ]);
  });

  it('lets a person capture an escalated deal without criterion verdicts', () => {
    const escalated: Deal = { ...verifyingDeal(), state: 'ESCALATED' };
    const decision = evaluateProposal(escalated, { ...capture, criteria: [] }, 'human', now);
    expect(decision.approved).toBe(true);
  });

  it('does not let the verifier capture an escalated deal', () => {
    const escalated: Deal = { ...verifyingDeal(), state: 'ESCALATED' };
    expect(violationCodes(evaluateProposal(escalated, capture, 'verifier', now))).toEqual([
      'WRONG_STATE',
    ]);
  });

  it('never lets the system capture', () => {
    expect(violationCodes(evaluateProposal(verifyingDeal(), capture, 'system', now))).toEqual([
      'NOT_ALLOWED_FOR_PROPOSER',
    ]);
  });
});

describe('evaluateProposal: void and escalate', () => {
  const voidProposal: SettlementProposal = { action: 'VOID', reason: 'Wrong item delivered' };

  it('approves a verifier void with the deal authorization', () => {
    expect(evaluateProposal(verifyingDeal(), voidProposal, 'verifier', now)).toEqual({
      approved: true,
      instruction: { action: 'VOID', authorizationId: 'auth-1' },
    });
  });

  it('lets the system void only after the delivery deadline', () => {
    const waiting: Deal = { ...verifyingDeal(), state: 'AWAITING_DELIVERY' };

    expect(violationCodes(evaluateProposal(waiting, voidProposal, 'system', now))).toEqual([
      'DEADLINE_NOT_PASSED',
    ]);
    expect(evaluateProposal(waiting, voidProposal, 'system', '2026-10-10T00:00:01Z').approved).toBe(
      true,
    );
  });

  it('approves escalation from VERIFYING only', () => {
    const escalate: SettlementProposal = { action: 'ESCALATE', reason: 'Photo is unclear' };

    expect(evaluateProposal(verifyingDeal(), escalate, 'verifier', now)).toEqual({
      approved: true,
      instruction: { action: 'ESCALATE' },
    });
    const waiting: Deal = { ...verifyingDeal(), state: 'AWAITING_DELIVERY' };
    expect(violationCodes(evaluateProposal(waiting, escalate, 'verifier', now))).toEqual([
      'WRONG_STATE',
    ]);
  });
});

describe('settlementProposalSchema', () => {
  it('rejects model output with a float amount or an unknown action', () => {
    expect(
      settlementProposalSchema.safeParse({ ...capture, amount: { currency: 'USD', value: 42.5 } })
        .success,
    ).toBe(false);
    expect(settlementProposalSchema.safeParse({ action: 'REFUND', reason: 'x' }).success).toBe(
      false,
    );
  });
});
