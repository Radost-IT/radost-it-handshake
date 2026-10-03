'use client';

import type { AttackCategory } from '@handshake/arena';
import { useEffect, useState, type ReactNode } from 'react';
import {
  fetchAccount,
  fetchDeals,
  fetchMyAttempts,
  fetchStats,
  messageOf,
  signOut,
  type Account,
  type ArenaDeal,
  type ArenaStats,
  type AttemptSummary,
  type Challenger,
} from './api';
import { AccessRequestForm } from './access-request-form';
import { AttackForm } from './attack-form';
import { AttemptHistory } from './attempt-history';
import { ChallengerCard, type BadgeInfo } from './challenger-card';
import { HandleForm } from './handle-form';
import { ARENA_TOPIC, useLiveEvents } from './live-events';
import { SignInForm } from './sign-in-form';

interface ArenaData {
  account: Account | null;
  deals: ArenaDeal[];
  dailyDealId: string;
  stats: ArenaStats;
}

type LoadState =
  { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; data: ArenaData };

interface ArenaPlayProps {
  categories: readonly AttackCategory[];
  maxAttackLength: number;
  minReasonLength: number;
  maxReasonLength: number;
  badges: BadgeInfo[];
}

export function ArenaPlay({
  categories,
  maxAttackLength,
  minReasonLength,
  maxReasonLength,
  badges,
}: ArenaPlayProps) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);

  useLiveEvents([ARENA_TOPIC], (event) => {
    if (event.type !== 'arena.stats') return;
    setLoad((current) =>
      current.kind === 'ready'
        ? {
            kind: 'ready',
            data: {
              ...current.data,
              stats: { ...current.data.stats, attempts: event.attempts, held: event.held },
            },
          }
        : current,
    );
  });

  useEffect(() => {
    Promise.all([fetchAccount(), fetchDeals(), fetchStats()])
      .then(([account, { deals, dailyDealId }, stats]) => {
        setLoad({ kind: 'ready', data: { account, deals, dailyDealId, stats } });
        if (account?.challenger) return fetchMyAttempts().then(setAttempts);
      })
      .catch((error: unknown) => {
        setLoad({ kind: 'failed', message: messageOf(error) });
      });
  }, []);

  if (load.kind === 'loading') return <p className="text-muted mt-12">Loading the arena...</p>;
  if (load.kind === 'failed') return <p className="text-refused mt-12">{load.message}</p>;

  const { account, deals, dailyDealId, stats } = load.data;
  const setAccount = (next: Account | null) => {
    setLoad({ kind: 'ready', data: { ...load.data, account: next } });
  };
  const showError = (error: unknown) => {
    setLoad({ kind: 'failed', message: messageOf(error) });
  };
  const challenger = account?.challenger ?? null;

  const panel = () => {
    if (!account) {
      return (
        <SignInForm
          onSignedIn={() => {
            fetchAccount().then(setAccount).catch(showError);
          }}
        />
      );
    }
    if (challenger) {
      return (
        <AttackForm
          deals={deals}
          dailyDealId={dailyDealId}
          stats={stats}
          categories={categories}
          maxAttackLength={maxAttackLength}
        />
      );
    }
    switch (account.access) {
      case 'none':
        return (
          <AccessRequestForm
            email={account.email}
            minReasonLength={minReasonLength}
            maxReasonLength={maxReasonLength}
            onRequested={() => {
              setAccount({ ...account, access: 'pending' });
            }}
          />
        );
      case 'pending':
        return (
          <Notice title="Your request is waiting">
            We read every request and reply to {account.email}. Come back once you get the email.
          </Notice>
        );
      case 'rejected':
        return (
          <Notice title="Your request was not approved">
            The arena has room for a few players only. You can still watch the leaderboard.
          </Notice>
        );
      case 'approved':
        return (
          <HandleForm
            onCreated={(created: Challenger) => {
              setAccount({ ...account, challenger: created });
            }}
          />
        );
    }
  };

  return (
    <div className="mt-12 flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <DefenseCounter stats={stats} />
        {account && (
          <button
            type="button"
            onClick={() => {
              signOut()
                .then(() => {
                  setAccount(null);
                  setAttempts([]);
                })
                .catch(showError);
            }}
            className="text-muted text-sm underline"
          >
            Sign out {account.email}
          </button>
        )}
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_20rem]">
        <section className="border-line bg-surface/70 rounded-card border p-6">{panel()}</section>
        {challenger && <ChallengerCard challenger={challenger} badges={badges} />}
      </div>
      {challenger && <AttemptHistory attempts={attempts} />}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-muted text-sm">{children}</p>
    </div>
  );
}

function DefenseCounter({ stats }: { stats: ArenaStats }) {
  return (
    <p className="text-muted text-sm">
      <span className="text-ink font-mono text-base font-semibold">{stats.held}</span> of{' '}
      <span className="text-ink font-mono text-base font-semibold">{stats.attempts}</span> attacks
      held so far.
    </p>
  );
}
