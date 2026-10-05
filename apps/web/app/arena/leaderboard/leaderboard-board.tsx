'use client';

import { ClientSideRowModelModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useEffect, useState } from 'react';
import { gridTheme } from '../../components/grid-theme';
import { fetchLeaderboard, messageOf, type LeaderboardEntry } from '../api';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

const columns: ColDef<LeaderboardEntry>[] = [
  { field: 'position', headerName: '#', width: 70 },
  { field: 'handle', headerName: 'Challenger', flex: 1, minWidth: 140 },
  { field: 'rank', headerName: 'Rank', flex: 1, minWidth: 130 },
  { field: 'xp', headerName: 'XP', width: 100, type: 'rightAligned' },
];

type Scope = 'all' | 'daily';

const scopeLabels: Record<Scope, string> = { all: 'All time', daily: 'Today' };

type BoardState =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; entries: LeaderboardEntry[] };

export function LeaderboardBoard() {
  const [scope, setScope] = useState<Scope>('all');
  const [state, setState] = useState<BoardState>({ kind: 'loading' });

  useEffect(() => {
    let isActive = true;
    setState({ kind: 'loading' });
    fetchLeaderboard(scope)
      .then(({ entries }) => {
        if (isActive) setState({ kind: 'ready', entries });
      })
      .catch((error: unknown) => {
        if (isActive) setState({ kind: 'failed', message: messageOf(error) });
      });
    return () => {
      isActive = false;
    };
  }, [scope]);

  return (
    <div className="mt-10 flex flex-col gap-4">
      <div role="tablist" aria-label="Leaderboard" className="flex gap-2">
        {(['all', 'daily'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={scope === option}
            onClick={() => {
              setScope(option);
            }}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
              scope === option ? 'border-accent text-ink' : 'border-line text-muted'
            }`}
          >
            {scopeLabels[option]}
          </button>
        ))}
      </div>
      {state.kind === 'failed' && <p className="text-refused text-sm">{state.message}</p>}
      {state.kind !== 'failed' && (
        <div className="h-[34rem]">
          <AgGridReact<LeaderboardEntry>
            theme={gridTheme}
            rowData={state.kind === 'ready' ? state.entries : null}
            columnDefs={columns}
            getRowId={({ data }) => data.challengerId}
            loading={state.kind === 'loading'}
            overlayNoRowsTemplate="No challengers on this board yet."
          />
        </div>
      )}
    </div>
  );
}
