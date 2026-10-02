import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveCheckout } from './checkout';
import { saveWait, takeWait } from './waits';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

beforeEach(() => dynamodb.reset());

describe('saveWait', () => {
  it('stores the task token under the deal with a month of TTL', async () => {
    dynamodb.on(PutCommand).resolves({});

    await saveWait(table, 'deal-1', 'evidence', 'token-1', new Date('2026-10-02T12:00:00Z'));

    const [call] = dynamodb.commandCalls(PutCommand);
    expect(call?.args[0].input).toEqual({
      TableName: 'T',
      Item: {
        pk: 'DEAL#deal-1',
        sk: 'WAIT#evidence',
        taskToken: 'token-1',
        ttl: Date.parse('2026-11-01T12:00:00Z') / 1000,
      },
    });
  });
});

describe('takeWait', () => {
  it('deletes the wait and returns its token', async () => {
    dynamodb
      .on(DeleteCommand, { Key: { pk: 'DEAL#deal-1', sk: 'WAIT#checkout' } })
      .resolves({ Attributes: { pk: 'DEAL#deal-1', sk: 'WAIT#checkout', taskToken: 'token-1' } });

    await expect(takeWait(table, 'deal-1', 'checkout')).resolves.toBe('token-1');
    expect(dynamodb.commandCalls(DeleteCommand)[0]?.args[0].input.ReturnValues).toBe('ALL_OLD');
  });

  it('returns undefined when nothing is waiting', async () => {
    dynamodb.on(DeleteCommand).resolves({});
    await expect(takeWait(table, 'deal-1', 'checkout')).resolves.toBeUndefined();
  });
});

describe('saveCheckout', () => {
  it('stores the order the buyer must approve', async () => {
    dynamodb.on(PutCommand).resolves({});

    await saveCheckout(table, 'deal-1', { orderId: 'ORDER-1', approveUrl: 'https://paypal/x' });

    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toEqual({
      pk: 'DEAL#deal-1',
      sk: 'CHECKOUT',
      orderId: 'ORDER-1',
      approveUrl: 'https://paypal/x',
    });
  });
});
