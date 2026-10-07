import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { accountIdForEmail, hashSignInCode, saveFixedCodeAccount } from '@handshake/store';
import { randomInt } from 'node:crypto';
import { judgeEmails } from './judges';

const usage = 'Usage: pnpm accounts:judges <table-name> <email-domain>';
const [tableName, domain] = process.argv.slice(2);
const emails = judgeEmails(domain);
if (tableName === undefined || emails === undefined) {
  console.error(usage);
  process.exit(1);
}

const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };
const createdAt = new Date();
const judges = await Promise.all(
  emails.map(async (email) => {
    const accountId = accountIdForEmail(email);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await saveFixedCodeAccount(table, {
      accountId,
      email,
      fixedSignInCodeHash: hashSignInCode(accountId, code),
      createdAt,
    });
    return `${email}  ${code}`;
  }),
);

console.log(
  `These accounts are approved and sign in with a fixed code instead of an email. The codes are shown only once:\n${judges.join('\n')}`,
);
