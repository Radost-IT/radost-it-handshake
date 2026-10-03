import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleLiveEvent } from './live-connections';

const dynamodb = mockClient(DynamoDBDocumentClient);
const context = {
  table: { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' },
  now: () => new Date('2026-10-03T12:00:00Z'),
};

const attemptId = '0b7e1d8a-4c3f-4a7e-9f21-6d5c8b3a2e10';

const connectEvent = (topics?: string) => ({
  requestContext: { routeKey: '$connect', connectionId: 'c1' },
  ...(topics === undefined ? {} : { queryStringParameters: { topics } }),
});

beforeEach(() => {
  dynamodb.reset();
  dynamodb.on(TransactWriteCommand).resolves({});
});

describe('handleLiveEvent', () => {
  it('subscribes a new connection to each topic once, for two hours', async () => {
    const response = await handleLiveEvent(
      context,
      connectEvent(`arena,attempt:${attemptId},arena`),
    );

    expect(response).toEqual({ statusCode: 200 });
    const items = dynamodb
      .commandCalls(TransactWriteCommand)[0]
      ?.args[0].input.TransactItems?.map((write): unknown => write.Put?.Item?.pk);
    expect(items).toEqual(['LIVE#c1', 'TOPIC#arena', `TOPIC#attempt:${attemptId}`]);
    expect(
      dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems?.[0]?.Put?.Item
        ?.ttl,
    ).toBe(Date.parse('2026-10-03T14:00:00Z') / 1000);
  });

  it.each([undefined, '', 'deals', 'arena,a,b,c,d'])(
    'refuses to connect with the topics %j',
    async (topics) => {
      await expect(handleLiveEvent(context, connectEvent(topics))).resolves.toEqual({
        statusCode: 400,
      });
      expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(0);
    },
  );

  it('removes the subscriptions when the connection closes', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { topics: ['arena'] } });

    const response = await handleLiveEvent(context, {
      requestContext: { routeKey: '$disconnect', connectionId: 'c1' },
    });

    expect(response).toEqual({ statusCode: 200 });
    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(1);
  });
});
