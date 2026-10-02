import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { HandshakeStack } from './handshake-stack';

const openNextOutputDirs = [
  'assets',
  'cache',
  'server-functions/default',
  'image-optimization-function',
  'revalidation-function',
  'dynamodb-provider',
];

function createBuiltWebApp(): string {
  const appPath = mkdtempSync(join(tmpdir(), 'handshake-web-'));
  writeFileSync(join(appPath, 'package.json'), '{"scripts":{"build":"next build"}}');
  for (const dir of openNextOutputDirs) {
    const outputPath = join(appPath, '.open-next', dir);
    mkdirSync(outputPath, { recursive: true });
    writeFileSync(join(outputPath, 'index.mjs'), 'export {};');
  }
  return appPath;
}

describe('HandshakeStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { '@aws-cdk/core:bootstrapQualifier': 'handshake' } });
    const stack = new HandshakeStack(app, 'Handshake-test', {
      stage: 'test',
      webAppPath: createBuiltWebApp(),
      domains: {
        zone: 'radostit.com',
        web: 'test-handshake.radostit.com',
        api: 'api-test-handshake.radostit.com',
      },
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
      Replicas: [
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      ],
    });
  });

  it('exposes GET /health on the HTTP API', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /health' });
  });

  it('accepts PayPal webhooks and prints the URL to register with PayPal', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /webhooks/paypal',
    });
    template.hasOutput('WebhookUrl', {
      Value: 'https://api-test-handshake.radostit.com/webhooks/paypal',
    });
  });

  it('publishes webhook events to a bus named after the stack', () => {
    template.hasResourceProperties('AWS::Events::EventBus', { Name: 'Handshake-test-events' });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          HANDSHAKE_STAGE: 'test',
          EVENT_BUS_NAME: Match.anyValue(),
          TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });

  it('runs the deal lifecycle in a state machine named after the stack', () => {
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineName: 'Handshake-test-DealLifecycle',
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({ WEB_URL: 'https://test-handshake.radostit.com' }),
      },
    });
    const [stateMachine] = Object.values(
      template.findResources('AWS::StepFunctions::StateMachine'),
    );
    const definition = JSON.stringify(stateMachine);
    for (const state of [
      'StartCheckout',
      'AuthorizePayment',
      'CheckDeliveryTimer',
      'WaitForEvidence',
      'WaitForVerdict',
      'SettleByVerifier',
      'WaitForHumanDecision',
      'SettleByHuman',
      'WaitForCapture',
      'ConfirmCapture',
    ]) {
      expect(definition).toContain(`\\"${state}\\"`);
    }
    expect(definition).toContain('waitForTaskToken');
    expect(definition).toContain('TimeoutSecondsPath');
  });

  it('resumes the lifecycle when PayPal reports an approved checkout or a capture', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        source: ['handshake.paypal'],
        'detail-type': [
          'CHECKOUT.ORDER.APPROVED',
          'PAYMENT.CAPTURE.COMPLETED',
          'PAYMENT.CAPTURE.DENIED',
        ],
      },
    });
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: [
              'states:SendTaskSuccess',
              'states:SendTaskFailure',
              'states:SendTaskHeartbeat',
            ],
          }),
        ]),
      },
    });
  });

  it('throttles the API and serves it only on the custom domain', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { DisableExecuteApiEndpoint: true });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 25, ThrottlingBurstLimit: 50 },
    });
  });

  it('puts the workload permissions boundary on every role', () => {
    template.allResourcesProperties('AWS::IAM::Role', {
      PermissionsBoundary: {
        'Fn::Join': ['', Match.arrayWith([':policy/HandshakeWorkloadBoundary'])],
      },
    });
  });

  it('serves the Next.js app through CloudFront from a private bucket and a Lambda URL', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' });
  });

  it('serves the web app and the API on their own hostnames with certificates from SSM', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['test-handshake.radostit.com'],
        ViewerCertificate: Match.objectLike({ AcmCertificateArn: Match.anyValue() }),
      }),
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::DomainName', {
      DomainName: 'api-test-handshake.radostit.com',
    });
    template.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
    template.hasParameter('*', { Default: '/handshake/certificates/us-east-1' });
    template.hasParameter('*', { Default: '/handshake/certificates/eu-west-1' });
  });

  it('points the web and API hostnames at CloudFront and API Gateway in the Route 53 zone', () => {
    template.hasParameter('*', { Default: '/handshake/dns/hosted-zone-id' });
    template.resourcePropertiesCountIs('AWS::Route53::RecordSet', { Type: 'A' }, 2);
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'test-handshake.radostit.com.',
      Type: 'AAAA',
      AliasTarget: Match.objectLike({
        DNSName: { 'Fn::GetAtt': [Match.stringLikeRegexp('^WebDistribution'), 'DomainName'] },
      }),
    });
    template.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'api-test-handshake.radostit.com.',
      Type: 'A',
      AliasTarget: Match.objectLike({
        DNSName: { 'Fn::GetAtt': [Match.stringLikeRegexp('^ApiDomain'), 'RegionalDomainName'] },
      }),
    });
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
