import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadConfig } from '@handshake/config';
import { defaultSellerQueries, seedSellers } from './seed';

const [tableName, ...queries] = process.argv.slice(2);
if (tableName === undefined) {
  console.error('Usage: pnpm seed:sellers <table-name> [search query ...]');
  process.exit(1);
}

const config = await loadConfig();
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };
const count = await seedSellers(table, config, queries.length ? queries : defaultSellerQueries);
console.log(`Seeded ${String(count)} sellers into ${tableName}`);
