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
const VERDICT_TIMEOUT = Duration.days(1);

/**
 * The DealLifecycle state machine. Each Lambda step loads the deal, applies
 * one change and reports the deal's state; the state decides what comes next.
 * The machine pauses with a task token until the buyer approves the checkout,
 * delivery evidence arrives, the verifier answers or a person decides.
 * Started with `{ "dealId": "..." }` once the deal reaches AUTHORIZING.
 */
export function createDealLifecycle(scope: Construct, lifecycleFunction: IFunction): StateMachine {
  const lifecycle = new Construct(scope, 'DealLifecycle');
  const dealId = JsonPath.stringAt('$.dealId');

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

  // The resumer sends the settlement proposal itself as the task output.
  const waitForVerdict = waitFor(
    'WaitForVerdict',
    { task: 'AwaitSignal', signal: 'verdict' },
    '$.proposal',
    Timeout.duration(VERDICT_TIMEOUT),
  )
    .addCatch(
      step('EscalateUnanswered', {
        task: 'Escalate',
        reason: 'The verifier did not answer in time',
      }).next(routeByState),
      timeouts,
    )
    .next(
      step('SettleByVerifier', {
        task: 'Settle',
        proposer: 'verifier',
        proposal: JsonPath.objectAt('$.proposal'),
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

  // A refused human decision leaves the deal ESCALATED, which waits again.
  // CAPTURING ends here too: the PayPal webhook confirms the pending capture.
  routeByState
    .when(Condition.stringEquals('$.result.state', 'AWAITING_DELIVERY'), checkDeliveryTimer)
    .when(Condition.stringEquals('$.result.state', 'VERIFYING'), waitForVerdict)
    .when(Condition.stringEquals('$.result.state', 'ESCALATED'), waitForHumanDecision)
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

  const definition = startCheckout
    .next(
      step('AuthorizePayment', {
        task: 'AuthorizePayment',
        orderId: JsonPath.stringAt('$.checkout.orderId'),
      }),
    )
    .next(routeByState);

  return new StateMachine(lifecycle, 'StateMachine', {
    stateMachineName: `${Stack.of(scope).stackName}-DealLifecycle`,
    definitionBody: DefinitionBody.fromChainable(definition),
  });
}
