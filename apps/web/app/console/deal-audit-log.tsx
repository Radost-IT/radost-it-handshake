'use client';

import { ClientSideRowModelModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { gridTheme } from '../components/grid-theme';
import {
  fetchDealRecord,
  messageOf,
  type DealRecord,
  type PayPalCall,
  type Webhook,
} from '../deals/api';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

const timeColumn = {
  field: 'at',
  headerName: 'Time',
  width: 190,
  sort: 'asc',
  valueFormatter: ({ value }: { value: string }) => new Date(value).toLocaleString(),
} as const;

const callColumns: ColDef<PayPalCall>[] = [
  timeColumn,
  { field: 'operation', headerName: 'Operation', width: 150 },
  { field: 'statusCode', headerName: 'HTTP', width: 90 },
  { field: 'debugId', headerName: 'debug_id', flex: 1, minWidth: 150, cellClass: 'font-mono' },
  {
    field: 'requestId',
    headerName: 'PayPal-Request-Id',
    flex: 2,
    minWidth: 220,
    cellClass: 'font-mono',
  },
];

const webhookColumns: ColDef<Webhook>[] = [
  timeColumn,
  { field: 'eventType', headerName: 'Event', flex: 1, minWidth: 240 },
  { field: 'resourceId', headerName: 'Resource', flex: 1, minWidth: 160, cellClass: 'font-mono' },
  { field: 'eventId', headerName: 'Event ID', flex: 1, minWidth: 160, cellClass: 'font-mono' },
];

type AuditState =
  { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; record: DealRecord };

export function DealAuditLog({ apiKey, dealId }: { apiKey: string; dealId: string }) {
  const [state, setState] = useState<AuditState>({ kind: 'loading' });

  useEffect(() => {
    let isActive = true;
    fetchDealRecord(dealId, apiKey)
      .then((record) => {
        if (isActive) setState({ kind: 'ready', record });
      })
      .catch((error: unknown) => {
        if (isActive) setState({ kind: 'failed', message: messageOf(error) });
      });
    return () => {
      isActive = false;
    };
  }, [apiKey, dealId]);

  if (state.kind === 'failed') return <p className="text-refused text-sm">{state.message}</p>;
  const record = state.kind === 'ready' ? state.record : null;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">
          PayPal activity <span className="text-muted font-mono text-sm">{dealId}</span>
        </h2>
        <Link href={`/deals/${dealId}`} className="text-accent text-sm font-semibold">
          Open the deal page
        </Link>
      </div>
      <div>
        <h3 className="text-muted mb-2 text-xs font-semibold tracking-widest uppercase">
          API calls
        </h3>
        <div className="h-[18rem]">
          <AgGridReact<PayPalCall>
            theme={gridTheme}
            rowData={record?.paypalCalls ?? null}
            columnDefs={callColumns}
            loading={record === null}
            overlayNoRowsTemplate="No PayPal calls for this deal yet."
          />
        </div>
      </div>
      <div>
        <h3 className="text-muted mb-2 text-xs font-semibold tracking-widest uppercase">
          Verified webhooks
        </h3>
        <div className="h-[14rem]">
          <AgGridReact<Webhook>
            theme={gridTheme}
            rowData={record?.webhooks ?? null}
            columnDefs={webhookColumns}
            getRowId={({ data }) => data.eventId}
            loading={record === null}
            overlayNoRowsTemplate="No webhooks for this deal yet."
          />
        </div>
      </div>
    </section>
  );
}
