import type { ReactNode } from 'react';

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-line bg-surface/70 rounded-card border p-6">
      <h2 className="text-muted mb-3 text-xs font-semibold tracking-widest uppercase">{title}</h2>
      {children}
    </section>
  );
}
