'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { FORM_INPUT_CLASS } from './form-styles';
import { CHALLENGE_ANSWER_FIELD, CHALLENGE_TOKEN_FIELD, HONEYPOT_FIELD } from '../_forms/fields';

const challengeSchema = z.object({ a: z.number(), b: z.number(), token: z.string() });
type Challenge = z.infer<typeof challengeSchema>;

/** Reads the honeypot and challenge inputs that `SpamGuardFields` renders into a form. */
export function readSpamGuardFields(form: FormData): Record<string, FormDataEntryValue> {
  return {
    [HONEYPOT_FIELD]: form.get(HONEYPOT_FIELD) ?? '',
    [CHALLENGE_TOKEN_FIELD]: form.get(CHALLENGE_TOKEN_FIELD) ?? '',
    [CHALLENGE_ANSWER_FIELD]: form.get(CHALLENGE_ANSWER_FIELD) ?? '',
  };
}

// True once every required field except the sum itself holds a valid value.
function areOtherFieldsFilled(form: HTMLFormElement): boolean {
  return Array.from(form.elements).every(
    (element) =>
      !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
      element.name === CHALLENGE_ANSWER_FIELD ||
      element.checkValidity(),
  );
}

// The sum comes from the server, which signs the answer, so the browser never
// holds a valid answer it did not compute. It appears only once the rest of the
// form is filled, so visitors read the form before they meet the check.
export function SpamGuardFields() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isFormFilled, setIsFormFilled] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  useEffect(() => {
    const form = anchorRef.current?.closest('form');
    if (!form) return;
    const revealWhenFilled = () => {
      if (areOtherFieldsFilled(form)) setIsFormFilled(true);
    };
    revealWhenFilled();
    form.addEventListener('input', revealWhenFilled);
    form.addEventListener('change', revealWhenFilled);
    return () => {
      form.removeEventListener('input', revealWhenFilled);
      form.removeEventListener('change', revealWhenFilled);
    };
  }, []);

  useEffect(() => {
    if (!isFormFilled) return;
    void fetch('/api/challenge', { cache: 'no-store' })
      .then((response) => response.json())
      .then((body) => {
        setChallenge(challengeSchema.parse(body));
      });
  }, [isFormFilled]);

  return (
    <>
      {/* Hidden from sight, tab order and screen readers, so only a bot fills it. */}
      <div
        ref={anchorRef}
        aria-hidden="true"
        className="absolute -left-[9999px] h-0 w-0 overflow-hidden"
      >
        <label htmlFor={HONEYPOT_FIELD}>Website</label>
        <input
          id={HONEYPOT_FIELD}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      {challenge && (
        <div className="flex items-center gap-3">
          <label htmlFor={CHALLENGE_ANSWER_FIELD} className="text-muted text-sm">
            What is {challenge.a} + {challenge.b}?
          </label>
          <input type="hidden" name={CHALLENGE_TOKEN_FIELD} value={challenge.token} />
          <input
            id={CHALLENGE_ANSWER_FIELD}
            name={CHALLENGE_ANSWER_FIELD}
            required
            inputMode="numeric"
            autoComplete="off"
            className={`${FORM_INPUT_CLASS} w-20 text-center`}
          />
        </div>
      )}
    </>
  );
}
