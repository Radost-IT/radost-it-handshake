import { App } from 'aws-cdk-lib';
import { fileURLToPath } from 'node:url';
import { HandshakeStack } from '../lib/handshake-stack';

const app = new App();

new HandshakeStack(app, 'Handshake-prod', {
  stage: 'prod',
  webAppPath: fileURLToPath(new URL('../../apps/web', import.meta.url)),
  domains: {
    zone: 'radostit.com',
    web: 'handshake.radostit.com',
    api: 'api-handshake.radostit.com',
    live: 'ws-handshake.radostit.com',
  },
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-west-1' },
});
