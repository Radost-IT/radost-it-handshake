import { money, type NegotiationMove, type NegotiationTurn } from '@handshake/core';
import { expect, it } from 'vitest';
import type { DecidedMove } from './negotiator';
import { runNegotiation, type NegotiationAgent } from './run-negotiation';

const usd = (value: string) => money(value, 'USD');
const usage = { inputTokens: 100, outputTokens: 20 };

function scripted(...moves: NegotiationMove[]): NegotiationAgent {
  return () => {
    const move = moves.shift();
    if (!move) throw new Error('The script ran out of moves');
    return Promise.resolve<DecidedMove>({ move, usage });
  };
}

const offer = (value: string): NegotiationMove => ({
  action: 'OFFER',
  price: usd(value),
  message: value,
});

const options = (turns: NegotiationTurn[]) => ({
  now: () => '2026-10-02T12:00:00Z',
  onTurn: (turn: NegotiationTurn) => {
    turns.push(turn);
    return Promise.resolve();
  },
});

it('runs turns until a party accepts and adds up the token usage', async () => {
  const turns: NegotiationTurn[] = [];

  const result = await runNegotiation(
    { listPrice: usd('50.00'), maxTurns: 8, turns: [] },
    {
      buyer: scripted(offer('40.00'), { action: 'ACCEPT', message: 'Deal.' }),
      seller: scripted(offer('46.00')),
    },
    options(turns),
  );

  expect(result.status).toEqual({ status: 'AGREED', price: usd('46.00') });
  expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 60 });
  expect(turns.map((turn) => turn.party)).toEqual(['buyer', 'seller', 'buyer']);
});

it('stops at the turn cap without asking either agent again', async () => {
  const turns: NegotiationTurn[] = [];

  const result = await runNegotiation(
    { listPrice: usd('50.00'), maxTurns: 3, turns: [] },
    {
      buyer: scripted(offer('40.00'), offer('41.00')),
      seller: scripted(offer('49.00')),
    },
    options(turns),
  );

  expect(result.status).toEqual({ status: 'ABANDONED', reason: 'No agreement within 3 turns' });
  expect(turns).toHaveLength(3);
});
