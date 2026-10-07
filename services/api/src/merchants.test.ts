import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  arenaTestContext,
  mockSignedIn,
  sessionAuthorization,
  stubZeptoMail,
  testAccount,
} from './arena-test-context';
import { applyAsMerchant, getMerchantSettings } from './merchants';

const dynamodb = mockClient(DynamoDBDocumentClient);
let sentEmails: ReturnType<typeof stubZeptoMail>;
const context = arenaTestContext('2026-10-07T12:00:00Z');
const newAccount = { ...testAccount, access: 'none', challengerId: undefined };
const application = {
  businessName: 'Fjell Outdoor',
  website: 'https://fjell.example',
  payoutEmail: 'payouts@fjell.example',
  products: 'Hiking backpacks and rain covers for day hikes',
};
const apply = (body: unknown) =>
  applyAsMerchant(context, { body: JSON.stringify(body), authorization: sessionAuthorization });

const merchant = {
  accountId: 'account-1',
  ...application,
  sellerIds: ['arena-backpack'],
  createdAt: '2026-10-07T10:00:00.000Z',
};
const seller = {
  sellerId: 'arena-backpack',
  name: 'Mara',
  persona: 'Warm and chatty.',
  floorPrice: { currency: 'USD', value: '50.00' },
  listing: {
    productId: 'arena-backpack-30l',
    title: 'Fjell 30 L hiking backpack',
    description: 'Green.',
    categoryPath: ['outdoor'],
    listPrice: { currency: 'USD', value: '65.00' },
  },
};

beforeEach(() => {
  dynamodb.reset();
  sentEmails = stubZeptoMail();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyAsMerchant', () => {
  it('saves the application, leaves the account pending and emails the admin', async () => {
    mockSignedIn(dynamodb, newAccount);
    dynamodb.on(UpdateCommand).resolves({});
    dynamodb.on(PutCommand).resolves({});

    const response = await apply(application);

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body ?? '')).toEqual({ access: 'pending' });
    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      pk: 'MERCHANT#account-1',
      payoutEmail: 'payouts@fjell.example',
      sellerIds: [],
    });
    const email = sentEmails()[0];
    expect(email?.to).toBe('admin@example.com');
    expect(email?.text).toContain('PayPal business account: payouts@fjell.example');
    expect(email?.text).toContain('pnpm arena:access T approve ada@example.com');
  });

  it('refuses an account that already asked to join', async () => {
    mockSignedIn(dynamodb, newAccount);
    dynamodb
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'asked', $metadata: {} }));

    const response = await apply(application);

    expect(response.statusCode).toBe(409);
    expect(dynamodb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('refuses a payout account that is not an email address', async () => {
    mockSignedIn(dynamodb, newAccount);

    const response = await apply({ ...application, payoutEmail: 'not an email' });

    expect(response.statusCode).toBe(400);
  });
});

describe('getMerchantSettings', () => {
  it('returns the profile, the keys without their secret, and the seller agents', async () => {
    mockSignedIn(dynamodb);
    dynamodb
      .on(GetCommand, { Key: { pk: 'MERCHANT#account-1', sk: 'META' } })
      .resolves({ Item: merchant });
    dynamodb.on(QueryCommand).resolves({
      Items: [
        {
          developerId: 'account:account-1',
          name: 'Shop',
          createdAt: '2026-10-07T10:00:00Z',
          lastCharacters: 'abcd',
        },
      ],
    });
    dynamodb.on(BatchGetCommand).resolves({ Responses: { T: [seller] } });

    const response = await getMerchantSettings(context, sessionAuthorization);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '')).toEqual({
      merchant: {
        businessName: 'Fjell Outdoor',
        website: 'https://fjell.example',
        payoutEmail: 'payouts@fjell.example',
        products: application.products,
        createdAt: merchant.createdAt,
      },
      apiKeys: [{ name: 'Shop', createdAt: '2026-10-07T10:00:00Z', lastCharacters: 'abcd' }],
      sellers: [
        {
          sellerId: 'arena-backpack',
          name: 'Mara',
          persona: 'Warm and chatty.',
          floorPrice: seller.floorPrice,
          listing: { title: seller.listing.title, listPrice: seller.listing.listPrice },
        },
      ],
    });
  });

  it('refuses an account that is not approved', async () => {
    mockSignedIn(dynamodb, { ...testAccount, access: 'pending' });

    const response = await getMerchantSettings(context, sessionAuthorization);

    expect(response.statusCode).toBe(403);
  });
});
