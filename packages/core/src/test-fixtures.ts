import { signTerms, type DealTerms, type SignedContract } from './contract';
import { createDeal, transitionDeal, type Deal, type EscrowHold } from './deal';
import type { Mandate } from './mandate';
import { money } from './money';

export const mandate: Mandate = {
  maxPrice: money('100', 'USD'),
  blockedCategories: ['weapons'],
  humanApprovalThreshold: money('50', 'USD'),
};

export function buildTerms(overrides: Partial<DealTerms> = {}): DealTerms {
  return {
    dealId: 'deal-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    item: { productId: 'prod-1', title: 'Steel water bottle', categoryPath: ['home', 'kitchen'] },
    price: money('42.50', 'USD'),
    deliveryDeadline: '2026-10-10T00:00:00Z',
    acceptanceCriteria: [
      { id: 'c1', description: 'Bottle is 750 ml' },
      { id: 'c2', description: 'Lid is included' },
    ],
    ...overrides,
  };
}

export function signBoth(terms: DealTerms): SignedContract {
  return {
    terms,
    signatures: [
      signTerms(terms, 'buyer', '2026-10-02T10:00:00Z'),
      signTerms(terms, 'seller', '2026-10-02T10:00:01Z'),
    ],
  };
}

export function buildEscrow(overrides: Partial<EscrowHold> = {}): EscrowHold {
  return {
    orderId: 'order-1',
    authorizationId: 'auth-1',
    amount: money('42.50', 'USD'),
    authorizedAt: '2026-10-02T12:00:00Z',
    expiresAt: '2026-10-31T00:00:00Z',
    ...overrides,
  };
}

const at = '2026-10-02T12:00:00Z';

/** A deal walked through the real state machine up to VERIFYING. */
export function verifyingDeal(terms: DealTerms = buildTerms()): Deal {
  let { deal } = createDeal(terms.dealId, mandate, at);
  deal = transitionDeal(deal, { to: 'NEGOTIATING' }, at, 'start').deal;
  deal = transitionDeal(deal, { to: 'AGREED', contract: signBoth(terms) }, at, 'agreed').deal;
  deal = transitionDeal(deal, { to: 'AUTHORIZING' }, at, 'below threshold').deal;
  deal = transitionDeal(
    deal,
    { to: 'IN_ESCROW', escrow: buildEscrow({ amount: terms.price }) },
    at,
    'authorized',
  ).deal;
  deal = transitionDeal(deal, { to: 'AWAITING_DELIVERY' }, at, 'waiting').deal;
  return transitionDeal(deal, { to: 'VERIFYING' }, at, 'evidence received').deal;
}
