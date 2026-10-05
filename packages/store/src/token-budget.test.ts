import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { addTokensUsed, arenaTokenLimit, getTokensUsed } from './token-budget';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const key = { pk: 'BUDGET#2026-10-03', sk: 'TOKENS' };

beforeEach(() => dynamodb.reset());

describe('getTokensUsed', () => {
  it('reads the day counter', async () => {
    dynamodb.on(GetCommand, { Key: key }).resolves({ Item: { ...key, used: 1234 } });

    expect(await getTokensUsed(table, '2026-10-03', 'all')).toBe(1234);
  });

  it('counts a day without calls as zero', async () => {
    dynamodb.on(GetCommand).resolves({});

    expect(await getTokensUsed(table, '2026-10-03', 'all')).toBe(0);
  });
});

describe('addTokensUsed', () => {
  it('adds to the day counter atomically', async () => {
    dynamodb.on(UpdateCommand).resolves({});

    await addTokensUsed(table, '2026-10-03', 'all', 120);

    expect(dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input).toEqual({
      TableName: 'T',
      Key: key,
      UpdateExpression: 'ADD used :tokens',
      ExpressionAttributeValues: { ':tokens': 120 },
    });
  });
});

describe('arena tokens', () => {
  it('keeps a separate counter for arena runs', async () => {
    dynamodb.on(UpdateCommand).resolves({});

    await addTokensUsed(table, '2026-10-03', 'arena', 120);

    expect(dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input.Key).toEqual({
      pk: 'BUDGET#2026-10-03',
      sk: 'ARENA',
    });
  });

  it('gives the arena half of the day', () => {
    expect(arenaTokenLimit(1001)).toBe(500);
  });
});
