import {
  SendTaskSuccessCommand,
  TaskDoesNotExist,
  TaskTimedOut,
  type SFNClient,
} from '@aws-sdk/client-sfn';
import { saveWait, takeWait, type StoreTable, type WaitSignal } from '@handshake/store';
import { z } from 'zod';

export interface PayPalEventContext {
  table: StoreTable;
  stepFunctions: SFNClient;
  now: () => string;
}

// The webhook endpoint verified the signature before it published the event.
const paypalEventSchema = z.object({
  'detail-type': z.string(),
  detail: z.object({ resource: z.unknown() }),
});

// Webhook resources use PayPal's wire names, not the SDK's camelCase ones.
const approvedOrderSchema = z.object({
  id: z.string().min(1),
  purchase_units: z.array(z.object({ custom_id: z.string().min(1) })).min(1),
});

// PayPal copies the order's custom_id, our deal ID, onto the capture.
const captureSchema = z.object({ custom_id: z.string().min(1).optional() });

/**
 * Resumes the DealLifecycle execution that waits for a PayPal event. Events
 * that no execution waits for, such as a repeated delivery, are ignored.
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
      if (dealId) await resume(context, dealId, 'checkout', { orderId: order.id });
      return;
    }
    case 'PAYMENT.CAPTURE.COMPLETED':
    case 'PAYMENT.CAPTURE.DENIED': {
      const { custom_id: dealId } = captureSchema.parse(event.detail.resource);
      // The lifecycle checks the capture itself, so it gets the whole resource.
      if (dealId) await resume(context, dealId, 'capture', event.detail.resource);
      return;
    }
  }
}

async function resume(
  context: PayPalEventContext,
  dealId: string,
  signal: WaitSignal,
  output: unknown,
): Promise<void> {
  const taskToken = await takeWait(context.table, dealId, signal);
  if (!taskToken) return;
  try {
    await context.stepFunctions.send(
      new SendTaskSuccessCommand({ taskToken, output: JSON.stringify(output) }),
    );
  } catch (error) {
    // The wait already ended, for example when the checkout timed out.
    if (error instanceof TaskTimedOut || error instanceof TaskDoesNotExist) return;
    // Put the token back so the retried event can still resume the execution.
    await saveWait(context.table, dealId, signal, taskToken, new Date(context.now()));
    throw error;
  }
}
