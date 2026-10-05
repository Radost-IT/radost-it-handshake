'use client';

import { ClientSideRowModelModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { gridTheme } from '../components/grid-theme';
import type { Deal, Money } from '../deals/api';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

const formatMoney = (money: Money | null | undefined) =>
  money ? `${money.value} ${money.currency}` : '';
const formatTime = (at: string) => new Date(at).toLocaleString();

const columns: ColDef<Deal>[] = [
  {
    field: 'createdAt',
    headerName: 'Opened',
    width: 190,
    valueFormatter: ({ value }: { value: string }) => formatTime(value),
  },
  {
    colId: 'item',
    headerName: 'Item',
    flex: 2,
    minWidth: 180,
    valueGetter: ({ data }) => data?.contract?.terms.item.title ?? '',
  },
  { field: 'state', headerName: 'State', width: 200 },
  {
    colId: 'price',
    headerName: 'Price',
    width: 130,
    type: 'rightAligned',
    valueGetter: ({ data }) => formatMoney(data?.contract?.terms.price),
  },
  {
    colId: 'held',
    headerName: 'Held',
    width: 130,
    type: 'rightAligned',
    valueGetter: ({ data }) => formatMoney(data?.escrow?.amount),
  },
  {
    colId: 'captured',
    headerName: 'Captured',
    width: 130,
    type: 'rightAligned',
    valueGetter: ({ data }) => formatMoney(data?.capture?.amount),
  },
  { field: 'id', headerName: 'Deal ID', flex: 1, minWidth: 160, cellClass: 'font-mono' },
];

interface DealsGridProps {
  /** Null while the deals load. */
  deals: Deal[] | null;
  onSelect: (dealId: string) => void;
}

export function DealsGrid({ deals, onSelect }: DealsGridProps) {
  return (
    <div className="mt-4 h-[24rem]">
      <AgGridReact<Deal>
        theme={gridTheme}
        rowData={deals}
        columnDefs={columns}
        getRowId={({ data }) => data.id}
        loading={deals === null}
        overlayNoRowsTemplate="No deals yet. Open one above."
        onRowClicked={({ data }) => {
          if (data) onSelect(data.id);
        }}
      />
    </div>
  );
}
