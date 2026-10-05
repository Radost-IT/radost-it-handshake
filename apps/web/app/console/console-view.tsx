'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { FORM_INPUT_CLASS } from '../components/form-styles';
import { API_KEY_STORAGE_KEY, fetchDeals, messageOf, type Deal } from '../deals/api';
import { DealAuditLog } from './deal-audit-log';
import { DealsGrid } from './deals-grid';
import { OpenDealForm } from './open-deal-form';

const API_KEY_PREFIX = 'hs_sandbox_';

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

type DealsState =
  { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; deals: Deal[] };

export function ConsoleView() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [deals, setDeals] = useState<DealsState>({ kind: 'loading' });
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    setApiKey(readStoredApiKey());
  }, []);

  useEffect(() => {
    if (!apiKey) return;
    let isActive = true;
    fetchDeals(apiKey)
      .then((loaded) => {
        if (isActive) setDeals({ kind: 'ready', deals: loaded });
      })
      .catch((error: unknown) => {
        if (isActive) setDeals({ kind: 'failed', message: messageOf(error) });
      });
    return () => {
      isActive = false;
    };
  }, [apiKey, reloads]);

  const switchApiKey = (key: string | null) => {
    storeApiKey(key);
    setApiKey(key);
    setDeals({ kind: 'loading' });
    setSelectedDealId(null);
  };

  if (!apiKey) return <ApiKeyForm onKey={switchApiKey} />;

  return (
    <div className="mt-10 flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted font-mono text-sm">
          {apiKey.slice(0, API_KEY_PREFIX.length + 4)}...
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              setReloads((count) => count + 1);
            }}
            className="border-line hover:border-ink rounded-full border px-4 py-1.5 text-sm font-semibold"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              switchApiKey(null);
            }}
            className="border-line hover:border-ink rounded-full border px-4 py-1.5 text-sm font-semibold"
          >
            Forget key
          </button>
        </div>
      </div>

      <OpenDealForm
        apiKey={apiKey}
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
          apiKey={apiKey}
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
      className="border-line bg-surface/70 rounded-card mt-10 flex max-w-xl flex-col gap-4 border p-6"
    >
      <label className="flex flex-col gap-2 text-sm font-semibold">
        API key
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
      <button
        type="submit"
        disabled={!isValid}
        className="bg-accent text-on-accent self-start rounded-full px-6 py-2 text-sm font-semibold disabled:opacity-50"
      >
        Open console
      </button>
    </form>
  );
}
