import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Channel3 } from '@channel3/sdk';
import { searchProducts } from '@handshake/channel3';
import { loadConfig, requireChannel3ApiKey } from '@handshake/config';
import { saveSellers } from '@handshake/store';
import { sellersFromProducts } from './sellers';

const [tableName, ...queries] = process.argv.slice(2);
if (tableName === undefined) {
  console.error('Usage: pnpm seed:sellers <table-name> [search query ...]');
  process.exit(1);
}

const defaultQueries = ['stainless steel water bottle', 'wireless headphones', 'running shoes'];

const config = await loadConfig();
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };
const context = {
  products: new Channel3({ apiKey: requireChannel3ApiKey(config) }).products,
  table,
  now: () => new Date(),
};

const results = await Promise.all(
  (queries.length ? queries : defaultQueries).map((query) => searchProducts(context, query)),
);
const sellers = sellersFromProducts(results.flat());

await saveSellers(table, sellers);
console.log(`Seeded ${String(sellers.length)} sellers into ${tableName}`);
