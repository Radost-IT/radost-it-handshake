import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { resumeLifecycleFromPayPal, type PayPalEventContext } from './paypal-events';

const environment = z.object({ TABLE_NAME: z.string().min(1) }).parse(process.env);

const context: PayPalEventContext = {
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  stepFunctions: new SFNClient({}),
  now: () => new Date().toISOString(),
};

/** Receives PayPal webhook events from EventBridge. A thrown error makes Lambda retry the event. */
export async function handler(event: unknown): Promise<void> {
  await resumeLifecycleFromPayPal(context, event);
}
