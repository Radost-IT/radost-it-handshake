import { expect, it } from 'vitest';
import { accessRequestEmail, signInCodeEmail } from './arena-emails';

it('shows the sign-in code in both the text and the HTML body', () => {
  const email = signInCodeEmail('123456', 10);

  expect(email.text).toContain('123456');
  expect(email.html).toContain('>123456</td>');
  expect(email.html).toContain('expires in 10 minutes');
});

it('escapes visitor text in the HTML body', () => {
  const email = accessRequestEmail({
    email: 'ada@example.com',
    reason: '<script>alert("hi")</script>',
    approveCommand: 'pnpm arena:access T approve ada@example.com',
    rejectCommand: 'pnpm arena:access T reject ada@example.com',
  });

  expect(email.html).not.toContain('<script>');
  expect(email.html).toContain('&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt;');
});
