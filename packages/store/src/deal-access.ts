import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { dealKey } from './deals';
import type { StoreTable } from './table';

// The hash is part of the key, so checking a token is one key lookup and a
// wrong token simply finds nothing.
const dealAccessKey = (dealId: string, tokenHash: string) => ({
  pk: dealKey(dealId).pk,
  sk: `ACCESS#${tokenHash}`,
});

/** Lets the holder of the token act for the buyer. Only the token's SHA-256 is stored. */
export async function grantDealAccess(
  table: StoreTable,
  dealId: string,
  tokenHash: string,
): Promise<void> {
  await table.client.send(
    new PutCommand({ TableName: table.name, Item: dealAccessKey(dealId, tokenHash) }),
  );
}

export async function hasDealAccess(
  table: StoreTable,
  dealId: string,
  tokenHash: string,
): Promise<boolean> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: dealAccessKey(dealId, tokenHash) }),
  );
  return Item !== undefined;
}
