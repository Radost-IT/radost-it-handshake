import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  dealEventSchema,
  dealSchema,
  deliveryEvidenceSchema,
  moneySchema,
  negotiationTurnSchema,
  type Deal,
  type DealEvent,
  type DeliveryEvidence,
} from '@handshake/core';
import { z } from 'zod';
import { checkoutSchema, type Checkout } from './checkout';
import { dealKey } from './deals';
import type { StoreTable } from './table';

const timestamp = z.iso.datetime({ offset: true });

const briefSchema = z.object({
  goal: z.string().min(1),
  /** A seeded seller to negotiate with. Without one, the buyer agent shops the catalog. */
  sellerId: z.string().min(1).nullable(),
  /** Who the buyer is in the contract: the developer who opened the deal. */
  buyerId: z.string().min(1),
});

/** What the buyer asked for when the deal was opened. */
export type DealBrief = z.infer<typeof briefSchema>;

const listingSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  categoryPath: z.array(z.string()),
  listPrice: moneySchema,
});

const negotiationRecordSchema = z.object({
  sellerId: z.string().min(1),
  sellerName: z.string().min(1),
  listing: listingSchema,
  turns: z.array(negotiationTurnSchema),
  /** Why the negotiation ended, once it has. */
  outcome: z.string().nullable(),
});

/** The negotiation as the deal page shows it. The seller's floor price is never stored here. */
export type NegotiationRecord = z.infer<typeof negotiationRecordSchema>;

const paypalCallSchema = z.object({
  at: timestamp,
  operation: z.string().min(1),
  requestId: z.string().nullable(),
  statusCode: z.number().int(),
  debugId: z.string().nullable(),
});

/** One PayPal API call made for the deal, for the audit log. */
export type PayPalCallEntry = z.infer<typeof paypalCallSchema>;

const webhookSchema = z.object({
  at: timestamp,
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  resourceId: z.string().nullable(),
});

/** One signature-verified PayPal webhook event about the deal. */
export type WebhookEntry = z.infer<typeof webhookSchema>;

export interface DealRecord {
  deal: Deal;
  events: DealEvent[];
  brief: DealBrief | null;
  negotiation: NegotiationRecord | null;
  checkout: Checkout | null;
  evidence: DeliveryEvidence | null;
  paypalCalls: PayPalCallEntry[];
  webhooks: WebhookEntry[];
}

const recordKey = (dealId: string, sk: string) => ({ pk: dealKey(dealId).pk, sk });

async function put(table: StoreTable, item: Record<string, unknown>): Promise<void> {
  await table.client.send(new PutCommand({ TableName: table.name, Item: item }));
}

export function saveDealBrief(table: StoreTable, dealId: string, brief: DealBrief): Promise<void> {
  return put(table, { ...recordKey(dealId, 'BRIEF'), ...brief });
}

export async function getDealBrief(
  table: StoreTable,
  dealId: string,
): Promise<DealBrief | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: recordKey(dealId, 'BRIEF') }),
  );
  return Item ? briefSchema.parse(Item) : undefined;
}

/** Saved after every turn, so the deal page can follow the negotiation while it runs. */
export function saveNegotiationRecord(
  table: StoreTable,
  dealId: string,
  negotiation: NegotiationRecord,
): Promise<void> {
  return put(table, { ...recordKey(dealId, 'NEGOTIATION'), ...negotiation });
}

/** Delivery evidence is kept once: a seller cannot replace it after verification starts. */
export async function saveEvidence(
  table: StoreTable,
  dealId: string,
  evidence: DeliveryEvidence,
): Promise<void> {
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: { ...recordKey(dealId, 'EVIDENCE'), ...evidence },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
}

export async function getEvidence(
  table: StoreTable,
  dealId: string,
): Promise<DeliveryEvidence | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: recordKey(dealId, 'EVIDENCE') }),
  );
  return Item ? deliveryEvidenceSchema.parse(Item) : undefined;
}

export function recordPayPalCall(
  table: StoreTable,
  dealId: string,
  call: PayPalCallEntry,
): Promise<void> {
  // Several calls can share a millisecond, so the request ID or operation keeps keys apart.
  const sk = `PAYPAL#${call.at}#${call.requestId ?? call.operation}`;
  return put(table, { ...recordKey(dealId, sk), ...call });
}

export function recordWebhook(
  table: StoreTable,
  dealId: string,
  webhook: WebhookEntry,
): Promise<void> {
  return put(table, {
    ...recordKey(dealId, `WEBHOOK#${webhook.at}#${webhook.eventId}`),
    ...webhook,
  });
}

/**
 * Everything about one deal in a single query. Access grants and lifecycle
 * task tokens share the partition but are never returned.
 */
export async function getDealRecord(
  table: StoreTable,
  dealId: string,
): Promise<DealRecord | undefined> {
  const items = await queryDealPartition(table, dealId);
  const meta = items.find((item) => item.sk === 'META');
  if (!meta) return undefined;
  const single = (sk: string) => items.find((item) => item.sk === sk);
  const many = (prefix: string) => items.filter((item) => String(item.sk).startsWith(prefix));
  const parseOptional = <T>(schema: z.ZodType<T>, item: Record<string, unknown> | undefined) =>
    item ? schema.parse(item) : null;

  return {
    deal: dealSchema.parse(meta),
    events: many('EVT#').map((item) => dealEventSchema.parse(item)),
    brief: parseOptional(briefSchema, single('BRIEF')),
    negotiation: parseOptional(negotiationRecordSchema, single('NEGOTIATION')),
    checkout: parseOptional(checkoutSchema, single('CHECKOUT')),
    evidence: parseOptional(deliveryEvidenceSchema, single('EVIDENCE')),
    paypalCalls: many('PAYPAL#').map((item) => paypalCallSchema.parse(item)),
    webhooks: many('WEBHOOK#').map((item) => webhookSchema.parse(item)),
  };
}

async function queryDealPartition(
  table: StoreTable,
  dealId: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await table.client.send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': dealKey(dealId).pk },
        ConsistentRead: true,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}
