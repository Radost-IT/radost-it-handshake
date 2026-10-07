import Link from 'next/link';
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

const entryPoints = [
  {
    href: '/console',
    title: 'Developer console',
    description: 'Open a sandbox deal with an API key and read every PayPal call behind it.',
  },
  {
    href: '/evals',
    title: 'Agent evals',
    description: 'How often the agents held against each kind of attack, from the latest run.',
  },
  {
    href: '/arena',
    title: 'Red Team Lab',
    description: 'Play a dishonest seller. A breach pays a sandbox bounty and becomes a test.',
  },
  {
    href: '/merchants',
    title: 'Merchants',
    description: 'Apply with a PayPal business account and run seller agents with a floor price.',
  },
];

const escrowSteps = [
  { title: 'Agree', description: 'Buyer and seller agents bargain and sign a contract.' },
  { title: 'Hold', description: 'PayPal authorizes the price. Nothing is captured yet.' },
  { title: 'Verify', description: 'A verifier checks the delivery against the contract.' },
  { title: 'Settle', description: 'Policy code captures the payment or voids the hold.' },
];

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
      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/console"
          className="bg-accent text-on-accent rounded-full px-6 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
        >
          Open a sandbox deal
        </Link>
        <Link
          href="/arena"
          className="border-line hover:border-ink rounded-full border px-6 py-2.5 text-sm font-semibold transition-colors"
        >
          Attack the agents
        </Link>
      </div>
      <ol className="border-line bg-surface/50 rounded-card mt-16 grid w-full gap-px overflow-hidden border sm:grid-cols-4">
        {escrowSteps.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-1 p-6">
            <span className="text-accent font-mono text-xs font-semibold">0{index + 1}</span>
            <span className="text-lg font-semibold">{step.title}</span>
            <span className="text-muted text-sm">{step.description}</span>
          </li>
        ))}
      </ol>
      <ul className="mt-6 grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {entryPoints.map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className="group border-line bg-surface/70 rounded-card hover:border-accent/60 flex h-full flex-col gap-2 border p-6 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-12px_var(--accent)]"
            >
              <span className="flex items-center justify-between font-semibold">
                {entry.title}
                <span
                  aria-hidden="true"
                  className="text-muted group-hover:text-accent transition-transform group-hover:translate-x-0.5"
                >
                  &rarr;
                </span>
              </span>
              <span className="text-muted text-sm">{entry.description}</span>
            </Link>
          </li>
        ))}
      </ul>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </main>
  );
}
