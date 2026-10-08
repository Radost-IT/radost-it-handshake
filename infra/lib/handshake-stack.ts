import { CfnOutput, Duration, PermissionsBoundary, Stack, type StackProps } from 'aws-cdk-lib';
import {
  CfnStage,
  CorsHttpMethod,
  DomainName,
  HttpApi,
  HttpMethod,
  WebSocketApi,
  WebSocketStage,
} from 'aws-cdk-lib/aws-apigatewayv2';
import {
  HttpLambdaIntegration,
  WebSocketLambdaIntegration,
} from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { AttributeType, Billing, StreamViewType, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  FilterCriteria,
  FilterRule,
  type IFunction,
  Runtime,
  StartingPosition,
} from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AaaaRecord, ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { ApiGatewayv2DomainProperties, CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Nextjs } from 'cdk-nextjs-standalone';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import { createArenaRun } from './arena-run';
import { createDealLifecycle } from './deal-lifecycle';

export interface HandshakeStackProps extends StackProps {
  /** Selects the config under `/handshake/<stage>` in SSM. */
  stage: string;
  /** A Next.js app already built with `open-next build`. */
  webAppPath: string;
  /** The Route 53 zone and the hostnames in it covered by its wildcard certificates. */
  domains: { zone: string; web: string; api: string; live: string };
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

// The PayPal SDK pulls in CommonJS packages that require Node built-ins. An
// ESM bundle has no require, so the banner provides one.
const esmBundling = {
  format: OutputFormat.ESM,
  minify: true,
  sourceMap: true,
  banner:
    "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
};

// Caps what public traffic can cost. The stage limit is shared by every caller,
// so the routes anyone can hit get their own smaller limits: a flood of one of
// them is then refused there and cannot starve the Deal API or PayPal webhooks.
const apiThrottle = { rateLimit: 25, burstLimit: 50 };
const publicRouteThrottles: Record<string, { rateLimit: number; burstLimit: number }> = {
  'GET /health': { rateLimit: 2, burstLimit: 5 },
  'POST /webhooks/paypal': { rateLimit: 10, burstLimit: 20 },
  'POST /arena/sign-in': { rateLimit: 5, burstLimit: 10 },
  'POST /arena/sign-in/verify': { rateLimit: 5, burstLimit: 10 },
  'POST /arena/session/refresh': { rateLimit: 5, burstLimit: 10 },
  'POST /arena/sign-out': { rateLimit: 5, burstLimit: 10 },
  'GET /arena/deals': { rateLimit: 5, burstLimit: 10 },
  'GET /arena/stats': { rateLimit: 5, burstLimit: 10 },
  'GET /arena/leaderboard': { rateLimit: 5, burstLimit: 10 },
  'GET /arena/attempts/{attemptId}': { rateLimit: 5, burstLimit: 10 },
};

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
      // The table holds every deal and its PayPal audit log; a stray delete must fail.
      deletionProtection: true,
      // Deal pages hear about changes from this stream; the keys say which deal changed.
      dynamoStream: StreamViewType.KEYS_ONLY,
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
      bundling: esmBundling,
    });

    const arenaApiFunction = new NodejsFunction(this, 'ArenaApiFunction', {
      entry: serviceSource('api', 'arena-handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup: new LogGroup(this, 'ArenaApiFunctionLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: esmBundling,
      environment: { HANDSHAKE_STAGE: props.stage, TABLE_NAME: table.tableName },
    });
    table.grant(
      arenaApiFunction,
      'dynamodb:GetItem',
      'dynamodb:BatchGetItem',
      'dynamodb:Query',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
    );

    const configPath = `/handshake/${props.stage}`;
    // The arena API refuses attempts once the day's tokens are used and emails sign-in
    // codes and access requests. The ZeptoMail token is the only secret it reads.
    for (const value of [
      'limits/daily-token-budget',
      'arena/email-from',
      'arena/admin-email',
      'arena/zeptomail-api-url',
      'arena/zeptomail-token',
    ]) {
      this.grantConfigValueRead(arenaApiFunction, `${configPath}/${value}`);
    }
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
      bundling: esmBundling,
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
      bundling: esmBundling,
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

    const dealAgentsFunction = new NodejsFunction(this, 'DealAgentsFunction', {
      entry: serviceSource('workflows', 'deal-agents-handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      // Shopping the catalog and a full negotiation are many model calls in a row.
      timeout: Duration.minutes(10),
      logGroup: new LogGroup(this, 'DealAgentsFunctionLogs', {
        retention: RetentionDays.ONE_MONTH,
      }),
      bundling: esmBundling,
      environment: { HANDSHAKE_STAGE: props.stage, TABLE_NAME: table.tableName },
    });
    table.grant(
      dealAgentsFunction,
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:ConditionCheckItem',
    );
    this.grantConfigRead(dealAgentsFunction, configPath);
    this.grantAnthropicModels(dealAgentsFunction);
    const dealLifecycle = createDealLifecycle(this, {
      lifecycle: workflowsFunction,
      agents: dealAgentsFunction,
    });

    const arenaRunFunction = new NodejsFunction(this, 'ArenaRunFunction', {
      entry: serviceSource('workflows', 'arena-run-handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      // A full negotiation is up to the turn limit of model calls in a row.
      timeout: Duration.minutes(5),
      logGroup: new LogGroup(this, 'ArenaRunFunctionLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: esmBundling,
      environment: { HANDSHAKE_STAGE: props.stage, TABLE_NAME: table.tableName },
    });
    table.grant(
      arenaRunFunction,
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:Query',
    );
    this.grantConfigRead(arenaRunFunction, configPath);
    this.grantAnthropicModels(arenaRunFunction);
    const arenaRun = createArenaRun(this, arenaRunFunction);
    arenaApiFunction.addEnvironment('ARENA_RUN_ARN', arenaRun.stateMachineArn);
    arenaRun.grantStartExecution(arenaApiFunction);

    const liveFunction = new NodejsFunction(this, 'LiveFunction', {
      entry: serviceSource('api', 'live-handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, 'LiveFunctionLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: esmBundling,
      environment: { TABLE_NAME: table.tableName },
    });
    table.grant(liveFunction, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem');
    const liveIntegration = new WebSocketLambdaIntegration('LiveIntegration', liveFunction);
    // Browsers only listen; ArenaRun and the deal stream push through the management API.
    const liveApi = new WebSocketApi(this, 'LiveApi', {
      connectRouteOptions: { integration: liveIntegration },
      disconnectRouteOptions: { integration: liveIntegration },
    });

    const paypalEventsFunction = new NodejsFunction(this, 'PayPalEventsFunction', {
      entry: serviceSource('workflows', 'paypal-events-handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup: new LogGroup(this, 'PayPalEventsFunctionLogs', {
        retention: RetentionDays.ONE_MONTH,
      }),
      bundling: esmBundling,
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
      bundling: esmBundling,
      environment: {
        TABLE_NAME: table.tableName,
        DEAL_LIFECYCLE_ARN: dealLifecycle.stateMachineArn,
        WEB_URL: `https://${props.domains.web}`,
      },
    });
    table.grant(
      dealApiFunction,
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:Query',
      'dynamodb:BatchGetItem',
      'dynamodb:ConditionCheckItem',
    );
    dealLifecycle.grantStartExecution(dealApiFunction);
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
        maxAge: Duration.hours(1),
      },
    });
    const httpStage = httpApi.addStage('DefaultStage', {
      autoDeploy: true,
      domainMapping: { domainName: apiDomain },
      throttle: apiThrottle,
    });
    httpStage.node.addDependency(apiDomain);
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
    const liveDomain = new DomainName(this, 'LiveDomain', {
      domainName: props.domains.live,
      certificate: certificateFromParameter('LiveCertificate', certificateParameters.regional),
    });
    const liveStage = new WebSocketStage(this, 'LiveStage', {
      webSocketApi: liveApi,
      stageName: 'live',
      autoDeploy: true,
      domainMapping: { domainName: liveDomain },
      throttle: apiThrottle,
    });
    arenaRunFunction.addEnvironment('LIVE_CALLBACK_URL', liveStage.callbackUrl);
    liveApi.grantManageConnections(arenaRunFunction);

    const dealUpdatesFunction = new NodejsFunction(this, 'DealUpdatesFunction', {
      entry: serviceSource('workflows', 'deal-updates-handler.ts'),
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup: new LogGroup(this, 'DealUpdatesFunctionLogs', {
        retention: RetentionDays.ONE_MONTH,
      }),
      bundling: esmBundling,
      environment: { TABLE_NAME: table.tableName, LIVE_CALLBACK_URL: liveStage.callbackUrl },
    });
    table.grant(dealUpdatesFunction, 'dynamodb:GetItem', 'dynamodb:DeleteItem', 'dynamodb:Query');
    liveApi.grantManageConnections(dealUpdatesFunction);
    dealUpdatesFunction.addEventSource(
      new DynamoEventSource(table, {
        startingPosition: StartingPosition.LATEST,
        // Updates are hints and the page also polls, so a failing batch is not retried for long.
        retryAttempts: 2,
        filters: [
          FilterCriteria.filter({
            dynamodb: {
              Keys: {
                pk: { S: FilterRule.beginsWith('DEAL#') },
                sk: { S: FilterRule.or('META', 'NEGOTIATION') },
              },
            },
          }),
        ],
      }),
    );

    const arenaApiIntegration = new HttpLambdaIntegration('ArenaApiIntegration', arenaApiFunction);
    for (const path of [
      '/arena/sign-in',
      '/arena/sign-in/verify',
      '/arena/session/refresh',
      '/arena/sign-out',
      '/arena/access-requests',
      '/arena/merchant-applications',
      '/arena/challengers',
      '/arena/attempts',
    ]) {
      httpApi.addRoutes({ path, methods: [HttpMethod.POST], integration: arenaApiIntegration });
    }
    httpApi.addRoutes({
      path: '/arena/attempts/{attemptId}',
      methods: [HttpMethod.GET],
      integration: arenaApiIntegration,
    });
    for (const path of [
      '/arena/account',
      '/arena/merchant',
      '/arena/deals',
      '/arena/stats',
      '/arena/leaderboard',
      '/arena/challengers/me/attempts',
    ]) {
      httpApi.addRoutes({ path, methods: [HttpMethod.GET], integration: arenaApiIntegration });
    }
    const dealApiIntegration = new HttpLambdaIntegration('DealApiIntegration', dealApiFunction);
    httpApi.addRoutes({
      path: '/v1/deals',
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration: dealApiIntegration,
    });
    httpApi.addRoutes({
      path: '/v1/deals/{dealId}',
      methods: [HttpMethod.GET],
      integration: dealApiIntegration,
    });
    for (const action of ['evidence', 'purchase-approval', 'human-decision']) {
      httpApi.addRoutes({
        path: `/v1/deals/{dealId}/${action}`,
        methods: [HttpMethod.POST],
        integration: dealApiIntegration,
      });
    }

    // CloudFormation takes route settings as raw JSON, keyed by route key, and
    // the stage must be updated after the routes it names exist.
    const httpStageResource = httpStage.node.defaultChild as CfnStage;
    httpStageResource.routeSettings = Object.fromEntries(
      Object.entries(publicRouteThrottles).map(([routeKey, limit]) => [
        routeKey,
        { ThrottlingRateLimit: limit.rateLimit, ThrottlingBurstLimit: limit.burstLimit },
      ]),
    );
    for (const child of httpApi.node.children) {
      if (child.node.id !== 'DefaultStage') httpStage.node.addDependency(child);
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
    this.grantConfigValueRead(webServer, `${configPath}/web/form-signing-secret`);

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

    new ARecord(this, 'LiveRecord', {
      zone,
      recordName: props.domains.live,
      target: RecordTarget.fromAlias(
        new ApiGatewayv2DomainProperties(
          liveDomain.regionalDomainName,
          liveDomain.regionalHostedZoneId,
        ),
      ),
    });

    new CfnOutput(this, 'ApiUrl', { value: `https://${props.domains.api}` });
    new CfnOutput(this, 'LiveUrl', { value: `wss://${props.domains.live}` });
    new CfnOutput(this, 'WebUrl', { value: `https://${props.domains.web}` });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'DealLifecycleArn', { value: dealLifecycle.stateMachineArn });
    new CfnOutput(this, 'ArenaRunArn', { value: arenaRun.stateMachineArn });
    // Registered with PayPal by hand; see the README, Deploy.
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

  // For functions that need one config value and must not see the other secrets.
  private grantConfigValueRead(fn: IFunction, parameterName: string): void {
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          this.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: parameterName.slice(1),
          }),
        ],
      }),
    );
    this.grantSsmDecrypt(fn);
  }

  // Matches the Bedrock statement in the workload boundary. Inference profiles route
  // to foundation models in other regions, so both resources are needed.
  private grantAnthropicModels(fn: IFunction): void {
    fn.addToRolePolicy(
      new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          this.formatArn({
            service: 'bedrock',
            resource: 'inference-profile',
            resourceName: '*anthropic.*',
          }),
          this.formatArn({
            service: 'bedrock',
            region: '*',
            account: '',
            resource: 'foundation-model',
            resourceName: 'anthropic.*',
          }),
        ],
      }),
    );
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
