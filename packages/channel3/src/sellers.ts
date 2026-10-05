import { createHash } from 'node:crypto';
import { percentOfMoney } from '@handshake/core';
import type { Seller } from '@handshake/store';
import type { CatalogProduct } from './products';

/** The product fields a seller is built from. */
export type ListedProduct = Pick<
  CatalogProduct,
  'productId' | 'title' | 'description' | 'categoryPath' | 'listPrice'
>;

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
export function sellerFromProduct(product: ListedProduct, persona: SellerPersona): Seller {
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

/**
 * The seller for a product the buyer agent found on its own. The persona comes
 * from the product ID, so the same product always meets the same seller.
 */
export function sellerForProduct(product: ListedProduct): Seller {
  const index = createHash('sha256').update(product.productId).digest().readUInt32BE(0);
  return sellerFromProduct(product, personaAt(index));
}

function personaAt(index: number): SellerPersona {
  const persona = sellerPersonas[index % sellerPersonas.length];
  if (!persona) throw new Error('No seller personas are defined');
  return persona;
}

/** Drops products found by more than one search and deals out the personas in turn. */
export function sellersFromProducts(products: CatalogProduct[]): Seller[] {
  const unique = [...new Map(products.map((product) => [product.productId, product])).values()];
  return unique.map((product, index) => sellerFromProduct(product, personaAt(index)));
}
