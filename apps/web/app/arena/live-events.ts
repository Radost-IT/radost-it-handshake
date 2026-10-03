'use client';

import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { LIVE_URL } from '../site';

const liveEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('arena.result'),
    attemptId: z.string(),
    status: z.enum(['judged', 'failed']),
  }),
  z.object({
    type: z.literal('challenger.progress'),
    challengerId: z.string(),
    xp: z.number(),
    xpGained: z.number(),
    rank: z.string(),
    rankUp: z.boolean(),
    newBadges: z.array(z.string()),
  }),
  z.object({ type: z.literal('arena.stats'), attempts: z.number(), held: z.number() }),
]);

export type LiveEvent = z.infer<typeof liveEventSchema>;

export const ARENA_TOPIC = 'arena';
export const attemptTopic = (attemptId: string) => `attempt:${attemptId}`;

const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Listens to arena events on the given topics and reconnects with backoff
 * when the socket drops. Events are hints only: callers refetch from the API.
 */
export function useLiveEvents(topics: string[], onEvent: (event: LiveEvent) => void): void {
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  const topicList = topics.join(',');
  useEffect(() => {
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let isActive = true;

    const connect = () => {
      socket = new WebSocket(`${LIVE_URL}?topics=${encodeURIComponent(topicList)}`);
      socket.onopen = () => {
        failures = 0;
      };
      socket.onmessage = (message) => {
        const event = liveEventSchema.safeParse(parseJson(message.data));
        if (event.success) onEventRef.current(event.data);
      };
      socket.onclose = () => {
        if (!isActive) return;
        failures += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** failures, MAX_RECONNECT_DELAY_MS));
      };
    };
    connect();
    return () => {
      isActive = false;
      clearTimeout(timer);
      socket?.close();
    };
  }, [topicList]);
}

function parseJson(data: unknown): unknown {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data);
  } catch {
    // A message that is not JSON is not an arena event; the page keeps polling.
    return undefined;
  }
}
