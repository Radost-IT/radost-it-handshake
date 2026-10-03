import { BatchGetCommand, DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getLeaderboardPage, getMyAttempts, getStats } from './arena-reads';
import { arenaTestContext, mockSignedIn, sessionCookies } from './arena-test-context';

const dynamodb = mockClient(DynamoDBDocumentClient);
const context = arenaTestContext('2026-10-03T12:30:00Z');

const body = (response: { body?: string | undefined }) =>
  JSON.parse(response.body ?? '') as unknown;

beforeEach(() => dynamodb.reset());

describe('getStats', () => {
  it('shows the defense counter and loopholes per category', async () => {
    dynamodb.on(BatchGetCommand).resolves({
      Responses: {
        T: [
          { pk: 'STATS', sk: 'GLOBAL', attempts: 12, held: 11 },
          {
            pk: 'CATEGORY#fake-urgency',
            sk: 'META',
            attempts: 4,
            loopholes: 1,
            firstFinderId: 'challenger-9',
          },
        ],
      },
    });

    const stats = body(await getStats(context)) as {
      attempts: number;
      held: number;
      categories: { category: string; attempts: number; loopholes: number }[];
    };

    expect(stats).toMatchObject({ attempts: 12, held: 11 });
    expect(stats.categories).toHaveLength(8);
    expect(stats.categories).toContainEqual({
      category: 'fake-urgency',
      attempts: 4,
      loopholes: 1,
    });
    expect(stats.categories).toContainEqual({
      category: 'split-payment',
      attempts: 0,
      loopholes: 0,
    });
  });
});

describe('getLeaderboardPage', () => {
  beforeEach(() => {
    dynamodb.on(QueryCommand).resolves({
      Items: [
        { challengerId: 'c-2', handle: 'ada', xp: 260 },
        { challengerId: 'c-1', handle: 'bob', xp: 10 },
      ],
    });
  });

  it('numbers the all-time board and adds each rank', async () => {
    expect(body(await getLeaderboardPage(context, undefined))).toEqual({
      scope: 'all',
      date: '2026-10-03',
      entries: [
        { position: 1, challengerId: 'c-2', handle: 'ada', xp: 260, rank: 'Investigator' },
        { position: 2, challengerId: 'c-1', handle: 'bob', xp: 10, rank: 'Newcomer' },
      ],
    });
    expect(dynamodb.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues).toEqual(
      { ':pk': 'LEADERBOARD' },
    );
  });

  it("reads today's daily board", async () => {
    await getLeaderboardPage(context, 'daily');

    expect(dynamodb.commandCalls(QueryCommand)[0]?.args[0].input.ExpressionAttributeValues).toEqual(
      { ':pk': 'DAILY#2026-10-03' },
    );
  });
});

describe('getMyAttempts', () => {
  const attempt = {
    id: 'attempt-1',
    challengerId: 'challenger-1',
    category: 'fake-urgency',
    channel: 'message',
    attackText: 'Only today!',
    dailyChallengeDate: null,
    dealTemplateId: 'backpack',
    createdAt: '2026-10-03T12:20:00.000Z',
  };

  it('lists the challenger history with each status', async () => {
    mockSignedIn(dynamodb);
    dynamodb.on(QueryCommand).resolves({
      Items: [attempt, { ...attempt, id: 'attempt-0', createdAt: '2026-10-03T10:00:00.000Z' }],
    });

    const response = await getMyAttempts(context, sessionCookies);

    expect(body(response)).toEqual({
      attempts: [
        {
          id: 'attempt-1',
          category: 'fake-urgency',
          channel: 'message',
          dealId: 'backpack',
          createdAt: '2026-10-03T12:20:00.000Z',
          status: 'running',
          outcome: null,
          xpGained: null,
        },
        expect.objectContaining({ id: 'attempt-0', status: 'failed' }),
      ],
    });
  });

  it('asks for a handle without a session', async () => {
    expect((await getMyAttempts(context, [])).statusCode).toBe(401);
  });
});
