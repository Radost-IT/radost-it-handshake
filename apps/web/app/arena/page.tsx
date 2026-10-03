import { attackCategories, badges, MAX_ATTACK_LENGTH } from '@handshake/arena';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArenaPlay } from './arena-play';

export const metadata: Metadata = {
  title: 'Arena',
  description:
    'Play a dishonest seller and try to trick the AI shopping agents. Every trick that works becomes a test that makes them stronger.',
  alternates: { canonical: '/arena' },
};

export default function ArenaPage() {
  return (
    <main data-accent="heat" className="mx-auto w-full max-w-6xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-accent text-sm font-semibold tracking-widest uppercase">Arena</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Play the seller. <span className="text-heat">Try to trick the agents.</span>
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
        Write a listing, a chat message or a delivery proof that gets the buyer to pay for a bad
        deal. If the agents hold, you still earn XP. If you find a loophole, it becomes a test so no
        one can use it again. All money is PayPal sandbox money.
      </p>
      <ArenaPlay
        categories={attackCategories}
        maxAttackLength={MAX_ATTACK_LENGTH}
        badges={badges.map(({ id, name, howToEarn }) => ({ id, name, howToEarn }))}
      />
    </main>
  );
}
