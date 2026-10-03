'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchAttempt, messageOf, type Attempt } from '../../api';
import { categoryName, channelName } from '../../labels';
import { pillStateFor, StatusPill } from '../../status-pill';

// No push channel yet, so the page asks again until the judge has decided.
const POLL_INTERVAL_MS = 2000;

const failureMessages = {
  budget: 'The arena ran out of its AI budget for today before this attempt finished.',
  error: 'This attempt stopped before the judge could decide. It earned no XP.',
};

type ReplayState =
  { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; attempt: Attempt };

export function AttemptReplay({ attemptId }: { attemptId: string }) {
  const [state, setState] = useState<ReplayState>({ kind: 'loading' });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isActive = true;
    const poll = () => {
      fetchAttempt(attemptId)
        .then((attempt) => {
          if (!isActive) return;
          setState({ kind: 'ready', attempt });
          if (attempt.status === 'running') timer = setTimeout(poll, POLL_INTERVAL_MS);
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
  }, [attemptId]);

  if (state.kind === 'loading') return <p className="text-muted">Loading the attempt...</p>;
  if (state.kind === 'failed') return <p className="text-refused">{state.message}</p>;

  const { attempt } = state;
  const { result, run } = attempt;
  return (
    <article className="flex flex-col gap-8">
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

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-line bg-surface/70 rounded-card border p-6">
      <h2 className="text-muted mb-3 text-xs font-semibold tracking-widest uppercase">{title}</h2>
      {children}
    </section>
  );
}
