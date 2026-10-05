import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { StoreTable } from './table';

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

/** Creates an API key and returns it. Only its SHA-256 is stored, so it can be shown only once. */
export async function issueApiKey(table: StoreTable, key: ApiKey): Promise<string> {
  const apiKey = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: { ...apiKeyKey(apiKey), ...key },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
  return apiKey;
}

export async function findApiKey(table: StoreTable, apiKey: string): Promise<ApiKey | undefined> {
  if (!apiKey.startsWith(API_KEY_PREFIX)) return undefined;
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: apiKeyKey(apiKey) }),
  );
  return Item ? apiKeySchema.parse(Item) : undefined;
}
