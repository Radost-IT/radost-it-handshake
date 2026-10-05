import { z } from 'zod';

const errorBodySchema = z.object({ error: z.string() });

const openedDealSchema = z.object({
  deal: z.object({ id: z.string(), state: z.string() }),
  buyerUrl: z.url(),
});

export type OpenedDeal = z.infer<typeof openedDealSchema>;

const acceptedSchema = z.object({ status: z.literal('accepted') });

/** The Deal API answered with an error. `message` is the API's own reason. */
export class DealApiError extends Error {
  override name = 'DealApiError';

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface DealApiClientOptions {
  apiUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface Money {
  currency: string;
  value: string;
}

export interface OpenDealInput {
  goal: string;
  mandate: { maxPrice: Money; humanApprovalThreshold: Money; blockedCategories: string[] };
  sellerId?: string;
}

export interface DeliveryEvidenceInput {
  productId: string;
  deliveredAt: string;
  invoiceTotal: Money;
  description: string;
}

export type DealApiClient = ReturnType<typeof createDealApiClient>;

/** A small client for the public Deal API, authenticated with a developer API key. */
export function createDealApiClient(options: DealApiClientOptions) {
  const send = options.fetch ?? fetch;

  async function call<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const response = await send(`${options.apiUrl}/v1${path}`, {
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    const responseBody: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = errorBodySchema.safeParse(responseBody);
      throw new DealApiError(
        response.status,
        error.success ? error.data.error : `The Deal API answered HTTP ${response.status}`,
      );
    }
    return schema.parse(responseBody);
  }

  const dealPath = (dealId: string) => `/deals/${encodeURIComponent(dealId)}`;

  return {
    openDeal: (input: OpenDealInput) => call('/deals', openedDealSchema, input),
    listDeals: () => call('/deals', z.json()),
    getDeal: (dealId: string) => call(dealPath(dealId), z.json()),
    submitEvidence: async (dealId: string, evidence: DeliveryEvidenceInput) => {
      await call(`${dealPath(dealId)}/evidence`, acceptedSchema, evidence);
    },
  };
}
