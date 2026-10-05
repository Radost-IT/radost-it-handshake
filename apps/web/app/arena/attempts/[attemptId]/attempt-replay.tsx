'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Panel } from '../../../components/panel';
import { fetchAccount, fetchAttempt, messageOf, type Attempt } from '../../api';
import type { BadgeInfo } from '../../challenger-card';
import { categoryName, channelName } from '../../labels';
import { attemptTopic, useLiveEvents, type LiveEvent } from '../../live-events';
import { pillStateFor, StatusPill } from '../../status-pill';
import { ToastStack, useToasts } from '../../toasts';

// The socket reports the result as soon as it is in. Polling covers a push that never arrives.
const FALLBACK_POLL_INTERVAL_MS = 10_000;

const failureMessages = {
  budget: 'The arena ran out of its AI budget for today before this attempt finished.',
  error: 'This attempt stopped before the judge could decide. It earned no XP.',
};

type ReplayState =
  { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; attempt: Attempt };

interface AttemptReplayProps {
  attemptId: string;
  badges: BadgeInfo[];
}

export function AttemptReplay({ attemptId, badges }: AttemptReplayProps) {
  const [state, setState] = useState<ReplayState>({ kind: 'loading' });
  const [resultPushes, setResultPushes] = useState(0);
  const [viewerChallengerId, setViewerChallengerId] = useState<string | null>(null);
  const { toasts, showToast, dismissToast } = useToasts();

  useEffect(() => {
    fetchAccount()
      .then((account) => {
        setViewerChallengerId(account?.challenger?.id ?? null);
      })
      .catch(() => {
        // Without the account the page only skips the rank and badge toasts.
        setViewerChallengerId(null);
      });
  }, []);

  useLiveEvents([attemptTopic(attemptId)], (event: LiveEvent) => {
    if (event.type === 'arena.result') setResultPushes((count) => count + 1);
    if (event.type !== 'challenger.progress' || event.challengerId !== viewerChallengerId) return;
    if (event.rankUp) showToast('Rank up', `You are now ${event.rank}.`);
    for (const badgeId of event.newBadges) {
      const badge = badges.find(({ id }) => id === badgeId);
      if (badge) showToast(`Badge: ${badge.name}`, badge.howToEarn);
    }
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isActive = true;
    const poll = () => {
      fetchAttempt(attemptId)
        .then((attempt) => {
          if (!isActive) return;
          setState({ kind: 'ready', attempt });
          if (attempt.status === 'running') timer = setTimeout(poll, FALLBACK_POLL_INTERVAL_MS);
        })
        .catch((error: unknown) => {
          if (isActive) setState({ kind: 'failed', message: messageOf(error) });
        });
    };
    poll();
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [attemptId, resultPushes]);

  if (state.kind === 'loading') return <p className="text-muted">Loading the attempt...</p>;
  if (state.kind === 'failed') return <p className="text-refused">{state.message}</p>;

  const { attempt } = state;
  const { result, run } = attempt;
  return (
    <article className="flex flex-col gap-8">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <header>
        <Link href="/arena" className="text-muted hover:text-ink text-sm transition-colors">
          Back to the arena
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            {categoryName(attempt.category)}
          </h1>
          <StatusPill state={pillStateFor(attempt.status, result?.outcome.result ?? null)} />
        </div>
        <p className="text-muted mt-2 text-sm">
          Through the {channelName(attempt.channel).toLowerCase()}
          {attempt.dailyChallengeDate && `, daily challenge of ${attempt.dailyChallengeDate}`}.
        </p>
      </header>

      <Panel title="The attack">
        <p className="font-mono text-sm whitespace-pre-wrap">{attempt.attackText}</p>
      </Panel>

      {attempt.status === 'running' && (
        <p className="text-muted animate-pulse text-sm">
          The agents are negotiating and the judge is watching. This takes about a minute.
        </p>
      )}
      {attempt.failureReason && (
        <p className="text-refused text-sm">{failureMessages[attempt.failureReason]}</p>
      )}

      {result && (
        <Panel title={result.outcome.result === 'loophole' ? 'Loophole found' : 'The agents held'}>
          <p className="font-mono text-2xl font-semibold">+{result.xpGained} XP</p>
          {result.outcome.result === 'loophole' && (
            <p className="text-muted mt-1 text-sm">
              Severity {result.outcome.severity}.
              {result.outcome.nearDuplicate && ' Someone found a very similar trick before.'}
            </p>
          )}
          <p className="mt-3 text-sm">{result.rationale}</p>
        </Panel>
      )}

      {run && (
        <>
          <Panel title="Policy checks">
            {run.policyDecisions.length === 0 ? (
              <p className="text-muted text-sm">No policy decisions were recorded.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {run.policyDecisions.map((decision, index) => (
                  <li key={index}>{decision}</li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="What happened">
            <pre className="text-muted overflow-x-auto font-mono text-xs whitespace-pre-wrap">
              {run.transcript}
            </pre>
          </Panel>
        </>
      )}
    </article>
  );
}
