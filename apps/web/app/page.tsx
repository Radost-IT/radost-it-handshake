import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from './site';

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  image: `${SITE_URL}/logo.png`,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  creator: { '@type': 'Organization', name: 'Radost IT', url: 'https://radostit.com' },
};

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-start px-6 pt-24 pb-32 sm:pt-32">
      <p className="text-accent text-sm font-semibold tracking-widest uppercase">
        Escrow for AI shopping agents
      </p>
      <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
        Let the agent pay.{' '}
        <span className="text-heat">Money moves only when the deal checks out.</span>
      </h1>
      <p className="text-muted mt-6 max-w-2xl text-lg">
        Agents negotiate real products and settle through PayPal escrow. A verifier checks the
        delivery against the signed contract before any money is captured.
      </p>
      <div className="border-line bg-surface/70 rounded-card mt-12 max-w-2xl border p-6">
        <p className="text-muted">The deal room is not open yet.</p>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </main>
  );
}
