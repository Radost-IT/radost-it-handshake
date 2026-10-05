import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { checkSignInCode, hashSignInCode, saveSignInCode } from './sign-in-codes';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const now = new Date('2026-10-02T12:00:00Z');
const live = now.getTime() / 1000 + 600;
const attempt = { accountId: 'account-1', codeHash: 'right', now };

beforeEach(() => dynamodb.reset());

describe('saveSignInCode', () => {
  it('replaces any earlier code and resets the failed tries', async () => {
    dynamodb.on(PutCommand).resolves({});

    await saveSignInCode(table, {
      accountId: 'account-1',
      codeHash: 'right',
      expiresAt: new Date('2026-10-02T12:10:00Z'),
    });

    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toEqual({
      pk: 'SIGNIN#account-1',
      sk: 'META',
      codeHash: 'right',
      failedChecks: 0,
      ttl: live,
    });
  });
});

describe('checkSignInCode', () => {
  it('accepts the right code once by deleting it', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { codeHash: 'right', failedChecks: 0, ttl: live } });
    dynamodb.on(DeleteCommand).resolves({});

    await expect(checkSignInCode(table, attempt)).resolves.toBe('valid');
    expect(dynamodb.commandCalls(DeleteCommand)[0]?.args[0].input.ConditionExpression).toBe(
      'codeHash = :hash AND failedChecks < :max',
    );
  });

  it('counts a wrong code against the stored one', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { codeHash: 'right', failedChecks: 2, ttl: live } });
    dynamodb.on(UpdateCommand).resolves({});

    await expect(checkSignInCode(table, { ...attempt, codeHash: 'wrong' })).resolves.toBe('wrong');
    const input = dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.UpdateExpression).toBe('ADD failedChecks :one');
    expect(input?.ConditionExpression).toBe('failedChecks < :max');
    expect(dynamodb.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it('locks a wrong code that parallel guesses already locked', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { codeHash: 'right', failedChecks: 4, ttl: live } });
    dynamodb
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'failed', $metadata: {} }));

    await expect(checkSignInCode(table, { ...attempt, codeHash: 'wrong' })).resolves.toBe('locked');
  });

  it('locks a code after five wrong tries, even for the right code', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { codeHash: 'right', failedChecks: 5, ttl: live } });

    await expect(checkSignInCode(table, attempt)).resolves.toBe('locked');
    expect(dynamodb.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it('rejects an expired code that DynamoDB has not deleted yet', async () => {
    dynamodb.on(GetCommand).resolves({
      Item: { codeHash: 'right', failedChecks: 0, ttl: now.getTime() / 1000 },
    });

    await expect(checkSignInCode(table, attempt)).resolves.toBe('expired');
  });

  it('treats a missing code as expired', async () => {
    dynamodb.on(GetCommand).resolves({});

    await expect(checkSignInCode(table, attempt)).resolves.toBe('expired');
  });

  it('lets only one of two requests with the same code sign in', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { codeHash: 'right', failedChecks: 0, ttl: live } });
    dynamodb
      .on(DeleteCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'failed', $metadata: {} }));

    await expect(checkSignInCode(table, attempt)).resolves.toBe('expired');
  });
});

describe('hashSignInCode', () => {
  it('salts the code with the account', () => {
    expect(hashSignInCode('account-1', '123456')).not.toBe(hashSignInCode('account-2', '123456'));
    expect(hashSignInCode('account-1', '123456')).not.toContain('123456');
  });
});
