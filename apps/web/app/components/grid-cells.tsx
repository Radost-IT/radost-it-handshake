import type { ReactNode } from 'react';
import { dealStateLabel, dealStateTone, type StateTone } from '../deals/state-labels';

const toneStyles: Record<StateTone, string> = {
  active: 'text-accent border-accent/40 bg-accent/10',
  held: 'text-held border-held/40 bg-held/10',
  escalated: 'text-escalated border-escalated/40 bg-escalated/10',
  settled: 'text-settled border-settled/40 bg-settled/10',
  stopped: 'text-refused border-refused/40 bg-refused/10',
};

function Pill({ tone, children }: { tone: StateTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 align-middle rounded-full border px-2.5 py-0.5 text-xs leading-5 font-semibold whitespace-nowrap ${toneStyles[tone]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function DealStateCell({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <Pill tone={dealStateTone(value)}>{dealStateLabel(value)}</Pill>;
}

export function HttpStatusCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const isSuccess = value >= 200 && value < 300;
  return <Pill tone={isSuccess ? 'settled' : 'stopped'}>{value}</Pill>;
}

export function ResultCell({ value }: { value: boolean | null | undefined }) {
  if (value === null || value === undefined) return null;
  return <Pill tone={value ? 'settled' : 'stopped'}>{value ? 'Pass' : 'Fail'}</Pill>;
}

const podiumStyles = ['bg-heat text-white', 'bg-accent text-on-accent', 'bg-held text-canvas'];

export function PositionCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  const podium = podiumStyles[value - 1];
  return (
    <span
      className={`inline-flex size-7 align-middle items-center justify-center rounded-full font-mono text-xs font-semibold ${podium ?? 'border-line text-muted border'}`}
    >
      {value}
    </span>
  );
}
