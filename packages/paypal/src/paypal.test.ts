import { money } from '@handshake/core';
import { describe, expect, it, vi } from 'vitest';
import {
  captureAuthorization,
  reauthorizeAuthorization,
  voidAuthorization,
} from './authorizations';
import { PayPalApiError, PayPalResponseError, type PayPalCallRecord } from './errors';
import { authorizeOrder, createAuthorizeOrder, getOrder } from './orders';
import { paypalRequestId } from './request-id';
import { lastSent, stubPayPalClient } from './test-transport';

const authorizationBody = {
  id: 'AUTH-1',
  status: 'CREATED',
  amount: { currency_code: 'USD', value: '42.50' },
  create_time: '2026-10-02T10:00:00Z',
  expiration_time: '2026-10-31T10:00:00Z',
};

const orderRequest = {
  dealId: 'deal-1',
  attempt: 0,
  amount: money('42.5', 'USD'),
  description: 'Steel water bottle',
  returnUrl: 'https://handshake.example/return',
  cancelUrl: 'https://handshake.example/cancel',
};

describe('paypalRequestId', () => {
  it('combines deal, operation and attempt', () => {
    expect(paypalRequestId('deal-1', 'capture', 0)).toBe('deal-1:capture:0');
  });

  it('rejects an empty deal ID or a bad attempt', () => {
    expect(() => paypalRequestId('', 'capture', 0)).toThrow(RangeError);
    expect(() => paypalRequestId('deal-1', 'capture', -1)).toThrow(RangeError);
    expect(() => paypalRequestId('deal-1', 'capture', 1.5)).toThrow(RangeError);
  });
});

