import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { accountKey, accountSchema, type Account } from './accounts';
import type { StoreTable } from './table';

export interface FixedCodeAccount {
  accountId: string;
  email: string;
  /** From `hashSignInCode`. The code itself is never stored. */
  fixedSignInCodeHash: string;
  createdAt: Date;
}

/**
 * Creates an approved account that signs in with a fixed code, or replaces
 * the code of an existing one. Only the operator can do this, from a script.
 */
export async function saveFixedCodeAccount(
  table: StoreTable,
  input: FixedCodeAccount,
): Promise<Account> {
  const now = input.createdAt.toISOString();
  const { Attributes } = await table.client.send(
    new UpdateCommand({
      TableName: table.name,
      Key: accountKey(input.accountId),
      UpdateExpression:
        'SET id = :id, email = :email, createdAt = if_not_exists(createdAt, :now), #access = :approved, decidedAt = :now, fixedSignInCodeHash = :hash REMOVE gsi1pk, gsi1sk',
      ExpressionAttributeNames: { '#access': 'access' },
      ExpressionAttributeValues: {
        ':id': input.accountId,
        ':email': input.email,
        ':now': now,
        ':approved': 'approved',
        ':hash': input.fixedSignInCodeHash,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return accountSchema.parse(Attributes);
}
