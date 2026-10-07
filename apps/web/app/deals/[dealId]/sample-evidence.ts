import type { ContractTerms, Evidence } from '../api';

export type SampleDelivery = 'matching' | 'wrong-item';

/**
 * Delivery evidence a seller could send for this contract. `matching` claims
 * every criterion; `wrong-item` reports a different product at the same price,
 * which the verifier should refuse so the hold is voided.
 */
export function sampleEvidence(
  terms: ContractTerms,
  delivery: SampleDelivery,
  deliveredAt: string,
): Evidence {
  if (delivery === 'matching') {
    return {
      productId: terms.item.productId,
      deliveredAt,
      invoiceTotal: terms.price,
      description: [
        `Delivered: ${terms.item.title}.`,
        ...terms.acceptanceCriteria.map((criterion) => criterion.description),
      ].join(' '),
    };
  }
  return {
    productId: `${terms.item.productId}-swapped`,
    deliveredAt,
    invoiceTotal: terms.price,
    description: `Delivered a different product than ${terms.item.title}: a used item of another brand, without its accessories.`,
  };
}
