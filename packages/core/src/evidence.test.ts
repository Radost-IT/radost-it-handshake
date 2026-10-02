import { describe, expect, it } from 'vitest';
import { checkEvidence, deliveryEvidenceSchema, type DeliveryEvidence } from './evidence';
import { money } from './money';
import { buildTerms } from './test-fixtures';

const terms = buildTerms();
const now = '2026-10-08T12:00:00Z';

function buildEvidence(overrides: Partial<DeliveryEvidence> = {}): DeliveryEvidence {
  return {
    productId: 'prod-1',
    deliveredAt: '2026-10-08T09:00:00Z',
    invoiceTotal: money('42.50', 'USD'),
    description: 'Delivered a 750 ml steel bottle with its lid.',
    ...overrides,
  };
}

const codes = (evidence: DeliveryEvidence) =>
  checkEvidence(terms, evidence, now).map((violation) => violation.code);

describe('checkEvidence', () => {
  it('passes evidence that matches the contract', () => {
    expect(codes(buildEvidence())).toEqual([]);
  });

  it('rejects an invoice in another currency', () => {
    expect(codes(buildEvidence({ invoiceTotal: money('42.50', 'EUR') }))).toEqual([
      'CURRENCY_MISMATCH',
    ]);
  });

  it('rejects an invoice for another amount', () => {
    expect(codes(buildEvidence({ invoiceTotal: money('21.25', 'USD') }))).toEqual([
      'AMOUNT_MISMATCH',
    ]);
  });

  it('rejects evidence for another product', () => {
    expect(codes(buildEvidence({ productId: 'prod-2' }))).toEqual(['PRODUCT_MISMATCH']);
  });

  it('rejects a delivery after the deadline', () => {
    expect(
      checkEvidence(
        terms,
        buildEvidence({ deliveredAt: '2026-10-11T00:00:00Z' }),
        '2026-10-12T00:00:00Z',
      ).map((violation) => violation.code),
    ).toEqual(['DELIVERED_AFTER_DEADLINE']);
  });

  it('rejects a delivery date that has not happened yet', () => {
    expect(codes(buildEvidence({ deliveredAt: '2026-10-09T00:00:00Z' }))).toEqual([
      'DELIVERY_DATE_IN_FUTURE',
    ]);
  });

  it('accepts a delivery exactly at the deadline', () => {
    expect(
      checkEvidence(
        terms,
        buildEvidence({ deliveredAt: terms.deliveryDeadline }),
        '2026-10-12T00:00:00Z',
      ),
    ).toEqual([]);
  });
});

describe('deliveryEvidenceSchema', () => {
  it('rejects an empty description', () => {
    expect(
      deliveryEvidenceSchema.safeParse({ ...buildEvidence(), description: '  ' }).success,
    ).toBe(false);
  });
});
