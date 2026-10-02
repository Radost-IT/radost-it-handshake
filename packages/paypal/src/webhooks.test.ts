import { describe, expect, it } from 'vitest';
import { PayPalApiError } from './errors';
import { lastSent, stubPayPalClient } from './test-transport';
import { readWebhookTransmission, verifyWebhookSignature } from './webhooks';

const headers = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
  'paypal-transmission-id': 'TRANSMISSION-1',
  'paypal-transmission-sig': 'c2lnbmF0dXJl',
  'paypal-transmission-time': '2026-10-02T10:00:00Z',
};

const transmission = {
  authAlgo: 'SHA256withRSA',
  certUrl: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
  transmissionId: 'TRANSMISSION-1',
  transmissionSig: 'c2lnbmF0dXJl',
  transmissionTime: '2026-10-02T10:00:00Z',
};

const event = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} };
// Spacing differs from what JSON.stringify would produce.
const rawEvent = '{ "id": "WH-1",  "event_type": "PAYMENT.CAPTURE.COMPLETED", "resource": {} }';

describe('readWebhookTransmission', () => {
  it('reads the signature headers in any case', () => {
    const mixedCase = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toUpperCase(), value]),
    );
    expect(readWebhookTransmission(mixedCase)).toEqual(transmission);
  });

  it('returns undefined when a signature header is missing', () => {
    expect(
      readWebhookTransmission({ ...headers, 'paypal-transmission-sig': undefined }),
    ).toBeUndefined();
  });
});

describe('verifyWebhookSignature', () => {
  it('sends the event exactly as received and accepts SUCCESS', async () => {
    const { client, sent } = stubPayPalClient([
      { status: 200, body: { verification_status: 'SUCCESS' } },
    ]);

    const verified = await verifyWebhookSignature(client, {
      webhookId: 'WEBHOOK-1',
      transmission,
      rawEvent,
    });

    expect(verified).toBe(true);
    const request = lastSent(sent);
    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature',
    );
    expect(request.headers['Content-Type']).toBe('application/json');
    expect(request.body).toEqual({
      auth_algo: 'SHA256withRSA',
      cert_url: transmission.certUrl,
      transmission_id: 'TRANSMISSION-1',
      transmission_sig: 'c2lnbmF0dXJl',
      transmission_time: '2026-10-02T10:00:00Z',
      webhook_id: 'WEBHOOK-1',
      webhook_event: event,
    });
    expect(request.rawBody).toContain(`"webhook_event":${rawEvent}}`);
  });

  it('rejects a FAILURE verdict', async () => {
    const { client } = stubPayPalClient([
      { status: 200, body: { verification_status: 'FAILURE' } },
    ]);

    await expect(
      verifyWebhookSignature(client, { webhookId: 'WEBHOOK-1', transmission, rawEvent }),
    ).resolves.toBe(false);
  });

  it('reports a PayPal error with its debug ID', async () => {
    const { client } = stubPayPalClient([
      { status: 400, body: { name: 'VALIDATION_ERROR', debug_id: 'debug-1' } },
    ]);

    const failure = verifyWebhookSignature(client, {
      webhookId: 'WEBHOOK-1',
      transmission,
      rawEvent,
    });

    await expect(failure).rejects.toBeInstanceOf(PayPalApiError);
    await expect(failure).rejects.toMatchObject({
      operation: 'verify-webhook',
      debugId: 'debug-1',
    });
  });
});
