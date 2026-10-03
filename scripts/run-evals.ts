import { readdir, readFile } from 'node:fs/promises';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { createBedrockLlmProvider } from '@handshake/agents';
import { loadConfig } from '@handshake/config';
import { evalScenarioSchema, runEvalScenario } from './evals';

const directory = new URL('../evals/scenarios/', import.meta.url);
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

const results = await Promise.all(scenarios.map((scenario) => runEvalScenario(provider, scenario)));

for (const result of results) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${result.outcome}`);
}
const failed = results.filter((result) => !result.passed).length;
const inputTokens = results.reduce((sum, result) => sum + result.usage.inputTokens, 0);
const outputTokens = results.reduce((sum, result) => sum + result.usage.outputTokens, 0);
console.log(
  `${String(results.length - failed)} of ${String(results.length)} passed, ${String(inputTokens)} input and ${String(outputTokens)} output tokens`,
);
if (failed > 0) process.exitCode = 1;
