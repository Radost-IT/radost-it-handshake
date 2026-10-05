import { recordWebhook } from '@handshake/store';
import { z } from 'zod';
import { resumeLifecycle, type ResumeContext } from './resume-lifecycle';

export type PayPalEventContext = ResumeContext;

// The webhook endpoint verified the signature before it published the event.
const paypalEventSchema = z.object({
  'detail-type': z.string(),
  detail: z.object({ id: z.string().min(1), resource: z.unknown() }),
});

const resourceIdSchema = z.object({ id: z.string().min(1).optional() });

// Webhook resources use PayPal's wire names, not the SDK's camelCase ones.
const approvedOrderSchema = z.object({
  id: z.string().min(1),
  purchase_units: z.array(z.object({ custom_id: z.string().min(1) })).min(1),
});

// PayPal copies the order's custom_id, our deal ID, onto the capture.
const captureSchema = z.object({ custom_id: z.string().min(1).optional() });

type PayPalEvent = z.infer<typeof paypalEventSchema>;

/**
 * Logs the PayPal event on its deal and resumes the DealLifecycle execution
 * that waits for it. Events that no execution waits for, such as a repeated
 * delivery, are only logged.
 */
export async function resumeLifecycleFromPayPal(
  context: PayPalEventContext,
  input: unknown,
): Promise<void> {
  const event = paypalEventSchema.parse(input);
  switch (event['detail-type']) {
    case 'CHECKOUT.ORDER.APPROVED': {
      const order = approvedOrderSchema.parse(event.detail.resource);
      const dealId = order.purchase_units[0]?.custom_id;
      if (!dealId) return;
      await logWebhook(context, dealId, event);
      await resumeLifecycle(context, dealId, 'checkout', { orderId: order.id });
      return;
    }
    case 'PAYMENT.CAPTURE.COMPLETED':
    case 'PAYMENT.CAPTURE.DENIED': {
      const { custom_id: dealId } = captureSchema.parse(event.detail.resource);
      if (!dealId) return;
      await logWebhook(context, dealId, event);
      // The lifecycle checks the capture itself, so it gets the whole resource.
      await resumeLifecycle(context, dealId, 'capture', event.detail.resource);
      return;
    }
  }
}

function logWebhook(context: PayPalEventContext, dealId: string, event: PayPalEvent) {
  return recordWebhook(context.table, dealId, {
    at: context.now(),
    eventId: event.detail.id,
    eventType: event['detail-type'],
    resourceId: resourceIdSchema.parse(event.detail.resource).id ?? null,
  });
}
