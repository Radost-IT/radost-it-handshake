import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { loadConfig } from '@handshake/config';
import { createPayPalClient, PayPalApiError, verifyWebhookSignature } from '@handshake/paypal';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { log } from './log';
import { receivePayPalWebhook, type PayPalWebhookEvent } from './paypal-webhook';

const environment = z
  .object({ TABLE_NAME: z.string().min(1), EVENT_BUS_NAME: z.string().min(1) })
  .parse(process.env);

// PayPal retries a failed delivery for up to three days, so a month covers every retry.
const DELIVERY_RECORD_TTL_SECONDS = 30 * 24 * 60 * 60;

const config = await loadConfig();
const paypal = createPayPalClient(config.paypal);
const dynamodb = new DynamoDBClient({});
const eventBridge = new EventBridgeClient({});

const deliveryKey = (eventId: string) => ({
  pk: { S: `IDEMP#paypal-webhook:${eventId}` },
  sk: { S: 'META' },
});

async function recordFirstDelivery(eventId: string): Promise<boolean> {
  const expiresAt = Math.floor(Date.now() / 1000) + DELIVERY_RECORD_TTL_SECONDS;
  try {
    await dynamodb.send(
      new PutItemCommand({
        TableName: environment.TABLE_NAME,
        Item: { ...deliveryKey(eventId), ttl: { N: String(expiresAt) } },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

async function forgetDelivery(eventId: string): Promise<void> {
  await dynamodb.send(
    new DeleteItemCommand({ TableName: environment.TABLE_NAME, Key: deliveryKey(eventId) }),
  );
}

async function publishEvent(event: PayPalWebhookEvent): Promise<void> {
  const result = await eventBridge.send(
    new PutEventsCommand({
      Entries: [
        {
          EventBusName: environment.EVENT_BUS_NAME,
          Source: 'handshake.paypal',
          DetailType: event.event_type,
          Detail: JSON.stringify(event),
        },
      ],
    }),
  );
  if (result.FailedEntryCount !== 0) {
    const entry = result.Entries?.[0];
    throw new Error(`EventBridge rejected the event: ${entry?.ErrorCode ?? 'unknown error'}`);
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const body = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
  try {
    return await receivePayPalWebhook(
      {
        webhookId: config.paypal.webhookId,
        verifySignature: (webhookId, transmission, rawEvent) =>
          verifyWebhookSignature(paypal, { webhookId, transmission, rawEvent }),
        recordFirstDelivery,
        forgetDelivery,
        publishEvent,
        log,
      },
      { headers: event.headers, body },
    );
  } catch (error) {
    log.error('PayPal webhook failed', {
      error: error instanceof Error ? error.message : String(error),
      debugId: error instanceof PayPalApiError ? error.debugId : undefined,
    });
    return { statusCode: 500 };
  }
}
