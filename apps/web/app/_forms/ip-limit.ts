import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { takeRateLimitSlot, type StoreTable } from '@handshake/store';
import { createHash } from 'node:crypto';
import { MAX_FORM_ATTEMPTS, type FormName } from './attempt-limit';

const HOUR_MS = 60 * 60 * 1000;

const tableName = process.env.TABLE_NAME;
const table: StoreTable | null = tableName
  ? { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName }
  : null;

/**
 * Counts a submission against the IP's hourly limit in DynamoDB, which every
 * Lambda instance shares, unlike the cookie and the in-memory counter. Local
 * development has no table, so only those two apply there.
 */
export async function takeFormIpSlot(form: FormName, ip: string, now: number): Promise<boolean> {
  if (table === null) return true;
  const hour = Math.floor(now / HOUR_MS) * HOUR_MS;
  return takeRateLimitSlot(table, {
    subject: formIpSubject(form, ip),
    window: new Date(hour).toISOString().slice(0, 13),
    limit: MAX_FORM_ATTEMPTS,
    expiresAt: new Date(hour + 2 * HOUR_MS),
  });
}

export const formIpSubject = (form: FormName, ip: string) =>
  `form-${form}#${createHash('sha256').update(ip).digest('hex')}`;

export const minutesToNextHour = (now: number) => Math.ceil((HOUR_MS - (now % HOUR_MS)) / 60_000);
