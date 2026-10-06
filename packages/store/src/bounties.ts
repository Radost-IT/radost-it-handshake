import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { addMoney, money, moneySchema, type Money } from '@handshake/core';
import { z } from 'zod';
import type { StoreTable } from './table';

const dayPartition = (date: string) => `BOUNTIES#${date}`;
const bountyKey = (date: string, attemptId: string) => ({
  pk: dayPartition(date),
  sk: `ATTEMPT#${attemptId}`,
});

const bountyItemSchema = z.object({ attemptId: z.string().min(1), amount: moneySchema });

export interface BountyReservation {
  /** UTC day the bounty counts against. */
  date: string;
  attemptId: string;
  amount: Money;
}

/**
 * Holds a bounty against the day's budget before it is paid, and returns what
 * every other bounty of that day holds or has paid. Two payouts racing for
 * the last of the budget both see each other, so at worst both are refused
 * and the budget is never passed. Reserving the same attempt again keeps the
 * first reservation, so a retried step sees the same total.
 */
export async function reserveBounty(
  table: StoreTable,
  reservation: BountyReservation,
): Promise<Money> {
  const { date, attemptId, amount } = reservation;
  try {
    await table.client.send(
      new PutCommand({
        TableName: table.name,
        Item: { ...bountyKey(date, attemptId), attemptId, amount, status: 'reserved' },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
  }

  let others = money('0', amount.currency);
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await table.client.send(
      new QueryCommand({
        TableName: table.name,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': dayPartition(date) },
        ConsistentRead: true,
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of page.Items ?? []) {
      const bounty = bountyItemSchema.parse(item);
      if (bounty.attemptId !== attemptId) others = addMoney(others, bounty.amount);
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return others;
}

/** Gives a refused bounty's share of the budget back. */
export async function releaseBounty(
  table: StoreTable,
  reservation: Pick<BountyReservation, 'date' | 'attemptId'>,
): Promise<void> {
  await table.client.send(
    new DeleteCommand({
      TableName: table.name,
      Key: bountyKey(reservation.date, reservation.attemptId),
    }),
  );
}

export async function markBountyPaid(
  table: StoreTable,
  reservation: Pick<BountyReservation, 'date' | 'attemptId'>,
  payoutBatchId: string,
): Promise<void> {
  await table.client.send(
    new UpdateCommand({
      TableName: table.name,
      Key: bountyKey(reservation.date, reservation.attemptId),
      UpdateExpression: 'SET #status = :paid, payoutBatchId = :batch',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':paid': 'paid', ':batch': payoutBatchId },
    }),
  );
}

const paidBountySchema = z.object({
  status: z.literal('paid'),
  amount: moneySchema,
  payoutBatchId: z.string().min(1),
});

export interface PaidBounty {
  amount: Money;
  payoutBatchId: string;
}

/** The bounty PayPal paid for an attempt; null while it is only reserved, or when none was paid. */
export async function getPaidBounty(
  table: StoreTable,
  reservation: Pick<BountyReservation, 'date' | 'attemptId'>,
): Promise<PaidBounty | null> {
  const { Item } = await table.client.send(
    new GetCommand({
      TableName: table.name,
      Key: bountyKey(reservation.date, reservation.attemptId),
    }),
  );
  if (Item?.status !== 'paid') return null;
  const { amount, payoutBatchId } = paidBountySchema.parse(Item);
  return { amount, payoutBatchId };
}
