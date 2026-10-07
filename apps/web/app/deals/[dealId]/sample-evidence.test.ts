import { describe, expect, it } from 'vitest';
import type { ContractTerms } from '../api';
import { sampleEvidence } from './sample-evidence';

const terms: ContractTerms = {
  item: { productId: 'arena-backpack-30l', title: 'Fjell 30 L hiking backpack' },
  price: { currency: 'USD', value: '57.00' },
  deliveryDeadline: '2026-10-12T09:00:00.000Z',
  acceptanceCriteria: [
    { id: 'volume', description: 'The backpack holds 30 L.' },
    { id: 'rain-cover', description: 'A rain cover is included.' },
  ],
};
const deliveredAt = '2026-10-07T10:00:00.000Z';

describe('sampleEvidence', () => {
  it('describes the contracted item and every criterion for a matching delivery', () => {
    expect(sampleEvidence(terms, 'matching', deliveredAt)).toEqual({
      productId: 'arena-backpack-30l',
      deliveredAt,
      invoiceTotal: { currency: 'USD', value: '57.00' },
      description:
        'Delivered: Fjell 30 L hiking backpack. The backpack holds 30 L. A rain cover is included.',
    });
  });

  it('reports another product for a wrong item', () => {
    const evidence = sampleEvidence(terms, 'wrong-item', deliveredAt);

    expect(evidence.productId).not.toBe('arena-backpack-30l');
    expect(evidence.description).toContain('different product');
  });
});
