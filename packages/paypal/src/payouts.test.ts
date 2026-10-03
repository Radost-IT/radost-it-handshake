import { money } from '@handshake/core';
import { describe, expect, it } from 'vitest';
import { PayPalApiError } from './errors';
import { createPayout } from './payouts';
import { lastSent, stubPayPalClient } from './test-transport';

const payoutRequest = {
  attemptId: 'attempt-1',
  amount: money('2.5', 'USD'),
  recipientEmail: 'arena@example.com',
  note: 'Loophole found: fake urgency',
};

describe('createPayout', () => {
  it('sends one email payout named after the attempt, with an idempotency key', async () => {
    const { client, sent } = stubPayPalClient([
      {
        status: 201,
        body: {
          batch_header: {
            payout_batch_id: 'BATCH-1',
            batch_status: 'PENDING',
            sender_batch_header: { sender_batch_id: 'attempt-1' },
          },
        },
      },
    ]);

    const batch = await createPayout(client, payoutRequest);

    expect(batch).toEqual({ batchId: 'BATCH-1', status: 'PENDING' });
    const request = lastSent(sent);
    expect(request.method).toBe('POST');
    expect(request.url).toMatch(/\/v1\/payments\/payouts$/);
    expect(request.headers['PayPal-Request-Id']).toBe('attempt-1:payout:0');
    expect(request.body).toEqual({
      sender_batch_header: {
        sender_batch_id: 'attempt-1',
        email_subject: 'You found a loophole in Handshake',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          receiver: 'arena@example.com',
          amount: { value: '2.50', currency: 'USD' },
          note: 'Loophole found: fake urgency',
          sender_item_id: 'attempt-1',
        },
      ],
    });
  });

  it('reports a refused payout with its debug ID', async () => {
    const { client } = stubPayPalClient([
      {
        status: 422,
        body: { debug_id: 'debug-9', details: [{ issue: 'INSUFFICIENT_FUNDS' }] },
      },
    ]);

    const failure = createPayout(client, payoutRequest);

    await expect(failure).rejects.toBeInstanceOf(PayPalApiError);
    await expect(failure).rejects.toMatchObject({
      operation: 'payout',
      debugId: 'debug-9',
      issue: 'INSUFFICIENT_FUNDS',
    });
  });
});
