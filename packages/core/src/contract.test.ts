import { describe, expect, it } from 'vitest';
import { dealTermsSchema, isSignedByBothParties, signTerms, termsDigest } from './contract';
import { money } from './money';
import { buildTerms, signBoth } from './test-fixtures';

describe('termsDigest', () => {
  it('does not depend on key order', () => {
    const terms = buildTerms();
    const item = Object.fromEntries(Object.entries(terms.item).reverse()) as typeof terms.item;
    const shuffled = Object.fromEntries(
      Object.entries({ ...terms, item }).reverse(),
    ) as typeof terms;

    expect(termsDigest(shuffled)).toBe(termsDigest(terms));
  });

  it('changes when any term changes', () => {
    const terms = buildTerms();
    expect(termsDigest({ ...terms, price: money('42.51', 'USD') })).not.toBe(termsDigest(terms));
  });
});

describe('isSignedByBothParties', () => {
  it('accepts a contract signed by both named parties', () => {
    expect(isSignedByBothParties(signBoth(buildTerms()))).toBe(true);
  });

  it('rejects a contract missing the seller signature', () => {
    const terms = buildTerms();
    const contract = { terms, signatures: [signTerms(terms, 'buyer', '2026-10-02T10:00:00Z')] };
    expect(isSignedByBothParties(contract)).toBe(false);
  });

  it('rejects terms changed after signing, such as a price bait-and-switch', () => {
    const contract = signBoth(buildTerms());
    const tampered = { ...contract, terms: { ...contract.terms, price: money('99', 'USD') } };
    expect(isSignedByBothParties(tampered)).toBe(false);
  });

  it('rejects a signature from someone other than the named seller', () => {
    const terms = buildTerms();
    const forged = { ...signTerms(terms, 'seller', '2026-10-02T10:00:00Z'), signerId: 'impostor' };
    const contract = {
      terms,
      signatures: [signTerms(terms, 'buyer', '2026-10-02T10:00:00Z'), forged],
    };
    expect(isSignedByBothParties(contract)).toBe(false);
  });
});

describe('dealTermsSchema', () => {
  it('accepts valid terms', () => {
    expect(dealTermsSchema.safeParse(buildTerms()).success).toBe(true);
  });

  it('requires at least one acceptance criterion and a real deadline', () => {
    expect(dealTermsSchema.safeParse(buildTerms({ acceptanceCriteria: [] })).success).toBe(false);
    expect(dealTermsSchema.safeParse(buildTerms({ deliveryDeadline: 'next week' })).success).toBe(
      false,
    );
  });
});
