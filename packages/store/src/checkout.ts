import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { dealKey } from './deals';
import type { StoreTable } from './table';

export interface Checkout {
  orderId: string;
  approveUrl: string;
}

/** Stores the PayPal order the buyer must approve, for the app to send them to. */
export async function saveCheckout(
  table: StoreTable,
  dealId: string,
  checkout: Checkout,
): Promise<void> {
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: { pk: dealKey(dealId).pk, sk: 'CHECKOUT', ...checkout },
    }),
  );
}
