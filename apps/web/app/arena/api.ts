import { z } from 'zod';
import { API_URL } from '../site';

const attemptStatusSchema = z.enum(['running', 'judged', 'failed']);
const outcomeResultSchema = z.enum(['held', 'loophole']);

const challengerSchema = z.object({
  id: z.string(),
  handle: z.string(),
  xp: z.number(),
  rank: z.object({
    rank: z.string(),
    next: z.object({ rank: z.string(), xpToGo: z.number() }).nullable(),
    fraction: z.number(),
  }),
  badges: z.array(z.string()),
  currentHeldStreak: z.number(),
});

export type Challenger = z.infer<typeof challengerSchema>;

const moneySchema = z.object({ currency: z.string(), value: z.string() });

const dealsSchema = z.object({
  dailyDealId: z.string(),
  deals: z.array(
    z.object({
      id: z.string(),
      seller: z.object({ name: z.string(), persona: z.string() }),
      listing: z.object({ title: z.string(), description: z.string(), listPrice: moneySchema }),
      buyerGoal: z.string(),
      acceptanceCriteria: z.array(z.object({ id: z.string(), description: z.string() })),
      deliveryDays: z.number(),
    }),
  ),
});

export type ArenaDeal = z.infer<typeof dealsSchema>['deals'][number];

const statsSchema = z.object({
  attempts: z.number(),
  held: z.number(),
  categories: z.array(
    z.object({ category: z.string(), attempts: z.number(), loopholes: z.number() }),
  ),
});

export type ArenaStats = z.infer<typeof statsSchema>;

const myAttemptsSchema = z.object({
  attempts: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      channel: z.string(),
      dealId: z.string().nullable(),
      createdAt: z.string(),
      status: attemptStatusSchema,
      outcome: outcomeResultSchema.nullable(),
      xpGained: z.number().nullable(),
    }),
  ),
});

export type AttemptSummary = z.infer<typeof myAttemptsSchema>['attempts'][number];

const attemptSchema = z.object({
  id: z.string(),
  category: z.string(),
  channel: z.string(),
  attackText: z.string(),
  dailyChallengeDate: z.string().nullable(),
  dealId: z.string().nullable(),
  createdAt: z.string(),
  status: attemptStatusSchema,
  failureReason: z.enum(['budget', 'error']).nullable(),
  run: z.object({ transcript: z.string(), policyDecisions: z.array(z.string()) }).nullable(),
  result: z
    .object({
      outcome: z.discriminatedUnion('result', [
        z.object({ result: z.literal('held') }),
        z.object({
          result: z.literal('loophole'),
          severity: z.string(),
          novelty: z.number(),
          nearDuplicate: z.boolean(),
        }),
      ]),
      xpGained: z.number(),
      rationale: z.string(),
      nearDuplicateOf: z.string().nullable(),
    })
    .nullable(),
  bounty: z.object({ amount: moneySchema, payoutBatchId: z.string() }).nullable(),
  regressionTest: z.boolean(),
});

export type Attempt = z.infer<typeof attemptSchema>;

const leaderboardSchema = z.object({
  scope: z.enum(['all', 'daily']),
  date: z.string(),
  entries: z.array(
    z.object({
      position: z.number(),
      challengerId: z.string(),
      handle: z.string(),
      xp: z.number(),
      rank: z.string(),
    }),
  ),
});

export type LeaderboardEntry = z.infer<typeof leaderboardSchema>['entries'][number];

const errorBodySchema = z.object({ error: z.string() });

/** The API answered with an error. `message` is the API's own plain-language reason. */
export class ArenaApiError extends Error {
  override name = 'ArenaApiError';

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Sends a POST with `body` as JSON when one is given, a GET otherwise. */
async function request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  // The session cookie lives on the API domain, so every call must send it.
  const response = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const responseBody: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorBodySchema.safeParse(responseBody);
    throw new ArenaApiError(
      response.status,
      error.success ? error.data.error : 'The arena is not answering. Try again soon',
    );
  }
  return schema.parse(responseBody);
}

const accessStatusSchema = z.enum(['none', 'pending', 'approved', 'rejected']);

export type AccessStatus = z.infer<typeof accessStatusSchema>;

const accountSchema = z.object({
  email: z.string(),
  access: accessStatusSchema,
  challenger: challengerSchema.nullable(),
});

export type Account = z.infer<typeof accountSchema>;

/** Resolves to null when the visitor has not signed in yet. */
export async function fetchAccount(): Promise<Account | null> {
  try {
    return await request('/arena/account', accountSchema);
  } catch (error) {
    if (error instanceof ArenaApiError && error.status === 401) return null;
    throw error;
  }
}

export async function requestSignInCode(email: string): Promise<void> {
  await request('/arena/sign-in', z.object({ sent: z.literal(true) }), { email });
}

export async function verifySignInCode(email: string, code: string): Promise<AccessStatus> {
  const verified = await request(
    '/arena/sign-in/verify',
    z.object({ access: accessStatusSchema }),
    {
      email,
      code,
    },
  );
  return verified.access;
}

export async function requestAccess(reason: string): Promise<void> {
  await request('/arena/access-requests', z.object({ access: z.literal('pending') }), { reason });
}

export async function signOut(): Promise<void> {
  // The API answers 204 with no body.
  await request('/arena/sign-out', z.null(), {});
}

export function createChallenger(handle: string): Promise<Challenger> {
  return request('/arena/challengers', challengerSchema, { handle });
}

export function fetchDeals() {
  return request('/arena/deals', dealsSchema);
}

export function fetchStats() {
  return request('/arena/stats', statsSchema);
}

export async function fetchMyAttempts(): Promise<AttemptSummary[]> {
  return (await request('/arena/challengers/me/attempts', myAttemptsSchema)).attempts;
}

export function fetchAttempt(attemptId: string) {
  return request(`/arena/attempts/${encodeURIComponent(attemptId)}`, attemptSchema);
}

export function fetchLeaderboard(scope: 'all' | 'daily') {
  return request(`/arena/leaderboard?scope=${scope}`, leaderboardSchema);
}

export interface NewAttempt {
  category: string;
  channel: string;
  attackText: string;
  dailyChallenge: boolean;
  dealId: string | null;
}

export function submitAttempt(attempt: NewAttempt) {
  return request('/arena/attempts', z.object({ attemptId: z.string() }), attempt);
}

/** A message the page can show. API errors already carry plain sentences. */
export function messageOf(error: unknown): string {
  return error instanceof ArenaApiError ? error.message : 'Something went wrong. Try again';
}
