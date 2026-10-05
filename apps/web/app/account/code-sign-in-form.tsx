'use client';

import { useState, type SyntheticEvent } from 'react';
import { FORM_INPUT_CLASS, SUBMIT_BUTTON_CLASS } from '../components/form-styles';
import { messageOf, requestSignInCode, verifySignInCode, type AccessStatus } from '../arena/api';

/** Signs in with a one-time code sent to the email, so anyone can prove their address. */
export function CodeSignInForm({ onSignedIn }: { onSignedIn: (access: AccessStatus) => void }) {
  const [email, setEmail] = useState('');
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);

  if (codeSentTo) {
    return (
      <CodeStep
        email={codeSentTo}
        onSignedIn={onSignedIn}
        onChangeEmail={() => {
          setCodeSentTo(null);
        }}
      />
    );
  }
  return <EmailStep email={email} onEmailChange={setEmail} onCodeSent={setCodeSentTo} />;
}

interface EmailStepProps {
  email: string;
  onEmailChange: (email: string) => void;
  onCodeSent: (email: string) => void;
}

function EmailStep({ email, onEmailChange, onCodeSent }: EmailStepProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    setError(null);
    requestSignInCode(email)
      .then(() => {
        onCodeSent(email);
      })
      .catch((cause: unknown) => {
        setError(messageOf(cause));
      })
      .finally(() => {
        setIsSending(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Confirm your email</h2>
      <p className="text-muted text-sm">We send a six-digit code to your email.</p>
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => {
            onEmailChange(event.target.value);
          }}
          required
          autoComplete="email"
          className={FORM_INPUT_CLASS}
        />
      </label>
      {error && <p className="text-refused text-sm">{error}</p>}
      <button type="submit" disabled={isSending} className={SUBMIT_BUTTON_CLASS}>
        {isSending ? 'Sending...' : 'Email me a code'}
      </button>
    </form>
  );
}

interface CodeStepProps {
  email: string;
  onSignedIn: (access: AccessStatus) => void;
  onChangeEmail: () => void;
}

function CodeStep({ email, onSignedIn, onChangeEmail }: CodeStepProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSending(true);
    setError(null);
    verifySignInCode(email, code)
      .then(onSignedIn)
      .catch((cause: unknown) => {
        setError(messageOf(cause));
        setIsSending(false);
      });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Check your email</h2>
      <p className="text-muted text-sm">
        We sent a six-digit code to <span className="text-ink">{email}</span>. It works for 10
        minutes.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        Code
        <input
          name="code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.trim());
          }}
          required
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          className={`${FORM_INPUT_CLASS} font-mono tracking-widest`}
        />
      </label>
      {error && <p className="text-refused text-sm">{error}</p>}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={isSending} className={SUBMIT_BUTTON_CLASS}>
          {isSending ? 'Checking...' : 'Sign in'}
        </button>
        <button type="button" onClick={onChangeEmail} className="text-muted text-sm underline">
          Use another email or send a new code
        </button>
      </div>
    </form>
  );
}
