import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDeal } from '@handshake/core';
import { mandate } from '@handshake/core/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { isDealOwner, listDeveloperDeals, UnreadDealsError } from './developer-deals';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

beforeEach(() => dynamodb.reset());

describe('listDeveloperDeals', () => {
  it('reads the listed deals in one batch, newest first', async () => {
    const older = createDeal('deal-1', mandate, '2026-10-05T10:00:00Z').deal;
    const newer = createDeal('deal-2', mandate, '2026-10-05T11:00:00Z').deal;
    dynamodb.on(QueryCommand).resolves({
      Items: [
        { pk: 'DEAL#deal-2', sk: 'OWNER' },
        { pk: 'DEAL#deal-1', sk: 'OWNER' },
      ],
    });
    dynamodb.on(BatchGetCommand).resolves({ Responses: { T: [older, newer] } });

    await expect(listDeveloperDeals(table, 'dev-1', 20)).resolves.toEqual([newer, older]);
    expect(dynamodb.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      IndexName: 'GSI1',
      ExpressionAttributeValues: { ':pk': 'DEV#dev-1' },
      ScanIndexForward: false,
    });
  });

  it('skips the batch read when the developer has no deals', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [] });
    await expect(listDeveloperDeals(table, 'dev-1', 20)).resolves.toEqual([]);
    expect(dynamodb.commandCalls(BatchGetCommand)).toHaveLength(0);
  });

  it('fails instead of returning a partial list', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [{ pk: 'DEAL#deal-1', sk: 'OWNER' }] });
    dynamodb.on(BatchGetCommand).resolves({
      Responses: { T: [] },
      UnprocessedKeys: { T: { Keys: [{ pk: 'DEAL#deal-1', sk: 'META' }] } },
    });
    await expect(listDeveloperDeals(table, 'dev-1', 20)).rejects.toBeInstanceOf(UnreadDealsError);
  });
});

describe('isDealOwner', () => {
  it('is true only for the developer who opened the deal', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { developerId: 'dev-1' } });
    await expect(isDealOwner(table, 'deal-1', 'dev-1')).resolves.toBe(true);
    await expect(isDealOwner(table, 'deal-1', 'dev-2')).resolves.toBe(false);
  });
});
