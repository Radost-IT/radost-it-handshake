import { signTerms, type DealTerms } from './contract';
import { InvalidTransitionError, transitionDeal, type Deal, type DealEvent } from './deal';
import { reviewAgreement } from './policy';

export interface AgreementOutcome {
  deal: Deal;
  events: DealEvent[];
}

/**
 * Turns agreed terms into a signed contract and moves the deal on: to
 * AUTHORIZING, to AWAITING_HUMAN_APPROVAL when the price reaches the mandate's
 * threshold, or to ABANDONED when the terms break the mandate.
 *
 * Signatures are plain digests anyone can compute, so only the server signs,
 * here, after the negotiation it ran. Never accept a signature from a client.
 */
export function concludeAgreement(deal: Deal, terms: DealTerms, now: string): AgreementOutcome {
  if (deal.state !== 'NEGOTIATING') {
    throw new InvalidTransitionError(`Deal ${deal.id} is not negotiating, it is ${deal.state}`);
  }
  const review = reviewAgreement(terms, deal.mandate);
  if (review.violations.length > 0) {
    const reason = review.violations.map((violation) => violation.message).join('. ');
    const abandoned = transitionDeal(deal, { to: 'ABANDONED' }, now, reason);
    return { deal: abandoned.deal, events: [abandoned.event] };
  }

  const contract = {
    terms,
    signatures: [signTerms(terms, 'buyer', now), signTerms(terms, 'seller', now)],
  };
  const agreed = transitionDeal(deal, { to: 'AGREED', contract }, now, 'Both parties signed');
  const next = review.requiresHumanApproval
    ? transitionDeal(
        agreed.deal,
        { to: 'AWAITING_HUMAN_APPROVAL' },
        now,
        'The price needs approval',
      )
    : transitionDeal(agreed.deal, { to: 'AUTHORIZING' }, now, 'Within the mandate');
  return { deal: next.deal, events: [agreed.event, next.event] };
}
