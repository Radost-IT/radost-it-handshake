import type { Metadata } from 'next';
import { DealView } from './deal-view';

export const metadata: Metadata = {
  title: 'Deal',
  description: 'Follow one Handshake deal from negotiation to settlement.',
  robots: { index: false, follow: false },
};

export default async function DealPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <DealView dealId={dealId} />
    </main>
  );
}
