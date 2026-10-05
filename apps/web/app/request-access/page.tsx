import { MAX_ACCESS_REASON_LENGTH, MIN_ACCESS_REASON_LENGTH } from '@handshake/arena';
import type { Metadata } from 'next';
import { RequestAccessView } from './request-access-view';

export const metadata: Metadata = {
  title: 'Request access',
  description: 'Ask for access to the Handshake console and the Red Team Lab.',
  alternates: { canonical: '/request-access' },
};

export default function RequestAccessPage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <h1 className="text-4xl font-semibold tracking-tight">Request access</h1>
      <p className="text-muted mt-4">
        Every deal and every attack runs real AI agents on Amazon Bedrock, so access is by
        invitation. Confirm your email, tell us what you want to do, and we reply by email.
      </p>
      <RequestAccessView
        minReasonLength={MIN_ACCESS_REASON_LENGTH}
        maxReasonLength={MAX_ACCESS_REASON_LENGTH}
      />
    </main>
  );
}
