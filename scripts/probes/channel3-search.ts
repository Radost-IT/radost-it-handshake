import { Channel3 } from '@channel3/sdk';
import { loadConfig } from '@handshake/config';

const query = process.argv[2] ?? 'stainless steel water bottle';

const config = await loadConfig();
const client = new Channel3({ apiKey: config.channel3.apiKey });

const page = await client.products.search({ query, limit: 5 });
const products = page.response.products;

console.log(`Channel3 search "${query}": ${products.length} products`);
for (const product of products) {
  const offer = product.offers?.[0];
  const price = offer ? `${offer.price.price} ${offer.price.currency}` : 'no offer';
  console.log(`- ${product.title} (${price})`);
}
