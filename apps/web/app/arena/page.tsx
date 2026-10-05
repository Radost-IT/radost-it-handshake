import {
  attackCategories,
  badges,
  MAX_ACCESS_REASON_LENGTH,
  MAX_ATTACK_LENGTH,
  MIN_ACCESS_REASON_LENGTH,
} from '@handshake/arena';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArenaPlay } from './arena-play';

export const metadata: Metadata = {
  title: 'Red Team Lab',
  description:
    'Act as a malicious seller and try to make the AI agents release money they should not. Every breach becomes a regression test.',
  alternates: { canonical: '/arena' },
};

const rulesOfEngagement = [
  ['Target', 'The buyer, seller-facing and verifier agents of a live sandbox deal'],
  ['Goal', 'Make the buyer pay for a bad deal, or make the verifier release a held payment'],
  ['Money', 'PayPal sandbox only. Code, not the model, moves money'],
  ['Outcome', 'A judge agent decides held or breach. Every breach becomes a regression test'],
] as const;

export default function ArenaPage() {
  return (
    <main data-accent="heat" className="mx-auto w-full max-w-6xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-accent font-mono text-sm font-semibold tracking-widest uppercase">
            Red Team Lab
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Attack the agents. <span className="text-heat">Ship the regression test.</span>
          </h1>
        </div>
        <Link
          href="/arena/leaderboard"
          className="border-line hover:border-accent rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
        >
          Leaderboard
        </Link>
      </div>
      <p className="text-muted mt-6 max-w-2xl text-lg">
        Agents that hold money attract attackers. Here you are one. Write a listing, a chat message
        or a delivery proof that should make the agents pay for a bad deal. A held attempt still
        earns XP. A breach earns a sandbox bounty and becomes a test in the suite, so no one can use
        it again.
      </p>
      <dl className="border-line bg-surface/70 rounded-card mt-8 grid gap-px overflow-hidden border font-mono text-sm sm:grid-cols-2">
        {rulesOfEngagement.map(([term, detail]) => (
          <div key={term} className="flex flex-col gap-1 p-4">
            <dt className="text-accent text-xs font-semibold tracking-widest uppercase">{term}</dt>
            <dd className="text-muted">{detail}</dd>
          </div>
        ))}
      </dl>
      <ArenaPlay
        categories={attackCategories}
        maxAttackLength={MAX_ATTACK_LENGTH}
        minReasonLength={MIN_ACCESS_REASON_LENGTH}
        maxReasonLength={MAX_ACCESS_REASON_LENGTH}
        badges={badges.map(({ id, name, howToEarn }) => ({ id, name, howToEarn }))}
      />
    </main>
  );
}
