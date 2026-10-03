import { CfnOutput, Duration, PermissionsBoundary, Stack, type StackProps } from 'aws-cdk-lib';
import { CorsHttpMethod, DomainName, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, type IFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AaaaRecord, ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGatewayv2DomainProperties, CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Nextjs } from 'cdk-nextjs-standalone';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import { createDealLifecycle } from './deal-lifecycle';

export interface HandshakeStackProps extends StackProps {
  /** Selects the config under `/handshake/<stage>` in SSM. */
  stage: string;
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

const serviceSource = (service: string, handlerFile: string) =>
  fileURLToPath(new URL(`../../services/${service}/src/${handlerFile}`, import.meta.url));

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
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'gsi1pk', type: AttributeType.STRING },
          sortKey: { name: 'gsi1sk', type: AttributeType.STRING },
        },
      ],
    });

    const eventBus = new EventBus(this, 'EventBus', { eventBusName: `${this.stackName}-events` });

    const healthFunction = new NodejsFunction(this, 'HealthFunction', {
      entry: serviceSource('api', 'health.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, 'HealthFunctionLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
    });

    const arenaApiFunction = new NodejsFunction(this, 'ArenaApiFunction', {
      entry: serviceSource('api', 'arena-handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup: new LogGroup(this, 'ArenaApiFunctionLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
      environment: { TABLE_NAME: table.tableName },
    });
    table.grant(arenaApiFunction, 'dynamodb:GetItem', 'dynamodb:PutItem');

    const configPath = `/handshake/${props.stage}`;
    const paypalWebhookFunction = new NodejsFunction(this, 'PayPalWebhookFunction', {
      entry: serviceSource('webhooks', 'handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      // Leaves room for one PayPal verification call with its retries.
      timeout: Duration.seconds(25),
      logGroup: new LogGroup(this, 'PayPalWebhookFunctionLogs', {
        retention: RetentionDays.ONE_MONTH,
      }),
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
      environment: {
        HANDSHAKE_STAGE: props.stage,
        TABLE_NAME: table.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    table.grant(paypalWebhookFunction, 'dynamodb:PutItem', 'dynamodb:DeleteItem');
    eventBus.grantPutEventsTo(paypalWebhookFunction);
    this.grantConfigRead(paypalWebhookFunction, configPath);

    const workflowsFunction = new NodejsFunction(this, 'WorkflowsFunction', {
      entry: serviceSource('workflows', 'handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      // A delivery timer step can reauthorize and then void, two PayPal calls in a row.
      timeout: Duration.seconds(30),
      logGroup: new LogGroup(this, 'WorkflowsFunctionLogs', {
        retention: RetentionDays.ONE_MONTH,
      }),
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
      environment: {
        HANDSHAKE_STAGE: props.stage,
        TABLE_NAME: table.tableName,
        WEB_URL: `https://${props.domains.web}`,
      },
    });
    table.grant(
      workflowsFunction,
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:DeleteItem',
      'dynamodb:ConditionCheckItem',
    );
    this.grantConfigRead(workflowsFunction, configPath);
    const dealLifecycle = createDealLifecycle(this, workflowsFunction);

    const paypalEventsFunction = new NodejsFunction(this, 'PayPalEventsFunction', {
      entry: serviceSource('workflows', 'paypal-events-handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup: new LogGroup(this, 'PayPalEventsFunctionLogs', {
        retention: RetentionDays.ONE_MONTH,
      }),
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
      environment: { TABLE_NAME: table.tableName },
    });
    table.grant(paypalEventsFunction, 'dynamodb:PutItem', 'dynamodb:DeleteItem');
    dealLifecycle.grantTaskResponse(paypalEventsFunction);
    new Rule(this, 'PayPalEventsRule', {
      eventBus,
      eventPattern: {
        source: ['handshake.paypal'],
        detailType: [
          'CHECKOUT.ORDER.APPROVED',
          'PAYMENT.CAPTURE.COMPLETED',
          'PAYMENT.CAPTURE.DENIED',
        ],
      },
      targets: [new LambdaFunction(paypalEventsFunction)],
    });

    const dealApiFunction = new NodejsFunction(this, 'DealApiFunction', {
      entry: serviceSource('api', 'deal-handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup: new LogGroup(this, 'DealApiFunctionLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: { format: OutputFormat.ESM, minify: true, sourceMap: true },
      environment: { TABLE_NAME: table.tableName },
    });
    table.grant(dealApiFunction, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem');
    dealLifecycle.grantTaskResponse(dealApiFunction);

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
      // The browser calls the API from the web hostname and sends the session cookie.
      corsPreflight: {
        allowOrigins: [`https://${props.domains.web}`],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST],
        allowHeaders: ['authorization', 'content-type'],
        allowCredentials: true,
        maxAge: Duration.hours(1),
      },
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
    httpApi.addRoutes({
      path: '/webhooks/paypal',
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration('PayPalWebhookIntegration', paypalWebhookFunction),
    });
    const arenaApiIntegration = new HttpLambdaIntegration('ArenaApiIntegration', arenaApiFunction);
    httpApi.addRoutes({
      path: '/arena/challengers',
      methods: [HttpMethod.POST],
      integration: arenaApiIntegration,
    });
    httpApi.addRoutes({
      path: '/arena/challengers/me',
      methods: [HttpMethod.GET],
      integration: arenaApiIntegration,
    });
    const dealApiIntegration = new HttpLambdaIntegration('DealApiIntegration', dealApiFunction);
    for (const decision of ['purchase-approval', 'human-decision']) {
      httpApi.addRoutes({
        path: `/deals/{dealId}/${decision}`,
        methods: [HttpMethod.POST],
        integration: dealApiIntegration,
      });
    }

    // Building here would run a full Next.js build on every synth and in every
    // test, so the root scripts run `open-next build` first instead.
    // NextjsDomain looks the hosted zone up at synth time, so the domain and
    // its records are set here to keep synth free of AWS calls.
    const web = new Nextjs(this, 'Web', {
      nextjsPath: props.webAppPath,
      skipBuild: true,
      environment: { HANDSHAKE_STAGE: props.stage },
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
    // The web server signs its form spam checks and must not see the PayPal or Channel3 keys.
    const webServer = web.serverFunction.lambdaFunction;
    webServer.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: `${configPath.slice(1)}/web/form-signing-secret`,
          }),
        ],
      }),
    );
    this.grantSsmDecrypt(webServer);

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
    new CfnOutput(this, 'DealLifecycleArn', { value: dealLifecycle.stateMachineArn });
    // Registered with PayPal by hand ([I-11]).
    new CfnOutput(this, 'WebhookUrl', { value: `https://${props.domains.api}/webhooks/paypal` });
  }

  private grantConfigRead(fn: NodejsFunction, configPath: string): void {
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:GetParametersByPath'],
        resources: [
          this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: configPath.slice(1),
          }),
        ],
      }),
    );
    this.grantSsmDecrypt(fn);
  }

  private grantSsmDecrypt(fn: IFunction): void {
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: { StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` } },
      }),
    );
  }
}
