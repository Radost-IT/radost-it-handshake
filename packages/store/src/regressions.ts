import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { regressionCaseSchema, type RegressionCase } from '@handshake/arena';
import type { StoreTable } from './table';

const HALL_OF_FAME = 'HALL_OF_FAME';

const regressionKey = (regression: RegressionCase) => ({
  pk: HALL_OF_FAME,
  sk: `CASE#${regression.foundAt}#${regression.attemptId}`,
});

/** Saving the same case twice keeps the first, so a retried workflow step changes nothing. */
export async function saveRegressionCase(
  table: StoreTable,
  regression: RegressionCase,
): Promise<void> {
  try {
    await table.client.send(
      new PutCommand({
        TableName: table.name,
        Item: { ...regressionKey(regression), ...regression },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return;
    throw error;
  }
}

/** Every case, oldest first. */
export async function listRegressionCases(table: StoreTable): Promise<RegressionCase[]> {
  const cases: RegressionCase[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await table.client.send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': HALL_OF_FAME },
        ExclusiveStartKey: startKey,
      }),
    );
    cases.push(...(page.Items ?? []).map((item) => regressionCaseSchema.parse(item)));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return cases;
}
