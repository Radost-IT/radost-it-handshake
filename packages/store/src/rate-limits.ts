import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { StoreTable } from './table';

export interface RateLimitWindow {
  /** Who is limited, for example a hashed IP address. Never store it in plain text. */
  subject: string;
  /** Names the window, for example the UTC hour, so each window counts from zero. */
  window: string;
  limit: number;
  /** When DynamoDB may delete the counter, after the window has ended. */
  expiresAt: Date;
}

/**
 * Counts one request against the window and returns false once the limit is
 * reached. The check and the count are one conditional update, so concurrent
 * requests cannot pass the limit together.
 */
export async function takeRateLimitSlot(
  table: StoreTable,
  { subject, window, limit, expiresAt }: RateLimitWindow,
): Promise<boolean> {
  try {
    await table.client.send(
      new UpdateCommand({
        TableName: table.name,
        Key: { pk: `RATE#${subject}`, sk: `WINDOW#${window}` },
        UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
        ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':limit': limit,
          ':ttl': Math.floor(expiresAt.getTime() / 1000),
        },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}
