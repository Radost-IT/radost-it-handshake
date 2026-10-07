'use client';

import {
  CellStyleModule,
  ClientSideRowModelModule,
  ModuleRegistry,
  type ColDef,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useEffect, useState } from 'react';
import { PositionCell } from '../../components/grid-cells';
import { gridTheme } from '../../components/grid-theme';
import { fetchLeaderboard, messageOf, type LeaderboardEntry } from '../api';

ModuleRegistry.registerModules([ClientSideRowModelModule, CellStyleModule]);

const columns: ColDef<LeaderboardEntry>[] = [
  { field: 'position', headerName: '#', width: 80, cellRenderer: PositionCell },
  { field: 'handle', headerName: 'Researcher', flex: 1, minWidth: 140, cellClass: 'font-semibold' },
  { field: 'rank', headerName: 'Rank', flex: 1, minWidth: 130, cellClass: 'text-muted' },
  {
    field: 'xp',
    headerName: 'XP',
    width: 120,
    type: 'rightAligned',
    cellClass: 'text-accent text-right font-mono font-semibold tabular-nums',
  },
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
        <div>
          <AgGridReact<LeaderboardEntry>
            theme={gridTheme}
            rowData={state.kind === 'ready' ? state.entries : null}
            columnDefs={columns}
            domLayout="autoHeight"
            getRowId={({ data }) => data.challengerId}
            loading={state.kind === 'loading'}
            overlayNoRowsTemplate="No researchers on this board yet."
          />
        </div>
      )}
    </div>
  );
}
