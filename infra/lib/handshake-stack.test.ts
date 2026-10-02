import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { HandshakeStack } from './handshake-stack';

describe('HandshakeStack', () => {
  let template: Template;

  beforeAll(() => {
    const webDistPath = mkdtempSync(join(tmpdir(), 'handshake-web-'));
    writeFileSync(join(webDistPath, 'index.html'), '<!doctype html>');
    const app = new App({ context: { '@aws-cdk/core:bootstrapQualifier': 'handshake' } });
    const stack = new HandshakeStack(app, 'Handshake-test', {
      stage: 'test',
      webDistPath,
      env: { region: 'eu-west-1' },
    });
    template = Template.fromStack(stack);
  }, 60_000);

  it('creates the single table with pk, sk and TTL', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('exposes GET /health on the HTTP API', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /health' });
  });

  it('keeps the site bucket private behind CloudFront', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });

  it('runs Lambdas on Node 22 with a managed log group', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
      LoggingConfig: Match.objectLike({ LogGroup: Match.anyValue() }),
    });
  });

  it('checks the bootstrap version under the handshake qualifier', () => {
    const json = JSON.stringify(template.toJSON());
    expect(json).toContain('/cdk-bootstrap/handshake/version');
  });
});
