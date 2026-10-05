import type { Email } from './send';

const SIGN_IN_URL = 'https://handshake.radostit.com/sign-in';

export function signInCodeEmail(code: string, validMinutes: number): Email {
  return {
    subject: `${code} is your Handshake sign-in code`,
    text: [
      `Your sign-in code is ${code}.`,
      `It works once and expires in ${validMinutes} minutes.`,
      'If you did not ask for it, ignore this email.',
    ].join('\n\n'),
  };
}

export function accessRequestEmail(request: {
  email: string;
  reason: string;
  approveCommand: string;
  rejectCommand: string;
}): Email {
  return {
    subject: `Handshake access request from ${request.email}`,
    text: [
      `${request.email} asks for access to the console and the Red Team Lab.`,
      `Reason:\n${request.reason}`,
      `Approve:\n${request.approveCommand}`,
      `Turn down:\n${request.rejectCommand}`,
    ].join('\n\n'),
  };
}

export function accessApprovedEmail(): Email {
  return {
    subject: 'Your Handshake access is approved',
    text: [
      'Your request for access is approved.',
      `Sign in with this email at ${SIGN_IN_URL}. You can open sandbox deals in the console and attack the agents in the Red Team Lab.`,
    ].join('\n\n'),
  };
}

export function accessRejectedEmail(): Email {
  return {
    subject: 'Your Handshake access request',
    text: [
      'Thanks for asking for access.',
      'Places are limited because every deal and attack runs real AI agents, and we cannot add you right now.',
    ].join('\n\n'),
  };
}
