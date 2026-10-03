import type { FormStatus } from './use-form-submission';

export function FormErrorMessage({ status }: { status: FormStatus }) {
  if (status.kind === 'failed') return <p className="text-refused text-sm">{status.error}</p>;
  if (status.kind === 'locked') {
    return (
      <p className="text-refused text-sm">
        Too many attempts. Try again in {status.minutes} minutes.
      </p>
    );
  }
  return null;
}
