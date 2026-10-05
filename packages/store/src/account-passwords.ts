import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { accountKey, accountSchema, type Account } from './accounts';
import type { StoreTable } from './table';

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
// An unknown account is checked against this salt too, so the time a wrong
// guess takes does not tell whether the account has a password.
const UNKNOWN_ACCOUNT_SALT = Buffer.alloc(SALT_BYTES);

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Hashes a password with scrypt and a random salt, as `scrypt:<salt>:<key>` in base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);
  return `scrypt:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

function parsePasswordHash(passwordHash: string): { salt: Buffer; key: Buffer } | undefined {
  const [scheme, salt, key] = passwordHash.split(':');
  if (scheme !== 'scrypt' || salt === undefined || key === undefined) return undefined;
  return { salt: Buffer.from(salt, 'base64url'), key: Buffer.from(key, 'base64url') };
}

/** False for a wrong password and for an account without one. */
export async function verifyPassword(
  password: string,
  passwordHash: string | undefined,
): Promise<boolean> {
  const stored = passwordHash === undefined ? undefined : parsePasswordHash(passwordHash);
  const key = await deriveKey(password, stored?.salt ?? UNKNOWN_ACCOUNT_SALT);
  return (
    stored !== undefined && stored.key.length === key.length && timingSafeEqual(stored.key, key)
  );
}

export interface PasswordAccount {
  accountId: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

/**
 * Creates an approved account that signs in with a password, or replaces the
 * password of an existing one. Only the operator can do this, from a script.
 */
export async function savePasswordAccount(
  table: StoreTable,
  input: PasswordAccount,
): Promise<Account> {
  const now = input.createdAt.toISOString();
  const { Attributes } = await table.client.send(
    new UpdateCommand({
      TableName: table.name,
      Key: accountKey(input.accountId),
      UpdateExpression:
        'SET id = :id, email = :email, createdAt = if_not_exists(createdAt, :now), #access = :approved, decidedAt = :now, passwordHash = :hash REMOVE gsi1pk, gsi1sk',
      ExpressionAttributeNames: { '#access': 'access' },
      ExpressionAttributeValues: {
        ':id': input.accountId,
        ':email': input.email,
        ':now': now,
        ':approved': 'approved',
        ':hash': input.passwordHash,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return accountSchema.parse(Attributes);
}
