import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SendTaskSuccessCommand, SFNClient, TaskTimedOut } from '@aws-sdk/client-sfn';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { resumeLifecycleFromPayPal, type PayPalEventContext } from './paypal-events';

const dynamodb = mockClient(DynamoDBDocumentClient);
const stepFunctions = mockClient(SFNClient);
const context: PayPalEventContext = {
  table: { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' },
  stepFunctions: new SFNClient({}),
  now: () => '2026-10-02T12:10:00Z',
};

beforeEach(() => {
  dynamodb.reset();
  stepFunctions.reset();
  dynamodb.on(PutCommand).resolves({});
});

function waitingFor(signal: string): void {
  dynamodb.on(DeleteCommand, { Key: { pk: 'DEAL#deal-1', sk: `WAIT#${signal}` } }).resolves({
    Attributes: { pk: 'DEAL#deal-1', sk: `WAIT#${signal}`, taskToken: 'token-1' },
  });
}

const orderApproved = {
  'detail-type': 'CHECKOUT.ORDER.APPROVED',
  detail: {
    id: 'WH-1',
    event_type: 'CHECKOUT.ORDER.APPROVED',
    resource: { id: 'ORDER-1', status: 'APPROVED', purchase_units: [{ custom_id: 'deal-1' }] },
  },
};

describe('CHECKOUT.ORDER.APPROVED', () => {
  it('resumes the checkout wait with the approved order', async () => {
    waitingFor('checkout');
    stepFunctions.on(SendTaskSuccessCommand).resolves({});

    await resumeLifecycleFromPayPal(context, orderApproved);

    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)[0]?.args[0].input).toEqual({
      taskToken: 'token-1',
      output: JSON.stringify({ orderId: 'ORDER-1' }),
    });
  });

  it('ignores an approval that nothing waits for', async () => {
    dynamodb.on(DeleteCommand).resolves({});

    await resumeLifecycleFromPayPal(context, orderApproved);

    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  });

  it('ignores an approval that arrives after the checkout timed out', async () => {
    waitingFor('checkout');
    stepFunctions
      .on(SendTaskSuccessCommand)
      .rejects(new TaskTimedOut({ message: 'Task Timed Out', $metadata: {} }));

    await resumeLifecycleFromPayPal(context, orderApproved);

    expect(dynamodb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('keeps the wait when Step Functions fails, so the retried event can resume it', async () => {
    waitingFor('checkout');
    stepFunctions.on(SendTaskSuccessCommand).rejects(new Error('Rate exceeded'));

    await expect(resumeLifecycleFromPayPal(context, orderApproved)).rejects.toThrow(
      'Rate exceeded',
    );

    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      sk: 'WAIT#checkout',
      taskToken: 'token-1',
    });
  });
});

describe('PAYMENT.CAPTURE.COMPLETED', () => {
  const capture = {
    id: 'capture-1',
    status: 'COMPLETED',
    amount: { currency_code: 'USD', value: '42.50' },
    custom_id: 'deal-1',
  };

  it('resumes the capture wait with the capture resource', async () => {
    waitingFor('capture');
    stepFunctions.on(SendTaskSuccessCommand).resolves({});

    await resumeLifecycleFromPayPal(context, {
      'detail-type': 'PAYMENT.CAPTURE.COMPLETED',
      detail: { id: 'WH-2', resource: capture },
    });

    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)[0]?.args[0].input.output).toBe(
      JSON.stringify(capture),
    );
  });

  it('ignores a capture without a deal ID, which the capture timeout then escalates', async () => {
    await resumeLifecycleFromPayPal(context, {
      'detail-type': 'PAYMENT.CAPTURE.COMPLETED',
      detail: { resource: { ...capture, custom_id: undefined } },
    });

    expect(dynamodb.calls()).toHaveLength(0);
  });
});

it('ignores PayPal events the lifecycle does not wait for', async () => {
  await resumeLifecycleFromPayPal(context, {
    'detail-type': 'PAYMENT.AUTHORIZATION.CREATED',
    detail: { resource: { id: 'auth-1' } },
  });

  expect(dynamodb.calls()).toHaveLength(0);
});
