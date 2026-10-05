'use client';

import { useState, type SyntheticEvent } from 'react';
import { FORM_INPUT_CLASS } from '../components/form-styles';
import { createChallenger, messageOf, type Challenger } from './api';

export function HandleForm({ onCreated }: { onCreated: (challenger: Challenger) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [handle, setHandle] = useState('');

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    setError(null);
    createChallenger(handle)
      .then(onCreated)
      .catch((cause: unknown) => {
        setError(messageOf(cause));
      })
      .finally(() => {
        setIsSending(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Pick a handle to start</h2>
      <p className="text-muted text-sm">
        Your access is approved. Your handle shows on the leaderboard instead of your email.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Handle
        <input
          name="handle"
          value={handle}
          onChange={(event) => {
            setHandle(event.target.value);
          }}
          required
          autoComplete="nickname"
          className={FORM_INPUT_CLASS}
        />
      </label>
      {error && <p className="text-refused text-sm">{error}</p>}
      <button
        type="submit"
        disabled={isSending}
        className="bg-heat text-on-accent self-start rounded-full px-6 py-2 text-sm font-semibold disabled:opacity-50"
      >
        {isSending ? 'Joining...' : 'Join the lab'}
      </button>
    </form>
  );
}
