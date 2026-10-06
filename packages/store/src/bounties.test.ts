import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { money } from '@handshake/core';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPaidBounty, markBountyPaid, releaseBounty, reserveBounty } from './bounties';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const reservation = { date: '2026-10-28', attemptId: 'attempt-1', amount: money('3.00', 'USD') };

const item = (attemptId: string, value: string) => ({
  pk: 'BOUNTIES#2026-10-28',
  sk: `ATTEMPT#${attemptId}`,
  attemptId,
  amount: money(value, 'USD'),
  status: 'paid',
});

beforeEach(() => dynamodb.reset());

describe('reserveBounty', () => {
  it('reserves the bounty and sums the other bounties of the day', async () => {
    dynamodb.on(PutCommand).resolves({});
    dynamodb
      .on(QueryCommand)
      .resolvesOnce({
        Items: [item('attempt-0', '4.00'), item('attempt-1', '3.00')],
        LastEvaluatedKey: { pk: 'BOUNTIES#2026-10-28', sk: 'ATTEMPT#attempt-1' },
      })
      .resolvesOnce({ Items: [item('attempt-2', '1.50')] });

    const others = await reserveBounty(table, reservation);

    expect(others).toEqual(money('5.50', 'USD'));
    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: 'T',
      Item: {
        pk: 'BOUNTIES#2026-10-28',
        sk: 'ATTEMPT#attempt-1',
        attemptId: 'attempt-1',
        amount: money('3.00', 'USD'),
        status: 'reserved',
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    });
    expect(dynamodb.commandCalls(QueryCommand)[0]?.args[0].input.ConsistentRead).toBe(true);
  });

  it('keeps an earlier reservation of the same attempt', async () => {
    dynamodb
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'exists', $metadata: {} }));
    dynamodb.on(QueryCommand).resolves({ Items: [item('attempt-1', '3.00')] });

    await expect(reserveBounty(table, reservation)).resolves.toEqual(money('0.00', 'USD'));
  });
});

describe('releaseBounty and markBountyPaid', () => {
  it('delete or settle the reservation of the attempt', async () => {
    dynamodb.on(DeleteCommand).resolves({});
    dynamodb.on(UpdateCommand).resolves({});

    await releaseBounty(table, reservation);
    await markBountyPaid(table, reservation, 'BATCH-1');

    const key = { pk: 'BOUNTIES#2026-10-28', sk: 'ATTEMPT#attempt-1' };
    expect(dynamodb.commandCalls(DeleteCommand)[0]?.args[0].input.Key).toEqual(key);
    expect(dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input).toMatchObject({
      Key: key,
      ExpressionAttributeValues: { ':paid': 'paid', ':batch': 'BATCH-1' },
    });
  });
});

describe('getPaidBounty', () => {
  const key = { date: '2026-10-28', attemptId: 'attempt-1' };

  it('returns the amount and payout batch of a paid bounty', async () => {
    dynamodb
      .on(GetCommand)
      .resolves({ Item: { ...item('attempt-1', '3.00'), payoutBatchId: 'B-1' } });

    expect(await getPaidBounty(table, key)).toEqual({
      amount: money('3.00', 'USD'),
      payoutBatchId: 'B-1',
    });
    expect(dynamodb.commandCalls(GetCommand)[0]?.args[0].input.Key).toEqual({
      pk: 'BOUNTIES#2026-10-28',
      sk: 'ATTEMPT#attempt-1',
    });
  });

  it('returns null for a bounty that is only reserved', async () => {
    dynamodb
      .on(GetCommand)
      .resolves({ Item: { ...item('attempt-1', '3.00'), status: 'reserved' } });

    expect(await getPaidBounty(table, key)).toBeNull();
  });

  it('returns null when no bounty was reserved', async () => {
    dynamodb.on(GetCommand).resolves({});

    expect(await getPaidBounty(table, key)).toBeNull();
  });
});
