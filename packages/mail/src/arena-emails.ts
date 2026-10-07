import { renderEmailHtml } from './html-layout';
import type { Email } from './send';

const SIGN_IN_URL = 'https://handshake.radostit.com/sign-in';
const NOT_YOU_NOTE =
  'Handshake never asks for your password or payment details by email. If you did not ask for this, ignore this email.';

export function signInCodeEmail(code: string, validMinutes: number): Email {
  const expiry = `It works once and expires in ${String(validMinutes)} minutes.`;
  return {
    subject: `${code} is your Handshake sign-in code`,
    text: [
      `Your sign-in code is ${code}.`,
      expiry,
      'If you did not ask for it, ignore this email.',
    ].join('\n\n'),
    html: renderEmailHtml({
      preview: `Your Handshake sign-in code is ${code}`,
      heading: 'Your sign-in code',
      blocks: [
        { kind: 'paragraph', text: 'Type this code on the Handshake sign-in page.' },
        { kind: 'code', label: 'Sign-in code', code },
        { kind: 'paragraph', text: expiry },
      ],
      note: NOT_YOU_NOTE,
    }),
  };
}

export function accessRequestEmail(request: {
  email: string;
  reason: string;
  approveCommand: string;
  rejectCommand: string;
}): Email {
  const summary = `${request.email} asks for access to the console and the Red Team Lab.`;
  return {
    subject: `Handshake access request from ${request.email}`,
    text: [
      summary,
      `Reason:\n${request.reason}`,
      `Approve:\n${request.approveCommand}`,
      `Turn down:\n${request.rejectCommand}`,
    ].join('\n\n'),
    html: renderEmailHtml({
      preview: summary,
      heading: 'New access request',
      blocks: [
        { kind: 'paragraph', text: summary },
        { kind: 'snippet', label: 'Reason', text: request.reason },
        { kind: 'snippet', label: 'Approve', text: request.approveCommand },
        { kind: 'snippet', label: 'Turn down', text: request.rejectCommand },
      ],
      note: 'You get this email because you are the Handshake admin.',
    }),
  };
}

export function accessApprovedEmail(): Email {
  const body =
    'You can open sandbox deals in the console and attack the agents in the Red Team Lab.';
  return {
    subject: 'Your Handshake access is approved',
    text: [
      'Your request for access is approved.',
      `Sign in with this email at ${SIGN_IN_URL}. ${body}`,
    ].join('\n\n'),
    html: renderEmailHtml({
      preview: 'Your request for access is approved.',
      heading: 'Your access is approved',
      blocks: [
        { kind: 'paragraph', text: `Sign in with this email address. ${body}` },
        { kind: 'button', label: 'Sign in', href: SIGN_IN_URL },
      ],
      note: NOT_YOU_NOTE,
    }),
  };
}

export function accessRejectedEmail(): Email {
  const reason =
    'Places are limited because every deal and attack runs real AI agents, and we cannot add you right now.';
  return {
    subject: 'Your Handshake access request',
    text: ['Thanks for asking for access.', reason].join('\n\n'),
    html: renderEmailHtml({
      preview: 'Thanks for asking for access.',
      heading: 'Thanks for asking for access',
      blocks: [{ kind: 'paragraph', text: reason }],
      note: NOT_YOU_NOTE,
    }),
  };
}
