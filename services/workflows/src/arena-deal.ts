import { createHash } from 'node:crypto';
import { pickDealTemplate, type DealTemplate } from '@handshake/arena';
import type { AcceptanceCriterion } from '@handshake/core';
import { listSellers, type Seller, type StoreTable } from '@handshake/store';

/** The deal a challenger attacks, whether it came from a template or a seeded seller. */
export interface ArenaDeal {
  sellerId: string;
  seller: DealTemplate['seller'];
  listing: DealTemplate['listing'];
  buyer: DealTemplate['buyer'];
  /** Null for seeded sellers: the contract drafter writes their criteria after agreement. */
  acceptanceCriteria: AcceptanceCriterion[] | null;
  deliveryDays: number;
}

export type ArenaDealSource = 'templates' | 'sellers';

export class NoSeededSellersError extends Error {
  override name = 'NoSeededSellersError';
}

// The arena picks from this many seeded sellers; one query keeps the pick cheap.
const SELLER_POOL_SIZE = 100;
const SELLER_DELIVERY_DAYS = 5;

export async function pickArenaDeal(
  context: { table: StoreTable; dealSource: ArenaDealSource },
  attempt: { id: string; dailyChallengeDate: string | null },
): Promise<ArenaDeal> {
  if (context.dealSource === 'templates') return fromTemplate(pickDealTemplate(attempt));

  const sellers = await listSellers(context.table, SELLER_POOL_SIZE);
  const seller = pickByHash(sellers, attempt.dailyChallengeDate ?? attempt.id);
  if (seller === undefined) {
    throw new NoSeededSellersError(
      'ARENA_DEAL_SOURCE is sellers, but no sellers are seeded. Run pnpm seed:sellers first.',
    );
  }
  return fromSeller(seller);
}

function fromTemplate(template: DealTemplate): ArenaDeal {
  return {
    sellerId: `arena-${template.id}`,
    seller: template.seller,
    listing: template.listing,
    buyer: template.buyer,
    acceptanceCriteria: template.acceptanceCriteria,
    deliveryDays: template.deliveryDays,
  };
}

// A seeded seller has no buyer, so the buyer wants the listed product and pays at most the list price.
function fromSeller(seller: Seller): ArenaDeal {
  return {
    sellerId: seller.sellerId,
    seller: { name: seller.name, persona: seller.persona, floorPrice: seller.floorPrice },
    listing: seller.listing,
    buyer: { goal: seller.listing.title, maxPrice: seller.listing.listPrice },
    acceptanceCriteria: null,
    deliveryDays: SELLER_DELIVERY_DAYS,
  };
}

// The same key always picks the same seller while the seeded set stays the same.
function pickByHash<Item>(items: readonly Item[], key: string): Item | undefined {
  if (items.length === 0) return undefined;
  return items[createHash('sha256').update(key).digest().readUInt32BE(0) % items.length];
}
