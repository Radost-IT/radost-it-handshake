import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface HandshakeStackProps extends StackProps {
  stage: string;
  webDistPath: string;
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

    const siteBucket = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    });

    const distribution = new Distribution(this, 'Distribution', {
      comment: `Handshake ${props.stage} web app`,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    new BucketDeployment(this, 'SiteDeployment', {
      sources: [Source.asset(props.webDistPath)],
      destinationBucket: siteBucket,
      distribution,
    });

    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new CfnOutput(this, 'WebUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
