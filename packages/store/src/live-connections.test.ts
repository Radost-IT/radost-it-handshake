import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  attemptTopic,
  closeLiveConnection,
  listLiveConnections,
  liveTopicSchema,
  openLiveConnection,
} from './live-connections';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

const attemptId = '0b7e1d8a-4c3f-4a7e-9f21-6d5c8b3a2e10';
const now = new Date('2026-10-03T12:00:00Z');
const nowSeconds = now.getTime() / 1000;

beforeEach(() => dynamodb.reset());

describe('liveTopicSchema', () => {
  it('accepts the arena topic and attempt topics only', () => {
    expect(liveTopicSchema.safeParse('arena').success).toBe(true);
    expect(liveTopicSchema.safeParse(attemptTopic(attemptId)).success).toBe(true);
    expect(liveTopicSchema.safeParse('attempt:../other').success).toBe(false);
    expect(liveTopicSchema.safeParse('deals').success).toBe(false);
  });
});

describe('openLiveConnection', () => {
  it('stores the connection and one subscription per topic with the same expiry', async () => {
    dynamodb.on(TransactWriteCommand).resolves({});

    await openLiveConnection(table, {
      connectionId: 'c1',
      topics: ['arena', attemptTopic(attemptId)],
      expiresAt: new Date('2026-10-03T14:00:00Z'),
    });

    const items = dynamodb
      .commandCalls(TransactWriteCommand)[0]
      ?.args[0].input.TransactItems?.map((write) => write.Put?.Item);
    expect(items).toEqual([
      {
        pk: 'LIVE#c1',
        sk: 'META',
        topics: ['arena', attemptTopic(attemptId)],
        ttl: nowSeconds + 7200,
      },
      { pk: 'TOPIC#arena', sk: 'LIVE#c1', connectionId: 'c1', ttl: nowSeconds + 7200 },
      {
        pk: `TOPIC#attempt:${attemptId}`,
        sk: 'LIVE#c1',
        connectionId: 'c1',
        ttl: nowSeconds + 7200,
      },
    ]);
  });
});

describe('closeLiveConnection', () => {
  it('deletes the connection and its subscriptions', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { topics: ['arena'] } });
    dynamodb.on(TransactWriteCommand).resolves({});

    await closeLiveConnection(table, 'c1');

    const keys = dynamodb
      .commandCalls(TransactWriteCommand)[0]
      ?.args[0].input.TransactItems?.map((write) => write.Delete?.Key);
    expect(keys).toEqual([
      { pk: 'LIVE#c1', sk: 'META' },
      { pk: 'TOPIC#arena', sk: 'LIVE#c1' },
    ]);
  });

  it('does nothing for a connection that is already gone', async () => {
    dynamodb.on(GetCommand).resolves({});

    await closeLiveConnection(table, 'c1');

    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});

describe('listLiveConnections', () => {
  it('reads every page and skips expired subscriptions', async () => {
    dynamodb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [{ connectionId: 'c1', ttl: nowSeconds + 60 }],
        LastEvaluatedKey: { pk: 'TOPIC#arena', sk: 'LIVE#c1' },
      })
      .resolvesOnce({
        Items: [
          { connectionId: 'c2', ttl: nowSeconds - 1 },
          { connectionId: 'c3', ttl: nowSeconds + 60 },
        ],
      });

    await expect(listLiveConnections(table, 'arena', now)).resolves.toEqual(['c1', 'c3']);
    expect(dynamodb.commandCalls(QueryCommand)[1]?.args[0].input.ExclusiveStartKey).toEqual({
      pk: 'TOPIC#arena',
      sk: 'LIVE#c1',
    });
  });
});
