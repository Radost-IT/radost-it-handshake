import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { issueApiKey, listApiKeys } from './api-keys';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const key = { developerId: 'account:account-1', name: 'Shop', createdAt: '2026-10-07T10:00:00Z' };

beforeEach(() => {
  dynamodb.reset();
});

describe('issueApiKey', () => {
  it('stores only the hash and the last characters, listed under the developer', async () => {
    dynamodb.on(PutCommand).resolves({});

    const apiKey = await issueApiKey(table, key);

    const item = dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(JSON.stringify(item)).not.toContain(apiKey);
    expect(item).toMatchObject({
      lastCharacters: apiKey.slice(-4),
      gsi1pk: 'KEYS#account:account-1',
      gsi1sk: key.createdAt,
    });
  });
});

describe('listApiKeys', () => {
  it('returns what a settings page may show of each key', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [{ ...key, lastCharacters: 'abcd' }] });

    await expect(listApiKeys(table, 'account:account-1')).resolves.toEqual([
      { ...key, lastCharacters: 'abcd' },
    ]);
    expect(dynamodb.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues).toEqual(
      {
        ':pk': 'KEYS#account:account-1',
      },
    );
  });
});
