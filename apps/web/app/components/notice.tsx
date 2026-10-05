import type { ReactNode } from 'react';

export function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-muted text-sm">{children}</p>
    </div>
  );
}
