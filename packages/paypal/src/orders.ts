import type { Money } from '@handshake/core';
import { CheckoutPaymentIntent, PaypalExperienceUserAction } from '@paypal/paypal-server-sdk';
import { z } from 'zod';
import { RETURN_REPRESENTATION, type PayPalClient } from './client';
import { callPayPal, parsePayPalResponse, PayPalResponseError } from './errors';
import { paypalRequestId } from './request-id';
import {
  authorizationSchema,
  linkSchema,
  orderStatusSchema,
  toPayPalMoney,
  type PayPalAuthorization,
  type PayPalOrderStatus,
} from './schemas';

export interface AuthorizeOrderRequest {
  dealId: string;
  attempt: number;
  amount: Money;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface PayPalOrder {
  id: string;
  status: PayPalOrderStatus;
  /** Where the buyer approves the payment. Absent once the order no longer needs approval. */
  approveUrl: string | undefined;
  /** The authorization on this order, once the order has been authorized. */
  authorization: PayPalAuthorization | undefined;
}

const orderSchema = z
  .object({
    id: z.string(),
    status: orderStatusSchema,
    links: z.array(linkSchema).optional(),
    purchaseUnits: z
      .array(
        z.object({
          payments: z
            .object({ authorizations: z.array(authorizationSchema).optional() })
            .optional(),
        }),
      )
      .optional(),
  })
  .transform(({ id, status, links, purchaseUnits }) => ({
    id,
    status,
    // With payment_source.paypal set, PayPal names the approval link "payer-action".
    approveUrl: links?.find((link) => link.rel === 'payer-action')?.href,
    authorization: purchaseUnits?.[0]?.payments?.authorizations?.[0],
  }));

/**
 * Creates an order with intent AUTHORIZE: once the buyer approves it and we
 * authorize it, the funds are held but not captured. The deal ID is stored as
 * the purchase unit's custom_id so webhook events can be traced back to it.
 */
export async function createAuthorizeOrder(
  client: PayPalClient,
  request: AuthorizeOrderRequest,
): Promise<PayPalOrder> {
  const order = await callPayPal(client, 'create-order', () =>
    client.orders.createOrder({
      paypalRequestId: paypalRequestId(request.dealId, 'create-order', request.attempt),
      prefer: RETURN_REPRESENTATION,
      body: {
        intent: CheckoutPaymentIntent.Authorize,
        purchaseUnits: [
          {
            referenceId: request.dealId,
            customId: request.dealId,
            description: request.description,
            amount: toPayPalMoney(request.amount),
          },
        ],
        paymentSource: {
          paypal: {
            experienceContext: {
              brandName: 'Handshake',
              userAction: PaypalExperienceUserAction.PayNow,
              returnUrl: request.returnUrl,
              cancelUrl: request.cancelUrl,
            },
          },
        },
      },
    }),
  );
  return parsePayPalResponse('create-order', orderSchema, order);
}

export async function getOrder(client: PayPalClient, orderId: string): Promise<PayPalOrder> {
  const order = await callPayPal(client, 'get-order', () =>
    client.orders.getOrder({ id: orderId }),
  );
  return parsePayPalResponse('get-order', orderSchema, order);
}

export interface AuthorizedOrder {
  orderId: string;
  authorization: PayPalAuthorization;
}

/** Authorizes an order the buyer has approved. This places the escrow hold. */
export async function authorizeOrder(
  client: PayPalClient,
  request: { dealId: string; orderId: string; attempt: number },
): Promise<AuthorizedOrder> {
  const response = await callPayPal(client, 'authorize', () =>
    client.orders.authorizeOrder({
      id: request.orderId,
      paypalRequestId: paypalRequestId(request.dealId, 'authorize', request.attempt),
      prefer: RETURN_REPRESENTATION,
    }),
  );
  const order = parsePayPalResponse('authorize', orderSchema, response);
  if (order.authorization === undefined) {
    throw new PayPalResponseError('authorize', { cause: new Error('Order has no authorization') });
  }
  return { orderId: order.id, authorization: order.authorization };
}
