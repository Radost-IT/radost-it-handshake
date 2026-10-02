import { z } from 'zod';
import type { DealTerms } from './contract';
import { formatMoney, hasSameCurrency, moneyEquals, moneySchema } from './money';
import type { PolicyViolation } from './policy';

/** What a seller submits as proof of delivery. All of it is the seller's claim. */
export const deliveryEvidenceSchema = z.object({
  productId: z.string().trim().min(1).max(128),
  deliveredAt: z.iso.datetime({ offset: true }),
  invoiceTotal: moneySchema,
  description: z.string().trim().min(1).max(4000),
});

export type DeliveryEvidence = z.infer<typeof deliveryEvidenceSchema>;

/**
 * Checks the evidence facts that need no judgment against the signed terms.
 * The verifier runs these before it asks a model anything.
 */
export function checkEvidence(
  terms: DealTerms,
  evidence: DeliveryEvidence,
  now: string,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  if (!hasSameCurrency(evidence.invoiceTotal, terms.price)) {
    violations.push({
      code: 'CURRENCY_MISMATCH',
      message: `Invoice is in ${evidence.invoiceTotal.currency}, the contract is in ${terms.price.currency}`,
    });
  } else if (!moneyEquals(evidence.invoiceTotal, terms.price)) {
    violations.push({
      code: 'AMOUNT_MISMATCH',
      message: `Invoice total ${formatMoney(evidence.invoiceTotal)} differs from the contract price ${formatMoney(terms.price)}`,
    });
  }
  if (evidence.productId !== terms.item.productId) {
    violations.push({ code: 'PRODUCT_MISMATCH', message: 'Evidence is for a different product' });
  }
  const deliveredAt = Date.parse(evidence.deliveredAt);
  if (deliveredAt > Date.parse(terms.deliveryDeadline)) {
    violations.push({
      code: 'DELIVERED_AFTER_DEADLINE',
      message: 'Delivery was after the contract deadline',
    });
  }
  if (deliveredAt > Date.parse(now)) {
    violations.push({
      code: 'DELIVERY_DATE_IN_FUTURE',
      message: 'The delivery date is in the future',
    });
  }
  return violations;
}
