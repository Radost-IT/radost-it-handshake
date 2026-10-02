import { CfnOutput, Duration, PermissionsBoundary, Stack, type StackProps } from 'aws-cdk-lib';
import { DomainName, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AaaaRecord, ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGatewayv2DomainProperties, CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Nextjs } from 'cdk-nextjs-standalone';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface HandshakeStackProps extends StackProps {
  /** A Next.js app already built with `open-next build`. */
  webAppPath: string;
  /** The Route 53 zone and the hostnames in it covered by its wildcard certificates. */
  domains: { zone: string; web: string; api: string };
}

// The IDs live in SSM rather than in the repo, and CloudFormation reads them at deploy time.
const certificateParameters = {
  cloudFront: '/handshake/certificates/us-east-1',
  regional: '/handshake/certificates/eu-west-1',
};
const hostedZoneIdParameter = '/handshake/dns/hosted-zone-id';

// Created by hand from infra/iam/workload-boundary.json. The CDK execution policy
// only lets CloudFormation create roles that carry it, so a deploy cannot grant more.
const workloadBoundaryPolicyName = 'HandshakeWorkloadBoundary';

// Caps what public traffic can cost before per-route limits exist.
const apiThrottle = { rateLimit: 25, burstLimit: 50 };

const apiSource = (handlerFile: string) =>
  fileURLToPath(new URL(`../../services/api/src/${handlerFile}`, import.meta.url));

// Generated resource names start with the stack name (`Handshake-prod`),
// which is what the IAM policies in infra/iam/ are scoped to.
export class HandshakeStack extends Stack {
  constructor(scope: Construct, id: string, props: HandshakeStackProps) {
    super(scope, id, {
      ...props,
      permissionsBoundary: PermissionsBoundary.fromName(workloadBoundaryPolicyName),
    });

    const table = new TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      billing: Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    const healthFunction = new NodejsFunction(this, 'HealthFunction', {
      entry: apiSource('health.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, 'HealthFunctionLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
    });

    const certificateFromParameter = (id: string, parameterName: string) =>
      Certificate.fromCertificateArn(
        this,
        id,
        StringParameter.valueForStringParameter(this, parameterName),
      );

    const apiDomain = new DomainName(this, 'ApiDomain', {
      domainName: props.domains.api,
      certificate: certificateFromParameter('RegionalCertificate', certificateParameters.regional),
    });
    // The default stage is built here because HttpApi cannot set throttling on
    // the one it creates. The same ID keeps the deployed stage in place.
    const httpApi = new HttpApi(this, 'HttpApi', {
      createDefaultStage: false,
      disableExecuteApiEndpoint: true,
    });
    httpApi
      .addStage('DefaultStage', {
        autoDeploy: true,
        domainMapping: { domainName: apiDomain },
        throttle: apiThrottle,
      })
      .node.addDependency(apiDomain);
    httpApi.addRoutes({
      path: '/health',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthIntegration', healthFunction),
    });

    // Building here would run a full Next.js build on every synth and in every
    // test, so the root scripts run `open-next build` first instead.
    // NextjsDomain looks the hosted zone up at synth time, so the domain and
    // its records are set here to keep synth free of AWS calls.
    const web = new Nextjs(this, 'Web', {
      nextjsPath: props.webAppPath,
      skipBuild: true,
      overrides: {
        nextjsDistribution: {
          distributionProps: {
            domainNames: [props.domains.web],
            certificate: certificateFromParameter(
              'CloudFrontCertificate',
              certificateParameters.cloudFront,
            ),
          },
        },
      },
    });

    const zone = HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      zoneName: props.domains.zone,
      hostedZoneId: StringParameter.valueForStringParameter(this, hostedZoneIdParameter),
    });
    const webTarget = RecordTarget.fromAlias(new CloudFrontTarget(web.distribution.distribution));
    new ARecord(this, 'WebRecord', { zone, recordName: props.domains.web, target: webTarget });
    new AaaaRecord(this, 'WebRecordIpv6', {
      zone,
      recordName: props.domains.web,
      target: webTarget,
    });
    new ARecord(this, 'ApiRecord', {
      zone,
      recordName: props.domains.api,
      target: RecordTarget.fromAlias(
        new ApiGatewayv2DomainProperties(
          apiDomain.regionalDomainName,
          apiDomain.regionalHostedZoneId,
        ),
      ),
    });

    new CfnOutput(this, 'ApiUrl', { value: `https://${props.domains.api}` });
    new CfnOutput(this, 'WebUrl', { value: `https://${props.domains.web}` });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
