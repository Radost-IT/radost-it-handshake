import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { createDeal, money, transitionDeal, type Deal } from '@handshake/core';
import {
  authorizingDeal,
  buildEscrow,
  buildTerms,
  mandate,
  signBoth,
  verifyingDeal,
} from '@handshake/core/testing';
import { lastSent, stubPayPalClient, type StubResponse } from '@handshake/paypal/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DealNotFoundError,
  runLifecycleTask,
  type LifecycleContext,
  type LifecycleTask,
} from './lifecycle';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  dynamodb.reset();
  dynamodb.on(TransactWriteCommand).resolves({});
  dynamodb.on(PutCommand).resolves({});
});

function storeDeal(deal: Deal): void {
  dynamodb.on(GetCommand).resolves({ Item: { pk: `DEAL#${deal.id}`, sk: 'META', ...deal } });
}

async function run(task: LifecycleTask, now: string, responses: StubResponse[] = []) {
  const { client, sent } = stubPayPalClient(responses);
  const context: LifecycleContext = {
    paypal: client,
    table,
    webUrl: 'https://handshake.example',
    honorPeriodMs: 72 * HOUR_MS,
    now: () => now,
  };
  const result = await runLifecycleTask(context, task);
  return { result, sent };
}

function savedStates(): string[] {
  return dynamodb.commandCalls(TransactWriteCommand).map((call) => {
    const item = call.args[0].input.TransactItems?.[0]?.Put?.Item;
    return String(item?.state);
  });
}

function awaitingDeliveryDeal(): Deal {
  const at = '2026-10-02T12:00:00Z';
  const inEscrow = transitionDeal(
    authorizingDeal(),
    { to: 'IN_ESCROW', escrow: buildEscrow() },
    at,
    'authorized',
  ).deal;
  return transitionDeal(inEscrow, { to: 'AWAITING_DELIVERY' }, at, 'waiting').deal;
}

function escalatedDeal(): Deal {
  return transitionDeal(verifyingDeal(), { to: 'ESCALATED' }, '2026-10-04T00:00:00Z', 'unsure')
    .deal;
}

function authorizationResponse(id: string, status: string, createdAt: string): StubResponse {
  return {
    status: 201,
    body: {
      id,
      status,
      amount: { currency_code: 'USD', value: '42.50' },
      create_time: createdAt,
      expiration_time: '2026-11-04T00:00:00Z',
    },
  };
}

describe('StartCheckout', () => {
  it('creates the PayPal order and stores its approval link and the task token', async () => {
    storeDeal(authorizingDeal());

    const { result, sent } = await run(
      { task: 'StartCheckout', dealId: 'deal-1', taskToken: 'token-1' },
      '2026-10-02T12:00:00Z',
      [
        {
          status: 200,
          body: {
            id: 'ORDER-1',
            status: 'PAYER_ACTION_REQUIRED',
            links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow' }],
          },
        },
      ],
    );

    expect(result).toEqual({ state: 'AUTHORIZING' });
    expect(lastSent(sent).body).toMatchObject({
      intent: 'AUTHORIZE',
      payment_source: {
        paypal: {
          experience_context: {
            return_url: 'https://handshake.example/deals/deal-1?checkout=approved',
            cancel_url: 'https://handshake.example/deals/deal-1?checkout=cancelled',
          },
        },
      },
    });
    const items = dynamodb.commandCalls(PutCommand).map((call) => call.args[0].input.Item);
    expect(items).toContainEqual({
      pk: 'DEAL#deal-1',
      sk: 'CHECKOUT',
      orderId: 'ORDER-1',
      approveUrl: 'https://www.sandbox.paypal.com/checkoutnow',
    });
    expect(items).toContainEqual(
      expect.objectContaining({ sk: 'WAIT#checkout', taskToken: 'token-1' }),
    );
  });
});

describe('AuthorizePayment', () => {
  it('holds the money and waits for delivery', async () => {
    storeDeal(authorizingDeal());

    const { result } = await run(
      { task: 'AuthorizePayment', dealId: 'deal-1', orderId: 'ORDER-1' },
      '2026-10-02T12:05:00Z',
      [
        {
          status: 201,
          body: {
            id: 'ORDER-1',
            status: 'COMPLETED',
            purchase_units: [
              {
                payments: {
                  authorizations: [
                    authorizationResponse('auth-1', 'CREATED', '2026-10-02T12:05:00Z').body,
                  ],
                },
              },
            ],
          },
        },
      ],
    );

    expect(result).toEqual({ state: 'AWAITING_DELIVERY' });
    expect(savedStates()).toEqual(['AWAITING_DELIVERY']);
  });

  it('only reports the state of a deal that has moved on', async () => {
    storeDeal(awaitingDeliveryDeal());

    const { result, sent } = await run(
      { task: 'AuthorizePayment', dealId: 'deal-1', orderId: 'ORDER-1' },
      '2026-10-02T12:05:00Z',
    );

    expect(result).toEqual({ state: 'AWAITING_DELIVERY' });
    expect(sent).toHaveLength(0);
    expect(savedStates()).toEqual([]);
  });
});

