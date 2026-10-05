import type { Metadata } from 'next';
import { SignInView } from './sign-in-view';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to the Handshake console and the Red Team Lab.',
  robots: { index: false, follow: false },
};

export default function SignInPage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <h1 className="text-4xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-muted mt-4">
        Signed-in accounts open sandbox deals in the console and attack the agents in the Red Team
        Lab.
      </p>
      <SignInView />
    </main>
  );
}
