const pillStyles = {
  running: 'text-muted border-line',
  held: 'text-held border-held/40',
  loophole: 'text-settled border-settled/40',
  failed: 'text-refused border-refused/40',
};

const pillLabels = {
  running: 'Running',
  held: 'Agents held',
  loophole: 'Breach',
  failed: 'Stopped',
};

export type PillState = keyof typeof pillStyles;

export function StatusPill({ state }: { state: PillState }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${pillStyles[state]}`}
    >
      {pillLabels[state]}
    </span>
  );
}

export function pillStateFor(
  status: 'running' | 'judged' | 'failed',
  outcome: 'held' | 'loophole' | null,
): PillState {
  if (status === 'judged' && outcome) return outcome;
  return status === 'failed' ? 'failed' : 'running';
}
