import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { dealKey } from './deals';
import type { StoreTable } from './table';

export const checkoutSchema = z.object({ orderId: z.string().min(1), approveUrl: z.url() });

export type Checkout = z.infer<typeof checkoutSchema>;

const checkoutKey = (dealId: string) => ({ pk: dealKey(dealId).pk, sk: 'CHECKOUT' });

/** Stores the PayPal order the buyer must approve, for the app to send them to. */
export async function saveCheckout(
  table: StoreTable,
  dealId: string,
  checkout: Checkout,
): Promise<void> {
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: { ...checkoutKey(dealId), ...checkout },
    }),
  );
}

export async function getCheckout(
  table: StoreTable,
  dealId: string,
): Promise<Checkout | undefined> {
  const { Item } = await table.client.send(
    new GetCommand({ TableName: table.name, Key: checkoutKey(dealId) }),
  );
  return Item ? checkoutSchema.parse(Item) : undefined;
}
