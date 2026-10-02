import { randomUUID } from 'node:crypto';
import { loadConfig } from '@handshake/config';
import { money } from '@handshake/core';
import { describe, expect, it } from 'vitest';
import { PayPalApiError } from './errors';
import { authorizeOrder, createAuthorizeOrder, getOrder } from './orders';
import { createPayPalClient } from './client';

const config = await loadConfig();
const client = createPayPalClient(config.paypal);

describe('PayPal sandbox orders', () => {
  it('creates an AUTHORIZE order that waits for buyer approval', async () => {
    const dealId = `it-${randomUUID()}`;
    const created = await createAuthorizeOrder(client, {
      dealId,
      attempt: 0,
      amount: money('12.34', 'USD'),
      description: 'Integration test order',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
    });

    expect(created.status).toBe('PAYER_ACTION_REQUIRED');
    expect(created.approveUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);

    const fetched = await getOrder(client, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.authorization).toBeUndefined();
  });

  it('replays the first result for a repeated request ID', async () => {
    const request = {
      dealId: `it-${randomUUID()}`,
      attempt: 0,
      amount: money('5.00', 'USD'),
      description: 'Idempotency check',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
    };
    const first = await createAuthorizeOrder(client, request);
    const second = await createAuthorizeOrder(client, request);

    expect(second.id).toBe(first.id);
  });

  it('refuses to authorize an order the buyer has not approved', async () => {
    const dealId = `it-${randomUUID()}`;
    const created = await createAuthorizeOrder(client, {
      dealId,
      attempt: 0,
      amount: money('3.00', 'USD'),
      description: 'Unapproved order',
      returnUrl: 'https://example.com/return',
      cancelUrl: 'https://example.com/cancel',
    });

    const failure = authorizeOrder(client, { dealId, orderId: created.id, attempt: 0 });
    await expect(failure).rejects.toBeInstanceOf(PayPalApiError);
    await expect(failure).rejects.toMatchObject({
      statusCode: 422,
      issue: 'ORDER_NOT_APPROVED',
      debugId: expect.any(String) as unknown,
    });
  });
});
