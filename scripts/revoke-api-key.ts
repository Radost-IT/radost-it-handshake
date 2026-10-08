import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { accountDeveloperId, accountIdForEmail, revokeApiKeys } from '@handshake/store';

const usage =
  'Usage: pnpm api-keys:revoke <table-name> <developer-id|account-email> <last-characters>';
const [tableName, owner, lastCharacters] = process.argv.slice(2);
if (tableName === undefined || owner === undefined || lastCharacters === undefined) {
  console.error(usage);
  process.exit(1);
}

const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };
const developerId = owner.includes('@') ? accountDeveloperId(accountIdForEmail(owner)) : owner;
const revoked = await revokeApiKeys(table, developerId, lastCharacters);

if (revoked.length === 0) {
  console.error(`No key of developer ${developerId} ends in ${lastCharacters}.`);
  process.exit(1);
}
for (const key of revoked) console.log(`Revoked ${key.name}, ending ${key.lastCharacters}.`);
