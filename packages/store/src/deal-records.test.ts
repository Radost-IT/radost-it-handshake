import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createDeal, money } from '@handshake/core';
import { mandate } from '@handshake/core/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDealRecord, recordPayPalCall, saveEvidence } from './deal-records';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const at = '2026-10-05T12:00:00Z';

beforeEach(() => dynamodb.reset());

describe('getDealRecord', () => {
  it('returns the deal with its records and leaves out access grants and waits', async () => {
    const { deal, event } = createDeal('deal-1', mandate, at);
    const pk = 'DEAL#deal-1';
    dynamodb.on(QueryCommand).resolves({
      Items: [
        { pk, sk: 'ACCESS#abc' },
        { pk, sk: 'BRIEF', goal: 'A water bottle', sellerId: null, buyerId: 'dev-1' },
        { pk, sk: 'CHECKOUT', orderId: 'ORDER-1', approveUrl: 'https://paypal.test/approve' },
        { pk, sk: `EVT#${at}#000000`, ...event },
        { pk, sk: 'META', ...deal },
        {
          pk,
          sk: `PAYPAL#${at}#deal-1:create-order:0`,
          at,
          operation: 'create-order',
          requestId: 'deal-1:create-order:0',
          statusCode: 201,
          debugId: 'debug-1',
        },
        { pk, sk: 'WAIT#checkout', taskToken: 'secret-token' },
      ],
    });

    const record = await getDealRecord(table, 'deal-1');

    expect(record).toEqual({
      deal,
      events: [event],
      brief: { goal: 'A water bottle', sellerId: null, buyerId: 'dev-1' },
      negotiation: null,
      checkout: { orderId: 'ORDER-1', approveUrl: 'https://paypal.test/approve' },
      evidence: null,
      paypalCalls: [
        {
          at,
          operation: 'create-order',
          requestId: 'deal-1:create-order:0',
          statusCode: 201,
          debugId: 'debug-1',
        },
      ],
      webhooks: [],
    });
    expect(JSON.stringify(record)).not.toContain('secret-token');
  });

  it('reads every page of a long deal', async () => {
    const { deal } = createDeal('deal-1', mandate, at);
    dynamodb
      .on(QueryCommand)
      .resolvesOnce({ Items: [], LastEvaluatedKey: { pk: 'DEAL#deal-1', sk: 'EVT#x' } })
      .resolvesOnce({ Items: [{ pk: 'DEAL#deal-1', sk: 'META', ...deal }] });

    await expect(getDealRecord(table, 'deal-1')).resolves.toMatchObject({ deal });
    expect(dynamodb.commandCalls(QueryCommand)).toHaveLength(2);
  });

  it('returns undefined for an unknown deal', async () => {
    dynamodb.on(QueryCommand).resolves({ Items: [] });
    await expect(getDealRecord(table, 'missing')).resolves.toBeUndefined();
  });
});

describe('saveEvidence', () => {
  it('never replaces evidence that was already submitted', async () => {
    dynamodb.on(PutCommand).resolves({});
    await saveEvidence(table, 'deal-1', {
      productId: 'p-1',
      deliveredAt: at,
      invoiceTotal: money('40', 'USD'),
      description: 'Delivered to the front desk',
    });
    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input).toMatchObject({
      Item: { pk: 'DEAL#deal-1', sk: 'EVIDENCE' },
      ConditionExpression: 'attribute_not_exists(pk)',
    });
  });
});

describe('recordPayPalCall', () => {
  it('keys a call without a request ID by its operation', async () => {
    dynamodb.on(PutCommand).resolves({});
    await recordPayPalCall(table, 'deal-1', {
      at,
      operation: 'get-order',
      requestId: null,
      statusCode: 200,
      debugId: null,
    });
    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      sk: `PAYPAL#${at}#get-order`,
    });
  });
});
