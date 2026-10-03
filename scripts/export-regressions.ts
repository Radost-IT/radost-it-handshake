import { mkdir, writeFile } from 'node:fs/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { regressionFileName } from '@handshake/arena';
import { listRegressionCases } from '@handshake/store';

const tableName = process.argv[2];
if (tableName === undefined) {
  console.error('Usage: pnpm regressions:export <table-name>');
  process.exit(1);
}

const directory = new URL('../evals/regressions/', import.meta.url);
const table = { client: DynamoDBDocumentClient.from(new DynamoDBClient({})), name: tableName };
const cases = await listRegressionCases(table);

await mkdir(directory, { recursive: true });
await Promise.all(
  cases.map((regression) =>
    writeFile(
      new URL(regressionFileName(regression), directory),
      `${JSON.stringify(regression, null, 2)}\n`,
    ),
  ),
);
console.log(`Wrote ${String(cases.length)} regression cases to evals/regressions/`);
