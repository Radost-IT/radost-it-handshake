import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { readBody } from './http';

const eventWith = (headers: Record<string, string>, body: string, isBase64Encoded = false) =>
  ({ headers, body, isBase64Encoded }) as unknown as APIGatewayProxyEventV2;

describe('readBody', () => {
  it('reads a JSON body, plain or base64', () => {
    const body = '{"a":1}';

    expect(readBody(eventWith({ 'content-type': 'application/json' }, body))).toBe(body);
    expect(
      readBody(
        eventWith(
          { 'content-type': 'application/json; charset=utf-8' },
          Buffer.from(body).toString('base64'),
          true,
        ),
      ),
    ).toBe(body);
  });

  it('ignores the body of a form or plain-text request', () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', '']) {
      expect(readBody(eventWith({ 'content-type': contentType }, '{"a":1}'))).toBe('');
    }
  });
});
