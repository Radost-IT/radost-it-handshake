import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, savePasswordAccount, verifyPassword } from './account-passwords';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

beforeEach(() => dynamodb.reset());

describe('hashPassword and verifyPassword', () => {
  it('accepts the password and refuses any other', async () => {
    const passwordHash = await hashPassword('correct horse');

    expect(passwordHash).not.toContain('correct horse');
    await expect(verifyPassword('correct horse', passwordHash)).resolves.toBe(true);
    await expect(verifyPassword('correct horse ', passwordHash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);

    expect(first).not.toBe(second);
  });

  it('refuses an account without a password and a malformed hash', async () => {
    await expect(verifyPassword('anything', undefined)).resolves.toBe(false);
    await expect(verifyPassword('anything', 'plain-text')).resolves.toBe(false);
  });
});

describe('savePasswordAccount', () => {
  it('stores the account as approved and takes it off the pending list', async () => {
    dynamodb.on(UpdateCommand).resolves({
      Attributes: {
        id: 'account-1',
        email: 'judges@example.com',
        createdAt: '2026-10-05T09:00:00.000Z',
        access: 'approved',
        passwordHash: 'scrypt:salt:key',
      },
    });

    const account = await savePasswordAccount(table, {
      accountId: 'account-1',
      email: 'judges@example.com',
      passwordHash: 'scrypt:salt:key',
      createdAt: new Date('2026-10-05T09:00:00Z'),
    });

    expect(account.access).toBe('approved');
    const input = dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.Key).toEqual({ pk: 'ACCOUNT#account-1', sk: 'META' });
    expect(input?.UpdateExpression).toContain('REMOVE gsi1pk, gsi1sk');
    expect(input?.ExpressionAttributeValues?.[':hash']).toBe('scrypt:salt:key');
  });
});
