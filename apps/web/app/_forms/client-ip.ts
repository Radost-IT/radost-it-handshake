import { timingSafeEqual } from 'node:crypto';

export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

function isFromCloudFront(headers: Headers, originSecret: string): boolean {
  const sent = Buffer.from(headers.get(ORIGIN_VERIFY_HEADER) ?? '');
  const expected = Buffer.from(originSecret);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

/**
 * The visitor's IP, or null when the request skipped CloudFront. The web
 * server's function URL is public, and a direct caller could set any address
 * header, so only a request carrying CloudFront's origin secret is trusted.
 * Without a secret (local development) every request is trusted.
 */
export function clientIp(headers: Headers, originSecret: string | null): string | null {
  if (originSecret !== null && !isFromCloudFront(headers, originSecret)) return null;

  // CloudFront sends the viewer address as `ip:port`; IPv6 addresses contain
  // colons too, so only the last part is the port.
  const viewerAddress = headers.get('cloudfront-viewer-address');
  if (viewerAddress) return viewerAddress.slice(0, viewerAddress.lastIndexOf(':'));

  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwardedFor || 'unknown';
}
