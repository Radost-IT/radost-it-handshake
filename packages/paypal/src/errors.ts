import { ApiError, type ApiResponse } from '@paypal/paypal-server-sdk';
import { z } from 'zod';
import type { PayPalClient } from './client';

export type PayPalOperation =
  | 'create-order'
  | 'get-order'
  | 'authorize'
  | 'capture'
  | 'void'
  | 'reauthorize'
  | 'payout'
  | 'verify-webhook';

/** PayPal answered with a non-2xx status. `debugId` is what PayPal support asks for. */
export class PayPalApiError extends Error {
  override name = 'PayPalApiError';

  constructor(
    readonly operation: PayPalOperation,
    readonly statusCode: number,
    readonly debugId: string | undefined,
    readonly issue: string | undefined,
    options: ErrorOptions,
  ) {
    super(
      `PayPal ${operation} failed with HTTP ${statusCode}${issue === undefined ? '' : ` (${issue})`}`,
      options,
    );
  }
}

/** PayPal answered 2xx, but without the fields this operation depends on. */
export class PayPalResponseError extends Error {
  override name = 'PayPalResponseError';

  constructor(
    readonly operation: PayPalOperation,
    options: ErrorOptions,
  ) {
    super(`PayPal ${operation} returned an unexpected response`, options);
  }
}

const errorBodySchema = z.object({
  debug_id: z.string().optional(),
  details: z.array(z.object({ issue: z.string() })).optional(),
});

/** One PayPal call made for a deal, as the audit log shows it. */
export interface PayPalCallRecord {
  dealId: string;
  operation: PayPalOperation;
  requestId: string | undefined;
  statusCode: number;
  debugId: string | undefined;
}

/** Ties a call to a deal so the client's observer can record it. */
export interface DealCall {
  dealId: string;
  requestId?: string;
}

/**
 * Runs one SDK call and translates SDK errors into the typed errors above.
 * Calls made for a deal are reported to the client's observer, failed ones too.
 */
export async function callPayPal<T>(
  client: PayPalClient,
  operation: PayPalOperation,
  send: () => Promise<ApiResponse<T>>,
  dealCall?: DealCall,
): Promise<T> {
  let response: ApiResponse<T>;
  try {
    response = await send();
  } catch (error) {
    const translated = translateError(client, operation, error);
    if (dealCall && translated instanceof PayPalApiError) {
      await report(client, operation, dealCall, translated.statusCode, translated.debugId);
    }
    throw translated;
  }
  if (dealCall) {
    const debugId = headerValue(response.headers, 'paypal-debug-id');
    await report(client, operation, dealCall, response.statusCode, debugId);
  }
  return response.result;
}

async function report(
  client: PayPalClient,
  operation: PayPalOperation,
  { dealId, requestId }: DealCall,
  statusCode: number,
  debugId: string | undefined,
): Promise<void> {
  await client.onCall?.({ dealId, operation, requestId, statusCode, debugId });
}

export function parsePayPalResponse<T>(
  operation: PayPalOperation,
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new PayPalResponseError(operation, { cause: result.error });
  return result.data;
}

function translateError(client: PayPalClient, operation: PayPalOperation, error: unknown): unknown {
  // A failed token request surfaces as a generic "token is expired" error, so
  // report the token failure that caused it instead.
  const cause = error instanceof ApiError ? error : (client.consumeTokenFailure() ?? error);
  if (!(cause instanceof ApiError)) return cause;

  const body = errorBodySchema.safeParse(cause.result ?? parseJson(cause.body));
  const details = body.success ? body.data : {};
  return new PayPalApiError(
    operation,
    cause.statusCode,
    details.debug_id ?? headerValue(cause.headers, 'paypal-debug-id'),
    details.details?.[0]?.issue,
    { cause },
  );
}

export function parseJson(body: unknown): unknown {
  if (typeof body !== 'string') return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match?.[1];
}
