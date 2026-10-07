'use client';

import {
  BarSeriesModule,
  CategoryAxisModule,
  ModuleRegistry as ChartModuleRegistry,
  NumberAxisModule,
  type AgCartesianChartOptions,
  type AgChartTheme,
} from 'ag-charts-community';
import { AgCharts } from 'ag-charts-react';
import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnAutoSizeModule,
  ModuleRegistry,
  RowAutoHeightModule,
  type ColDef,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { categoryName } from '../arena/labels';
import { useChartTheme } from '../components/chart-theme';
import { ResultCell } from '../components/grid-cells';
import { gridTheme } from '../components/grid-theme';
import { defenseByCategory, type EvalReport, type ScenarioResult } from './report';

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CellStyleModule,
  ColumnAutoSizeModule,
  RowAutoHeightModule,
]);
ChartModuleRegistry.registerModules([BarSeriesModule, CategoryAxisModule, NumberAxisModule]);

const columns: ColDef<ScenarioResult>[] = [
  { field: 'name', headerName: 'Scenario', width: 210, cellClass: 'font-mono text-xs' },
  {
    field: 'attack',
    headerName: 'Attack',
    width: 210,
    valueFormatter: ({ value }: { value: string | null }) =>
      value === null ? 'Baseline' : categoryName(value),
  },
  {
    field: 'passed',
    headerName: 'Result',
    width: 120,
    cellRenderer: ResultCell,
  },
  {
    field: 'description',
    headerName: 'What it checks',
    flex: 2,
    minWidth: 260,
    wrapText: true,
    autoHeight: true,
    cellClass: 'py-3',
  },
  {
    field: 'outcome',
    headerName: 'What the agents did',
    flex: 2,
    minWidth: 260,
    wrapText: true,
    autoHeight: true,
    cellClass: 'text-muted py-3',
  },
];

export function EvalReportView({ report }: { report: EvalReport }) {
  const chartTheme = useChartTheme();
  const categories = defenseByCategory(report.scenarios).map((entry) => ({
    ...entry,
    label: categoryName(entry.category),
  }));
  const attacks = report.scenarios.filter(({ attack }) => attack !== null);
  const baseline = report.scenarios.filter(({ attack }) => attack === null);
  const tokens = report.scenarios.reduce(
    (sum, { inputTokens, outputTokens }) => sum + inputTokens + outputTokens,
    0,
  );

  return (
    <div className="mt-10 flex flex-col gap-10">
      <dl className="grid gap-4 sm:grid-cols-4">
        <Stat label="Attacks held" value={`${passedCount(attacks)} of ${attacks.length}`} />
        <Stat label="Baseline passed" value={`${passedCount(baseline)} of ${baseline.length}`} />
        <Stat label="Tokens used" value={tokens.toLocaleString('en-US')} />
        <Stat label="Run on" value={report.generatedAt.slice(0, 10)} />
      </dl>

      <section>
        <h2 className="text-xl font-semibold">Defense rate by attack category</h2>
        <p className="text-muted mt-1 text-sm">
          Share of attack scenarios in each category that the agents held.
        </p>
        <div className="border-line bg-surface/70 rounded-card mt-4 h-80 border p-4">
          {chartTheme && <AgCharts options={defenseChartOptions(categories, chartTheme)} />}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Scenarios</h2>
        <p className="text-muted mt-1 text-sm">
          Models: <span className="font-mono">{report.models.fast}</span> and{' '}
          <span className="font-mono">{report.models.smart}</span>.
        </p>
        <div className="mt-4">
          <AgGridReact<ScenarioResult>
            theme={gridTheme}
            rowData={report.scenarios}
            columnDefs={columns}
            getRowId={({ data }) => data.name}
            domLayout="autoHeight"
            autoSizeStrategy={{ type: 'fitGridWidth' }}
          />
        </div>
      </section>
    </div>
  );
}

type CategoryBar = ReturnType<typeof defenseByCategory>[number] & { label: string };

function defenseChartOptions(
  categories: CategoryBar[],
  theme: AgChartTheme,
): AgCartesianChartOptions<CategoryBar> {
  return {
    theme,
    data: categories,
    series: [
      {
        type: 'bar',
        direction: 'horizontal',
        xKey: 'label',
        yKey: 'defenseRate',
        yName: 'Defense rate (%)',
        cornerRadius: 4,
        tooltip: {
          renderer: ({ datum }) => ({
            title: datum.label,
            data: [{ label: 'Held', value: `${datum.held} of ${datum.total}` }],
          }),
        },
      },
    ],
    axes: {
      y: { type: 'number', position: 'bottom', min: 0, max: 100 },
      x: { type: 'category', position: 'left' },
    },
  };
}

function passedCount(scenarios: readonly ScenarioResult[]): number {
  return scenarios.filter(({ passed }) => passed).length;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line bg-surface/70 rounded-card border p-4">
      <dt className="text-muted text-xs font-semibold tracking-widest uppercase">{label}</dt>
      <dd className="mt-1 font-mono text-2xl font-semibold">{value}</dd>
    </div>
  );
}
