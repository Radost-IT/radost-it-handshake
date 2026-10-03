import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { grantDealAccess, hasDealAccess } from './deal-access';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const accessKey = { pk: 'DEAL#deal-1', sk: 'ACCESS#hash-1' };

beforeEach(() => dynamodb.reset());

describe('deal access', () => {
  it('stores the token hash in the deal partition', async () => {
    dynamodb.on(PutCommand).resolves({});

    await grantDealAccess(table, 'deal-1', 'hash-1');

    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: 'T',
      Item: accessKey,
    });
  });

  it('grants access only for a stored token hash', async () => {
    dynamodb.on(GetCommand).resolves({});
    dynamodb.on(GetCommand, { Key: accessKey }).resolves({ Item: accessKey });

    await expect(hasDealAccess(table, 'deal-1', 'hash-1')).resolves.toBe(true);
    await expect(hasDealAccess(table, 'deal-1', 'hash-2')).resolves.toBe(false);
  });
});
