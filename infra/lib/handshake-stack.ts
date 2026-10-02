import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { DomainName, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Nextjs } from 'cdk-nextjs-standalone';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface HandshakeStackProps extends StackProps {
  /** A Next.js app already built with `open-next build`. */
  webAppPath: string;
  /** Hostnames covered by the *.radostit.com certificates. DNS records are managed outside AWS. */
  domains: { web: string; api: string };
}

// The ARNs live in SSM rather than in the repo, and CloudFormation reads them at deploy time.
const certificateParameters = {
  cloudFront: '/handshake/certificates/us-east-1',
  regional: '/handshake/certificates/eu-west-1',
};

const apiSource = (handlerFile: string) =>
  fileURLToPath(new URL(`../../services/api/src/${handlerFile}`, import.meta.url));

// Generated resource names start with the stack name (`Handshake-prod`),
// which is what the IAM policies in infra/iam/ are scoped to.
export class HandshakeStack extends Stack {
  constructor(scope: Construct, id: string, props: HandshakeStackProps) {
    super(scope, id, props);

    const table = new TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      billing: Billing.onDemand(),
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
    const httpApi = new HttpApi(this, 'HttpApi', {
      defaultDomainMapping: { domainName: apiDomain },
    });
    httpApi.addRoutes({
      path: '/health',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthIntegration', healthFunction),
    });

    // Building here would run a full Next.js build on every synth and in every
    // test, so the root scripts run `open-next build` first instead.
    // NextjsDomain needs a Route 53 hosted zone, so the domain goes on the distribution directly.
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

    new CfnOutput(this, 'ApiUrl', { value: `https://${props.domains.api}` });
    new CfnOutput(this, 'ApiDnsTarget', { value: apiDomain.regionalDomainName });
    new CfnOutput(this, 'WebUrl', { value: `https://${props.domains.web}` });
    new CfnOutput(this, 'WebDnsTarget', { value: web.distribution.distributionDomain });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
