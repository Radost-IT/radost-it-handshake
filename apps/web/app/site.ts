import type { Metadata } from 'next';

export const SITE_URL = 'https://handshake.radostit.com';
export const SITE_NAME = 'Handshake by Radost IT';
export const SITE_DESCRIPTION =
  'Escrow for AI shopping agents. Agents negotiate real products and pay through PayPal escrow. The money moves only when a verifier checks the delivery against the signed contract.';
export const API_URL = 'https://api-handshake.radostit.com';
export const LIVE_URL = 'wss://ws-handshake.radostit.com';

export const PUBLISHER = {
  '@type': 'Organization',
  '@id': 'https://radostit.com/#organization',
  name: 'Radost IT',
  url: 'https://radostit.com',
  logo: `${SITE_URL}/logo.png`,
  sameAs: ['https://x.com/radostithq'],
} as const;

/** Screenshots of one real sandbox deal and the Red Team Lab, served from /screenshots. */
export const SCREENSHOTS = [
  {
    file: '02-negotiation',
    caption:
      'A buyer agent and a seller agent bargain on Amazon Bedrock. The listing says 65 USD; they agree on 57 USD.',
  },
  {
    file: '03-approve-price',
    caption:
      'The agreed price is above the buyer approval threshold, so the buyer approves it before anything is paid.',
  },
  {
    file: '05-settled-timeline',
    caption:
      'The escrow timeline: price agreed, funds held, delivery claimed and payment captured, with the PayPal capture ID.',
  },
  {
    file: '06-paypal-activity',
    caption:
      'The verifier checks the delivery evidence against the contract. Every PayPal call and webhook is logged with its debug_id.',
  },
  {
    file: '07-console-deals',
    caption:
      'The developer console lists each deal and its PayPal calls, with the deterministic PayPal-Request-Id of each call.',
  },
  {
    file: '09-red-team-lab',
    caption:
      'The Red Team Lab: play a dishonest seller and attack the live buyer and verifier agents.',
  },
  {
    file: '10-attack-held',
    caption:
      'A platform impersonation attack. The agents ignored it, and policy code approved only the negotiated price.',
  },
  {
    file: '11-evals',
    caption:
      'The agent defense report: attack scenarios held and baseline deals passed on Amazon Bedrock.',
  },
] as const;

export function screenshotUrl(file: string, width?: 750): string {
  return `/screenshots/${file}${width ? `-${width}` : ''}.webp`;
}

export const SHARE_IMAGES = {
  home: {
    url: '/opengraph-image.jpg',
    alt: 'Handshake by Radost IT logo: a neon octagon around the word Handshake',
  },
  arena: {
    url: '/share/arena.jpg',
    alt: 'The Handshake Red Team Lab, where you play a dishonest seller and attack live AI agents',
  },
  evals: {
    url: '/share/evals.jpg',
    alt: 'The Handshake agent defense report: attack scenarios held and baseline deals passed on Amazon Bedrock',
  },
  merchants: {
    url: '/share/merchants.jpg',
    alt: 'The Handshake merchant page: sell to AI shopping agents with a PayPal business account',
  },
  console: {
    url: '/share/console.jpg',
    alt: 'The Handshake developer console: deals and the PayPal API calls behind each one',
  },
} as const;

/**
 * Metadata for a public page. Open Graph and Twitter fields are set per page,
 * because Next.js would otherwise inherit the home page title and URL. Setting
 * them drops the inherited share image, so each page names its image.
 */
export function pageMetadata(page: {
  title: string;
  description: string;
  path: string;
  shareImage?: { url: string; alt: string };
}): Metadata {
  const title = `${page.title} - ${SITE_NAME}`;
  const image = { ...(page.shareImage ?? SHARE_IMAGES.home), width: 1200, height: 630 };
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      siteName: SITE_NAME,
      url: page.path,
      title,
      description: page.description,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@radostithq',
      creator: '@radostithq',
      title,
      description: page.description,
      images: [image],
    },
  };
}
