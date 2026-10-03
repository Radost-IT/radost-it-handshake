import type { Metadata } from 'next';
import { AttemptReplay } from './attempt-replay';

export const metadata: Metadata = {
  title: 'Arena attempt',
  description: 'How the agents handled one arena attack.',
  robots: { index: false, follow: true },
};

export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return (
    <main data-accent="heat" className="mx-auto w-full max-w-4xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <AttemptReplay attemptId={attemptId} />
    </main>
  );
}
