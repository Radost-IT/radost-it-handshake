import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { scriptedModel } from './test-model';
import {
  arenaTokenLimits,
  dealTokenLimits,
  TokenBudgetExhaustedError,
  withDailyTokenBudget,
} from './token-budget';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const budgetKey = { pk: 'BUDGET#2026-10-03', sk: 'TOKENS' };
const arenaBudgetKey = { pk: 'BUDGET#2026-10-03', sk: 'ARENA' };
const developerBudgetKey = { pk: 'BUDGET#2026-10-03', sk: 'POOL#developer:account:a1' };
const challengerBudgetKey = { pk: 'BUDGET#2026-10-03', sk: 'POOL#challenger:c1' };
const request = {
  tier: 'fast' as const,
  system: 'Answer.',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hi' }] }],
  toolChoice: { type: 'tool' as const, name: 'answer' },
  maxTokens: 100,
};

beforeEach(() => dynamodb.reset());

describe('withDailyTokenBudget', () => {
  const budgeted = (
    model = scriptedModel({ answer: () => ({}) }),
    limits = dealTokenLimits(1000, 'account:a1'),
  ) => ({
    model,
    llm: withDailyTokenBudget(model, {
      table,
      limits,
      now: () => '2026-10-03T12:00:00.000Z',
    }),
  });

  it('calls the model and adds the tokens it used to the day', async () => {
    dynamodb.on(GetCommand).resolves({});
    dynamodb.on(GetCommand, { Key: budgetKey }).resolves({ Item: { ...budgetKey, used: 880 } });
    dynamodb.on(UpdateCommand).resolves({});
    const { model, llm } = budgeted();

    await llm.converse(request);

    expect(model.requests).toHaveLength(1);
    expect(dynamodb.commandCalls(UpdateCommand).map((call) => call.args[0].input)).toMatchObject([
      { Key: budgetKey, ExpressionAttributeValues: { ':tokens': 120 } },
      { Key: developerBudgetKey, ExpressionAttributeValues: { ':tokens': 120 } },
    ]);
  });

  it("refuses the call once the developer's fifth of the day is used up", async () => {
    dynamodb.on(GetCommand).resolves({});
    dynamodb
      .on(GetCommand, { Key: developerBudgetKey })
      .resolves({ Item: { ...developerBudgetKey, used: 200 } });
    const { model, llm } = budgeted();

    await expect(llm.converse(request)).rejects.toThrow(TokenBudgetExhaustedError);
    expect(model.requests).toHaveLength(0);
  });

  it('refuses the call once the budget is used up', async () => {
    dynamodb.on(GetCommand).resolves({});
    dynamodb.on(GetCommand, { Key: budgetKey }).resolves({ Item: { ...budgetKey, used: 1000 } });
    const { model, llm } = budgeted();

    await expect(llm.converse(request)).rejects.toThrow(TokenBudgetExhaustedError);
    expect(model.requests).toHaveLength(0);
    expect(dynamodb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('counts arena calls in every pool and stops at the arena half', async () => {
    dynamodb.on(GetCommand).resolves({});
    dynamodb.on(UpdateCommand).resolves({});
    const { llm } = budgeted(undefined, arenaTokenLimits(1000, 'c1'));

    await llm.converse(request);

    expect(dynamodb.commandCalls(UpdateCommand).map((call) => call.args[0].input.Key)).toEqual([
      budgetKey,
      arenaBudgetKey,
      challengerBudgetKey,
    ]);

    dynamodb
      .on(GetCommand, { Key: arenaBudgetKey })
      .resolves({ Item: { ...arenaBudgetKey, used: 500 } });
    await expect(llm.converse(request)).rejects.toThrow(TokenBudgetExhaustedError);
  });
});
