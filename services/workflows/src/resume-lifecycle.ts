import {
  SendTaskSuccessCommand,
  TaskDoesNotExist,
  TaskTimedOut,
  type SFNClient,
} from '@aws-sdk/client-sfn';
import { saveWait, takeWait, type StoreTable, type WaitSignal } from '@handshake/store';

export interface ResumeContext {
  table: StoreTable;
  stepFunctions: SFNClient;
  now: () => string;
}

/**
 * Hands `output` to the DealLifecycle execution that waits for `signal`.
 * Returns false when nothing waits, so a repeated signal changes nothing.
 */
export async function resumeLifecycle(
  context: ResumeContext,
  dealId: string,
  signal: WaitSignal,
  output: unknown,
): Promise<boolean> {
  const taskToken = await takeWait(context.table, dealId, signal);
  if (!taskToken) return false;
  try {
    await context.stepFunctions.send(
      new SendTaskSuccessCommand({ taskToken, output: JSON.stringify(output) }),
    );
    return true;
  } catch (error) {
    // The wait already ended, for example when it timed out.
    if (error instanceof TaskTimedOut || error instanceof TaskDoesNotExist) return false;
    // Put the token back so a retry can still resume the execution.
    await saveWait(context.table, dealId, signal, taskToken, new Date(context.now()));
    throw error;
  }
}
