import type { Email } from './send';

const ARENA_URL = 'https://handshake.radostit.com/arena';

export function signInCodeEmail(code: string, validMinutes: number): Email {
  return {
    subject: `${code} is your Handshake Arena code`,
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
    subject: `Arena access request from ${request.email}`,
    text: [
      `${request.email} asks to join the arena.`,
      `Reason:\n${request.reason}`,
      `Approve:\n${request.approveCommand}`,
      `Turn down:\n${request.rejectCommand}`,
    ].join('\n\n'),
  };
}

export function accessApprovedEmail(): Email {
  return {
    subject: 'You can join Handshake Arena',
    text: [
      'Your request to join the arena is approved.',
      `Sign in with this email at ${ARENA_URL}, pick a handle and start.`,
    ].join('\n\n'),
  };
}

export function accessRejectedEmail(): Email {
  return {
    subject: 'Your Handshake Arena request',
    text: [
      'Thanks for asking to join the arena.',
      'Places are limited because every attempt runs real AI agents, and we cannot add you right now.',
    ].join('\n\n'),
  };
}
