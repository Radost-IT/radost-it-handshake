import Link from 'next/link';
import type { AttemptSummary } from './api';
import { categoryName, channelName } from './labels';
import { pillStateFor, StatusPill } from './status-pill';

export function AttemptHistory({ attempts }: { attempts: AttemptSummary[] }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">Your attempts</h2>
      {attempts.length === 0 ? (
        <p className="text-muted mt-3 text-sm">No attempts yet. Your first one shows up here.</p>
      ) : (
        <ul className="border-line bg-surface/70 rounded-card mt-4 divide-y divide-line border">
          {attempts.map((attempt) => (
            <li key={attempt.id}>
              <Link
                href={`/arena/attempts/${attempt.id}`}
                className="hover:bg-canvas/60 flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm transition-colors"
              >
                <span>
                  <span className="font-semibold">{categoryName(attempt.category)}</span>
                  <span className="text-muted">
                    {' '}
                    via {channelName(attempt.channel).toLowerCase()}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  {attempt.xpGained !== null && (
                    <span className="font-mono text-xs">+{attempt.xpGained} XP</span>
                  )}
                  <StatusPill state={pillStateFor(attempt.status, attempt.outcome)} />
                  <time dateTime={attempt.createdAt} className="text-muted text-xs">
                    {new Date(attempt.createdAt).toLocaleString()}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
