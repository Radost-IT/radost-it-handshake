'use client';

import {
  CellStyleModule,
  ClientSideRowModelModule,
  ModuleRegistry,
  PaginationModule,
  type ColDef,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { DealStateCell } from '../components/grid-cells';
import { gridTheme } from '../components/grid-theme';
import type { Deal, Money } from '../deals/api';

ModuleRegistry.registerModules([ClientSideRowModelModule, CellStyleModule, PaginationModule]);

const formatMoney = (money: Money | null | undefined) =>
  money ? `${money.value} ${money.currency}` : '';
const formatTime = (at: string) => new Date(at).toLocaleString();

const columns: ColDef<Deal>[] = [
  {
    field: 'createdAt',
    headerName: 'Opened',
    width: 190,
    sort: 'desc',
    cellClass: 'text-muted tabular-nums',
    valueFormatter: ({ value }: { value: string }) => formatTime(value),
  },
  {
    colId: 'item',
    headerName: 'Item',
    flex: 2,
    minWidth: 180,
    cellClass: 'font-medium',
    valueGetter: ({ data }) => data?.contract?.terms.item.title ?? '',
  },
  { field: 'state', headerName: 'State', width: 240, cellRenderer: DealStateCell },
  {
    colId: 'price',
    headerName: 'Price',
    width: 130,
    type: 'rightAligned',
    cellClass: 'text-right font-mono tabular-nums',
    valueGetter: ({ data }) => formatMoney(data?.contract?.terms.price),
  },
  {
    colId: 'held',
    headerName: 'Held',
    width: 130,
    type: 'rightAligned',
    cellClass: 'text-right font-mono tabular-nums',
    valueGetter: ({ data }) => formatMoney(data?.escrow?.amount),
  },
  {
    colId: 'captured',
    headerName: 'Captured',
    width: 130,
    type: 'rightAligned',
    cellClass: 'text-right font-mono tabular-nums',
    valueGetter: ({ data }) => formatMoney(data?.capture?.amount),
  },
  {
    field: 'id',
    headerName: 'Deal ID',
    flex: 1,
    minWidth: 160,
    cellClass: 'text-muted font-mono text-xs',
  },
];

interface DealsGridProps {
  /** Null while the deals load. */
  deals: Deal[] | null;
  onSelect: (dealId: string) => void;
}

export function DealsGrid({ deals, onSelect }: DealsGridProps) {
  return (
    <div className="mt-4 [&_.ag-row]:cursor-pointer">
      <AgGridReact<Deal>
        theme={gridTheme}
        rowData={deals}
        columnDefs={columns}
        domLayout="autoHeight"
        pagination
        paginationPageSize={10}
        paginationPageSizeSelector={false}
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
