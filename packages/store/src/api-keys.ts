import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { StoreTable } from './table';

// Account developers get their own prefix, so they never share deals with a script-made key.
export const ACCOUNT_DEVELOPER_PREFIX = 'account:';

/** The developer ID of a signed-in account and of the API keys issued to it. */
export const accountDeveloperId = (accountId: string) => `${ACCOUNT_DEVELOPER_PREFIX}${accountId}`;

/** Every Handshake API key starts with this, so a key never passes for a deal access token. */
export const API_KEY_PREFIX = 'hs_sandbox_';

// Like deal access tokens, the key's hash is the item key, so a lookup is one GetItem.
const apiKeyKey = (apiKey: string) => ({
  pk: `APIKEY#${createHash('sha256').update(apiKey).digest('hex')}`,
  sk: 'META',
});

const apiKeySchema = z.object({
  developerId: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
});

export type ApiKey = z.infer<typeof apiKeySchema>;

const listedApiKeySchema = apiKeySchema.extend({ lastCharacters: z.string().min(1) });

/** What a settings page may show of a key: never the key itself. */
export type ListedApiKey = z.infer<typeof listedApiKeySchema>;

// Keys issued before keys were listed have no GSI1 entry, so they never show up here.
const developerKeysPartition = (developerId: string) => `KEYS#${developerId}`;
const SHOWN_KEY_CHARACTERS = 4;

/** Creates an API key and returns it. Only its SHA-256 is stored, so it can be shown only once. */
export async function issueApiKey(table: StoreTable, key: ApiKey): Promise<string> {
  const apiKey = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: {
        ...apiKeyKey(apiKey),
        ...key,
        lastCharacters: apiKey.slice(-SHOWN_KEY_CHARACTERS),
        gsi1pk: developerKeysPartition(key.developerId),
        gsi1sk: key.createdAt,
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
  return apiKey;
}

/** The developer's keys, oldest first. */
export async function listApiKeys(table: StoreTable, developerId: string): Promise<ListedApiKey[]> {
  const { Items = [] } = await table.client.send(
    new QueryCommand({
      TableName: table.name,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': developerKeysPartition(developerId) },
    }),
  );
  return Items.map((item) => listedApiKeySchema.parse(item));
}

export async function findApiKey(table: StoreTable, apiKey: string): Promise<ApiKey | undefined> {
  if (!apiKey.startsWith(API_KEY_PREFIX)) return undefined;
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: apiKeyKey(apiKey) }),
  );
  return Item ? apiKeySchema.parse(Item) : undefined;
}
