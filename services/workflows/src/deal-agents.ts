import {
  decideBuyerMove,
  decideSellerMove,
  draftDealTerms,
  findProductForGoal,
  runNegotiation,
  verifyDelivery,
  type LlmProvider,
  type NegotiationAgent,
  type ProductCatalog,
} from '@handshake/agents';
import { sellerForProduct } from '@handshake/channel3';
import {
  concludeAgreement,
  transitionDeal,
  type Deal,
  type DealState,
  type NegotiationTurn,
  type SettlementProposal,
} from '@handshake/core';
import {
  getDeal,
  getDealBrief,
  getEvidence,
  getSeller,
  saveDeal,
  saveNegotiationRecord,
  type DealBrief,
  type Seller,
  type StoreTable,
} from '@handshake/store';
import { z } from 'zod';

export interface DealAgentsContext {
  table: StoreTable;
  llm: LlmProvider;
  /** Null while product search is not set up; deals then need a seller ID. */
  catalog: ProductCatalog | null;
  negotiationMaxTurns: number;
  now: () => string;
}

const CATALOG_UNAVAILABLE =
  'Product search is not available right now. Open the deal again with a seller ID, such as arena-backpack';

// Sandbox deals have no real shipping, so one fixed window keeps the demo deals comparable.
const DELIVERY_DAYS = 5;

const dealId = z.string().min(1);

/** The input the DealLifecycle state machine sends to the agent steps. */
export const dealAgentsTaskSchema = z.discriminatedUnion('task', [
  z.object({ task: z.literal('Negotiate'), dealId }),
  z.object({ task: z.literal('Verify'), dealId }),
]);

export type DealAgentsTask = z.infer<typeof dealAgentsTaskSchema>;

export type DealAgentsResult = { state: DealState } | { proposal: SettlementProposal };

export class DealRecordMissingError extends Error {
  override name = 'DealRecordMissingError';
}

/**
 * The agent steps of a deal: find a seller and negotiate, or check delivery
 * evidence against the contract. Neither moves money. Negotiation ends with
 * the server signing the contract, and verification returns a proposal that
 * policy checks in the next step.
 */
export async function runDealAgentsTask(
  context: DealAgentsContext,
  task: DealAgentsTask,
): Promise<DealAgentsResult> {
  const deal = await getDeal(context.table, task.dealId);
  if (!deal) throw new DealRecordMissingError(`Deal ${task.dealId} does not exist`);
  switch (task.task) {
    case 'Negotiate':
      return deal.state === 'NEGOTIATING' ? negotiate(context, deal) : { state: deal.state };
    case 'Verify':
      return verify(context, deal);
  }
}

async function negotiate(context: DealAgentsContext, deal: Deal): Promise<DealAgentsResult> {
  const brief = await getDealBrief(context.table, deal.id);
  if (!brief) throw new DealRecordMissingError(`Deal ${deal.id} has no brief`);
  const found = await findSeller(context, deal, brief);
  if (!found.seller) return abandon(context, deal, found.reason);
  const { seller } = found;

  const { listing } = seller;
  const buyerBrief = { goal: brief.goal, maxPrice: deal.mandate.maxPrice };
  const buyer: NegotiationAgent = (negotiation) =>
    decideBuyerMove(context.llm, { buyer: buyerBrief, listing, negotiation });
  const sellerAgent: NegotiationAgent = (negotiation) =>
    decideSellerMove(context.llm, { seller, listing, negotiation });

  const turns: NegotiationTurn[] = [];
  const record = (outcome: string | null) =>
    saveNegotiationRecord(context.table, deal.id, {
      sellerId: seller.sellerId,
      sellerName: seller.name,
      listing,
      turns,
      outcome,
    });
  await record(null);
  const { status } = await runNegotiation(
    { listPrice: listing.listPrice, maxTurns: context.negotiationMaxTurns, turns: [] },
    { buyer, seller: sellerAgent },
    {
      now: context.now,
      onTurn: (turn) => {
        turns.push(turn);
        return record(null);
      },
    },
  );
  if (status.status !== 'AGREED') {
    await record(status.reason);
    return abandon(context, deal, status.reason);
  }

  const { terms } = await draftDealTerms(context.llm, {
    dealId: deal.id,
    buyerId: brief.buyerId,
    sellerId: seller.sellerId,
    buyer: buyerBrief,
    listing,
    price: status.price,
    deliveryDeadline: new Date(
      Date.parse(context.now()) + DELIVERY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  });
  await record('The buyer and the seller agreed on a price');
  const outcome = concludeAgreement(deal, terms, context.now());
  await saveDeal(context.table, outcome.deal, outcome.events);
  return { state: outcome.deal.state };
}

async function findSeller(
  context: DealAgentsContext,
  deal: Deal,
  brief: DealBrief,
): Promise<{ seller: Seller } | { seller: null; reason: string }> {
  if (brief.sellerId !== null) {
    const seller = await getSeller(context.table, brief.sellerId);
    return seller
      ? { seller }
      : { seller: null, reason: `Seller ${brief.sellerId} does not exist` };
  }
  if (context.catalog === null) return { seller: null, reason: CATALOG_UNAVAILABLE };
  const shopping = await findProductForGoal(context.llm, {
    goal: brief.goal,
    mandate: deal.mandate,
    catalog: context.catalog,
  });
  return shopping.found
    ? { seller: sellerForProduct(shopping.listing) }
    : { seller: null, reason: shopping.reason };
}

async function abandon(
  context: DealAgentsContext,
  deal: Deal,
  reason: string,
): Promise<DealAgentsResult> {
  const change = transitionDeal(deal, { to: 'ABANDONED' }, context.now(), reason);
  await saveDeal(context.table, change.deal, [change.event]);
  return { state: change.deal.state };
}

async function verify(context: DealAgentsContext, deal: Deal): Promise<DealAgentsResult> {
  if (deal.state !== 'VERIFYING' || !deal.contract) {
    throw new DealRecordMissingError(`Deal ${deal.id} is ${deal.state} and has nothing to verify`);
  }
  const evidence = await getEvidence(context.table, deal.id);
  if (!evidence) throw new DealRecordMissingError(`Deal ${deal.id} has no delivery evidence`);
  const { proposal } = await verifyDelivery(context.llm, {
    terms: deal.contract.terms,
    evidence,
    now: context.now(),
  });
  return { proposal };
}
