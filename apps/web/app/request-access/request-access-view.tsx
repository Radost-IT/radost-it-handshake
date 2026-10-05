'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AccessRequestForm } from '../account/access-request-form';
import { CodeSignInForm } from '../account/code-sign-in-form';
import { fetchAccount, messageOf, type Account } from '../arena/api';
import { Notice } from '../components/notice';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; account: Account | null };

interface RequestAccessViewProps {
  minReasonLength: number;
  maxReasonLength: number;
}

export function RequestAccessView({ minReasonLength, maxReasonLength }: RequestAccessViewProps) {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  const loadAccount = () => {
    fetchAccount()
      .then((account) => {
        setLoad({ kind: 'ready', account });
      })
      .catch((error: unknown) => {
        setLoad({ kind: 'failed', message: messageOf(error) });
      });
  };

  useEffect(loadAccount, []);

  if (load.kind === 'loading') return <p className="text-muted mt-10">Loading...</p>;
  if (load.kind === 'failed') return <p className="text-refused mt-10">{load.message}</p>;

  const { account } = load;
  const panel = () => {
    if (!account) return <CodeSignInForm onSignedIn={loadAccount} />;
    switch (account.access) {
      case 'none':
        return (
          <AccessRequestForm
            email={account.email}
            minReasonLength={minReasonLength}
            maxReasonLength={maxReasonLength}
            onRequested={() => {
              setLoad({ kind: 'ready', account: { ...account, access: 'pending' } });
            }}
          />
        );
      case 'pending':
        return (
          <Notice title="Your request is waiting">
            We read every request and reply to {account.email}. Come back once you get the email.
          </Notice>
        );
      case 'rejected':
        return (
          <Notice title="Your request was not approved">
            We have room for a few people only. You can still read the evals and the leaderboard.
          </Notice>
        );
      case 'approved':
        return (
          <Notice title="You have access">
            Open the{' '}
            <Link href="/console" className="text-ink underline">
              console
            </Link>{' '}
            or the{' '}
            <Link href="/arena" className="text-ink underline">
              Red Team Lab
            </Link>
            .
          </Notice>
        );
    }
  };

  return (
    <div className="mt-10 flex flex-col gap-6">
      <section className="border-line bg-surface/70 rounded-card border p-6">{panel()}</section>
      {!account && (
        <p className="text-muted text-sm">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-ink underline">
            Sign in
          </Link>
        </p>
      )}
    </div>
  );
}
