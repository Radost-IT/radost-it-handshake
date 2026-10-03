'use client';

import { useEffect, type SyntheticEvent } from 'react';
import { FormErrorMessage } from './form-error-message';
import { FORM_INPUT_CLASS } from './form-styles';
import { PrivacyConsent } from './privacy-consent';
import { SpamGuardFields, readSpamGuardFields } from './spam-guard-fields';
import { useFormSubmission } from './use-form-submission';

export function NewsletterForm() {
  const { status, attempts, submit, checkLock } = useFormSubmission('/api/newsletter');

  useEffect(() => {
    void checkLock();
  }, [checkLock]);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit({
      email: form.get('email'),
      areTermsAccepted: form.get('areTermsAccepted') === 'on',
      ...readSpamGuardFields(form),
    });
  };

  if (status.kind === 'sent') {
    return <p className="text-settled text-sm">You are subscribed. Thanks.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="relative flex max-w-md flex-col gap-3">
      <p className="text-ink font-semibold">Product updates</p>
      <p>Get an email when the deal room and the arena open.</p>
      <div className="flex gap-2">
        <label htmlFor="newsletter-email" className="sr-only">
          Email
        </label>
        <input
          id="newsletter-email"
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          placeholder="you@example.com"
          className={`${FORM_INPUT_CLASS} min-w-0 flex-1`}
        />
        <button
          type="submit"
          disabled={status.kind === 'sending' || status.kind === 'locked'}
          className="bg-accent text-on-accent rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {status.kind === 'sending' ? 'Sending...' : 'Subscribe'}
        </button>
      </div>
      <PrivacyConsent>I agree to receive product emails from Radost IT,</PrivacyConsent>
      <SpamGuardFields key={attempts} />
      <FormErrorMessage status={status} />
    </form>
  );
}
