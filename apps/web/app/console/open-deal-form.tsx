'use client';

import { useState, type SyntheticEvent } from 'react';
import { FORM_INPUT_CLASS } from '../components/form-styles';
import { messageOf, openDeal, type DealCredential } from '../deals/api';

interface OpenDealFormProps {
  credential: DealCredential;
  onOpened: (dealId: string) => void;
}

export function OpenDealForm({ credential, onOpened }: OpenDealFormProps) {
  const [goal, setGoal] = useState('');
  const [maxPrice, setMaxPrice] = useState('60.00');
  const [approvalThreshold, setApprovalThreshold] = useState('50.00');
  const [sellerId, setSellerId] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyerUrl, setBuyerUrl] = useState<string | null>(null);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    setError(null);
    openDeal(credential, {
      goal,
      mandate: {
        maxPrice: { currency: 'USD', value: maxPrice },
        humanApprovalThreshold: { currency: 'USD', value: approvalThreshold },
        blockedCategories: [],
      },
      ...(sellerId.trim() ? { sellerId: sellerId.trim() } : {}),
    })
      .then((opened) => {
        setBuyerUrl(opened.buyerUrl);
        onOpened(opened.deal.id);
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause));
      })
      .finally(() => {
        setIsSending(false);
      });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-line bg-surface/70 rounded-card flex flex-col gap-4 border p-6"
    >
      <h2 className="text-xl font-semibold">Open a sandbox deal</h2>
      <label className="flex flex-col gap-2 text-sm font-semibold">
        What should the agent buy?
        <input
          required
          minLength={3}
          maxLength={500}
          value={goal}
          onChange={(event) => {
            setGoal(event.target.value);
          }}
          placeholder="A steel water bottle"
          className={FORM_INPUT_CLASS}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-2 text-sm font-semibold">
          Budget (USD)
          <input
            required
            inputMode="decimal"
            pattern="\d+\.\d{2}"
            value={maxPrice}
            onChange={(event) => {
              setMaxPrice(event.target.value);
            }}
            className={FORM_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-semibold">
          Ask me above (USD)
          <input
            required
            inputMode="decimal"
            pattern="\d+\.\d{2}"
            value={approvalThreshold}
            onChange={(event) => {
              setApprovalThreshold(event.target.value);
            }}
            className={FORM_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm font-semibold">
          Seller ID (optional)
          <input
            value={sellerId}
            onChange={(event) => {
              setSellerId(event.target.value);
            }}
            placeholder="Shop the catalog"
            className={`${FORM_INPUT_CLASS} font-mono`}
          />
        </label>
      </div>
      <p className="text-muted text-sm">
        Leave the seller ID empty to let the buyer agent shop the Channel3 catalog, or name a
        seller. <span className="font-mono">arena-backpack</span> fits a 60.00 budget. The others
        need more: <span className="font-mono">arena-running-shoes</span> 85.00,{' '}
        <span className="font-mono">arena-keyboard</span> 100.00,{' '}
        <span className="font-mono">arena-headphones</span> 110.00 and{' '}
        <span className="font-mono">arena-coffee-grinder</span> 140.00.
      </p>
      <button
        type="submit"
        disabled={isSending}
        className="bg-accent text-on-accent self-start rounded-full px-6 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {isSending ? 'Opening...' : 'Open deal'}
      </button>
      {error && <p className="text-refused text-sm">{error}</p>}
      {buyerUrl && (
        <p className="text-sm">
          The agents are negotiating.{' '}
          <a href={buyerUrl} className="text-accent font-semibold">
            Follow the deal as the buyer
          </a>
          . This link holds the deal&apos;s access token, so share it only with the buyer.
        </p>
      )}
    </form>
  );
}
