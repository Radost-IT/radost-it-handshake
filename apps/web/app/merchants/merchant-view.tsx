'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CodeSignInForm } from '../account/code-sign-in-form';
import { fetchAccount, messageOf, type Account } from '../arena/api';
import { Notice } from '../components/notice';
import { MerchantApplicationForm } from './merchant-application-form';
import { MerchantSettingsView } from './merchant-settings';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; account: Account | null };

export function MerchantView({ minProductsLength }: { minProductsLength: number }) {
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
  if (account?.access === 'approved') return <MerchantSettingsView />;

  const panel = () => {
    if (!account) return <CodeSignInForm onSignedIn={loadAccount} />;
    switch (account.access) {
      case 'none':
        return (
          <MerchantApplicationForm
            email={account.email}
            minProductsLength={minProductsLength}
            onApplied={() => {
              setLoad({ kind: 'ready', account: { ...account, access: 'pending' } });
            }}
          />
        );
      case 'pending':
        return (
          <Notice title="Your request is waiting">
            During the beta we approve every business by hand and reply to {account.email}. Come
            back once you get the email.
          </Notice>
        );
      case 'rejected':
        return (
          <Notice title="Your request was not approved">
            We have room for a few businesses only during the beta.
          </Notice>
        );
    }
  };

  return (
    <div className="mt-10 flex flex-col gap-6">
      <section className="border-line bg-surface/70 rounded-card border p-6">{panel()}</section>
      {!account && (
        <p className="text-muted text-sm">
          Judges and approved merchants sign in with their account to see their settings. Building a
          shopping agent instead?{' '}
          <Link href="/request-access" className="text-ink underline">
            Request developer access
          </Link>
          .
        </p>
      )}
    </div>
  );
}
