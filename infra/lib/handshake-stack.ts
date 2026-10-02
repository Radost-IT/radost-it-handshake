import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Nextjs } from 'cdk-nextjs-standalone';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface HandshakeStackProps extends StackProps {
  stage: string;
  /** A Next.js app already built with `open-next build`. */
  webAppPath: string;
}

const apiSource = (handlerFile: string) =>
  fileURLToPath(new URL(`../../services/api/src/${handlerFile}`, import.meta.url));

// Generated resource names start with the stack name (`Handshake-<stage>`),
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

    const httpApi = new HttpApi(this, 'HttpApi');
    httpApi.addRoutes({
      path: '/health',
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration('HealthIntegration', healthFunction),
    });

    // Building here would run a full Next.js build on every synth and in every
    // test, so the root scripts run `open-next build` first instead.
    const web = new Nextjs(this, 'Web', { nextjsPath: props.webAppPath, skipBuild: true });

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'WebUrl', { value: web.url });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
