import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { accountDeveloperId, accountIdForEmail, issueApiKey } from '@handshake/store';
import { randomUUID } from 'node:crypto';

const usage = 'Usage: pnpm api-keys:create <table-name> <name> [account-email]';
const [tableName, name, email] = process.argv.slice(2);
if (tableName === undefined || name === undefined) {
  console.error(usage);
  process.exit(1);
}

const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };
// A key issued to an account shares its deals and merchant settings; without one it stands alone.
const developerId = email ? accountDeveloperId(accountIdForEmail(email)) : randomUUID();
const apiKey = await issueApiKey(table, {
  developerId,
  name,
  createdAt: new Date().toISOString(),
});

console.log(`API key for ${name} (developer ${developerId}). It is shown only once:\n${apiKey}`);
