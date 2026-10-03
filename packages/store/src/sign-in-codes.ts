import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type { StoreTable } from './table';

const signInCodeKey = (accountId: string) => ({ pk: `SIGNIN#${accountId}`, sk: 'META' });

// Six digits are a million guesses; five wrong tries per code keep guessing hopeless.
const MAX_FAILED_CHECKS = 5;

const epochSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export interface SignInCode {
  accountId: string;
  /** SHA-256 of the emailed code. The code itself is never stored. */
  codeHash: string;
  expiresAt: Date;
}

/** Stores a new code for the email. It replaces any earlier code and its failed tries. */
export async function saveSignInCode(table: StoreTable, code: SignInCode): Promise<void> {
  await table.client.send(
    new PutCommand({
      TableName: table.name,
      Item: {
        ...signInCodeKey(code.accountId),
        codeHash: code.codeHash,
        failedChecks: 0,
        ttl: epochSeconds(code.expiresAt),
      },
    }),
  );
}

const storedCodeSchema = z.object({
  codeHash: z.string().min(1),
  failedChecks: z.number().int().nonnegative(),
  ttl: z.number().int(),
});

export type SignInCodeCheck = 'valid' | 'wrong' | 'expired' | 'locked';

/**
 * Checks a code the person typed. A valid code is deleted so it works once;
 * a wrong one counts against the code, which locks after five wrong tries.
 */
export async function checkSignInCode(
  table: StoreTable,
  attempt: { accountId: string; codeHash: string; now: Date },
): Promise<SignInCodeCheck> {
  const Key = signInCodeKey(attempt.accountId);
  const { Item } = await table.client.send(new GetCommand({ TableName: table.name, Key }));
  if (!Item) return 'expired';
  const stored = storedCodeSchema.parse(Item);
  // DynamoDB deletes expired items only eventually, so expiry is checked here too.
  if (stored.ttl <= epochSeconds(attempt.now)) return 'expired';
  if (stored.failedChecks >= MAX_FAILED_CHECKS) return 'locked';

  if (stored.codeHash !== attempt.codeHash) {
    await table.client.send(
      new UpdateCommand({
        TableName: table.name,
        Key,
        UpdateExpression: 'ADD failedChecks :one',
        ExpressionAttributeValues: { ':one': 1 },
      }),
    );
    return 'wrong';
  }
  // The condition makes two requests with the same code race for one sign-in.
  try {
    await table.client.send(
      new DeleteCommand({
        TableName: table.name,
        Key,
        ConditionExpression: 'codeHash = :hash',
        ExpressionAttributeValues: { ':hash': attempt.codeHash },
      }),
    );
    return 'valid';
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return 'expired';
    throw error;
  }
}