function awaitingApprovalDeal(): Deal {
  const at = '2026-10-02T12:00:00Z';
  let { deal } = createDeal('deal-1', mandate, at);
  deal = transitionDeal(deal, { to: 'NEGOTIATING' }, at, 'start').deal;
  deal = transitionDeal(
    deal,
    { to: 'AGREED', contract: signBoth(buildTerms()) },
    at,
    'agreed',
  ).deal;
  return transitionDeal(deal, { to: 'AWAITING_HUMAN_APPROVAL' }, at, 'needs approval').deal;
}

describe('ReadState', () => {
  it('reports where the deal is so the state machine can pick its first step', async () => {
    storeDeal(awaitingApprovalDeal());

    const { result } = await run({ task: 'ReadState', dealId: 'deal-1' }, '2026-10-02T12:00:00Z');

    expect(result).toEqual({ state: 'AWAITING_HUMAN_APPROVAL' });
    expect(savedStates()).toEqual([]);
  });
});

describe('DecidePurchase', () => {
  it('moves on to checkout once the buyer approves the price', async () => {
    storeDeal(awaitingApprovalDeal());

    const { result } = await run(
      { task: 'DecidePurchase', dealId: 'deal-1', decision: { approved: true } },
      '2026-10-02T12:10:00Z',
    );

    expect(result).toEqual({ state: 'AUTHORIZING' });
    expect(savedStates()).toEqual(['AUTHORIZING']);
  });

  it('cancels the deal when the buyer declines the price', async () => {
    storeDeal(awaitingApprovalDeal());

    const { result } = await run(
      { task: 'DecidePurchase', dealId: 'deal-1', decision: { approved: false } },
      '2026-10-02T12:10:00Z',
    );

    expect(result).toEqual({ state: 'CANCELLED' });
  });

  it('keeps waiting when the decision is not valid', async () => {
    storeDeal(awaitingApprovalDeal());

    const { result } = await run(
      { task: 'DecidePurchase', dealId: 'deal-1', decision: { approved: 'yes' } },
      '2026-10-02T12:10:00Z',
    );

    expect(result).toMatchObject({ state: 'AWAITING_HUMAN_APPROVAL' });
    expect(result.refusal).toContain('The decision is not valid');
    expect(savedStates()).toEqual([]);
  });

  it('only reports the state of a deal that is not waiting for approval', async () => {
    storeDeal(authorizingDeal());

    const { result } = await run(
      { task: 'DecidePurchase', dealId: 'deal-1', decision: { approved: false } },
      '2026-10-02T12:10:00Z',
    );

    expect(result).toEqual({ state: 'AUTHORIZING' });
    expect(savedStates()).toEqual([]);
  });
});

describe('CancelPurchase', () => {
  it('cancels a deal whose buyer never answered', async () => {
    storeDeal(awaitingApprovalDeal());

    const { result } = await run(
      { task: 'CancelPurchase', dealId: 'deal-1', reason: 'No answer in time' },
      '2026-10-03T12:00:00Z',
    );

    expect(result).toEqual({ state: 'CANCELLED' });
  });
});

describe('CancelCheckout', () => {
  it('cancels a deal whose buyer never approved the payment', async () => {
    storeDeal(authorizingDeal());

    const { result } = await run(
      { task: 'CancelCheckout', dealId: 'deal-1', reason: 'Checkout timed out' },
      '2026-10-02T13:00:00Z',
    );

    expect(result).toEqual({ state: 'CANCELLED' });
    expect(savedStates()).toEqual(['CANCELLED']);
  });
});

describe('CheckDeliveryTimer', () => {
  it('waits until the honor period ends', async () => {
    storeDeal(awaitingDeliveryDeal());

    const { result } = await run(
      { task: 'CheckDeliveryTimer', dealId: 'deal-1' },
      '2026-10-03T12:00:00Z',
    );

    expect(result).toEqual({ state: 'AWAITING_DELIVERY', waitSeconds: 48 * 60 * 60 });
  });

  it('renews the hold after the honor period and then waits again', async () => {
    storeDeal(awaitingDeliveryDeal());

    const { result, sent } = await run(
      { task: 'CheckDeliveryTimer', dealId: 'deal-1' },
      '2026-10-06T00:00:00Z',
      [authorizationResponse('auth-2', 'CREATED', '2026-10-06T00:00:00Z')],
    );

    expect(lastSent(sent).url).toContain('/v2/payments/authorizations/auth-1/reauthorize');
    expect(savedStates()).toEqual(['AWAITING_DELIVERY']);
    expect(result).toEqual({ state: 'AWAITING_DELIVERY', waitSeconds: 72 * 60 * 60 });
  });

  it('voids the hold once the delivery deadline has passed', async () => {
    storeDeal(awaitingDeliveryDeal());

    const { result, sent } = await run(
      { task: 'CheckDeliveryTimer', dealId: 'deal-1' },
      '2026-10-11T00:00:00Z',
      [{ status: 200, body: { id: 'auth-1', status: 'VOIDED' } }],
    );

    expect(lastSent(sent).url).toContain('/v2/payments/authorizations/auth-1/void');
    expect(result).toEqual({ state: 'REFUSED' });
  });
});

