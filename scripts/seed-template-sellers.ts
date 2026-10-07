import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { dealTemplates } from '@handshake/arena';
import { saveSellers, type Seller } from '@handshake/store';

const [tableName] = process.argv.slice(2);
if (tableName === undefined) {
  console.error('Usage: pnpm seed:template-sellers <table-name>');
  process.exit(1);
}

// Same IDs the arena gives its template sellers, so one name means one seller everywhere.
const sellers: Seller[] = dealTemplates.map((template) => ({
  sellerId: `arena-${template.id}`,
  name: template.seller.name,
  persona: template.seller.persona,
  floorPrice: template.seller.floorPrice,
  listing: template.listing,
}));

const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };
await saveSellers(table, sellers);
for (const { sellerId, listing } of sellers) {
  console.log(
    `${sellerId}  ${listing.title}  ${listing.listPrice.value} ${listing.listPrice.currency}`,
  );
}
