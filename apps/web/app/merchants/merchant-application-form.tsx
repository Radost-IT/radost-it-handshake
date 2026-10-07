'use client';

import { useState, type SyntheticEvent } from 'react';
import { applyAsMerchant, messageOf, type MerchantApplication } from '../arena/api';
import { FORM_INPUT_CLASS, SUBMIT_BUTTON_CLASS } from '../components/form-styles';

const MAX_PRODUCTS_LENGTH = 300;

interface MerchantApplicationFormProps {
  email: string;
  minProductsLength: number;
  onApplied: () => void;
}

const emptyApplication: MerchantApplication = {
  businessName: '',
  website: '',
  payoutEmail: '',
  products: '',
};

export function MerchantApplicationForm({
  email,
  minProductsLength,
  onApplied,
}: MerchantApplicationFormProps) {
  const [application, setApplication] = useState(emptyApplication);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const field = (name: keyof MerchantApplication) => ({
    name,
    value: application[name],
    onChange: (event: { target: { value: string } }) => {
      setApplication((current) => ({ ...current, [name]: event.target.value }));
    },
    required: true,
    className: FORM_INPUT_CLASS,
  });

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    setError(null);
    applyAsMerchant(application)
      .then(onApplied)
      .catch((cause: unknown) => {
        setError(messageOf(cause));
        setIsSending(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Apply as a merchant</h2>
      <p className="text-muted text-sm">
        You are signed in as <span className="text-ink">{email}</span>. During the beta we approve
        every business by hand and reply by email.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Business name
          <input {...field('businessName')} maxLength={100} autoComplete="organization" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Website
          <input {...field('website')} type="url" placeholder="https://" autoComplete="url" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        PayPal business account email
        <input {...field('payoutEmail')} type="email" autoComplete="email" />
        <span className="text-muted text-xs">
          The account that should receive your money. During the sandbox beta, payments settle to
          Handshake&apos;s PayPal sandbox account.
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        What do you sell?
        <textarea
          {...field('products')}
          rows={3}
          minLength={minProductsLength}
          maxLength={MAX_PRODUCTS_LENGTH}
        />
      </label>
      {error && <p className="text-refused text-sm">{error}</p>}
      <button type="submit" disabled={isSending} className={SUBMIT_BUTTON_CLASS}>
        {isSending ? 'Sending...' : 'Send application'}
      </button>
    </form>
  );
}
