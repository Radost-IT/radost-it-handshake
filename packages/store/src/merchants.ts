import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { StoreTable } from './table';

const merchantKey = (accountId: string) => ({ pk: `MERCHANT#${accountId}`, sk: 'META' });

/** A business that sells through Handshake. It belongs to one account and runs one or more seller agents. */
export const merchantSchema = z.object({
  accountId: z.string().min(1),
  businessName: z.string().min(1).max(100),
  website: z.url({ protocol: /^https?$/ }),
  /** The PayPal business account that should receive this merchant's money. */
  payoutEmail: z.email(),
  products: z.string().min(1).max(500),
  sellerIds: z.array(z.string().min(1)),
  createdAt: z.iso.datetime({ offset: true }),
});

export type Merchant = z.infer<typeof merchantSchema>;

/** Saving a merchant again replaces it. */
export async function saveMerchant(table: StoreTable, merchant: Merchant): Promise<void> {
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: { ...merchantKey(merchant.accountId), ...merchantSchema.parse(merchant) },
    }),
  );
}

export async function getMerchant(
  table: StoreTable,
  accountId: string,
): Promise<Merchant | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: merchantKey(accountId) }),
  );
  return Item ? merchantSchema.parse(Item) : undefined;
}
