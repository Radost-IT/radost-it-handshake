import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { money } from '@handshake/core';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { UnprocessedWritesError } from './batch-writes';
import { listSellers, saveSellers, sellerSchema, type Seller } from './sellers';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

const seller = (index: number): Seller => ({
  sellerId: `seller-${String(index)}`,
  name: 'Ada',
  persona: 'Friendly.',
  floorPrice: money('20.00', 'USD'),
  listing: {
    productId: `c3-${String(index)}`,
    title: 'Bottle',
    description: '',
    categoryPath: ['home'],
    listPrice: money('25.00', 'USD'),
  },
});

beforeEach(() => {
  dynamodb.reset();
});

describe('sellerSchema', () => {
  it('rejects a floor price above the list price', () => {
    const result = sellerSchema.safeParse({ ...seller(1), floorPrice: money('30.00', 'USD') });

    expect(result.success).toBe(false);
  });
});

describe('saveSellers', () => {
  it('writes sellers in batches of 25 under SELLER#<id>', async () => {
    dynamodb.on(BatchWriteCommand).resolves({});

    await saveSellers(
      table,
      Array.from({ length: 30 }, (_, index) => seller(index)),
    );

    const batches = dynamodb.commandCalls(BatchWriteCommand).map((call) => call.args[0].input);
    expect(batches.map((batch) => batch.RequestItems?.T?.length)).toEqual([25, 5]);
    expect(batches[0]?.RequestItems?.T?.[0]?.PutRequest?.Item).toMatchObject({
      pk: 'SELLER#seller-0',
      sk: 'META',
      gsi1pk: 'SELLERS',
      gsi1sk: 'seller-0',
      name: 'Ada',
    });
  });

  it('retries the items DynamoDB left unprocessed', async () => {
    const leftOver = [{ PutRequest: { Item: { pk: 'SELLER#seller-1', sk: 'META' } } }];
    dynamodb
      .on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: { T: leftOver } })
      .resolves({});

    await saveSellers(table, [seller(0), seller(1)]);

    const calls = dynamodb.commandCalls(BatchWriteCommand);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args[0].input.RequestItems?.T).toEqual(leftOver);
  });

  it('gives up after five attempts', async () => {
    const leftOver = [{ PutRequest: { Item: { pk: 'SELLER#seller-0', sk: 'META' } } }];
    dynamodb.on(BatchWriteCommand).resolves({ UnprocessedItems: { T: leftOver } });

    await expect(saveSellers(table, [seller(0)])).rejects.toThrow(UnprocessedWritesError);
  }, 10_000);
});

describe('listSellers', () => {
  it('reads the seeded sellers from GSI1', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [{ pk: 'SELLER#seller-1', ...seller(1) }] });

    const sellers = await listSellers(table, 50);

    expect(sellers).toEqual([seller(1)]);
    expect(dynamodb.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      IndexName: 'GSI1',
      ExpressionAttributeValues: { ':pk': 'SELLERS' },
      Limit: 50,
    });
  });
});