describe('createAuthorizeOrder', () => {
  it('sends an AUTHORIZE order with an idempotency key and returns the approval link', async () => {
    const { client, sent } = stubPayPalClient([
      {
        status: 200,
        body: {
          id: 'ORDER-1',
          status: 'PAYER_ACTION_REQUIRED',
          links: [
            { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1' },
            {
              rel: 'payer-action',
              href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1',
            },
          ],
        },
      },
    ]);

    const order = await createAuthorizeOrder(client, orderRequest);

    expect(order).toEqual({
      id: 'ORDER-1',
      status: 'PAYER_ACTION_REQUIRED',
      approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1',
      authorization: undefined,
    });
    const request = lastSent(sent);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api-m.sandbox.paypal.com/v2/checkout/orders');
    expect(request.headers['PayPal-Request-Id']).toBe('deal-1:create-order:0');
    expect(request.body).toMatchObject({
      intent: 'AUTHORIZE',
      purchase_units: [{ custom_id: 'deal-1', amount: { currency_code: 'USD', value: '42.50' } }],
      payment_source: {
        paypal: { experience_context: { return_url: orderRequest.returnUrl } },
      },
    });
  });
});

describe('getOrder', () => {
  it('returns the authorization once the order is authorized', async () => {
    const { client } = stubPayPalClient([
      {
        status: 200,
        body: {
          id: 'ORDER-1',
          status: 'COMPLETED',
          purchase_units: [{ payments: { authorizations: [authorizationBody] } }],
        },
      },
    ]);

    const order = await getOrder(client, 'ORDER-1');

    expect(order.approveUrl).toBeUndefined();
    expect(order.authorization).toEqual({
      id: 'AUTH-1',
      status: 'CREATED',
      amount: money('42.50', 'USD'),
      createdAt: '2026-10-02T10:00:00Z',
      expiresAt: '2026-10-31T10:00:00Z',
    });
  });
});

describe('authorizeOrder', () => {
  it('returns the escrow authorization', async () => {
    const { client, sent } = stubPayPalClient([
      {
        status: 201,
        body: {
          id: 'ORDER-1',
          status: 'COMPLETED',
          purchase_units: [{ payments: { authorizations: [authorizationBody] } }],
        },
      },
    ]);

    const authorized = await authorizeOrder(client, {
      dealId: 'deal-1',
      orderId: 'ORDER-1',
      attempt: 0,
    });

    expect(authorized.orderId).toBe('ORDER-1');
    expect(authorized.authorization.id).toBe('AUTH-1');
    expect(lastSent(sent).url).toBe(
      'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1/authorize',
    );
    expect(lastSent(sent).headers['PayPal-Request-Id']).toBe('deal-1:authorize:0');
  });

  it('fails when PayPal returns no authorization', async () => {
    const { client } = stubPayPalClient([
      { status: 201, body: { id: 'ORDER-1', status: 'COMPLETED', purchase_units: [] } },
    ]);

    await expect(
      authorizeOrder(client, { dealId: 'deal-1', orderId: 'ORDER-1', attempt: 0 }),
    ).rejects.toBeInstanceOf(PayPalResponseError);
  });
});

describe('captureAuthorization', () => {
  it('captures the agreed amount as a final capture', async () => {
    const { client, sent } = stubPayPalClient([
      {
        status: 201,
        body: {
          id: 'CAPTURE-1',
          status: 'COMPLETED',
          amount: { currency_code: 'USD', value: '42.50' },
        },
      },
    ]);

    const capture = await captureAuthorization(client, {
      dealId: 'deal-1',
      authorizationId: 'AUTH-1',
      attempt: 0,
      amount: money('42.50', 'USD'),
    });

    expect(capture).toEqual({
      id: 'CAPTURE-1',
      status: 'COMPLETED',
      amount: money('42.50', 'USD'),
    });
    const request = lastSent(sent);
    expect(request.url).toBe(
      'https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH-1/capture',
    );
    expect(request.headers['PayPal-Request-Id']).toBe('deal-1:capture:0');
    expect(request.body).toEqual({
      amount: { currency_code: 'USD', value: '42.50' },
      final_capture: true,
    });
  });

  it('rejects a capture response with an amount PayPal could not have sent', async () => {
    const { client } = stubPayPalClient([
      {
        status: 201,
        body: {
          id: 'CAPTURE-1',
          status: 'COMPLETED',
          amount: { currency_code: 'USD', value: '4.250' },
        },
      },
    ]);

    await expect(
      captureAuthorization(client, {
        dealId: 'deal-1',
        authorizationId: 'AUTH-1',
        attempt: 0,
        amount: money('4.25', 'USD'),
      }),
    ).rejects.toBeInstanceOf(PayPalResponseError);
  });
});

describe('voidAuthorization', () => {
  it('returns the voided authorization', async () => {
    const { client, sent } = stubPayPalClient([
      { status: 200, body: { ...authorizationBody, status: 'VOIDED' } },
    ]);

    const voided = await voidAuthorization(client, {
      dealId: 'deal-1',
      authorizationId: 'AUTH-1',
      attempt: 0,
    });

    expect(voided).toEqual({ id: 'AUTH-1', status: 'VOIDED' });
    expect(lastSent(sent).headers['PayPal-Request-Id']).toBe('deal-1:void:0');
  });
});

describe('deal call audit', () => {
  const voidRequest = { dealId: 'deal-1', authorizationId: 'AUTH-1', attempt: 0 };

  it('reports a successful call with its request ID and debug_id', async () => {
    const calls: PayPalCallRecord[] = [];
    const { client } = stubPayPalClient(
      [
        {
          status: 200,
          body: { ...authorizationBody, status: 'VOIDED' },
          headers: { 'paypal-debug-id': 'debug-ok' },
        },
      ],
      [],
      (call) => {
        calls.push(call);
        return Promise.resolve();
      },
    );

    await voidAuthorization(client, voidRequest);

    expect(calls).toEqual([
      {
        dealId: 'deal-1',
        operation: 'void',
        requestId: 'deal-1:void:0',
        statusCode: 200,
        debugId: 'debug-ok',
      },
    ]);
  });

  it('reports a failed call before the error reaches the caller', async () => {
    const calls: PayPalCallRecord[] = [];
    const { client } = stubPayPalClient(
      [{ status: 422, body: { debug_id: 'debug-bad', details: [{ issue: 'X' }] } }],
      [],
      (call) => {
        calls.push(call);
        return Promise.resolve();
      },
    );

    await expect(voidAuthorization(client, voidRequest)).rejects.toBeInstanceOf(PayPalApiError);
    expect(calls).toMatchObject([{ operation: 'void', statusCode: 422, debugId: 'debug-bad' }]);
  });

  it('does not report calls made without a deal', async () => {
    const onCall = vi.fn(() => Promise.resolve());
    const { client } = stubPayPalClient(
      [{ status: 200, body: { id: 'ORDER-1', status: 'APPROVED' } }],
      [],
      onCall,
    );

    await getOrder(client, 'ORDER-1');

    expect(onCall).not.toHaveBeenCalled();
  });
});

describe('reauthorizeAuthorization', () => {
  it('returns the new authorization', async () => {
    const { client, sent } = stubPayPalClient([
      { status: 201, body: { ...authorizationBody, id: 'AUTH-2' } },
    ]);

    const renewed = await reauthorizeAuthorization(client, {
      dealId: 'deal-1',
      authorizationId: 'AUTH-1',
      attempt: 1,
    });

    expect(renewed.id).toBe('AUTH-2');
    expect(lastSent(sent).url).toBe(
      'https://api-m.sandbox.paypal.com/v2/payments/authorizations/AUTH-1/reauthorize',
    );
    expect(lastSent(sent).headers['PayPal-Request-Id']).toBe('deal-1:reauthorize:1');
  });
});

describe('errors', () => {
  it('carries the status, issue and debug_id of a PayPal error', async () => {
    const { client } = stubPayPalClient([
      {
        status: 422,
        body: {
          name: 'UNPROCESSABLE_ENTITY',
          message: 'The requested action could not be performed.',
          debug_id: 'debug-123',
          details: [{ issue: 'AUTHORIZATION_ALREADY_CAPTURED' }],
        },
      },
    ]);

    const failure = captureAuthorization(client, {
      dealId: 'deal-1',
      authorizationId: 'AUTH-1',
      attempt: 0,
      amount: money('42.50', 'USD'),
    });

    await expect(failure).rejects.toBeInstanceOf(PayPalApiError);
    await expect(failure).rejects.toMatchObject({
      operation: 'capture',
      statusCode: 422,
      debugId: 'debug-123',
      issue: 'AUTHORIZATION_ALREADY_CAPTURED',
    });
  });

  it('falls back to the debug ID header when the body has none', async () => {
    const { client } = stubPayPalClient([
      { status: 503, body: 'Service Unavailable', headers: { 'paypal-debug-id': 'debug-456' } },
    ]);

    await expect(getOrder(client, 'ORDER-1')).rejects.toMatchObject({
      statusCode: 503,
      debugId: 'debug-456',
      issue: undefined,
    });
  });

  it('reports a failed token request and recovers on the next call', async () => {
    const { client } = stubPayPalClient(
      [{ status: 200, body: { id: 'ORDER-1', status: 'APPROVED' } }],
      [{ status: 401, body: { error: 'invalid_client', debug_id: 'debug-789' } }],
    );

    await expect(getOrder(client, 'ORDER-1')).rejects.toMatchObject({
      name: 'PayPalApiError',
      statusCode: 401,
    });
    await expect(getOrder(client, 'ORDER-1')).resolves.toMatchObject({ status: 'APPROVED' });
  });
});
