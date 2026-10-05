import { badges } from '@handshake/arena';
import type { Metadata } from 'next';
import { AttemptReplay } from './attempt-replay';

export const metadata: Metadata = {
  title: 'Red Team Lab attempt',
  description: 'How the agents handled one attack in the Red Team Lab.',
  robots: { index: false, follow: true },
};

export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return (
    <main data-accent="heat" className="mx-auto w-full max-w-4xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <AttemptReplay
        attemptId={attemptId}
        badges={badges.map(({ id, name, howToEarn }) => ({ id, name, howToEarn }))}
      />
    </main>
  );
}
