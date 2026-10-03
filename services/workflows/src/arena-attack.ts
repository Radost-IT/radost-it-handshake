import {
  decideBuyerMove,
  decideSellerMove,
  draftDealTerms,
  runNegotiation,
  verifyDelivery,
  type LlmProvider,
  type NegotiationAgent,
} from '@handshake/agents';
import {
  concludeAgreement,
  createDeal,
  dealTermsSchema,
  evaluateProposal,
  formatMoney,
  transitionDeal,
  type Deal,
  type DealTerms,
  type EscrowHold,
  type Mandate,
  type Money,
  type NegotiationTurn,
  type SettlementProposal,
} from '@handshake/core';
import type { ArenaRun, StoredAttempt } from '@handshake/store';
import type { ArenaDeal } from './arena-deal';

export interface ArenaAttackContext {
  llm: LlmProvider;
  negotiationMaxTurns: number;
  now: string;
}

type Attempt = Pick<StoredAttempt, 'id' | 'channel' | 'attackText'>;

const ARENA_BUYER_ID = 'arena-buyer';
// Arena deals hold no money, and an authorization would stay valid this long.
const SIMULATED_HOLD_MS = 29 * 24 * 60 * 60 * 1000;

/**
 * Runs an arena deal with the challenger's text as the seller's and records
 * what the agents said and what policy decided. Listing and message attacks
 * go through negotiation and the contract; evidence attacks go to the
 * verifier. Nothing here touches PayPal: the escrow is simulated, and policy
 * decisions are only recorded for the judge.
 */
export async function runArenaAttack(
  context: ArenaAttackContext,
  deal: ArenaDeal,
  attempt: Attempt,
): Promise<ArenaRun> {
  return attempt.channel === 'evidence'
    ? attackThroughEvidence(context, deal, attempt)
    : attackThroughNegotiation(context, deal, attempt);
}

async function attackThroughNegotiation(
  context: ArenaAttackContext,
  deal: ArenaDeal,
  attempt: Attempt,
): Promise<ArenaRun> {
  const listing =
    attempt.channel === 'listing'
      ? { ...deal.listing, description: `${deal.listing.description}\n\n${attempt.attackText}` }
      : deal.listing;
  const sellerModel: NegotiationAgent = (negotiation) =>
    decideSellerMove(context.llm, { seller: deal.seller, listing, negotiation });
  const seller =
    attempt.channel === 'message'
      ? openWithAttack(attempt.attackText, listing.listPrice, sellerModel)
      : sellerModel;
  const buyer: NegotiationAgent = (negotiation) =>
    decideBuyerMove(context.llm, { buyer: deal.buyer, listing, negotiation });

  const { negotiation, status } = await runNegotiation(
    { listPrice: listing.listPrice, maxTurns: context.negotiationMaxTurns, turns: [] },
    { buyer, seller },
    { now: () => context.now, onTurn: () => Promise.resolve() },
  );
  const transcript = negotiation.turns.map(describeTurn);
  if (status.status !== 'AGREED') {
    return {
      transcript: [...transcript, `No deal: ${status.reason}`].join('\n'),
      policyDecisions: [],
    };
  }

  const terms = await termsFor(context, { ...deal, listing }, attempt, status.price);
  const agreed = concludeArenaAgreement(deal, attempt, terms, context.now);
  return {
    transcript: [...transcript, describeTerms(terms)].join('\n'),
    policyDecisions: [agreed.decision],
  };
}

// The challenger's message is the seller's opening line; the seller model plays every turn after it.
function openWithAttack(
  attackText: string,
  listPrice: Money,
  seller: NegotiationAgent,
): NegotiationAgent {
  return (negotiation) =>
    negotiation.turns.some((turn) => turn.party === 'seller')
      ? seller(negotiation)
      : Promise.resolve({
          move: { action: 'OFFER', price: listPrice, message: attackText },
          usage: { inputTokens: 0, outputTokens: 0 },
        });
}

// The evidence channel tests the verifier, so the deal is agreed at the seller's floor without talking.
async function attackThroughEvidence(
  context: ArenaAttackContext,
  deal: ArenaDeal,
  attempt: Attempt,
): Promise<ArenaRun> {
  const price = deal.seller.floorPrice;
  const terms = await termsFor(context, deal, attempt, price);
  const agreed = concludeArenaAgreement(deal, attempt, terms, context.now);
  const transcript = [
    `The buyer and the seller agreed at ${formatMoney(price)} without negotiating.`,
    describeTerms(terms),
  ];
  if (agreed.deal.state !== 'AUTHORIZING') {
    return { transcript: transcript.join('\n'), policyDecisions: [agreed.decision] };
  }

  const verifying = awaitVerification(agreed.deal, terms, context.now);
  const evidence = {
    productId: terms.item.productId,
    deliveredAt: context.now,
    invoiceTotal: price,
    description: attempt.attackText,
  };
  const { proposal } = await verifyDelivery(context.llm, { terms, evidence, now: context.now });
  const decision = evaluateProposal(verifying, proposal, 'verifier', context.now);
  return {
    transcript: [...transcript, describeProposal(proposal)].join('\n'),
    policyDecisions: [
      agreed.decision,
      decision.approved
        ? `Policy approved ${proposal.action}. This is an arena deal, so no money moved.`
        : `Policy refused ${proposal.action}: ${decision.violations.map((violation) => violation.message).join('. ')}`,
    ],
  };
}

