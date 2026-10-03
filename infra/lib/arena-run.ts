import { Duration, Stack } from 'aws-cdk-lib';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import {
  Choice,
  Condition,
  DefinitionBody,
  Fail,
  type IChainable,
  JsonPath,
  StateMachine,
  Succeed,
  TaskInput,
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

// An attempt is a few model calls and at most one payout; past this something is stuck.
const ATTEMPT_TIMEOUT = Duration.minutes(30);

/**
 * The ArenaRun state machine: run the arena deal, judge it, and for a
 * loophole save the regression case and pay the bounty. Each step stores its
 * work before returning, so a retried step picks up where it stopped. A step
 * that still fails marks the attempt failed. Once the attempt is judged or
 * failed, an Announce step pushes the news to the browsers watching it.
 * Started with `{ "attemptId": "..." }` once the attempt is stored.
 */
export function createArenaRun(scope: Construct, arenaFunction: IFunction): StateMachine {
  const arena = new Construct(scope, 'ArenaRun');
  const attemptId = JsonPath.stringAt('$.attemptId');

  // The pages poll as well, so a failed announcement must not fail the attempt.
  const announce = (stateName: string, next: IChainable) =>
    new LambdaInvoke(arena, stateName, {
      lambdaFunction: arenaFunction,
      payload: TaskInput.fromObject({ task: 'Announce', attemptId }),
      payloadResponseOnly: true,
      resultPath: JsonPath.DISCARD,
    })
      .addRetry({ interval: Duration.seconds(1), maxAttempts: 2 })
      .addCatch(next, { resultPath: JsonPath.DISCARD })
      .next(next);

  const attemptFailed = new Fail(arena, 'AttemptFailed', {
    errorPath: '$.error.Error',
    causePath: '$.error.Cause',
  });
  // Without this, an attempt whose run stopped would show as running forever.
  const markFailed = new LambdaInvoke(arena, 'MarkFailed', {
    lambdaFunction: arenaFunction,
    payload: TaskInput.fromObject({
      task: 'MarkFailed',
      attemptId,
      error: JsonPath.stringAt('$.error.Error'),
    }),
    payloadResponseOnly: true,
    resultPath: JsonPath.DISCARD,
  }).next(announce('AnnounceFailure', attemptFailed));

  const step = (task: string, retryOn: string[]) =>
    new LambdaInvoke(arena, task, {
      lambdaFunction: arenaFunction,
      payload: TaskInput.fromObject({ task, attemptId }),
      payloadResponseOnly: true,
      resultPath: '$.result',
    })
      .addRetry({
        errors: retryOn,
        interval: Duration.seconds(5),
        backoffRate: 2,
        maxAttempts: 2,
      })
      .addCatch(markFailed, { resultPath: '$.error' });

  // Rerunning a model step costs tokens, so only failures a second try can fix are retried.
  const modelErrors = ['ThrottlingException', 'ServiceUnavailableException', 'LlmOutputError'];

  const saveAndPay = step('SaveRegression', ['ConcurrentArenaUpdateError']).next(
    // A PayPal retry reuses the payout's request ID, so it cannot pay twice.
    step('PayBounty', ['PayPalApiError']),
  );
  const judged = new Choice(arena, 'FoundLoophole')
    .when(Condition.booleanEquals('$.result.loophole', true), saveAndPay)
    .otherwise(new Succeed(arena, 'NoLoophole'));

  const definition = step('RunDeal', modelErrors)
    .next(step('Judge', [...modelErrors, 'ConcurrentArenaUpdateError']))
    .next(announce('AnnounceResult', judged));

  return new StateMachine(arena, 'StateMachine', {
    stateMachineName: `${Stack.of(scope).stackName}-ArenaRun`,
    definitionBody: DefinitionBody.fromChainable(definition),
    timeout: ATTEMPT_TIMEOUT,
  });
}
