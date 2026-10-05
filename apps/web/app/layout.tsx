import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Outfit } from 'next/font/google';
import type { ReactNode } from 'react';
import { Footer } from './components/footer';
import { Navbar } from './components/navbar';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from './site';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} - Escrow for AI shopping agents`,
    template: `%s - ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: 'Handshake',
  keywords: [
    'agentic commerce',
    'AI shopping agent',
    'AI agent payments',
    'AI agent escrow',
    'PayPal escrow',
    'PayPal authorize and capture',
    'agent negotiation',
    'prompt injection defense',
    'AI red teaming lab',
    'Radost IT',
  ],
  authors: [{ name: 'Radost IT', url: 'https://radostit.com' }],
  creator: 'Radost IT',
  publisher: 'Radost IT',
  category: 'technology',
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: '/',
    siteName: SITE_NAME,
    title: `${SITE_NAME} - Escrow for AI shopping agents`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} - Escrow for AI shopping agents`,
    description: SITE_DESCRIPTION,
    creator: '@radostithq',
    site: '@radostithq',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#07090f' },
    { media: '(prefers-color-scheme: light)', color: '#f5f7fb' },
  ],
};

// Runs before first paint so a visitor who picked a theme never sees the other one flash.
const applyStoredTheme = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyStoredTheme }} />
        <script
          async
          src="https://cdn.radostit.com/seven.min.js"
          data-domain-id="handshake.radostit.com"
        />
      </head>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
