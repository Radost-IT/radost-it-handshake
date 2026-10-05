'use client';

import { useState, type SyntheticEvent } from 'react';
import { FORM_INPUT_CLASS, SUBMIT_BUTTON_CLASS } from '../components/form-styles';
import { messageOf, requestAccess } from '../arena/api';

interface AccessRequestFormProps {
  email: string;
  minReasonLength: number;
  maxReasonLength: number;
  onRequested: () => void;
}

export function AccessRequestForm({
  email,
  minReasonLength,
  maxReasonLength,
  onRequested,
}: AccessRequestFormProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    setError(null);
    requestAccess(reason)
      .then(onRequested)
      .catch((cause: unknown) => {
        setError(messageOf(cause));
        setIsSending(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Request access</h2>
      <p className="text-muted text-sm">
        You are signed in as <span className="text-ink">{email}</span>. Tell us who you are and what
        you want to build or test. We reply by email.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Who are you, and what do you want to do?
        <textarea
          name="reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          required
          rows={4}
          minLength={minReasonLength}
          maxLength={maxReasonLength}
          className={FORM_INPUT_CLASS}
        />
      </label>
      <p className="text-muted text-xs">
        {reason.trim().length} of {maxReasonLength} characters, at least {minReasonLength}.
      </p>
      {error && <p className="text-refused text-sm">{error}</p>}
      <button type="submit" disabled={isSending} className={SUBMIT_BUTTON_CLASS}>
        {isSending ? 'Sending...' : 'Send request'}
      </button>
    </form>
  );
}
