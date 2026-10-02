import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadConfig } from '@handshake/config';
import { createPayPalClient } from '@handshake/paypal';
import { z } from 'zod';
import {
  lifecycleTaskSchema,
  runLifecycleTask,
  type LifecycleContext,
  type LifecycleTaskResult,
} from './lifecycle';

const environment = z
  .object({ TABLE_NAME: z.string().min(1), WEB_URL: z.url() })
  .parse(process.env);

const config = await loadConfig();

const context: LifecycleContext = {
  paypal: createPayPalClient(config.paypal),
  table: {
    client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
    name: environment.TABLE_NAME,
  },
  webUrl: environment.WEB_URL,
  honorPeriodMs: config.paypal.honorPeriodHours * 60 * 60 * 1000,
  now: () => new Date().toISOString(),
};

/** One step of the DealLifecycle state machine. Errors fail the step so Step Functions can retry. */
export async function handler(input: unknown): Promise<LifecycleTaskResult> {
  return runLifecycleTask(context, lifecycleTaskSchema.parse(input));
}