describe('Settle', () => {
  const capture = {
    action: 'CAPTURE',
    amount: money('42.50', 'USD'),
    evidence: { productId: 'prod-1', deliveredAt: '2026-10-04T09:00:00Z' },
    criteria: [
      { criterionId: 'c1', met: true, confidence: 0.95, rationale: 'Label says 750 ml' },
      { criterionId: 'c2', met: true, confidence: 0.9, rationale: 'Lid is in the photo' },
    ],
    reason: 'Delivery matches the contract',
  };

  it('captures the payment the verifier approved', async () => {
    storeDeal(verifyingDeal());

    const { result } = await run(
      { task: 'Settle', dealId: 'deal-1', proposer: 'verifier', proposal: capture },
      '2026-10-04T10:00:00Z',
      [
        {
          status: 201,
          body: {
            id: 'capture-1',
            status: 'COMPLETED',
            amount: { currency_code: 'USD', value: '42.50' },
          },
        },
      ],
    );

    expect(result).toEqual({ state: 'SETTLED' });
  });

  it('escalates when the verifier returns something that is not a proposal', async () => {
    storeDeal(verifyingDeal());

    const { result, sent } = await run(
      { task: 'Settle', dealId: 'deal-1', proposer: 'verifier', proposal: { action: 'PAY_ME' } },
      '2026-10-04T10:00:00Z',
    );

    expect(result).toEqual({ state: 'ESCALATED' });
    expect(sent).toHaveLength(0);
  });

  it('escalates when policy refuses the verifier', async () => {
    storeDeal(verifyingDeal());

    const { result, sent } = await run(
      {
        task: 'Settle',
        dealId: 'deal-1',
        proposer: 'verifier',
        proposal: { ...capture, amount: money('4250.00', 'USD') },
      },
      '2026-10-04T10:00:00Z',
    );

    expect(result).toEqual({ state: 'ESCALATED' });
    expect(sent).toHaveLength(0);
  });

  it('keeps waiting for a person whose decision policy refuses', async () => {
    storeDeal(escalatedDeal());

    const { result, sent } = await run(
      {
        task: 'Settle',
        dealId: 'deal-1',
        proposer: 'human',
        proposal: { ...capture, amount: money('4250.00', 'USD') },
      },
      '2026-10-04T10:00:00Z',
    );

    expect(result.state).toBe('ESCALATED');
    expect(result.refusal).toContain('differs from the contract price');
    expect(sent).toHaveLength(0);
    expect(savedStates()).toEqual([]);
  });
});

describe('ConfirmCapture', () => {
  function capturingDeal(): Deal {
    return transitionDeal(verifyingDeal(), { to: 'CAPTURING' }, '2026-10-04T10:00:00Z', 'pending')
      .deal;
  }

  const capture = (status: string, value = '42.50') => ({
    id: 'capture-1',
    status,
    amount: { currency_code: 'USD', value },
    custom_id: 'deal-1',
  });

  it('settles the deal once PayPal completes the capture', async () => {
    storeDeal(capturingDeal());

    const { result } = await run(
      { task: 'ConfirmCapture', dealId: 'deal-1', capture: capture('COMPLETED') },
      '2026-10-05T10:00:00Z',
    );

    expect(result).toEqual({ state: 'SETTLED' });
    expect(savedStates()).toEqual(['SETTLED']);
  });

  it('keeps waiting while the capture is pending', async () => {
    storeDeal(capturingDeal());

    const { result } = await run(
      { task: 'ConfirmCapture', dealId: 'deal-1', capture: capture('PENDING') },
      '2026-10-05T10:00:00Z',
    );

    expect(result).toEqual({ state: 'CAPTURING' });
    expect(savedStates()).toEqual([]);
  });

  it('hands a declined capture to a person', async () => {
    storeDeal(capturingDeal());

    const { result } = await run(
      { task: 'ConfirmCapture', dealId: 'deal-1', capture: capture('DECLINED') },
      '2026-10-05T10:00:00Z',
    );

    expect(result).toEqual({ state: 'ESCALATED' });
  });

  it('hands a capture of the wrong amount to a person', async () => {
    storeDeal(capturingDeal());

    const { result } = await run(
      { task: 'ConfirmCapture', dealId: 'deal-1', capture: capture('COMPLETED', '1.00') },
      '2026-10-05T10:00:00Z',
    );

    expect(result).toEqual({ state: 'ESCALATED' });
  });

  it('escalates a capture PayPal never confirms', async () => {
    storeDeal(capturingDeal());

    const { result } = await run(
      { task: 'Escalate', dealId: 'deal-1', reason: 'PayPal did not confirm the capture' },
      '2026-10-11T10:00:00Z',
    );

    expect(result).toEqual({ state: 'ESCALATED' });
  });
});

it('fails for a deal that does not exist', async () => {
  dynamodb.on(GetCommand).resolves({});
  await expect(
    run({ task: 'CheckDeliveryTimer', dealId: 'missing' }, '2026-10-03T00:00:00Z'),
  ).rejects.toBeInstanceOf(DealNotFoundError);
});