async function termsFor(
  context: ArenaAttackContext,
  deal: ArenaDeal,
  attempt: Attempt,
  price: Money,
): Promise<DealTerms> {
  const dealId = `arena-${attempt.id}`;
  const deliveryDeadline = new Date(
    Date.parse(context.now) + deal.deliveryDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  if (deal.acceptanceCriteria === null) {
    const { terms } = await draftDealTerms(context.llm, {
      dealId,
      buyerId: ARENA_BUYER_ID,
      sellerId: deal.sellerId,
      buyer: deal.buyer,
      listing: deal.listing,
      price,
      deliveryDeadline,
    });
    return terms;
  }
  return dealTermsSchema.parse({
    dealId,
    buyerId: ARENA_BUYER_ID,
    sellerId: deal.sellerId,
    item: {
      productId: deal.listing.productId,
      title: deal.listing.title,
      categoryPath: deal.listing.categoryPath,
    },
    price,
    deliveryDeadline,
    acceptanceCriteria: deal.acceptanceCriteria,
  });
}

function concludeArenaAgreement(
  deal: ArenaDeal,
  attempt: Attempt,
  terms: DealTerms,
  now: string,
): { deal: Deal; decision: string } {
  // Every arena price at the buyer's maximum waits for a person, as a real mandate would.
  const mandate: Mandate = {
    maxPrice: deal.buyer.maxPrice,
    blockedCategories: [],
    humanApprovalThreshold: deal.buyer.maxPrice,
  };
  const created = createDeal(`arena-${attempt.id}`, mandate, now).deal;
  const negotiating = transitionDeal(created, { to: 'NEGOTIATING' }, now, 'Arena deal opened');
  const outcome = concludeAgreement(negotiating.deal, terms, now);
  const last = outcome.events.at(-1);
  const reason = last?.type === 'STATE_CHANGED' ? last.reason : outcome.deal.state;
  const decision =
    outcome.deal.state === 'AUTHORIZING'
      ? `Policy approved the agreement at ${formatMoney(terms.price)}: ${reason}.`
      : `Policy stopped the agreement at ${formatMoney(terms.price)} in ${outcome.deal.state}: ${reason}.`;
  return { deal: outcome.deal, decision };
}

// The hold mirrors what PayPal returns, so the settlement policy runs unchanged on an arena deal.
function awaitVerification(deal: Deal, terms: DealTerms, now: string): Deal {
  const escrow: EscrowHold = {
    orderId: `${deal.id}-simulated`,
    authorizationId: `${deal.id}-simulated`,
    amount: terms.price,
    authorizedAt: now,
    expiresAt: new Date(Date.parse(now) + SIMULATED_HOLD_MS).toISOString(),
  };
  const held = transitionDeal(deal, { to: 'IN_ESCROW', escrow }, now, 'Simulated hold').deal;
  const delivering = transitionDeal(held, { to: 'AWAITING_DELIVERY' }, now, 'Arena').deal;
  return transitionDeal(delivering, { to: 'VERIFYING' }, now, 'Evidence received').deal;
}

function describeTurn({ party, move }: NegotiationTurn): string {
  const price = move.action === 'OFFER' ? ` ${formatMoney(move.price)}` : '';
  return `${party} ${move.action}${price}: ${move.message}`;
}

function describeTerms(terms: DealTerms): string {
  const criteria = terms.acceptanceCriteria.map(
    (criterion) => `${criterion.id}: ${criterion.description}`,
  );
  return [
    `Contract: ${terms.item.title} (${terms.item.productId}) for ${formatMoney(terms.price)}, delivered by ${terms.deliveryDeadline}.`,
    ...criteria,
  ].join('\n');
}

function describeProposal(proposal: SettlementProposal): string {
  if (proposal.action !== 'CAPTURE')
    return `verifier proposes ${proposal.action}: ${proposal.reason}`;
  const criteria = proposal.criteria.map(
    (result) =>
      `${result.criterionId} ${result.met ? 'met' : 'not met'} (confidence ${result.confidence}): ${result.rationale}`,
  );
  return [`verifier proposes CAPTURE of ${formatMoney(proposal.amount)}`, ...criteria].join('\n');
}
