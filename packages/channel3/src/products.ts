import {
  currencyCodes,
  InvalidMoneyError,
  moneyFromNumber,
  moneySchema,
  type Money,
} from '@handshake/core';
import { z } from 'zod';

/** A product we can negotiate over: one in-stock offer with a price we can pay in. */
export interface CatalogProduct {
  productId: string;
  title: string;
  description: string;
  brand: string | null;
  /** Category slugs from the root down, as the deal terms store them. */
  categoryPath: string[];
  listPrice: Money;
  merchantDomain: string;
  url: string;
}

export const catalogProductSchema = z.object({
  productId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  brand: z.string().nullable(),
  categoryPath: z.array(z.string().min(1)),
  listPrice: moneySchema,
  merchantDomain: z.string().min(1),
  url: z.url(),
});

// Only the fields we use. Everything else Channel3 sends is ignored.
const channel3ProductSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  brands: z.array(z.object({ name: z.string() })).optional(),
  category: z
    .object({ slug: z.string(), path: z.array(z.object({ slug: z.string() })).optional() })
    .nullish(),
  key_features: z.array(z.string()).nullish(),
  offers: z
    .array(
      z.object({
        url: z.url(),
        domain: z.string().min(1),
        price: z.object({ price: z.number(), currency: z.string() }),
        availability: z.string(),
      }),
    )
    .optional(),
});

type Channel3Offer = NonNullable<z.infer<typeof channel3ProductSchema>['offers']>[number];

/**
 * Maps a Channel3 product to a catalog product, or null when it has no
 * in-stock offer in a currency PayPal escrow supports. Throws a ZodError when
 * the product is malformed, since that means the API changed under us.
 */
export function toCatalogProduct(raw: unknown): CatalogProduct | null {
  const product = channel3ProductSchema.parse(raw);
  const offer = product.offers?.find(isPayableOffer);
  if (!offer) return null;
  const currency = z.enum(currencyCodes).parse(offer.price.currency);
  const features = product.key_features ?? [];
  return {
    productId: product.id,
    title: product.title,
    description: [product.description ?? '', ...features.map((feature) => `- ${feature}`)]
      .join('\n')
      .trim(),
    brand: product.brands?.[0]?.name ?? null,
    categoryPath: categoryPath(product.category),
    listPrice: moneyFromNumber(offer.price.price, currency),
    merchantDomain: offer.domain,
    url: offer.url,
  };
}

function isPayableOffer(offer: Channel3Offer): boolean {
  if (offer.availability !== 'InStock') return false;
  const currency = z.enum(currencyCodes).safeParse(offer.price.currency);
  if (!currency.success) return false;
  try {
    moneyFromNumber(offer.price.price, currency.data);
    return true;
  } catch (error) {
    if (error instanceof InvalidMoneyError) return false;
    throw error;
  }
}

function categoryPath(category: z.infer<typeof channel3ProductSchema>['category']): string[] {
  if (!category) return [];
  const path = category.path?.map((entry) => entry.slug) ?? [];
  return path.length > 0 ? path : [category.slug];
}
