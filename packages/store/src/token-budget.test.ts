import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { addTokensUsed, getTokensUsed } from './token-budget';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const key = { pk: 'BUDGET#2026-10-03', sk: 'TOKENS' };

beforeEach(() => dynamodb.reset());

describe('getTokensUsed', () => {
  it('reads the day counter', async () => {
    dynamodb.on(GetCommand, { Key: key }).resolves({ Item: { ...key, used: 1234 } });

    expect(await getTokensUsed(table, '2026-10-03')).toBe(1234);
  });

  it('counts a day without calls as zero', async () => {
    dynamodb.on(GetCommand).resolves({});

    expect(await getTokensUsed(table, '2026-10-03')).toBe(0);
  });
});

describe('addTokensUsed', () => {
  it('adds to the day counter atomically', async () => {
    dynamodb.on(UpdateCommand).resolves({});

    await addTokensUsed(table, '2026-10-03', 120);

    expect(dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input).toEqual({
      TableName: 'T',
      Key: key,
      UpdateExpression: 'ADD used :tokens',
      ExpressionAttributeValues: { ':tokens': 120 },
    });
  });
});
