import type { Money } from '@handshake/core';
import { z } from 'zod';
import type { PayPalClient } from './client';
import { callPayPal, parseJson, parsePayPalResponse } from './errors';
import { paypalRequestId } from './request-id';

export interface PayoutRequest {
  /** One payout per attempt. It keys the PayPal-Request-Id, so a retry replays the first payout. */
  attemptId: string;
  amount: Money;
  recipientEmail: string;
  /** Shown to the recipient next to the payment. */
  note: string;
}

export const payoutBatchStatusSchema = z.enum([
  'DENIED',
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'CANCELED',
]);
export type PayoutBatchStatus = z.infer<typeof payoutBatchStatusSchema>;

export interface PayoutBatch {
  batchId: string;
  status: PayoutBatchStatus;
}

const createdBatchSchema = z
  .object({
    batch_header: z.object({
      payout_batch_id: z.string().min(1),
      batch_status: payoutBatchStatusSchema,
    }),
  })
  .transform(({ batch_header }) => ({
    batchId: batch_header.payout_batch_id,
    status: batch_header.batch_status,
  }));

/**
 * Sends one sandbox payout. PayPal processes batches asynchronously, so the
 * returned status is usually PENDING; the PAYMENT.PAYOUTS-ITEM webhooks
 * report the outcome. The SDK has no Payouts controller, so this calls the
 * REST endpoint through the SDK's authenticated request builder.
 */
export async function createPayout(
  client: PayPalClient,
  request: PayoutRequest,
): Promise<PayoutBatch> {
  const body = JSON.stringify({
    sender_batch_header: {
      sender_batch_id: request.attemptId,
      email_subject: 'You found a loophole in Handshake',
    },
    items: [
      {
        recipient_type: 'EMAIL',
        receiver: request.recipientEmail,
        amount: { value: request.amount.value, currency: request.amount.currency },
        note: request.note,
        sender_item_id: request.attemptId,
      },
    ],
  });

  const response = await callPayPal(client, 'payout', () => {
    const req = client.createRequest('POST', '/v1/payments/payouts');
    req.header('PayPal-Request-Id', paypalRequestId(request.attemptId, 'payout', 0));
    req.contentType('application/json');
    req.text(body);
    req.authenticate([{ oauth2: true }]);
    return req.callAsText();
  });
  return parsePayPalResponse('payout', createdBatchSchema, parseJson(response));
}
