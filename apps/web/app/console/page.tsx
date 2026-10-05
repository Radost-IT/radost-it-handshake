import type { Metadata } from 'next';
import { ConsoleView } from './console-view';

export const metadata: Metadata = {
  title: 'Developer console',
  description: 'Open sandbox deals and read the PayPal audit log of each one.',
  robots: { index: false, follow: false },
};

export default function ConsolePage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <p className="text-accent text-sm font-semibold tracking-widest uppercase">Developers</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">Console</h1>
      <p className="text-muted mt-4 max-w-2xl">
        Open sandbox deals with your account or API key and see every PayPal call and webhook behind
        them, with the PayPal <span className="font-mono">debug_id</span> of each call.
      </p>
      <ConsoleView />
    </main>
  );
}
