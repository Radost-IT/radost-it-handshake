'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CodeSignInForm } from '../account/code-sign-in-form';
import { nextPathFrom } from '../account/next-path';
import type { AccessStatus } from '../arena/api';

export function SignInView() {
  const router = useRouter();

  // An account without access yet continues to its request.
  const continueAs = (access: AccessStatus) => {
    router.push(access === 'approved' ? nextPathFrom(window.location.search) : '/request-access');
  };

  return (
    <div className="mt-10 flex flex-col gap-6">
      <section className="border-line bg-surface/70 rounded-card border p-6">
        <CodeSignInForm onSignedIn={continueAs} />
      </section>
      <p className="text-muted text-sm">
        No account yet?{' '}
        <Link href="/request-access" className="text-ink underline">
          Request access
        </Link>
      </p>
    </div>
  );
}
