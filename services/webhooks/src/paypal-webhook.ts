import { readWebhookTransmission, type WebhookTransmission } from '@handshake/paypal';
import { z } from 'zod';
import type { Logger } from './log';

const webhookEventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource_type: z.string().optional(),
  resource: z.record(z.string(), z.unknown()),
  create_time: z.iso.datetime({ offset: true }),
});

// PayPal retries a delivery for up to three days. An older signed event is a
// replay, and past this age its delivery record may already have expired.
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PayPalWebhookEvent = z.infer<typeof webhookEventSchema>;

export interface WebhookRequest {
  headers: Record<string, string | undefined>;
  body: string;
}

export interface WebhookDependencies {
  /** Undefined until the webhook is registered with PayPal ([I-11]). */
  webhookId: string | undefined;
  verifySignature: (
    webhookId: string,
    transmission: WebhookTransmission,
    rawEvent: string,
  ) => Promise<boolean>;
  /** Returns false when this event ID was already accepted. */
  recordFirstDelivery: (eventId: string) => Promise<boolean>;
  forgetDelivery: (eventId: string) => Promise<void>;
  publishEvent: (event: PayPalWebhookEvent) => Promise<void>;
  log: Logger;
  now: () => Date;
}

/**
 * Accepts one PayPal webhook delivery. PayPal retries any non-2xx answer, so
 * 2xx means "stop sending this one" and 5xx means "try again later".
 */
export async function receivePayPalWebhook(
  dependencies: WebhookDependencies,
  request: WebhookRequest,
): Promise<{ statusCode: number }> {
  const { webhookId, log } = dependencies;
  if (webhookId === undefined) {
    log.error('PayPal webhook ID is not configured');
    return { statusCode: 503 };
  }

  const transmission = readWebhookTransmission(request.headers);
  if (transmission === undefined) {
    log.warn('PayPal webhook without signature headers');
    return { statusCode: 400 };
  }

  const event = parseWebhookEvent(request.body);
  if (event === undefined) {
    log.warn('PayPal webhook with an invalid body');
    return { statusCode: 400 };
  }

  const context = { eventId: event.id, eventType: event.event_type };
  if (dependencies.now().getTime() - Date.parse(event.create_time) > MAX_EVENT_AGE_MS) {
    log.warn('PayPal webhook is too old', { ...context, createdAt: event.create_time });
    return { statusCode: 200 };
  }
  // Verify before recording, so an unsigned request cannot claim a real event ID.
  if (!(await dependencies.verifySignature(webhookId, transmission, request.body))) {
    log.warn('PayPal webhook signature rejected', context);
    return { statusCode: 401 };
  }

  if (!(await dependencies.recordFirstDelivery(event.id))) {
    log.info('PayPal webhook already received', context);
    return { statusCode: 200 };
  }

  try {
    await dependencies.publishEvent(event);
  } catch (error) {
    // Forget the event so PayPal's retry is not mistaken for a duplicate.
    await dependencies.forgetDelivery(event.id);
    throw error;
  }
  log.info('PayPal webhook published', context);
  return { statusCode: 200 };
}

function parseWebhookEvent(body: string): PayPalWebhookEvent | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const result = webhookEventSchema.safeParse(json);
  return result.success ? result.data : undefined;
}
