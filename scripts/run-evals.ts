import { readdir, readFile, writeFile } from 'node:fs/promises';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { createBedrockLlmProvider } from '@handshake/agents';
import { loadConfig } from '@handshake/config';
import { buildEvalReport, evalScenarioSchema, runEvalScenario, type EvalResult } from './evals';

const directory = new URL('../evals/scenarios/', import.meta.url);
const reportFile = new URL('../evals/report.json', import.meta.url);
const files = (await readdir(directory)).filter((file) => file.endsWith('.json')).sort();
const scenarios = await Promise.all(
  files.map(async (file) =>
    evalScenarioSchema.parse(JSON.parse(await readFile(new URL(file, directory), 'utf8'))),
  ),
);

const config = await loadConfig();
const provider = createBedrockLlmProvider(
  new BedrockRuntimeClient({ region: config.bedrock.region }),
  { fast: config.bedrock.modelFast, smart: config.bedrock.modelSmart },
);

const runs = await Promise.all(
  scenarios.map(async (scenario) => ({
    scenario,
    result: await runEvalScenario(provider, scenario).catch(
      // One broken scenario is a failed result, not the end of the run.
      (error: unknown): EvalResult => ({
        name: scenario.name,
        passed: false,
        outcome: `error: ${error instanceof Error ? error.message : String(error)}`,
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    ),
  })),
);
const results = runs.map(({ result }) => result);

for (const result of results) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${result.outcome}`);
}
const failed = results.filter((result) => !result.passed).length;
const inputTokens = results.reduce((sum, result) => sum + result.usage.inputTokens, 0);
const outputTokens = results.reduce((sum, result) => sum + result.usage.outputTokens, 0);
console.log(
  `${String(results.length - failed)} of ${String(results.length)} passed, ${String(inputTokens)} input and ${String(outputTokens)} output tokens`,
);

const report = buildEvalReport(
  runs,
  { fast: config.bedrock.modelFast, smart: config.bedrock.modelSmart },
  new Date().toISOString(),
);
await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log('Wrote evals/report.json');
if (failed > 0) process.exitCode = 1;
