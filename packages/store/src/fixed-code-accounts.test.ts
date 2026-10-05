import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveFixedCodeAccount } from './fixed-code-accounts';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

beforeEach(() => dynamodb.reset());

describe('saveFixedCodeAccount', () => {
  it('stores the account as approved and takes it off the pending list', async () => {
    dynamodb.on(UpdateCommand).resolves({
      Attributes: {
        id: 'account-1',
        email: 'judge-1@example.com',
        createdAt: '2026-10-05T09:00:00.000Z',
        access: 'approved',
        fixedSignInCodeHash: 'hash-1',
      },
    });

    const account = await saveFixedCodeAccount(table, {
      accountId: 'account-1',
      email: 'judge-1@example.com',
      fixedSignInCodeHash: 'hash-1',
      createdAt: new Date('2026-10-05T09:00:00Z'),
    });

    expect(account.access).toBe('approved');
    const input = dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.Key).toEqual({ pk: 'ACCOUNT#account-1', sk: 'META' });
    expect(input?.UpdateExpression).toContain('REMOVE gsi1pk, gsi1sk');
    expect(input?.ExpressionAttributeValues?.[':hash']).toBe('hash-1');
  });
});
