import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getMerchant, saveMerchant, type Merchant } from './merchants';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const merchant: Merchant = {
  accountId: 'account-1',
  businessName: 'Fjell Outdoor',
  website: 'https://fjell.example',
  payoutEmail: 'payouts@fjell.example',
  products: 'Hiking backpacks',
  sellerIds: ['arena-backpack'],
  createdAt: '2026-10-07T10:00:00Z',
};

beforeEach(() => {
  dynamodb.reset();
});

describe('saveMerchant', () => {
  it('stores the merchant under its account', async () => {
    dynamodb.on(PutCommand).resolves({});

    await saveMerchant(table, merchant);

    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toEqual({
      pk: 'MERCHANT#account-1',
      sk: 'META',
      ...merchant,
    });
  });

  it('refuses a website that is not a web address', async () => {
    await expect(
      saveMerchant(table, { ...merchant, website: 'javascript:alert(1)' }),
    ).rejects.toThrow();
  });
});

describe('getMerchant', () => {
  it('returns undefined for an account without a merchant', async () => {
    dynamodb.on(GetCommand).resolves({});

    await expect(getMerchant(table, 'account-1')).resolves.toBeUndefined();
  });
});
