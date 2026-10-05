import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SendTaskSuccessCommand, SFNClient } from '@aws-sdk/client-sfn';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ResumeContext } from '@handshake/workflows/resume-lifecycle';
import { approvePurchase, decideEscalation } from './deal-approvals';
import { hashToken } from './http';

const dynamodb = mockClient(DynamoDBDocumentClient);
const stepFunctions = mockClient(SFNClient);
const context: ResumeContext = {
  table: { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' },
  stepFunctions: new SFNClient({}),
  now: () => '2026-10-03T12:00:00Z',
};

const accessKey = { pk: 'DEAL#deal-1', sk: `ACCESS#${hashToken('token-1')}` };
const request = (body: unknown, authorization = 'Bearer token-1') => ({
  dealId: 'deal-1',
  authorization,
  cookies: [],
  body: JSON.stringify(body),
});

function waitingFor(signal: string): void {
  dynamodb.on(DeleteCommand, { Key: { pk: 'DEAL#deal-1', sk: `WAIT#${signal}` } }).resolves({
    Attributes: { pk: 'DEAL#deal-1', sk: `WAIT#${signal}`, taskToken: 'task-1' },
  });
}

beforeEach(() => {
  dynamodb.reset();
  stepFunctions.reset();
  dynamodb.on(GetCommand).resolves({});
  dynamodb.on(GetCommand, { Key: accessKey }).resolves({ Item: accessKey });
  dynamodb.on(DeleteCommand).resolves({});
  stepFunctions.on(SendTaskSuccessCommand).resolves({});
});

describe('approvePurchase', () => {
  it('resumes the waiting lifecycle with the buyer decision', async () => {
    waitingFor('purchase-approval');

    const response = await approvePurchase(context, request({ approved: true }));

    expect(response.statusCode).toBe(202);
    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)[0]?.args[0].input).toEqual({
      taskToken: 'task-1',
      output: JSON.stringify({ approved: true }),
    });
  });

  it('asks for the token when none is sent', async () => {
    const response = await approvePurchase(context, request({ approved: true }, ''));
    expect(response.statusCode).toBe(401);
  });

  it('treats a wrong token like an unknown deal and resumes nothing', async () => {
    waitingFor('purchase-approval');

    const response = await approvePurchase(
      context,
      request({ approved: true }, 'Bearer someone-else'),
    );

    expect(response.statusCode).toBe(404);
    expect(dynamodb.commandCalls(DeleteCommand)).toHaveLength(0);
    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  });

  it('refuses the developer API key, which agents hold', async () => {
    waitingFor('purchase-approval');

    const response = await approvePurchase(
      context,
      request({ approved: true }, 'Bearer hs_sandbox_key-1'),
    );

    expect(response.statusCode).toBe(403);
    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  });

  it('refuses a body that is not a decision', async () => {
    const response = await approvePurchase(context, request({ approved: 'yes' }));
    expect(response.statusCode).toBe(400);
  });

  it('reports a conflict when the deal is not waiting for approval', async () => {
    const response = await approvePurchase(context, request({ approved: false }));
    expect(response.statusCode).toBe(409);
  });
});

describe('decideEscalation', () => {
  it('passes a valid settlement proposal to the lifecycle, which checks policy', async () => {
    waitingFor('human-decision');
    const proposal = { action: 'VOID', reason: 'The parcel never arrived' };

    const response = await decideEscalation(context, request(proposal));

    expect(response.statusCode).toBe(202);
    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)[0]?.args[0].input.output).toBe(
      JSON.stringify(proposal),
    );
  });

  it('refuses the developer API key, which agents hold', async () => {
    waitingFor('human-decision');

    const response = await decideEscalation(
      context,
      request({ action: 'CAPTURE', reason: 'Looks fine' }, 'Bearer hs_sandbox_key-1'),
    );

    expect(response.statusCode).toBe(403);
    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  });

  it('refuses a proposal policy could never accept', async () => {
    waitingFor('human-decision');

    const response = await decideEscalation(context, request({ action: 'REFUND_TWICE' }));

    expect(response.statusCode).toBe(400);
    expect(stepFunctions.commandCalls(SendTaskSuccessCommand)).toHaveLength(0);
  });
});
