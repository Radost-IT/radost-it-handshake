import { money, type Deal } from '@handshake/core';
import { authorizingDeal, buildTerms, verifyingDeal } from '@handshake/core/testing';
import { lastSent, stubPayPalClient, type StubResponse } from '@handshake/paypal/testing';
import { describe, expect, it } from 'vitest';
import { AuthorizationNotHeldError, authorizeEscrow, renewEscrow } from './escrow';

const now = () => '2026-10-03T00:00:00Z';

function authorization(id: string, status: string) {
  return {
    id,
    status,
    amount: { currency_code: 'USD', value: '42.50' },
    create_time: '2026-10-03T00:00:00Z',
    expiration_time: '2026-11-01T00:00:00Z',
  };
}

function authorizedOrder(status: string): StubResponse {
  return {
    status: 201,
    body: {
      id: 'order-1',
      status: 'COMPLETED',
      purchase_units: [{ payments: { authorizations: [authorization('auth-1', status)] } }],
    },
  };
}

async function authorize(deal: Deal, responses: StubResponse[]) {
  const { client, sent } = stubPayPalClient(responses);
  const result = await authorizeEscrow({ paypal: client, now }, deal, 'order-1');
  return { result, sent };
}

function outcome(result: Awaited<ReturnType<typeof authorizeEscrow>>) {
  if (!result.approved) throw new Error('Expected an approved authorization');
  return { deal: result.deal, events: result.events.map((event) => event.type) };
}

describe('authorizeEscrow', () => {
  it('holds the money and waits for delivery', async () => {
    const deal = authorizingDeal();
    const { result, sent } = await authorize(deal, [authorizedOrder('CREATED')]);

    const { deal: next, events } = outcome(result);
    expect(next.state).toBe('AWAITING_DELIVERY');
    expect(next.escrow).toEqual({
      orderId: 'order-1',
      authorizationId: 'auth-1',
      amount: money('42.50', 'USD'),
      authorizedAt: '2026-10-03T00:00:00Z',
      expiresAt: '2026-11-01T00:00:00Z',
    });
    expect(events).toEqual(['STATE_CHANGED', 'STATE_CHANGED']);
    expect(lastSent(sent).headers['PayPal-Request-Id']).toBe(`deal-1:authorize:${deal.eventCount}`);
  });

  it('calls PayPal only after policy approves', async () => {
    const deal = authorizingDeal(buildTerms({ price: money('100.01', 'USD') }));
    const { result, sent } = await authorize(deal, []);

    expect(result).toMatchObject({
      approved: false,
      violations: [{ code: 'PRICE_ABOVE_MANDATE' }],
    });
    expect(sent).toHaveLength(0);
  });

  it('cancels the deal when PayPal denies the authorization', async () => {
    const { result } = await authorize(authorizingDeal(), [authorizedOrder('DENIED')]);
    expect(outcome(result).deal.state).toBe('CANCELLED');
  });

  it('cancels the deal when PayPal refuses the payment method', async () => {
    const { result } = await authorize(authorizingDeal(), [
      {
        status: 422,
        body: {
          name: 'UNPROCESSABLE_ENTITY',
          message: 'The instrument presented was declined.',
          debug_id: 'debug-1',
          details: [{ issue: 'INSTRUMENT_DECLINED' }],
        },
      },
    ]);
    expect(outcome(result).deal.state).toBe('CANCELLED');
  });

  it('fails without holding when the authorization is pending', async () => {
    await expect(authorize(authorizingDeal(), [authorizedOrder('PENDING')])).rejects.toBeInstanceOf(
      AuthorizationNotHeldError,
    );
  });

  it('lets server errors propagate so the call is retried', async () => {
    await expect(
      authorize(authorizingDeal(), [{ status: 503, body: 'Service Unavailable' }]),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe('renewEscrow', () => {
  it('replaces the authorization with the renewed one', async () => {
    const deal = verifyingDeal();
    const { client, sent } = stubPayPalClient([
      { status: 201, body: authorization('auth-2', 'CREATED') },
    ]);

    const { deal: next, event } = await renewEscrow({ paypal: client, now }, deal);

    expect(next.escrow).toMatchObject({
      orderId: 'order-1',
      authorizationId: 'auth-2',
      authorizedAt: '2026-10-03T00:00:00Z',
      expiresAt: '2026-11-01T00:00:00Z',
    });
    expect(event.type).toBe('AUTHORIZATION_RENEWED');
    expect(lastSent(sent).url).toContain('/v2/payments/authorizations/auth-1/reauthorize');
    expect(lastSent(sent).headers['PayPal-Request-Id']).toBe(
      `deal-1:reauthorize:${deal.eventCount}`,
    );
  });

  it('calls PayPal only while funds are held', async () => {
    const { client, sent } = stubPayPalClient([]);
    await expect(renewEscrow({ paypal: client, now }, authorizingDeal())).rejects.toThrow(
      'holds no funds',
    );
    expect(sent).toHaveLength(0);
  });

  it('fails when the renewed authorization does not hold the money', async () => {
    const { client } = stubPayPalClient([{ status: 201, body: authorization('auth-2', 'DENIED') }]);
    await expect(renewEscrow({ paypal: client, now }, verifyingDeal())).rejects.toBeInstanceOf(
      AuthorizationNotHeldError,
    );
  });
});
