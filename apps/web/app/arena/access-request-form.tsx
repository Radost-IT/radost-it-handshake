'use client';

import { useState, type SyntheticEvent } from 'react';
import { FORM_INPUT_CLASS } from '../components/form-styles';
import { messageOf, requestAccess } from './api';

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
      <h2 className="text-xl font-semibold">Ask to join</h2>
      <p className="text-muted text-sm">
        You are signed in as <span className="text-ink">{email}</span>. Tell us who you are and why
        you want to attack the agents. We reply by email.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Why do you want to play?
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
      <button
        type="submit"
        disabled={isSending}
        className="bg-heat text-on-accent self-start rounded-full px-6 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {isSending ? 'Sending...' : 'Send request'}
      </button>
    </form>
  );
}
