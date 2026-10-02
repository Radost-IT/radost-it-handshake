import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { newChallengerProgress } from '@handshake/arena';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { getArenaStats } from './arena-stats';
import { getChallenger } from './challengers';
import { getLeaderboard } from './leaderboard';

const dynamodb = mockClient(DynamoDBDocumentClient);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: 'T' };

beforeEach(() => dynamodb.reset());

describe('getChallenger', () => {
  it('parses the stored challenger', async () => {
    const challenger = {
      id: 'challenger-1',
      handle: 'tester',
      createdAt: '2026-10-01T09:00:00Z',
      version: 0,
      progress: newChallengerProgress,
    };
    dynamodb
      .on(GetCommand, { Key: { pk: 'CHALLENGER#challenger-1', sk: 'META' } })
      .resolves({ Item: { pk: 'CHALLENGER#challenger-1', sk: 'META', ...challenger } });

    await expect(getChallenger(table, 'challenger-1')).resolves.toEqual(challenger);
  });

  it('returns undefined for an unknown challenger', async () => {
    dynamodb.on(GetCommand).resolves({});
    await expect(getChallenger(table, 'missing')).resolves.toBeUndefined();
  });
});

describe('getLeaderboard', () => {
  it('queries the daily partition with the highest scores first', async () => {
    dynamodb.on(QueryCommand).resolves({
      Items: [{ pk: 'DAILY#2026-10-02', sk: 'SCORE#x', challengerId: 'c1', handle: 'a', xp: 50 }],
    });

    const entries = await getLeaderboard(table, { kind: 'daily', date: '2026-10-02' }, 10);

    expect(entries).toEqual([{ challengerId: 'c1', handle: 'a', xp: 50 }]);
    expect(dynamodb.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      ExpressionAttributeValues: { ':pk': 'DAILY#2026-10-02' },
      ScanIndexForward: false,
      Limit: 10,
    });
  });
});

describe('getArenaStats', () => {
  it('fills in zeros for categories nobody has tried', async () => {
    dynamodb.on(BatchGetCommand).resolves({
      Responses: {
        T: [
          { pk: 'STATS', sk: 'GLOBAL', attempts: 7, held: 5 },
          {
            pk: 'CATEGORY#fake-urgency',
            sk: 'META',
            attempts: 2,
            loopholes: 2,
            firstFinderId: 'c1',
          },
        ],
      },
    });

    const stats = await getArenaStats(table);

    expect(stats.attempts).toBe(7);
    expect(stats.held).toBe(5);
    expect(stats.categories['fake-urgency']).toEqual({
      attempts: 2,
      loopholes: 2,
      firstFinderId: 'c1',
    });
    expect(stats.categories['swapped-item']).toEqual({
      attempts: 0,
      loopholes: 0,
      firstFinderId: null,
    });
  });

  it('asks again for keys DynamoDB left unprocessed', async () => {
    dynamodb
      .on(BatchGetCommand)
      .resolvesOnce({
        Responses: { T: [] },
        UnprocessedKeys: { T: { Keys: [{ pk: 'STATS', sk: 'GLOBAL' }] } },
      })
      .resolves({ Responses: { T: [{ pk: 'STATS', sk: 'GLOBAL', attempts: 1, held: 1 }] } });

    await expect(getArenaStats(table)).resolves.toMatchObject({ attempts: 1, held: 1 });
    expect(dynamodb.commandCalls(BatchGetCommand)).toHaveLength(2);
  });
});
