import type { Metadata } from 'next';
import Link from 'next/link';
import { LeaderboardBoard } from './leaderboard-board';

export const metadata: Metadata = {
  title: 'Arena leaderboard',
  description: 'The challengers who earned the most XP trying to trick the Handshake agents.',
  alternates: { canonical: '/arena/leaderboard' },
};

export default function LeaderboardPage() {
  return (
    <main data-accent="heat" className="mx-auto w-full max-w-4xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <Link href="/arena" className="text-muted hover:text-ink text-sm transition-colors">
        Back to the arena
      </Link>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">
        <span className="text-heat">Leaderboard</span>
      </h1>
      <p className="text-muted mt-4">
        The top 50 challengers by XP. The daily board counts only today&apos;s daily challenge.
      </p>
      <LeaderboardBoard />
    </main>
  );
}
