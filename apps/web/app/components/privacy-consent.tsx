import type { ReactNode } from 'react';
import { PRIVACY_POLICY_URL } from '../legal';

export function PrivacyConsent({ children }: { children: ReactNode }) {
  return (
    <label className="text-muted flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        name="areTermsAccepted"
        required
        className="accent-accent mt-0.5 h-4 w-4 shrink-0"
      />
      <span>
        {children} as described in the{' '}
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-ink underline transition-colors"
        >
          privacy policy
        </a>
        .
      </span>
    </label>
  );
}
