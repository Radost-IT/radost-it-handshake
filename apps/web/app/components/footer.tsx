import Link from 'next/link';
import { LEGAL_LINKS } from '../legal';
import { CookieConsent } from './cookie-consent';
import { NewsletterForm } from './newsletter-form';

export function Footer() {
  return (
    <footer className="border-line text-muted border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8 text-sm">
        <NewsletterForm />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p>
            Handshake by{' '}
            <a href="https://radostit.com" className="hover:text-ink transition-colors">
              Radost IT
            </a>
            . PayPal sandbox only, no real money moves.
          </p>
          <nav aria-label="Legal" className="flex flex-wrap items-center gap-4">
            <Link href="/contact" className="hover:text-ink transition-colors">
              Contact
            </Link>
            {LEGAL_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="hover:text-ink transition-colors">
                {link.label}
              </a>
            ))}
            <CookieConsent />
          </nav>
        </div>
      </div>
    </footer>
  );
}
