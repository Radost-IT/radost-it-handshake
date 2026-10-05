'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CodeSignInForm } from '../account/code-sign-in-form';
import { nextPathFrom } from '../account/next-path';
import { PasswordSignInForm } from '../account/password-sign-in-form';
import type { AccessStatus } from '../arena/api';

export function SignInView() {
  const router = useRouter();
  const [usesCode, setUsesCode] = useState(false);

  // An account without access yet continues to its request.
  const continueAs = (access: AccessStatus) => {
    router.push(access === 'approved' ? nextPathFrom(window.location.search) : '/request-access');
  };

  return (
    <div className="mt-10 flex flex-col gap-6">
      <section className="border-line bg-surface/70 rounded-card border p-6">
        {usesCode ? (
          <CodeSignInForm onSignedIn={continueAs} />
        ) : (
          <PasswordSignInForm onSignedIn={continueAs} />
        )}
      </section>
      <div className="text-muted flex flex-col gap-2 text-sm">
        <button
          type="button"
          onClick={() => {
            setUsesCode((current) => !current);
          }}
          className="self-start underline"
        >
          {usesCode ? 'Sign in with a password' : 'No password? Sign in with an email code'}
        </button>
        <p>
          No account yet?{' '}
          <Link href="/request-access" className="text-ink underline">
            Request access
          </Link>
        </p>
      </div>
    </div>
  );
}
