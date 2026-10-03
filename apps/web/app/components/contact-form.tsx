'use client';

import { useEffect, type SyntheticEvent } from 'react';
import { FormErrorMessage } from './form-error-message';
import { FORM_INPUT_CLASS } from './form-styles';
import { PrivacyConsent } from './privacy-consent';
import { SpamGuardFields, readSpamGuardFields } from './spam-guard-fields';
import { useFormSubmission } from './use-form-submission';

export function ContactForm() {
  const { status, attempts, submit, checkLock } = useFormSubmission('/api/contact');

  useEffect(() => {
    void checkLock();
  }, [checkLock]);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void submit({
      name: form.get('name'),
      email: form.get('email'),
      company: form.get('company') || undefined,
      message: form.get('message'),
      areTermsAccepted: form.get('areTermsAccepted') === 'on',
      ...readSpamGuardFields(form),
    });
  };

  if (status.kind === 'sent') {
    return <p className="text-settled text-sm">Thanks. We will reply by email.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="relative flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            name="name"
            required
            maxLength={200}
            autoComplete="name"
            className={FORM_INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="email"
            className={FORM_INPUT_CLASS}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Company <span className="text-muted">(optional)</span>
        <input
          name="company"
          maxLength={200}
          autoComplete="organization"
          className={FORM_INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Message
        <textarea name="message" required maxLength={2000} rows={6} className={FORM_INPUT_CLASS} />
      </label>
      <PrivacyConsent>I agree that Radost IT stores my message to reply to me,</PrivacyConsent>
      <SpamGuardFields key={attempts} />
      <FormErrorMessage status={status} />
      <button
        type="submit"
        disabled={status.kind === 'sending' || status.kind === 'locked'}
        className="bg-accent text-on-accent self-start rounded-full px-6 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {status.kind === 'sending' ? 'Sending...' : 'Send message'}
      </button>
    </form>
  );
}
