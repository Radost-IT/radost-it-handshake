import { CookieConsent } from './cookie-consent';

export function Footer() {
  return (
    <footer className="border-line text-muted border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm">
        <p>
          Handshake by{' '}
          <a href="https://radostit.com" className="hover:text-ink transition-colors">
            Radost IT
          </a>
          . PayPal sandbox only, no real money moves.
        </p>
        <CookieConsent />
      </div>
    </footer>
  );
}
