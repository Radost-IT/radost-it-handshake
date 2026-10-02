import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createChallenger, findSessionChallengerId, HandleTakenError } from './sessions';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

const input = {
  challengerId: 'challenger-1',
  handle: 'Tester',
  sessionTokenHash: 'hash-1',
  createdAt: new Date('2026-10-02T12:00:00Z'),
  sessionExpiresAt: new Date('2026-12-31T12:00:00Z'),
};

beforeEach(() => dynamodb.reset());

describe('createChallenger', () => {
  it('reserves the lowercase handle, creates the challenger and stores only the token hash', async () => {
    dynamodb.on(TransactWriteCommand).resolves({});

    const challenger = await createChallenger(table, input);

    expect(challenger).toMatchObject({ id: 'challenger-1', handle: 'Tester', version: 0 });
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.map((write): unknown => write.Put?.Item?.pk)).toEqual([
      'HANDLE#tester',
      'CHALLENGER#challenger-1',
      'SESSION#hash-1',
    ]);
    expect(writes?.[2]?.Put?.Item).toEqual({
      pk: 'SESSION#hash-1',
      sk: 'META',
      challengerId: 'challenger-1',
      ttl: Date.parse('2026-12-31T12:00:00Z') / 1000,
    });
  });

  it('reports a taken handle', async () => {
    dynamodb.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
      }),
    );

    await expect(createChallenger(table, input)).rejects.toThrow(HandleTakenError);
  });
});

describe('findSessionChallengerId', () => {
  const now = new Date('2026-10-02T12:00:00Z');

  it('returns the challenger of a live session', async () => {
    dynamodb.on(GetCommand).resolves({
      Item: { challengerId: 'challenger-1', ttl: now.getTime() / 1000 + 60 },
    });
    await expect(findSessionChallengerId(table, 'hash-1', now)).resolves.toBe('challenger-1');
  });

  it('ignores an expired session that DynamoDB has not deleted yet', async () => {
    dynamodb.on(GetCommand).resolves({
      Item: { challengerId: 'challenger-1', ttl: now.getTime() / 1000 - 60 },
    });
    await expect(findSessionChallengerId(table, 'hash-1', now)).resolves.toBeUndefined();
  });

  it('returns undefined for an unknown session', async () => {
    dynamodb.on(GetCommand).resolves({});
    await expect(findSessionChallengerId(table, 'hash-1', now)).resolves.toBeUndefined();
  });
});
