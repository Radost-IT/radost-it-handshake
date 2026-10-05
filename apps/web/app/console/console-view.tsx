'use client';

import Link from 'next/link';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { fetchAccount, signOut, type Account } from '../arena/api';
import { FORM_INPUT_CLASS, SUBMIT_BUTTON_CLASS } from '../components/form-styles';
import { Notice } from '../components/notice';
import {
  API_KEY_STORAGE_KEY,
  fetchDeals,
  messageOf,
  type DealCredential,
  type Deal,
} from '../deals/api';
import { DealAuditLog } from './deal-audit-log';
import { DealsGrid } from './deals-grid';
import { OpenDealForm } from './open-deal-form';

const API_KEY_PREFIX = 'hs_sandbox_';

const OUTLINE_BUTTON_CLASS =
  'border-line hover:border-ink rounded-full border px-4 py-1.5 text-sm font-semibold';

function readStoredApiKey(): string | null {
  try {
    return sessionStorage.getItem(API_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeApiKey(apiKey: string | null): void {
  try {
    if (apiKey) sessionStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    else sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    // Without storage the key lasts until the page is reloaded.
  }
}

type Access =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'api-key'; apiKey: string }
  | { kind: 'session'; email: string }
  | { kind: 'signed-out'; account: Account | null };

function accessOf(account: Account | null): Access {
  return account?.access === 'approved'
    ? { kind: 'session', email: account.email }
    : { kind: 'signed-out', account };
}

/** An API key in the tab wins over the session, so a developer can test their own key. */
export function ConsoleView() {
  const [access, setAccess] = useState<Access>({ kind: 'loading' });

  const loadAccount = () => {
    fetchAccount()
      .then((account) => {
        setAccess(accessOf(account));
      })
      .catch((error: unknown) => {
        setAccess({ kind: 'failed', message: messageOf(error) });
      });
  };

  useEffect(() => {
    const apiKey = readStoredApiKey();
    if (apiKey) setAccess({ kind: 'api-key', apiKey });
    else loadAccount();
  }, []);

  const openWithApiKey = (apiKey: string) => {
    storeApiKey(apiKey);
    setAccess({ kind: 'api-key', apiKey });
  };

  switch (access.kind) {
    case 'loading':
      return <p className="text-muted mt-10">Loading...</p>;
    case 'failed':
      return <p className="text-refused mt-10">{access.message}</p>;
    case 'signed-out':
      return <SignedOut account={access.account} onApiKey={openWithApiKey} />;
    case 'api-key':
      return (
        <Workspace
          credential={access.apiKey}
          who={`${access.apiKey.slice(0, API_KEY_PREFIX.length + 4)}...`}
          leaveLabel="Forget key"
          onLeave={() => {
            storeApiKey(null);
            setAccess({ kind: 'loading' });
            loadAccount();
          }}
        />
      );
    case 'session':
      return (
        <Workspace
          credential={null}
          who={access.email}
          leaveLabel="Sign out"
          onLeave={() => {
            signOut()
              .then(() => {
                setAccess({ kind: 'signed-out', account: null });
              })
              .catch((error: unknown) => {
                setAccess({ kind: 'failed', message: messageOf(error) });
              });
          }}
        />
      );
  }
}

interface SignedOutProps {
  account: Account | null;
  onApiKey: (apiKey: string) => void;
}

function SignedOut({ account, onApiKey }: SignedOutProps) {
  return (
    <div className="mt-10 grid max-w-4xl items-start gap-6 md:grid-cols-2">
      <section className="border-line bg-surface/70 rounded-card border p-6">
        <AccountStatus account={account} />
      </section>
      <ApiKeyForm onKey={onApiKey} />
    </div>
  );
}

function AccountStatus({ account }: { account: Account | null }) {
  switch (account?.access) {
    case undefined:
      return (
        <div className="flex flex-col gap-4">
          <Notice title="Sign in">
            Judges and invited developers sign in with their account. No account yet? Request access
            and we reply by email.
          </Notice>
          <div className="flex flex-wrap gap-3">
            <Link href="/sign-in?next=/console" className={SUBMIT_BUTTON_CLASS}>
              Sign in
            </Link>
            <Link href="/request-access" className={OUTLINE_BUTTON_CLASS}>
              Request access
            </Link>
          </div>
        </div>
      );
    case 'none':
      return (
        <Notice title="Request access">
          You are signed in as {account.email}.{' '}
          <Link href="/request-access" className="text-ink underline">
            Tell us what you want to build
          </Link>{' '}
          to use the console.
        </Notice>
      );
    case 'pending':
      return (
        <Notice title="Your request is waiting">
          We reply to {account.email} once we have read it.
        </Notice>
      );
    case 'rejected':
      return (
        <Notice title="Your request was not approved">
          You can still use the console with an API key.
        </Notice>
      );
    case 'approved':
      return null;
  }
}

type DealsState =
  { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; deals: Deal[] };

interface WorkspaceProps {
  credential: DealCredential;
  who: string;
  leaveLabel: string;
  onLeave: () => void;
}

function Workspace({ credential, who, leaveLabel, onLeave }: WorkspaceProps) {
  const [deals, setDeals] = useState<DealsState>({ kind: 'loading' });
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let isActive = true;
    fetchDeals(credential)
      .then((loaded) => {
        if (isActive) setDeals({ kind: 'ready', deals: loaded });
      })
      .catch((error: unknown) => {
        if (isActive) setDeals({ kind: 'failed', message: messageOf(error) });
      });
    return () => {
      isActive = false;
    };
  }, [credential, reloads]);

  return (
    <div className="mt-10 flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted font-mono text-sm">{who}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setReloads((count) => count + 1);
            }}
            className={OUTLINE_BUTTON_CLASS}
          >
            Refresh
          </button>
          <button type="button" onClick={onLeave} className={OUTLINE_BUTTON_CLASS}>
            {leaveLabel}
          </button>
        </div>
      </div>

      <OpenDealForm
        credential={credential}
        onOpened={(dealId) => {
          setSelectedDealId(dealId);
          setReloads((count) => count + 1);
        }}
      />

      <section>
        <h2 className="text-xl font-semibold">Deals</h2>
        <p className="text-muted mt-1 text-sm">Select a deal to see its PayPal activity.</p>
        {deals.kind === 'failed' ? (
          <p className="text-refused mt-4 text-sm">{deals.message}</p>
        ) : (
          <DealsGrid
            deals={deals.kind === 'ready' ? deals.deals : null}
            onSelect={setSelectedDealId}
          />
        )}
      </section>

      {selectedDealId && (
        <DealAuditLog
          key={`${selectedDealId}-${reloads}`}
          credential={credential}
          dealId={selectedDealId}
        />
      )}
    </div>
  );
}

function ApiKeyForm({ onKey }: { onKey: (apiKey: string) => void }) {
  const [value, setValue] = useState('');
  const isValid = value.trim().startsWith(API_KEY_PREFIX);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isValid) onKey(value.trim());
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-line bg-surface/70 rounded-card flex flex-col gap-4 border p-6"
    >
      <label className="flex flex-col gap-2 text-sm font-semibold">
        Or use an API key
        <input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          placeholder="hs_sandbox_..."
          className={`${FORM_INPUT_CLASS} font-mono`}
        />
      </label>
      <p className="text-muted text-sm">
        The key stays in this browser tab and is sent only to the Handshake API.
      </p>
      <button type="submit" disabled={!isValid} className={SUBMIT_BUTTON_CLASS}>
        Open console
      </button>
    </form>
  );
}
