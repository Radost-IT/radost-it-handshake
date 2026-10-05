import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Metadata } from 'next';
import { evalReportSchema, type EvalReport } from './report';
import { EvalReportView } from './eval-report-view';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Agent defense report',
  description:
    'How the Handshake buyer and verifier agents handled scripted attacks and honest deals in the latest eval run on Amazon Bedrock.',
  alternates: { canonical: '/evals' },
};

// The page is built from the report `pnpm eval` writes at the repository root.
const reportFile = path.join(process.cwd(), '..', '..', 'evals', 'report.json');

async function readEvalReport(): Promise<EvalReport | null> {
  try {
    return evalReportSchema.parse(JSON.parse(await readFile(reportFile, 'utf8')));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export default async function EvalsPage() {
  const report = await readEvalReport();
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 pt-24 pb-32 sm:pt-32">
      <p className="text-accent text-sm font-semibold tracking-widest uppercase">Evals</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">Agent defense report</h1>
      <p className="text-muted mt-4 max-w-2xl">
        Every scenario runs the real agents on Amazon Bedrock. Attack scenarios replay tricks from
        the Red Team Lab against the buyer and the verifier. Baseline scenarios check that honest
        deals still close and pay.
      </p>
      {report ? (
        <EvalReportView report={report} />
      ) : (
        <p className="text-muted mt-10">
          No eval report yet. Run <span className="font-mono">pnpm eval</span> to create one.
        </p>
      )}
    </main>
  );
}
