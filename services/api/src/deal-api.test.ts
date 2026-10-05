import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SendTaskSuccessCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Deal } from '@handshake/core';
import { awaitingDeliveryDeal, mandate, verifyingDeal } from '@handshake/core/testing';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDeal, readDeal, submitEvidence, type DealApiContext } from './deal-api';
import { hashToken } from './http';

const dynamodb = mockClient(DynamoDBDocumentClient);
const stepFunctions = mockClient(SFNClient);
const context: DealApiContext = {
  table: { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' },
  stepFunctions: new SFNClient({}),
  now: () => '2026-10-05T12:00:00.000Z',
  dealLifecycleArn: 'arn:aws:states:eu-west-1:123:stateMachine:DealLifecycle',
  webUrl: 'https://handshake.example',
};

const apiKey = 'hs_sandbox_key-1';
const developer = { developerId: 'dev-1', name: 'Shop bot', createdAt: '2026-10-01T00:00:00Z' };
const withKey = `Bearer ${apiKey}`;
const evidence = {
  productId: 'prod-1',
  deliveredAt: '2026-10-05T10:00:00Z',
  invoiceTotal: { currency: 'USD', value: '42.50' },
  description: 'A 750 ml steel bottle with its lid.',
};

beforeEach(() => {
  dynamodb.reset();
  stepFunctions.reset();
  dynamodb.on(GetCommand).resolves({});
  dynamodb
    .on(GetCommand, { Key: { pk: `APIKEY#${hashToken(apiKey)}`, sk: 'META' } })
    .resolves({ Item: developer });
  dynamodb
    .on(GetCommand, { Key: { pk: 'DEAL#deal-1', sk: 'OWNER' } })
    .resolves({ Item: { developerId: 'dev-1' } });
  dynamodb.on(PutCommand).resolves({});
  dynamodb.on(UpdateCommand).resolves({});
  dynamodb.on(TransactWriteCommand).resolves({});
  dynamodb.on(DeleteCommand).resolves({});
  stepFunctions.on(StartExecutionCommand).resolves({});
  stepFunctions.on(SendTaskSuccessCommand).resolves({});
});

describe('openDeal', () => {
  const body = JSON.stringify({ goal: 'A steel water bottle', mandate });

  it('saves a negotiating deal, starts its lifecycle and returns the buyer link', async () => {
    const response = await openDeal(context, { authorization: withKey, body });

    expect(response.statusCode).toBe(201);
    const opened = JSON.parse(String(response.body)) as {
      deal: { id: string; state: string };
      accessToken: string;
      buyerUrl: string;
    };
    expect(opened.deal.state).toBe('NEGOTIATING');
    expect(opened.buyerUrl).toBe(
      `https://handshake.example/deals/${opened.deal.id}#token=${opened.accessToken}`,
    );
    expect(stepFunctions.commandCalls(StartExecutionCommand)[0]?.args[0].input).toEqual({
      stateMachineArn: context.dealLifecycleArn,
      name: opened.deal.id,
      input: JSON.stringify({ dealId: opened.deal.id }),
    });
    const saved = dynamodb.commandCalls(PutCommand).map((call) => call.args[0].input.Item);
    expect(saved).toContainEqual(
      expect.objectContaining({ sk: 'BRIEF', goal: 'A steel water bottle', buyerId: 'dev-1' }),
    );
    expect(saved).toContainEqual(
      expect.objectContaining({ sk: `ACCESS#${hashToken(opened.accessToken)}` }),
    );
  });

  it('refuses a caller without an API key', async () => {
    const response = await openDeal(context, { authorization: 'Bearer token-1', body });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a deal without a mandate', async () => {
    const response = await openDeal(context, {
      authorization: withKey,
      body: JSON.stringify({ goal: 'A bottle' }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('stops a key that used its deals for the day', async () => {
    dynamodb
      .on(UpdateCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'limit', $metadata: {} }));

    const response = await openDeal(context, { authorization: withKey, body });

    expect(response.statusCode).toBe(429);
    expect(stepFunctions.commandCalls(StartExecutionCommand)).toHaveLength(0);
  });
});

describe('readDeal', () => {
  it('hides the deal from a developer who did not open it', async () => {
    dynamodb
      .on(GetCommand, { Key: { pk: 'DEAL#deal-1', sk: 'OWNER' } })
      .resolves({ Item: { developerId: 'dev-2' } });

    const response = await readDeal(context, {
      dealId: 'deal-1',
      authorization: withKey,
      body: '',
    });

    expect(response.statusCode).toBe(404);
    expect(dynamodb.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('returns the deal record to its developer', async () => {
    const deal = verifyingDeal();
    dynamodb.on(QueryCommand).resolves({ Items: [{ pk: 'DEAL#deal-1', sk: 'META', ...deal }] });

    const response = await readDeal(context, {
      dealId: 'deal-1',
      authorization: withKey,
      body: '',
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(String(response.body))).toMatchObject({ deal: { state: 'VERIFYING' } });
  });
});

describe('submitEvidence', () => {
  const request = { dealId: 'deal-1', authorization: withKey, body: JSON.stringify(evidence) };

  function dealIs(deal: Deal): void {
    dynamodb.on(GetCommand, { Key: { pk: 'DEAL#deal-1', sk: 'META' } }).resolves({ Item: deal });
  }

  it('saves the evidence and resumes the waiting lifecycle', async () => {
    dealIs(awaitingDeliveryDeal());
    dynamodb.on(DeleteCommand, { Key: { pk: 'DEAL#deal-1', sk: 'WAIT#evidence' } }).resolves({
      Attributes: { pk: 'DEAL#deal-1', sk: 'WAIT#evidence', taskToken: 'task-1' },
    });

    const response = await submitEvidence(context, request);

    expect(response.statusCode).toBe(202);
    expect(dynamodb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      sk: 'EVIDENCE',
      productId: 'prod-1',
    });
    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)[0]?.args[0].input.taskToken).toBe(
      'task-1',
    );
  });

  it('refuses evidence for a deal that is not waiting for delivery', async () => {
    dealIs(verifyingDeal());

    const response = await submitEvidence(context, request);

    expect(response.statusCode).toBe(409);
    expect(dynamodb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('keeps the first evidence when it is sent twice', async () => {
    dealIs(awaitingDeliveryDeal());
    dynamodb
      .on(PutCommand)
      .rejects(new ConditionalCheckFailedException({ message: 'exists', $metadata: {} }));

    const response = await submitEvidence(context, request);

    expect(response.statusCode).toBe(409);
    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  });
});
