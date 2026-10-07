import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { dealTemplates } from '@handshake/arena';
import {
  accountDeveloperId,
  accountIdForEmail,
  issueApiKey,
  listApiKeys,
  saveMerchant,
} from '@handshake/store';
import { z } from 'zod';
import { judgeEmails } from './judges';

const usage = 'Usage: pnpm merchants:demo <table-name> <payout-email> <judge-email-domain>';
const [tableName, payoutEmail, domain] = process.argv.slice(2);
const emails = judgeEmails(domain);
const payout = z.email().safeParse(payoutEmail);
if (tableName === undefined || emails === undefined || !payout.success) {
  console.error(usage);
  process.exit(1);
}

const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };
const createdAt = new Date().toISOString();
// Judges see one demo business that runs the five seller agents from `pnpm seed:template-sellers`.
const keys = await Promise.all(
  emails.map(async (email) => {
    const accountId = accountIdForEmail(email);
    const developerId = accountDeveloperId(accountId);
    const [, existingKeys] = await Promise.all([
      saveMerchant(table, {
        accountId,
        businessName: 'Arena Outfitters (demo)',
        website: 'https://handshake.radostit.com',
        payoutEmail: payout.data,
        products:
          'Hiking backpacks, trail running shoes, headphones, keyboards and coffee grinders',
        sellerIds: dealTemplates.map((template) => `arena-${template.id}`),
        createdAt,
      }),
      listApiKeys(table, developerId),
    ]);
    if (existingKeys.length > 0)
      return `${email}  keeps its key ending ${existingKeys[0]?.lastCharacters ?? ''}`;
    const apiKey = await issueApiKey(table, { developerId, name: 'Demo merchant key', createdAt });
    return `${email}  ${apiKey}`;
  }),
);

console.log(
  `Saved the demo merchant for the judge accounts. New keys are shown only once:\n${keys.join('\n')}`,
);
