import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Channel3Error } from '@channel3/sdk';
import { money } from '@handshake/core';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getProduct, searchProducts, type Channel3Products } from './catalog';
import { toCatalogProduct } from './products';
import { channel3Bottle } from './fixtures';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const now = new Date('2026-10-03T12:00:00Z');
const nowSeconds = now.getTime() / 1000;

beforeEach(() => {
  dynamodb.reset();
  dynamodb.on(PutCommand).resolves({});
});

function channel3Returning(product: unknown): Channel3Products & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    search: (request) => {
      calls.push(`search ${request.query} ${String(request.limit)}`);
      return Promise.resolve({ response: { products: [product, { id: 'c3-x', title: 'X' }] } });
    },
    retrieve: (request) => {
      calls.push(`retrieve ${request.product_id}`);
      return Promise.resolve(product);
    },
  };
}

describe('searchProducts', () => {
  it('asks Channel3 on a miss, keeps payable products and caches them', async () => {
    dynamodb.on(GetCommand).resolves({});
    const products = channel3Returning(channel3Bottle);

    const found = await searchProducts({ products, table, now: () => now }, '  Water Bottle ');

    expect(found.map((product) => product.productId)).toEqual(['c3-bottle']);
    expect(products.calls).toEqual(['search water bottle 10']);
    const put = dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(put).toMatchObject({ sk: 'RESULT', products: found, ttl: nowSeconds + 6 * 3600 });
    expect(String(put?.pk)).toMatch(/^C3#[0-9a-f]{64}$/);
  });

  it('serves a fresh cache hit without calling Channel3', async () => {
    const product = toCatalogProduct(channel3Bottle);
    dynamodb.on(GetCommand).resolves({ Item: { products: [product], ttl: nowSeconds + 60 } });
    const products = channel3Returning(channel3Bottle);

    const found = await searchProducts({ products, table, now: () => now }, 'water bottle');

    expect(found).toEqual([product]);
    expect(found[0]?.listPrice).toEqual(money('24.99', 'USD'));
    expect(products.calls).toEqual([]);
  });

  it('ignores an expired item that DynamoDB has not deleted yet', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { products: [], ttl: nowSeconds - 1 } });
    const products = channel3Returning(channel3Bottle);

    await searchProducts({ products, table, now: () => now }, 'water bottle');

    expect(products.calls).toHaveLength(1);
  });
});

describe('getProduct', () => {
  it('retrieves one product by ID', async () => {
    dynamodb.on(GetCommand).resolves({});
    const products = channel3Returning(channel3Bottle);

    const found = await getProduct({ products, table, now: () => now }, 'c3-bottle');

    expect(found?.title).toBe('Steel water bottle');
    expect(products.calls).toEqual(['retrieve c3-bottle']);
  });

  it('returns undefined for a product Channel3 does not know', async () => {
    dynamodb.on(GetCommand).resolves({});
    const products: Channel3Products = {
      search: () => Promise.reject(new Error('not used')),
      retrieve: () => Promise.reject(new Channel3Error({ message: 'Not found', statusCode: 404 })),
    };

    await expect(getProduct({ products, table, now: () => now }, 'gone')).resolves.toBeUndefined();
  });

  it('lets other Channel3 errors through', async () => {
    dynamodb.on(GetCommand).resolves({});
    const products: Channel3Products = {
      search: () => Promise.reject(new Error('not used')),
      retrieve: () => Promise.reject(new Channel3Error({ message: 'Busy', statusCode: 503 })),
    };

    await expect(getProduct({ products, table, now: () => now }, 'c3-bottle')).rejects.toThrow(
      Channel3Error,
    );
  });
});
