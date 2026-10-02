import { randomUUID } from 'node:crypto';
import { loadConfig } from '@handshake/config';
import { money } from '@handshake/core';
import {
  authorizeOrder,
  captureAuthorization,
  createPayPalClient,
  PayPalApiError,
  reauthorizeAuthorization,
  voidAuthorization,
  type PayPalAuthorization,
} from '@handshake/paypal';
import { ApiError, CheckoutPaymentIntent } from '@paypal/paypal-server-sdk';

const config = await loadConfig();
const client = createPayPalClient(config.paypal);
const amount = money('10.00', 'USD');
const CARDS_DISABLED = 'PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING';

// A PayPal sandbox test card authorizes without a browser approval step.
async function authorizeWithTestCard(dealId: string): Promise<PayPalAuthorization> {
  const created = await createCardOrder(dealId);
  const orderId = created.id;
  if (orderId === undefined) throw new Error('Order has no ID');
  console.log(`order ${orderId}: ${created.status ?? 'no status'}`);
  const authorized = await authorizeOrder(client, { dealId, orderId, attempt: 0 });
  return authorized.authorization;
}

async function createCardOrder(dealId: string): Promise<{ id?: string; status?: string }> {
  try {
    const response = await client.orders.createOrder({
      paypalRequestId: `${dealId}:create-order:0`,
      body: {
        intent: CheckoutPaymentIntent.Authorize,
        purchaseUnits: [
          { customId: dealId, amount: { currencyCode: amount.currency, value: amount.value } },
        ],
        paymentSource: {
          card: {
            name: 'Probe Buyer',
            number: '4111111111111111',
            expiry: '2030-12',
            securityCode: '123',
          },
        },
      },
    });
    return response.result;
  } catch (error) {
    if (
      error instanceof ApiError &&
      typeof error.body === 'string' &&
      error.body.includes(CARDS_DISABLED)
    ) {
      console.error(
        `${CARDS_DISABLED}: enable card payments for the sandbox app, see INSTRUCTIONS.md [I-3].`,
      );
      process.exit(1);
    }
    throw error;
  }
}

async function outcome(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    console.log(`${label}: OK`, JSON.stringify(await run()));
  } catch (error) {
    if (!(error instanceof PayPalApiError)) throw error;
    console.log(
      `${label}: HTTP ${error.statusCode} ${error.issue ?? 'no issue'}, debug_id ${error.debugId ?? 'none'}`,
    );
  }
}

function hoursBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / 3_600_000;
}

const captureDeal = `probe-${randomUUID()}`;
const held = await authorizeWithTestCard(captureDeal);
console.log(
  `authorization ${held.status}, valid for ${hoursBetween(held.createdAt, held.expiresAt)} hours`,
);
const authorization = { dealId: captureDeal, authorizationId: held.id };

await outcome('reauthorize inside honor period', () =>
  reauthorizeAuthorization(client, { ...authorization, attempt: 1 }),
);
await outcome('capture', () =>
  captureAuthorization(client, { ...authorization, attempt: 0, amount }),
);
await outcome('capture replay, same request ID', () =>
  captureAuthorization(client, { ...authorization, attempt: 0, amount }),
);
await outcome('second capture, new request ID', () =>
  captureAuthorization(client, { ...authorization, attempt: 1, amount }),
);
await outcome('void after capture', () =>
  voidAuthorization(client, { ...authorization, attempt: 0 }),
);

const voidDeal = `probe-${randomUUID()}`;
const toVoid = { dealId: voidDeal, authorizationId: (await authorizeWithTestCard(voidDeal)).id };
await outcome('void', () => voidAuthorization(client, { ...toVoid, attempt: 0 }));
await outcome('void replay, same request ID', () =>
  voidAuthorization(client, { ...toVoid, attempt: 0 }),
);
await outcome('second void, new request ID', () =>
  voidAuthorization(client, { ...toVoid, attempt: 1 }),
);
await outcome('capture after void', () =>
  captureAuthorization(client, { ...toVoid, attempt: 0, amount }),
);
