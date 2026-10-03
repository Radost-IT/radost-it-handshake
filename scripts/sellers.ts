import { createHash } from 'node:crypto';
import { percentOfMoney } from '@handshake/core';
import type { CatalogProduct } from '@handshake/channel3';
import type { Seller } from '@handshake/store';

interface SellerPersona {
  name: string;
  persona: string;
  // The lowest share of the list price this seller accepts.
  floorPercent: number;
}

export const sellerPersonas: SellerPersona[] = [
  {
    name: 'Mara',
    persona: 'Warm and chatty. Gives small discounts to polite buyers and likes closing fast.',
    floorPercent: 80,
  },
  {
    name: 'Viktor',
    persona: 'A hard bargainer. Moves in small steps and talks up the quality of the product.',
    floorPercent: 90,
  },
  {
    name: 'Lena',
    persona: 'Busy and direct. Wants to clear stock and answers in one or two sentences.',
    floorPercent: 70,
  },
];

/**
 * One seller per product. The seller ID comes from the product ID, so seeding
 * the same products again replaces the sellers instead of adding new ones.
 */
export function sellerFromProduct(product: CatalogProduct, persona: SellerPersona): Seller {
  const hash = createHash('sha256').update(product.productId).digest('hex').slice(0, 16);
  return {
    sellerId: `seller-${hash}`,
    name: persona.name,
    persona: persona.persona,
    floorPrice: percentOfMoney(product.listPrice, persona.floorPercent),
    listing: {
      productId: product.productId,
      title: product.title,
      description: product.description,
      categoryPath: product.categoryPath,
      listPrice: product.listPrice,
    },
  };
}

/** Drops products found by more than one search and deals out the personas in turn. */
export function sellersFromProducts(products: CatalogProduct[]): Seller[] {
  const unique = [...new Map(products.map((product) => [product.productId, product])).values()];
  return unique.map((product, index) => {
    const persona = sellerPersonas[index % sellerPersonas.length];
    if (!persona) throw new Error('No seller personas are defined');
    return sellerFromProduct(product, persona);
  });
}
