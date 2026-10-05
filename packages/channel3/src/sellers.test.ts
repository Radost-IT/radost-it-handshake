import { money } from '@handshake/core';
import { sellerSchema } from '@handshake/store';
import { describe, expect, it } from 'vitest';
import {
  sellerForProduct,
  sellerFromProduct,
  sellerPersonas,
  sellersFromProducts,
} from './sellers';

const product = {
  productId: 'c3-bottle',
  title: 'Steel water bottle',
  description: 'Keeps drinks cold.',
  brand: 'Hydra',
  categoryPath: ['home', 'water-bottles'],
  listPrice: money('24.99', 'USD'),
  merchantDomain: 'store.example',
  url: 'https://store.example/bottle',
};

describe('sellerFromProduct', () => {
  it('sets the floor price from the persona and keeps the listing', () => {
    const [mara] = sellerPersonas;
    if (!mara) throw new Error('No personas');

    const seller = sellerFromProduct(product, mara);

    expect(seller.floorPrice).toEqual(money('19.99', 'USD'));
    expect(seller.listing).toEqual({
      productId: 'c3-bottle',
      title: 'Steel water bottle',
      description: 'Keeps drinks cold.',
      categoryPath: ['home', 'water-bottles'],
      listPrice: money('24.99', 'USD'),
    });
    expect(sellerSchema.safeParse(seller).success).toBe(true);
  });

  it('gives the same product the same seller ID every time', () => {
    const ids = sellerPersonas.map((persona) => sellerFromProduct(product, persona).sellerId);

    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^seller-[0-9a-f]{16}$/);
  });
});

describe('sellersFromProducts', () => {
  it('makes one seller per product and rotates the personas', () => {
    const other = { ...product, productId: 'c3-mug' };

    const sellers = sellersFromProducts([product, other, product]);

    expect(sellers.map((seller) => seller.name)).toEqual(['Mara', 'Viktor']);
  });
});

describe('sellerForProduct', () => {
  it('always gives the same product the same persona', () => {
    const first = sellerForProduct(product);
    const second = sellerForProduct({ ...product });

    expect(second).toEqual(first);
    expect(sellerPersonas.map((persona) => persona.name)).toContain(first.name);
  });
});
