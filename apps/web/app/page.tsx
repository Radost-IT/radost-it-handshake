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
      <ul className="mt-12 grid w-full gap-4 sm:grid-cols-3">
        {entryPoints.map((entry) => (
          <li key={entry.href}>
            <Link
              href={entry.href}
              className="border-line bg-surface/70 rounded-card hover:border-ink flex h-full flex-col gap-2 border p-6"
            >
              <span className="font-semibold">{entry.title}</span>
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
