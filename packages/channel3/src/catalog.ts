import { createHash } from 'node:crypto';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Channel3Error } from '@channel3/sdk';
import type { StoreTable } from '@handshake/store';
import { z } from 'zod';
import { catalogProductSchema, toCatalogProduct, type CatalogProduct } from './products';

/** The part of the Channel3 SDK client we call. `new Channel3({ apiKey }).products` fits it. */
export interface Channel3Products {
  search(request: { query: string; limit: number }): Promise<{ response: { products: unknown[] } }>;
  retrieve(request: { product_id: string }): Promise<unknown>;
}

export interface CatalogContext {
  products: Channel3Products;
  table: StoreTable;
  now: () => Date;
}

// Prices and stock change during the day; a few hours keeps deals honest and calls few.
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const SEARCH_LIMIT = 10;

const cachedProductsSchema = z.object({
  products: z.array(catalogProductSchema),
  ttl: z.number().int(),
});

/** Products for a search query, skipping any we cannot pay for. Cached in DynamoDB. */
export function searchProducts(context: CatalogContext, query: string): Promise<CatalogProduct[]> {
  const normalized = query.trim().toLowerCase();
  return cached(context, `search:${normalized}`, async () => {
    const page = await context.products.search({ query: normalized, limit: SEARCH_LIMIT });
    return page.response.products.map(toCatalogProduct).filter((product) => product !== null);
  });
}

/** One product, or undefined when Channel3 does not know it or we cannot pay for it. Cached. */
export async function getProduct(
  context: CatalogContext,
  productId: string,
): Promise<CatalogProduct | undefined> {
  const [product] = await cached(context, `product:${productId}`, async () => {
    try {
      const found = toCatalogProduct(await context.products.retrieve({ product_id: productId }));
      return found ? [found] : [];
    } catch (error) {
      if (error instanceof Channel3Error && error.statusCode === 404) return [];
      throw error;
    }
  });
  return product;
}

async function cached(
  context: CatalogContext,
  request: string,
  fetchProducts: () => Promise<CatalogProduct[]>,
): Promise<CatalogProduct[]> {
  const key = { pk: `C3#${createHash('sha256').update(request).digest('hex')}`, sk: 'RESULT' };
  const nowSeconds = Math.floor(context.now().getTime() / 1000);
  const { Item } = await context.table.client.send(
    new GetCommand({ TableName: context.table.name, Key: key }),
  );
  // DynamoDB deletes expired items lazily, so an expired one can still be read.
  const hit = Item ? cachedProductsSchema.parse(Item) : undefined;
  if (hit && hit.ttl > nowSeconds) return hit.products;

  const products = await fetchProducts();
  await context.table.client.send(
    new PutCommand({
      TableName: context.table.name,
      Item: { ...key, products, ttl: nowSeconds + CACHE_TTL_SECONDS },
    }),
  );
  return products;
}
