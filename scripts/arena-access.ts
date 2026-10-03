import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadArenaMailConfig } from '@handshake/config';
import { accessApprovedEmail, accessRejectedEmail, sendEmail } from '@handshake/mail';
import { accountIdForEmail, decideAccess, listPendingAccessRequests } from '@handshake/store';

const usage = 'Usage: pnpm arena:access <table-name> [approve|reject <email>]';
const [tableName, action, email] = process.argv.slice(2);
if (tableName === undefined) {
  console.error(usage);
  process.exit(1);
}

const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };

async function listPending(): Promise<void> {
  const requests = await listPendingAccessRequests(table);
  if (requests.length === 0) console.log('No pending requests.');
  for (const request of requests) {
    console.log(`${request.requestedAt ?? ''}  ${request.email}\n  ${request.reason ?? ''}\n`);
  }
}

async function decide(access: 'approved' | 'rejected', address: string): Promise<void> {
  const mail = await loadArenaMailConfig();
  const account = await decideAccess(table, accountIdForEmail(address), {
    access,
    decidedAt: new Date(),
  });
  if (!account) {
    console.error(`${address} has no pending request.`);
    process.exit(1);
  }
  await sendEmail(mail.zeptoMail, {
    from: mail.from,
    to: account.email,
    ...(access === 'approved' ? accessApprovedEmail() : accessRejectedEmail()),
  });
  console.log(`${account.email} is ${access}. They got an email.`);
}

if (action === undefined) {
  await listPending();
} else if ((action === 'approve' || action === 'reject') && email !== undefined) {
  await decide(action === 'approve' ? 'approved' : 'rejected', email);
} else {
  console.error(usage);
  process.exit(1);
}
