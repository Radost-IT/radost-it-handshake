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

// One level below radostit.com, so the *.radostit.com wildcard certificate covers every name.
const hostname = (...labels: string[]) => `${[...labels, 'handshake'].join('-')}.radostit.com`;
const stageLabels = stage === 'demo' ? [] : [stage];

new HandshakeStack(app, `Handshake-${stage}`, {
  stage,
  webAppPath: fileURLToPath(new URL('../../apps/web', import.meta.url)),
  domains: { web: hostname(...stageLabels), api: hostname('api', ...stageLabels) },
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});
