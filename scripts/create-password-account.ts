import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { accountIdForEmail, hashPassword, savePasswordAccount } from '@handshake/store';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const usage = 'Usage: pnpm accounts:password <table-name> <email>';
const [tableName, emailArgument] = process.argv.slice(2);
const email = z.email().safeParse(emailArgument?.trim().toLowerCase());
if (tableName === undefined || !email.success) {
  console.error(usage);
  process.exit(1);
}

const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };
const password = randomBytes(18).toString('base64url');
const account = await savePasswordAccount(table, {
  accountId: accountIdForEmail(email.data),
  email: email.data,
  passwordHash: await hashPassword(password),
  createdAt: new Date(),
});

console.log(
  `${account.email} is approved and signs in with this password. It is shown only once:\n${password}`,
);
