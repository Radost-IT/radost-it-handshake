'use client';

import { useState, type SyntheticEvent } from 'react';
import { FORM_INPUT_CLASS, SUBMIT_BUTTON_CLASS } from '../components/form-styles';
import { messageOf, signInWithPassword, type AccessStatus } from '../arena/api';

/** For accounts the operator created with a password, such as the judges' account. */
export function PasswordSignInForm({ onSignedIn }: { onSignedIn: (access: AccessStatus) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    setError(null);
    signInWithPassword(email, password)
      .then(onSignedIn)
      .catch((cause: unknown) => {
        setError(messageOf(cause));
        setIsSending(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          required
          autoComplete="username"
          className={FORM_INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          name="password"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          required
          maxLength={200}
          autoComplete="current-password"
          className={FORM_INPUT_CLASS}
        />
      </label>
      {error && <p className="text-refused text-sm">{error}</p>}
      <button type="submit" disabled={isSending} className={SUBMIT_BUTTON_CLASS}>
        {isSending ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
