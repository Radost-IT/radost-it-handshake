import { Channel3 } from '@channel3/sdk';
import { searchProducts, sellersFromProducts } from '@handshake/channel3';
import { requireChannel3ApiKey, type Config } from '@handshake/config';
import { saveSellers, type StoreTable } from '@handshake/store';

export const defaultSellerQueries = [
  'stainless steel water bottle',
  'wireless headphones',
  'running shoes',
];

/** Creates or replaces seller agents from Channel3 products and returns how many were saved. */
export async function seedSellers(
  table: StoreTable,
  config: Config,
  queries: string[],
): Promise<number> {
  const context = {
    products: new Channel3({ apiKey: requireChannel3ApiKey(config) }).products,
    table,
    now: () => new Date(),
  };
  const results = await Promise.all(queries.map((query) => searchProducts(context, query)));
  const sellers = sellersFromProducts(results.flat());
  await saveSellers(table, sellers);
  return sellers.length;
}
