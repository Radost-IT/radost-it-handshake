import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { takeRateLimitSlot } from './rate-limits';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const window = {
  subject: 'ip-hash',
  window: '2026-10-03T12',
  limit: 30,
  expiresAt: new Date('2026-10-03T14:00:00Z'),
};

beforeEach(() => dynamodb.reset());

describe('takeRateLimitSlot', () => {
  it('counts the request while the window is under its limit', async () => {
    dynamodb.on(UpdateCommand).resolves({});

    await expect(takeRateLimitSlot(table, window)).resolves.toBe(true);

    expect(dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input).toMatchObject({
      Key: { pk: 'RATE#ip-hash', sk: 'WINDOW#2026-10-03T12' },
      ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
      ExpressionAttributeValues: { ':one': 1, ':limit': 30, ':ttl': 1_791_036_000 },
    });
  });

  it('refuses the request once the limit is reached', async () => {
    dynamodb
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'limit', $metadata: {} }));

    await expect(takeRateLimitSlot(table, window)).resolves.toBe(false);
  });
});
