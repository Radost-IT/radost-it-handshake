import { ApiError, type ApiResponse } from '@paypal/paypal-server-sdk';
import { z } from 'zod';
import type { PayPalClient } from './client';

export type PayPalOperation =
  'create-order' | 'get-order' | 'authorize' | 'capture' | 'void' | 'reauthorize';

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

/** Runs one SDK call and translates SDK errors into the typed errors above. */
export async function callPayPal<T>(
  client: PayPalClient,
  operation: PayPalOperation,
  send: () => Promise<ApiResponse<T>>,
): Promise<T> {
  try {
    const response = await send();
    return response.result;
  } catch (error) {
    throw translateError(client, operation, error);
  }
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

function parseJson(body: unknown): unknown {
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
