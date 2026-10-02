import { App } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { HandshakeStack } from '../lib/handshake-stack';

const stages = ['dev', 'demo'];
const region = 'eu-west-1';

const app = new App();
const stage: unknown = app.node.tryGetContext('stage');
if (typeof stage !== 'string' || !stages.includes(stage)) {
  throw new Error(`Pass --context stage=<${stages.join('|')}>`);
}

new HandshakeStack(app, `Handshake-${stage}`, {
  stage,
  webDistPath: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});
