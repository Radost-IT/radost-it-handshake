import { Duration, Stack } from 'aws-cdk-lib';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import {
  Choice,
  Condition,
  DefinitionBody,
  Errors,
  IntegrationPattern,
  JsonPath,
  StateMachine,
  Succeed,
  TaskInput,
  Timeout,
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

// Matches the PayPal approval page, which the buyer either finishes or abandons quickly.
const CHECKOUT_TIMEOUT = Duration.hours(1);
// A buyer asked to approve a price gets a day before the deal is cancelled.
const PURCHASE_APPROVAL_TIMEOUT = Duration.days(1);
// PayPal settles most pending captures within days; past this a person looks at it.
const CAPTURE_TIMEOUT = Duration.days(7);

/**
 * The DealLifecycle state machine. Each Lambda step loads the deal, applies
 * one change and reports the deal's state; the state decides what comes next.
 * The agent steps negotiate and verify; they never move money. The machine
 * pauses with a task token until the buyer approves a price above their
 * threshold or the checkout, delivery evidence arrives or a person decides.
 * Started with `{ "dealId": "..." }` once the deal is NEGOTIATING, or once an
 * arena deal reaches AWAITING_HUMAN_APPROVAL or AUTHORIZING.
 */
export function createDealLifecycle(
  scope: Construct,
  functions: { lifecycle: IFunction; agents: IFunction },
): StateMachine {
  const lifecycle = new Construct(scope, 'DealLifecycle');
  const dealId = JsonPath.stringAt('$.dealId');
  const lifecycleFunction = functions.lifecycle;

  const step = (id: string, payload: Record<string, unknown>) => {
    const task = new LambdaInvoke(lifecycle, id, {
      lambdaFunction: lifecycleFunction,
      payload: TaskInput.fromObject({ dealId, ...payload }),
      payloadResponseOnly: true,
      resultPath: '$.result',
    });
    // A concurrent writer or a PayPal outage. Retrying reloads the deal and
    // reuses the same PayPal-Request-Id, so no money moves twice.
    return task.addRetry({
      errors: ['ConcurrentDealUpdateError', 'PayPalApiError'],
      interval: Duration.seconds(2),
      backoffRate: 2,
      maxAttempts: 3,
    });
  };

  const waitFor = (
    id: string,
    payload: Record<string, unknown>,
    resultPath: string,
    taskTimeout?: Timeout,
  ) =>
    new LambdaInvoke(lifecycle, id, {
      lambdaFunction: lifecycleFunction,
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,
      payload: TaskInput.fromObject({ dealId, taskToken: JsonPath.taskToken, ...payload }),
      resultPath,
      taskTimeout,
    });

  const done = new Succeed(lifecycle, 'Done');
  const routeByState = new Choice(lifecycle, 'RouteByState');
  const timeouts = { errors: [Errors.TIMEOUT], resultPath: JsonPath.DISCARD };

  const checkDeliveryTimer = step('CheckDeliveryTimer', { task: 'CheckDeliveryTimer' });
  const waitForEvidence = waitFor(
    'WaitForEvidence',
    { task: 'AwaitSignal', signal: 'evidence' },
    JsonPath.DISCARD,
    Timeout.at('$.result.waitSeconds'),
  )
    .addCatch(checkDeliveryTimer, timeouts)
    .next(step('StartVerification', { task: 'StartVerification' }))
    .next(routeByState);
  checkDeliveryTimer.next(
    new Choice(lifecycle, 'StillAwaitingDelivery')
      .when(Condition.stringEquals('$.result.state', 'AWAITING_DELIVERY'), waitForEvidence)
      .otherwise(routeByState),
  );

  // Model calls are slow and capped, so an agent step gets one retry for a
  // throttled or flaky model and then a fallback path instead of more retries.
  const agentStep = (id: string, task: string) =>
    new LambdaInvoke(lifecycle, id, {
      lambdaFunction: functions.agents,
      payload: TaskInput.fromObject({ dealId, task }),
      payloadResponseOnly: true,
      resultPath: '$.result',
    }).addRetry({
      errors: ['ThrottlingException', 'ServiceUnavailableException'],
      interval: Duration.seconds(5),
      maxAttempts: 1,
    });

  // The verifier returns `{ "proposal": ... }`; policy checks it in the next step.
  const verify = agentStep('Verify', 'Verify')
    .addCatch(
      step('EscalateUnverified', {
        task: 'Escalate',
        reason: 'The verifier could not check the evidence',
      }).next(routeByState),
      { errors: [Errors.ALL], resultPath: JsonPath.DISCARD },
    )
    .next(
      step('SettleByVerifier', {
        task: 'Settle',
        proposer: 'verifier',
        proposal: JsonPath.objectAt('$.result.proposal'),
      }),
    )
    .next(routeByState);

  const waitForHumanDecision = waitFor(
    'WaitForHumanDecision',
    { task: 'AwaitSignal', signal: 'human-decision' },
    '$.proposal',
  )
    .next(
      step('SettleByHuman', {
        task: 'Settle',
        proposer: 'human',
        proposal: JsonPath.objectAt('$.proposal'),
      }),
    )
    .next(routeByState);

  // The resumer sends the capture resource of the PayPal webhook.
  const waitForCapture = waitFor(
    'WaitForCapture',
    { task: 'AwaitSignal', signal: 'capture' },
    '$.capture',
    Timeout.duration(CAPTURE_TIMEOUT),
  )
    .addCatch(
      step('EscalateUnconfirmedCapture', {
        task: 'Escalate',
        reason: 'PayPal did not confirm the capture in time',
      }).next(routeByState),
      timeouts,
    )
    .next(
      step('ConfirmCapture', {
        task: 'ConfirmCapture',
        capture: JsonPath.objectAt('$.capture'),
      }),
    )
    .next(routeByState);

  // A refused human decision leaves the deal ESCALATED, which waits again.
  // A capture that is still pending leaves it CAPTURING, which also waits again.
  routeByState
    .when(Condition.stringEquals('$.result.state', 'AWAITING_DELIVERY'), checkDeliveryTimer)
    .when(Condition.stringEquals('$.result.state', 'VERIFYING'), verify)
    .when(Condition.stringEquals('$.result.state', 'ESCALATED'), waitForHumanDecision)
    .when(Condition.stringEquals('$.result.state', 'CAPTURING'), waitForCapture)
    .otherwise(done);

  // The resumer sends `{ "orderId": "..." }` once the buyer approves the order.
  const startCheckout = waitFor(
    'StartCheckout',
    { task: 'StartCheckout' },
    '$.checkout',
    Timeout.duration(CHECKOUT_TIMEOUT),
  )
    .addCatch(
      step('CancelUnapprovedCheckout', {
        task: 'CancelCheckout',
        reason: 'The buyer did not approve the payment in time',
      }).next(done),
      timeouts,
    )
    .addCatch(
      step('CancelCheckoutByBuyer', {
        task: 'CancelCheckout',
        reason: 'The buyer cancelled the payment',
      }).next(done),
      { errors: ['CheckoutCancelled'], resultPath: JsonPath.DISCARD },
    );

  startCheckout
    .next(
      step('AuthorizePayment', {
        task: 'AuthorizePayment',
        orderId: JsonPath.stringAt('$.checkout.orderId'),
      }),
    )
    .next(routeByState);

  // The resumer sends the buyer's `{ "approved": true | false }` as the task output.
  const waitForPurchaseApproval = waitFor(
    'WaitForPurchaseApproval',
    { task: 'AwaitSignal', signal: 'purchase-approval' },
    '$.decision',
    Timeout.duration(PURCHASE_APPROVAL_TIMEOUT),
  ).addCatch(
    step('CancelUnapprovedPurchase', {
      task: 'CancelPurchase',
      reason: 'The buyer did not approve the price in time',
    }).next(done),
    timeouts,
  );
  const routeStart = new Choice(lifecycle, 'RouteStart');
  const negotiate = agentStep('Negotiate', 'Negotiate').addCatch(
    step('AbandonFailedNegotiation', {
      task: 'AbandonNegotiation',
      reason: 'The agents could not finish the negotiation',
    }).next(routeStart),
    { errors: [Errors.ALL], resultPath: JsonPath.DISCARD },
  );
  negotiate.next(routeStart);
  // A refused decision leaves the deal AWAITING_HUMAN_APPROVAL, which waits again.
  waitForPurchaseApproval
    .next(
      step('DecidePurchase', {
        task: 'DecidePurchase',
        decision: JsonPath.objectAt('$.decision'),
      }),
    )
    .next(routeStart);
  routeStart
    .when(Condition.stringEquals('$.result.state', 'NEGOTIATING'), negotiate)
    .when(
      Condition.stringEquals('$.result.state', 'AWAITING_HUMAN_APPROVAL'),
      waitForPurchaseApproval,
    )
    .when(Condition.stringEquals('$.result.state', 'AUTHORIZING'), startCheckout)
    .otherwise(done);

  const definition = step('ReadState', { task: 'ReadState' }).next(routeStart);

  return new StateMachine(lifecycle, 'StateMachine', {
    stateMachineName: `${Stack.of(scope).stackName}-DealLifecycle`,
    definitionBody: DefinitionBody.fromChainable(definition),
  });
}
