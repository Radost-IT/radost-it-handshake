import { BatchGetCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { dealSchema, type Deal } from '@handshake/core';
import { dealKey } from './deals';
import type { StoreTable } from './table';

export class UnreadDealsError extends Error {
  override name = 'UnreadDealsError';
}

// DynamoDB's BatchGetItem reads at most 100 keys.
export const MAX_LISTED_DEALS = 100;

/** The rate limit subject that counts the deals a developer opens per day. */
export const dailyDealsSubject = (developerId: string) => `deals:${developerId}`;

const ownerKey = (dealId: string) => ({ pk: dealKey(dealId).pk, sk: 'OWNER' });
const developerPartition = (developerId: string) => `DEV#${developerId}`;

/** Records which developer opened a deal through the API. GSI1 lists a developer's deals, newest last. */
export async function saveDealOwner(
  table: StoreTable,
  dealId: string,
  owner: { developerId: string; createdAt: string },
): Promise<void> {
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: {
        ...ownerKey(dealId),
        ...owner,
        gsi1pk: developerPartition(owner.developerId),
        gsi1sk: `${owner.createdAt}#${dealId}`,
      },
    }),
  );
}

export async function isDealOwner(
  table: StoreTable,
  dealId: string,
  developerId: string,
): Promise<boolean> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: ownerKey(dealId) }),
  );
  return Item?.developerId === developerId;
}

/** The developer's most recent deals, newest first. */
export async function listDeveloperDeals(
  table: StoreTable,
  developerId: string,
  limit: number,
): Promise<Deal[]> {
  const { Items = [] } = await table.client.send(
    new QueryCommand({
      TableName: table.name,
      IndexName: 'GSI1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: { ':pk': developerPartition(developerId) },
      ScanIndexForward: false,
      Limit: Math.min(limit, MAX_LISTED_DEALS),
    }),
  );
  const dealIds = Items.map((item) => String(item.pk).slice('DEAL#'.length));
  if (dealIds.length === 0) return [];

  const { Responses = {}, UnprocessedKeys = {} } = await table.client.send(
    new BatchGetCommand({
      RequestItems: { [table.name]: { Keys: dealIds.map((dealId) => dealKey(dealId)) } },
    }),
  );
  if (Object.keys(UnprocessedKeys).length > 0) {
    throw new UnreadDealsError('DynamoDB did not return every deal; try again');
  }
  const deals = (Responses[table.name] ?? []).map((item) => dealSchema.parse(item));
  // BatchGetItem returns items in any order.
  return deals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
