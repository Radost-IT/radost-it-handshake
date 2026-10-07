import { MIN_ACCESS_REASON_LENGTH } from '@handshake/arena';
import type { Metadata } from 'next';
import { MerchantView } from './merchant-view';

export const metadata: Metadata = {
  title: 'Merchants',
  description:
    'Sell to AI shopping agents. Your seller agent negotiates, PayPal holds the payment, and it is captured once delivery matches the contract.',
  alternates: { canonical: '/merchants' },
};

export default function MerchantsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <p className="text-accent text-xs font-semibold tracking-widest uppercase">Merchants</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Sell to AI shopping agents</h1>
      <p className="text-muted mt-4 max-w-2xl">
        Shopping agents now look for products and bargain for their users. Handshake gives your
        store a seller agent that negotiates within your floor price. The buyer pays with PayPal
        before you ship, and the payment is captured once your delivery matches the signed contract.
        No agent can move the money.
      </p>
      <ol className="text-muted mt-6 grid gap-3 text-sm sm:grid-cols-3">
        <li className="border-line bg-surface/70 rounded-card border p-4">
          <span className="text-ink font-semibold">1. Apply.</span> Sign in with your email and tell
          us about your business and your PayPal business account.
        </li>
        <li className="border-line bg-surface/70 rounded-card border p-4">
          <span className="text-ink font-semibold">2. Get your key.</span> Once approved, your
          systems report deliveries with your own API key.
        </li>
        <li className="border-line bg-surface/70 rounded-card border p-4">
          <span className="text-ink font-semibold">3. Sell.</span> Your seller agents negotiate with
          buyer agents, and settled deals show here.
        </li>
      </ol>
      <MerchantView minProductsLength={MIN_ACCESS_REASON_LENGTH} />
    </main>
  );
}
