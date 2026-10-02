import { DynamoDBClient, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { createDeal, transitionDeal } from '@handshake/core';
import { mandate, verifyingDeal } from '@handshake/core/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConcurrentDealUpdateError, getDeal, saveDeal } from './deals';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

beforeEach(() => dynamodb.reset());

function sentTransaction(): NonNullable<TransactWriteCommandInput['TransactItems']> {
  const [call] = dynamodb.commandCalls(TransactWriteCommand);
  return call?.args[0].input.TransactItems ?? [];
}

describe('getDeal', () => {
  it('parses the stored deal', async () => {
    const deal = verifyingDeal();
    dynamodb
      .on(GetCommand, { Key: { pk: 'DEAL#deal-1', sk: 'META' } })
      .resolves({ Item: { pk: 'DEAL#deal-1', sk: 'META', ...deal } });

    await expect(getDeal(table, 'deal-1')).resolves.toEqual(deal);
  });

  it('returns undefined for an unknown deal', async () => {
    dynamodb.on(GetCommand).resolves({});
    await expect(getDeal(table, 'missing')).resolves.toBeUndefined();
  });

  it('rejects a stored item that is not a deal', async () => {
    dynamodb.on(GetCommand).resolves({ Item: { pk: 'DEAL#deal-1', sk: 'META', state: 'PAID' } });
    await expect(getDeal(table, 'deal-1')).rejects.toThrow();
  });
});

describe('saveDeal', () => {
  const at = '2026-10-02T12:00:00Z';

  it('creates a new deal only if none exists', async () => {
    dynamodb.on(TransactWriteCommand).resolves({});
    const { deal, event } = createDeal('deal-1', mandate, at);

    await saveDeal(table, deal, [event]);

    const [writeDeal, writeEvent] = sentTransaction();
    expect(writeDeal?.Put).toMatchObject({
      Item: { pk: 'DEAL#deal-1', sk: 'META', state: 'DRAFT' },
      ConditionExpression: 'attribute_not_exists(pk)',
    });
    expect(writeEvent?.Put?.Item).toMatchObject({
      pk: 'DEAL#deal-1',
      sk: `EVT#${at}#000001`,
      type: 'CREATED',
    });
  });

  it('updates a deal only if no one saved it since it was read', async () => {
    dynamodb.on(TransactWriteCommand).resolves({});
    const stored = verifyingDeal();
    const { deal, event } = transitionDeal(stored, { to: 'ESCALATED' }, at, 'unsure');

    await saveDeal(table, deal, [event]);

    expect(sentTransaction()[0]?.Put).toMatchObject({
      ConditionExpression: 'eventCount = :previousCount',
      ExpressionAttributeValues: { ':previousCount': stored.eventCount },
    });
  });

  it('reports a conflicting writer', async () => {
    dynamodb.on(TransactWriteCommand).rejects(
      new TransactionCanceledException({
        message: 'Transaction cancelled',
        $metadata: {},
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
      }),
    );
    const { deal, event } = transitionDeal(verifyingDeal(), { to: 'ESCALATED' }, at, 'unsure');

    await expect(saveDeal(table, deal, [event])).rejects.toBeInstanceOf(ConcurrentDealUpdateError);
  });

  it('refuses events that do not lead to the deal', async () => {
    const { deal } = transitionDeal(verifyingDeal(), { to: 'ESCALATED' }, at, 'unsure');
    await expect(saveDeal(table, deal, [])).rejects.toBeInstanceOf(RangeError);
    expect(dynamodb.commandCalls(TransactWriteCommand)).toHaveLength(0);
  });
});
