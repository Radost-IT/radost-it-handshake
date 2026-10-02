import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './log';
import { receivePayPalWebhook, type WebhookDependencies } from './paypal-webhook';

const signatureHeaders = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
  'paypal-transmission-id': 'TRANSMISSION-1',
  'paypal-transmission-sig': 'c2lnbmF0dXJl',
  'paypal-transmission-time': '2026-10-02T10:00:00Z',
};

const event = {
  id: 'WH-1',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource_type: 'capture',
  resource: { id: 'CAPTURE-1', status: 'COMPLETED' },
  create_time: '2026-10-02T10:00:00Z',
};

const request = { headers: signatureHeaders, body: JSON.stringify(event) };

const silentLog: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function dependencies(overrides: Partial<WebhookDependencies> = {}): WebhookDependencies {
  return {
    webhookId: 'WEBHOOK-1',
    verifySignature: vi.fn(() => Promise.resolve(true)),
    recordFirstDelivery: vi.fn(() => Promise.resolve(true)),
    forgetDelivery: vi.fn(() => Promise.resolve()),
    publishEvent: vi.fn(() => Promise.resolve()),
    log: silentLog,
    ...overrides,
  };
}

describe('receivePayPalWebhook', () => {
  it('verifies, records and publishes a new event', async () => {
    const deps = dependencies();

    await expect(receivePayPalWebhook(deps, request)).resolves.toEqual({ statusCode: 200 });

    expect(deps.verifySignature).toHaveBeenCalledWith(
      'WEBHOOK-1',
      expect.objectContaining({ transmissionId: 'TRANSMISSION-1' }),
      request.body,
    );
    expect(deps.recordFirstDelivery).toHaveBeenCalledWith('WH-1');
    expect(deps.publishEvent).toHaveBeenCalledWith(event);
  });

  it('answers 200 to a repeated event without publishing it again', async () => {
    const deps = dependencies({ recordFirstDelivery: vi.fn(() => Promise.resolve(false)) });

    await expect(receivePayPalWebhook(deps, request)).resolves.toEqual({ statusCode: 200 });
    expect(deps.publishEvent).not.toHaveBeenCalled();
  });

  it('rejects an event PayPal did not sign, before recording it', async () => {
    const deps = dependencies({ verifySignature: vi.fn(() => Promise.resolve(false)) });

    await expect(receivePayPalWebhook(deps, request)).resolves.toEqual({ statusCode: 401 });
    expect(deps.recordFirstDelivery).not.toHaveBeenCalled();
  });

  it('rejects a request without signature headers or with an invalid body', async () => {
    const deps = dependencies();

    await expect(receivePayPalWebhook(deps, { headers: {}, body: request.body })).resolves.toEqual({
      statusCode: 400,
    });
    await expect(
      receivePayPalWebhook(deps, { headers: signatureHeaders, body: '{not json' }),
    ).resolves.toEqual({ statusCode: 400 });
    await expect(
      receivePayPalWebhook(deps, { headers: signatureHeaders, body: '{"id":"WH-1"}' }),
    ).resolves.toEqual({ statusCode: 400 });
    expect(deps.verifySignature).not.toHaveBeenCalled();
  });

  it('answers 503 until the webhook ID is configured', async () => {
    const deps = dependencies({ webhookId: undefined });

    await expect(receivePayPalWebhook(deps, request)).resolves.toEqual({ statusCode: 503 });
    expect(deps.verifySignature).not.toHaveBeenCalled();
  });

  it('forgets the event when publishing fails, so the retry is not a duplicate', async () => {
    const failure = new Error('EventBridge unavailable');
    const deps = dependencies({ publishEvent: vi.fn(() => Promise.reject(failure)) });

    await expect(receivePayPalWebhook(deps, request)).rejects.toBe(failure);
    expect(deps.forgetDelivery).toHaveBeenCalledWith('WH-1');
  });
});
