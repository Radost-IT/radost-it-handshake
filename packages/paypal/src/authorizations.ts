import type { Money } from '@handshake/core';
import { z } from 'zod';
import { RETURN_REPRESENTATION, type PayPalClient } from './client';
import { callPayPal, parsePayPalResponse } from './errors';
import { paypalRequestId } from './request-id';
import {
  authorizationSchema,
  authorizationStatusSchema,
  captureSchema,
  toPayPalMoney,
  type PayPalAuthorization,
  type PayPalAuthorizationStatus,
  type PayPalCapture,
} from './schemas';

export interface AuthorizationRequest {
  dealId: string;
  authorizationId: string;
  attempt: number;
}

/**
 * Captures the held funds. The capture is final, so any amount left on the
 * authorization is released to the buyer.
 */
export async function captureAuthorization(
  client: PayPalClient,
  request: AuthorizationRequest & { amount: Money },
): Promise<PayPalCapture> {
  const requestId = paypalRequestId(request.dealId, 'capture', request.attempt);
  const capture = await callPayPal(
    client,
    'capture',
    () =>
      client.payments.captureAuthorizedPayment({
        authorizationId: request.authorizationId,
        paypalRequestId: requestId,
        prefer: RETURN_REPRESENTATION,
        body: { amount: toPayPalMoney(request.amount), finalCapture: true },
      }),
    { dealId: request.dealId, requestId },
  );
  return parsePayPalResponse('capture', captureSchema, capture);
}

const voidedAuthorizationSchema = z.object({ id: z.string(), status: authorizationStatusSchema });

/** Releases the held funds back to the buyer. */
export async function voidAuthorization(
  client: PayPalClient,
  request: AuthorizationRequest,
): Promise<{ id: string; status: PayPalAuthorizationStatus }> {
  const requestId = paypalRequestId(request.dealId, 'void', request.attempt);
  const authorization = await callPayPal(
    client,
    'void',
    () =>
      client.payments.voidPayment({
        authorizationId: request.authorizationId,
        paypalRequestId: requestId,
        prefer: RETURN_REPRESENTATION,
      }),
    { dealId: request.dealId, requestId },
  );
  return parsePayPalResponse('void', voidedAuthorizationSchema, authorization);
}

/**
 * Renews the hold for the same amount. PayPal returns a new authorization ID;
 * later captures and voids must use it.
 */
export async function reauthorizeAuthorization(
  client: PayPalClient,
  request: AuthorizationRequest,
): Promise<PayPalAuthorization> {
  const requestId = paypalRequestId(request.dealId, 'reauthorize', request.attempt);
  const authorization = await callPayPal(
    client,
    'reauthorize',
    () =>
      client.payments.reauthorizePayment({
        authorizationId: request.authorizationId,
        paypalRequestId: requestId,
        prefer: RETURN_REPRESENTATION,
      }),
    { dealId: request.dealId, requestId },
  );
  return parsePayPalResponse('reauthorize', authorizationSchema, authorization);
}
