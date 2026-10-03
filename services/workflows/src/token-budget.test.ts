import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { scriptedModel } from './test-model';
import { TokenBudgetExhaustedError, withDailyTokenBudget } from './token-budget';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };
const budgetKey = { pk: 'BUDGET#2026-10-03', sk: 'TOKENS' };
const request = {
  tier: 'fast' as const,
  system: 'Answer.',
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hi' }] }],
  toolChoice: { type: 'tool' as const, name: 'answer' },
  maxTokens: 100,
};

beforeEach(() => dynamodb.reset());

describe('withDailyTokenBudget', () => {
  const budgeted = (model = scriptedModel({ answer: () => ({}) })) => ({
    model,
    llm: withDailyTokenBudget(model, {
      table,
      dailyTokenBudget: 1000,
      now: () => '2026-10-03T12:00:00.000Z',
    }),
  });

  it('calls the model and adds the tokens it used to the day', async () => {
    dynamodb.on(GetCommand, { Key: budgetKey }).resolves({ Item: { ...budgetKey, used: 880 } });
    dynamodb.on(UpdateCommand).resolves({});
    const { model, llm } = budgeted();

    await llm.converse(request);

    expect(model.requests).toHaveLength(1);
    expect(dynamodb.commandCalls(UpdateCommand)[0]?.args[0].input).toMatchObject({
      Key: budgetKey,
      ExpressionAttributeValues: { ':tokens': 120 },
    });
  });

  it('refuses the call once the budget is used up', async () => {
    dynamodb.on(GetCommand, { Key: budgetKey }).resolves({ Item: { ...budgetKey, used: 1000 } });
    const { model, llm } = budgeted();

    await expect(llm.converse(request)).rejects.toThrow(TokenBudgetExhaustedError);
    expect(model.requests).toHaveLength(0);
    expect(dynamodb.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});
