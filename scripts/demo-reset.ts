import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ExecutionDoesNotExist, SFNClient, StopExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadConfig } from '@handshake/config';
import {
  clearRateLimitWindow,
  dailyDealsSubject,
  deleteDeal,
  listDeveloperDeals,
  MAX_LISTED_DEALS,
  type StoreTable,
} from '@handshake/store';
import { planDemoReset } from './demo-reset-plan';
import { defaultSellerQueries, seedSellers } from './seed';

const [stage, developerId] = process.argv.slice(2);
if (stage === undefined || developerId === undefined) {
  console.error('Usage: pnpm demo:reset <stage> <developer-id>');
  process.exit(1);
}

const stepFunctions = new SFNClient({});
const config = await loadConfig();
const outputs = await readStackOutputs(`Handshake-${stage}`);
const table: StoreTable = {
  client: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  name: requireOutput(outputs, 'TableName'),
};
const dealLifecycleArn = requireOutput(outputs, 'DealLifecycleArn');

const deals = await listDeveloperDeals(table, developerId, MAX_LISTED_DEALS);
const plans = deals.map((deal) => ({ deal, step: planDemoReset(deal) }));
const deleted = plans.flatMap(({ deal, step }) =>
  step.action === 'delete' ? [{ deal, step }] : [],
);
const kept = plans.flatMap(({ deal, step }) => (step.action === 'keep' ? [{ deal, step }] : []));

// Stop the lifecycles first, so no running workflow writes to a deal after it is deleted.
await Promise.all(
  deleted
    .filter(({ step }) => step.stopExecution)
    .map(({ deal }) => stopDealLifecycle(dealLifecycleArn, deal.id)),
);
await Promise.all(deleted.map(({ deal }) => deleteDeal(table, deal.id)));
await clearRateLimitWindow(table, {
  subject: dailyDealsSubject(developerId),
  window: new Date().toISOString().slice(0, 10),
});
const sellerCount = await seedSellers(table, config, defaultSellerQueries);

console.log(`Deleted ${String(deleted.length)} deals and reset today's deal limit.`);
console.log(`Seeded ${String(sellerCount)} sellers into ${table.name}.`);
for (const { deal, step } of kept) {
  console.log(`Kept deal ${deal.id}: ${step.reason}.`);
}
if (deals.length === MAX_LISTED_DEALS) {
  console.log(
    `Listed only the ${String(MAX_LISTED_DEALS)} newest deals. Run again to reset older ones.`,
  );
}

async function readStackOutputs(stackName: string): Promise<Map<string, string>> {
  const { Stacks = [] } = await new CloudFormationClient({}).send(
    new DescribeStacksCommand({ StackName: stackName }),
  );
  const outputs = Stacks[0]?.Outputs ?? [];
  return new Map(outputs.map((output) => [output.OutputKey ?? '', output.OutputValue ?? '']));
}

function requireOutput(outputs: Map<string, string>, key: string): string {
  const value = outputs.get(key);
  if (!value) throw new Error(`Stack output ${key} is missing; deploy the stack first`);
  return value;
}

async function stopDealLifecycle(stateMachineArn: string, dealId: string): Promise<void> {
  // The lifecycle execution is named after the deal.
  const executionArn = `${stateMachineArn.replace(':stateMachine:', ':execution:')}:${dealId}`;
  try {
    await stepFunctions.send(
      new StopExecutionCommand({ executionArn, cause: 'Demo reset deleted the deal' }),
    );
  } catch (error) {
    // A deal can be deleted before its lifecycle ever started.
    if (!(error instanceof ExecutionDoesNotExist)) throw error;
  }
}
