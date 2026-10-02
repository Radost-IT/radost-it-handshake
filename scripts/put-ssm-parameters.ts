import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { ssmParametersFromEnv } from '@handshake/config';

const stage = process.argv[2];
if (stage === undefined) {
  console.error('Usage: pnpm ssm:put <stage>');
  process.exit(1);
}

const parameters = ssmParametersFromEnv(process.env, stage);
const client = new SSMClient({});

await Promise.all(
  parameters.map(async ({ name, type, value }) => {
    await client.send(
      new PutParameterCommand({ Name: name, Type: type, Value: value, Overwrite: true }),
    );
    console.log(`Stored ${name} as ${type}`);
  }),
);
