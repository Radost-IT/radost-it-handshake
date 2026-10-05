import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createHash } from 'node:crypto';

/** Session and deal access tokens are stored only as this hash. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The body of a JSON request, or an empty string for any other content type.
 * A cross-site HTML form can only send form or plain-text bodies without a
 * CORS preflight, so ignoring them stops it from acting with the session cookie.
 */
export function readBody(event: APIGatewayProxyEventV2): string {
  const contentType = event.headers['content-type'] ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) return '';
  return event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');
}

export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
