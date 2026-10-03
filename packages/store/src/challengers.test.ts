import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChallengerNotAllowedError, createChallenger, HandleTakenError } from './challengers';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

const input = {
  challengerId: 'challenger-1',
  accountId: 'account-1',
  handle: 'Tester',
  createdAt: new Date('2026-10-02T12:00:00Z'),
};

const cancelled = (codes: string[]) =>
  new TransactionCanceledException({
    message: 'Transaction cancelled',
    $metadata: {},
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

beforeEach(() => dynamodb.reset());

describe('createChallenger', () => {
  it('reserves the lowercase handle and links the challenger to an approved account', async () => {
    dynamodb.on(TransactWriteCommand).resolves({});

    const challenger = await createChallenger(table, input);

    expect(challenger).toMatchObject({ id: 'challenger-1', handle: 'Tester', version: 0 });
    const writes = dynamodb.commandCalls(TransactWriteCommand)[0]?.args[0].input.TransactItems;
    expect(writes?.map((write): unknown => write.Put?.Item?.pk ?? write.Update?.Key?.pk)).toEqual([
      'HANDLE#tester',
      'CHALLENGER#challenger-1',
      'ACCOUNT#account-1',
    ]);
    expect(writes?.[2]?.Update?.ConditionExpression).toBe(
      '#access = :approved AND attribute_not_exists(challengerId)',
    );
  });

  it('reports a taken handle', async () => {
    dynamodb
      .on(TransactWriteCommand)
      .rejects(cancelled(['ConditionalCheckFailed', 'None', 'None']));

    await expect(createChallenger(table, input)).rejects.toThrow(HandleTakenError);
  });

  it('refuses an account that is not approved or already has a challenger', async () => {
    dynamodb
      .on(TransactWriteCommand)
      .rejects(cancelled(['None', 'None', 'ConditionalCheckFailed']));

    await expect(createChallenger(table, input)).rejects.toThrow(ChallengerNotAllowedError);
  });
});
