import { money } from '@handshake/core';
import { describe, expect, it } from 'vitest';
import { channel3Bottle } from './fixtures';
import { toCatalogProduct } from './products';

describe('toCatalogProduct', () => {
  it('takes the first in-stock offer and keeps the key features in the description', () => {
    expect(toCatalogProduct(channel3Bottle)).toEqual({
      productId: 'c3-bottle',
      title: 'Steel water bottle',
      description: 'Keeps drinks cold.\n- 750 ml\n- Lid included',
      brand: 'Hydra',
      categoryPath: ['home', 'water-bottles'],
      listPrice: money('24.99', 'USD'),
      merchantDomain: 'store.example',
      url: 'https://store.example/bottle',
    });
  });

  it('skips offers in a currency we cannot pay in, or with an inexact price', () => {
    const offers = [
      { ...channel3Bottle.offers[1], price: { price: 24.99, currency: 'CHF' } },
      { ...channel3Bottle.offers[1], price: { price: 24.999, currency: 'USD' } },
    ];

    expect(toCatalogProduct({ ...channel3Bottle, offers })).toBeNull();
  });

  it('cuts long titles and descriptions so a listing cannot flood the prompts', () => {
    const product = toCatalogProduct({
      ...channel3Bottle,
      title: 't'.repeat(1000),
      description: 'd'.repeat(10_000),
    });

    expect(product?.title).toHaveLength(300);
    expect(product?.description).toHaveLength(4000);
  });

  it('returns null for a product with no offers', () => {
    expect(toCatalogProduct({ id: 'c3-x', title: 'Lamp' })).toBeNull();
  });

  it('falls back to the category slug when there is no path', () => {
    const category = { slug: 'lamps', title: 'Lamps', has_children: false };

    expect(toCatalogProduct({ ...channel3Bottle, category })?.categoryPath).toEqual(['lamps']);
  });

  it('throws on a malformed product', () => {
    expect(() => toCatalogProduct({ id: 42 })).toThrow();
  });
});
