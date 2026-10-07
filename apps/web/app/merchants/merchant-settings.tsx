'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchMerchantSettings, messageOf, type MerchantSettings } from '../arena/api';
import { FORM_INPUT_CLASS, SUBMIT_BUTTON_CLASS } from '../components/form-styles';
import { Panel } from '../components/panel';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; settings: MerchantSettings };

const formatMoney = (money: { value: string; currency: string }) =>
  `${money.value} ${money.currency}`;
const formatDate = (at: string) => new Date(at).toLocaleDateString();

/** Read-only during the beta: every value is shown, nothing can be saved yet. */
export function MerchantSettingsView() {
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    fetchMerchantSettings()
      .then((settings) => {
        setLoad({ kind: 'ready', settings });
      })
      .catch((error: unknown) => {
        setLoad({ kind: 'failed', message: messageOf(error) });
      });
  }, []);

  if (load.kind === 'loading') return <p className="text-muted mt-10">Loading...</p>;
  if (load.kind === 'failed') return <p className="text-refused mt-10">{load.message}</p>;

  const { merchant, apiKeys, sellers } = load.settings;
  if (!merchant) {
    return (
      <section className="border-line bg-surface/70 rounded-card mt-10 border p-6">
        <h2 className="text-xl font-semibold">No merchant profile yet</h2>
        <p className="text-muted mt-2 text-sm">
          This account has developer access but no business. To sell through Handshake,{' '}
          <Link href="/contact" className="text-ink underline">
            write to us
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <div className="mt-10 flex flex-col gap-6">
      <p className="border-held/40 rounded-card border p-4 text-sm">
        Settings are read-only during the beta. To change a value,{' '}
        <Link href="/contact" className="underline">
          write to us
        </Link>
        .
      </p>

      <Panel title="Business">
        <div className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label="Business name" value={merchant.businessName} />
          <ReadOnlyField label="Website" value={merchant.website} />
        </div>
        <label className="mt-4 flex flex-col gap-1 text-sm">
          What you sell
          <textarea
            value={merchant.products}
            readOnly
            disabled
            rows={2}
            className={FORM_INPUT_CLASS}
          />
        </label>
        <p className="text-muted mt-3 text-xs">Merchant since {formatDate(merchant.createdAt)}.</p>
      </Panel>

      <Panel title="Payouts">
        <ReadOnlyField label="PayPal business account" value={merchant.payoutEmail} />
        <p className="text-muted mt-3 text-sm">
          During the sandbox beta, captured payments settle to Handshake&apos;s PayPal sandbox
          account. Paying each merchant&apos;s own account is next.
        </p>
      </Panel>

      <Panel title="API keys">
        <p className="text-muted text-sm">
          Your systems send this key to report deliveries for your sellers with{' '}
          <span className="font-mono">POST /v1/deals/&#123;dealId&#125;/evidence</span>. A key is
          shown only once, when it is created.
        </p>
        {apiKeys.length === 0 ? (
          <p className="text-muted mt-3 text-sm">No keys yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {apiKeys.map((key) => (
              <li key={`${key.createdAt}-${key.lastCharacters}`} className="flex flex-wrap gap-x-4">
                <span className="font-mono">hs_sandbox_...{key.lastCharacters}</span>
                <span>{key.name}</span>
                <span className="text-muted">created {formatDate(key.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <button type="button" disabled className={`${SUBMIT_BUTTON_CLASS} mt-4`}>
          Create a key
        </button>
      </Panel>

      <Panel title="Seller agents">
        <p className="text-muted text-sm">
          Each agent sells one listing and never goes below its floor price. Buyers open a deal with
          its seller ID.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {sellers.map((seller) => (
            <li key={seller.sellerId} className="border-line rounded-lg border p-4 text-sm">
              <p className="font-semibold">{seller.listing.title}</p>
              <p className="text-muted mt-1">
                Listed at {formatMoney(seller.listing.listPrice)}, floor{' '}
                {formatMoney(seller.floorPrice)}
              </p>
              <p className="mt-2">
                <span className="font-semibold">{seller.name}</span>: {seller.persona}
              </p>
              <p className="text-muted mt-2 font-mono text-xs">{seller.sellerId}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input value={value} readOnly disabled className={FORM_INPUT_CLASS} />
    </label>
  );
}
