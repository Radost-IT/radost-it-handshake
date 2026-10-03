'use client';

import type { AttackCategory } from '@handshake/arena';
import { useEffect, useState } from 'react';
import {
  fetchDeals,
  fetchMe,
  fetchMyAttempts,
  fetchStats,
  messageOf,
  type ArenaDeal,
  type ArenaStats,
  type AttemptSummary,
  type Challenger,
} from './api';
import { AttackForm } from './attack-form';
import { AttemptHistory } from './attempt-history';
import { ChallengerCard, type BadgeInfo } from './challenger-card';
import { HandleForm } from './handle-form';

interface ArenaData {
  me: Challenger | null;
  deals: ArenaDeal[];
  dailyDealId: string;
  stats: ArenaStats;
}

type LoadState =
  { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; data: ArenaData };

interface ArenaPlayProps {
  categories: readonly AttackCategory[];
  maxAttackLength: number;
  badges: BadgeInfo[];
}

export function ArenaPlay({ categories, maxAttackLength, badges }: ArenaPlayProps) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);

  useEffect(() => {
    Promise.all([fetchMe(), fetchDeals(), fetchStats()])
      .then(([me, { deals, dailyDealId }, stats]) => {
        setLoad({ kind: 'ready', data: { me, deals, dailyDealId, stats } });
        if (me) return fetchMyAttempts().then(setAttempts);
      })
      .catch((error: unknown) => {
        setLoad({ kind: 'failed', message: messageOf(error) });
      });
  }, []);

  if (load.kind === 'loading') return <p className="text-muted mt-12">Loading the arena...</p>;
  if (load.kind === 'failed') return <p className="text-refused mt-12">{load.message}</p>;

  const { me, deals, dailyDealId, stats } = load.data;
  const signIn = (challenger: Challenger) => {
    setLoad({ kind: 'ready', data: { ...load.data, me: challenger } });
  };

  return (
    <div className="mt-12 flex flex-col gap-8">
      <DefenseCounter stats={stats} />
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_20rem]">
        <section className="border-line bg-surface/70 rounded-card border p-6">
          {me ? (
            <AttackForm
              deals={deals}
              dailyDealId={dailyDealId}
              stats={stats}
              categories={categories}
              maxAttackLength={maxAttackLength}
            />
          ) : (
            <HandleForm onCreated={signIn} />
          )}
        </section>
        {me && <ChallengerCard challenger={me} badges={badges} />}
      </div>
      {me && <AttemptHistory attempts={attempts} />}
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
