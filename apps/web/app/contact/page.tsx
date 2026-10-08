import type { Metadata } from 'next';
import { ContactForm } from '../components/contact-form';
import { pageMetadata } from '../site';

export const metadata: Metadata = pageMetadata({
  title: 'Contact',
  description:
    'Questions about Handshake, partnerships or the Red Team Lab. Write to the Radost IT team.',
  path: '/contact',
});

export default function ContactPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <h1 className="text-4xl font-semibold tracking-tight">Contact</h1>
      <p className="text-muted mt-4">
        Questions about Handshake, partnerships or the Red Team Lab? Send us a message.
      </p>
      <div className="border-line bg-surface/70 rounded-card mt-10 border p-6">
        <ContactForm />
      </div>
    </main>
  );
}
