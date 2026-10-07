import { z } from 'zod';
import { API_URL } from '../site';
import { fetchWithSession } from '../account/session';

const moneySchema = z.object({ currency: z.string(), value: z.string() });

export type Money = z.infer<typeof moneySchema>;

export const finalDealStates = ['SETTLED', 'REFUSED', 'CANCELLED', 'ABANDONED'] as const;

const contractTermsSchema = z.object({
  item: z.object({ productId: z.string(), title: z.string() }),
  price: moneySchema,
  deliveryDeadline: z.string(),
  acceptanceCriteria: z.array(z.object({ id: z.string(), description: z.string() })),
});

export type ContractTerms = z.infer<typeof contractTermsSchema>;

const dealSchema = z.object({
  id: z.string(),
  state: z.string(),
  mandate: z.object({ maxPrice: moneySchema, humanApprovalThreshold: moneySchema }),
  contract: z
    .object({
      terms: contractTermsSchema,
      signatures: z.array(z.object({ party: z.string(), signedAt: z.string() })),
    })
    .nullable(),
  escrow: z
    .object({
      orderId: z.string(),
      authorizationId: z.string(),
      amount: moneySchema,
      authorizedAt: z.string(),
      expiresAt: z.string(),
    })
    .nullable(),
  capture: z.object({ captureId: z.string(), amount: moneySchema }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Deal = z.infer<typeof dealSchema>;

const dealEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CREATED'), seq: z.number(), at: z.string() }),
  z.object({
    type: z.literal('STATE_CHANGED'),
    seq: z.number(),
    at: z.string(),
    from: z.string(),
    to: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('AUTHORIZATION_RENEWED'),
    seq: z.number(),
    at: z.string(),
    authorizationId: z.string(),
    expiresAt: z.string(),
  }),
]);

export type DealEvent = z.infer<typeof dealEventSchema>;

const negotiationSchema = z.object({
  sellerName: z.string(),
  listing: z.object({ title: z.string(), description: z.string(), listPrice: moneySchema }),
  turns: z.array(
    z.object({
      party: z.enum(['buyer', 'seller']),
      move: z.object({
        action: z.enum(['OFFER', 'ACCEPT', 'WALK_AWAY']),
        price: moneySchema.optional(),
        message: z.string(),
      }),
      at: z.string(),
    }),
  ),
  outcome: z.string().nullable(),
});

export type Negotiation = z.infer<typeof negotiationSchema>;

const evidenceSchema = z.object({
  productId: z.string(),
  deliveredAt: z.string(),
  invoiceTotal: moneySchema,
  description: z.string(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

const paypalCallSchema = z.object({
  at: z.string(),
  operation: z.string(),
  requestId: z.string().nullable(),
  statusCode: z.number(),
  debugId: z.string().nullable(),
});

export type PayPalCall = z.infer<typeof paypalCallSchema>;

const webhookSchema = z.object({
  at: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  resourceId: z.string().nullable(),
});

export type Webhook = z.infer<typeof webhookSchema>;

const dealRecordSchema = z.object({
  deal: dealSchema,
  events: z.array(dealEventSchema),
  brief: z.object({ goal: z.string(), sellerId: z.string().nullable() }).nullable(),
  negotiation: negotiationSchema.nullable(),
  checkout: z.object({ orderId: z.string(), approveUrl: z.string() }).nullable(),
  evidence: evidenceSchema.nullable(),
  paypalCalls: z.array(paypalCallSchema),
  webhooks: z.array(webhookSchema),
});

export type DealRecord = z.infer<typeof dealRecordSchema>;

const errorBodySchema = z.object({ error: z.string() });

/** The API answered with an error. `message` is the API's own plain-language reason. */
export class DealApiError extends Error {
  override name = 'DealApiError';

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A deal access token or an API key, or null to act as the signed-in account. */
export type DealCredential = string | null;

/**
 * Calls the Deal API with `credential`. Sends a POST with `body` as JSON when
 * one is given, a GET otherwise.
 */
export async function callDealApi<T>(
  path: string,
  credential: DealCredential,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const init = {
    headers: {
      ...(credential === null ? {} : { authorization: `Bearer ${credential}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  };
  const url = `${API_URL}/v1${path}`;
  const response = await (credential === null
    ? fetchWithSession(url, init)
    : fetch(url, { ...init, cache: 'no-store' }));
  const responseBody: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorBodySchema.safeParse(responseBody);
    throw new DealApiError(
      response.status,
      error.success ? error.data.error : 'The Deal API is not answering. Try again soon',
    );
  }
  return schema.parse(responseBody);
}

const acceptedSchema = z.object({ status: z.literal('accepted') });

/** The developer console keeps the API key here for the tab; the deal page reads it too. */
export const API_KEY_STORAGE_KEY = 'handshake-api-key';

export async function fetchDeals(apiKey: DealCredential): Promise<Deal[]> {
  const { deals } = await callDealApi('/deals', apiKey, z.object({ deals: z.array(dealSchema) }));
  return deals;
}

export interface NewDeal {
  goal: string;
  mandate: { maxPrice: Money; humanApprovalThreshold: Money; blockedCategories: string[] };
  sellerId?: string;
}

const openedDealSchema = z.object({ deal: dealSchema, buyerUrl: z.url() });

export function openDeal(
  apiKey: DealCredential,
  newDeal: NewDeal,
): Promise<z.infer<typeof openedDealSchema>> {
  return callDealApi('/deals', apiKey, openedDealSchema, newDeal);
}

export function fetchDealRecord(dealId: string, credential: DealCredential): Promise<DealRecord> {
  return callDealApi(`/deals/${encodeURIComponent(dealId)}`, credential, dealRecordSchema);
}

export async function sendPurchaseApproval(
  dealId: string,
  credential: DealCredential,
  approved: boolean,
): Promise<void> {
  await callDealApi(
    `/deals/${encodeURIComponent(dealId)}/purchase-approval`,
    credential,
    acceptedSchema,
    { approved },
  );
}

/** Reports the delivery as the seller would. The verifier then checks it against the contract. */
export async function submitEvidence(
  dealId: string,
  credential: DealCredential,
  evidence: Evidence,
): Promise<void> {
  await callDealApi(
    `/deals/${encodeURIComponent(dealId)}/evidence`,
    credential,
    acceptedSchema,
    evidence,
  );
}

/** The buyer's decision on an escalated deal. Policy still checks it before money moves. */
export type HumanDecision =
  | {
      action: 'CAPTURE';
      amount: Money;
      evidence: { productId: string; deliveredAt: string };
      criteria: { criterionId: string; met: boolean; confidence: number; rationale: string }[];
      reason: string;
    }
  | { action: 'VOID'; reason: string };

export async function sendHumanDecision(
  dealId: string,
  credential: DealCredential,
  decision: HumanDecision,
): Promise<void> {
  await callDealApi(
    `/deals/${encodeURIComponent(dealId)}/human-decision`,
    credential,
    acceptedSchema,
    decision,
  );
}

export function messageOf(error: unknown): string {
  return error instanceof DealApiError ? error.message : 'Something went wrong. Try again';
}
