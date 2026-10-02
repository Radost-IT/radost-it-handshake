import { createHash } from 'node:crypto';
import { z } from 'zod';
import { moneySchema } from './money';

const identifier = z.string().trim().min(1).max(128);

export const acceptanceCriterionSchema = z.object({
  id: identifier,
  description: z.string().trim().min(1).max(500),
});

export const dealTermsSchema = z.object({
  dealId: identifier,
  buyerId: identifier,
  sellerId: identifier,
  item: z.object({
    productId: identifier,
    title: z.string().trim().min(1).max(300),
    // Category slugs from the root down, so a mandate can block a whole branch.
    categoryPath: z.array(z.string().trim().min(1).max(100)).max(10),
  }),
  price: moneySchema,
  deliveryDeadline: z.iso.datetime({ offset: true }),
  acceptanceCriteria: z.array(acceptanceCriterionSchema).min(1).max(10),
});

export type DealTerms = z.infer<typeof dealTermsSchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;

export type ContractParty = 'buyer' | 'seller';

export interface ContractSignature {
  party: ContractParty;
  signerId: string;
  digest: string;
  signedAt: string;
}

export interface SignedContract {
  terms: DealTerms;
  signatures: ContractSignature[];
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 over a key-order-independent JSON encoding of the terms. */
export function termsDigest(terms: DealTerms): string {
  return createHash('sha256').update(canonicalJson(terms)).digest('hex');
}

export function signTerms(
  terms: DealTerms,
  party: ContractParty,
  signedAt: string,
): ContractSignature {
  const signerId = party === 'buyer' ? terms.buyerId : terms.sellerId;
  return { party, signerId, digest: termsDigest(terms), signedAt };
}

/**
 * True only when both the buyer and the seller named in the terms signed
 * exactly these terms. Any change after signing breaks the digest.
 */
export function isSignedByBothParties(contract: SignedContract): boolean {
  const digest = termsDigest(contract.terms);
  const signedBy = (party: ContractParty, signerId: string) =>
    contract.signatures.some(
      (signature) =>
        signature.party === party && signature.signerId === signerId && signature.digest === digest,
    );
  return signedBy('buyer', contract.terms.buyerId) && signedBy('seller', contract.terms.sellerId);
}
