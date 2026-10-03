import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

describe('clientIp', () => {
  it('strips the port from an IPv4 CloudFront viewer address', () => {
    expect(clientIp(new Headers({ 'cloudfront-viewer-address': '203.0.113.7:46532' }))).toBe(
      '203.0.113.7',
    );
  });

  it('strips the port from an IPv6 CloudFront viewer address', () => {
    expect(clientIp(new Headers({ 'cloudfront-viewer-address': '2001:db8::1:46532' }))).toBe(
      '2001:db8::1',
    );
  });

  it('falls back to the first forwarded address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }))).toBe(
      '198.51.100.2',
    );
  });

  it('returns unknown without address headers', () => {
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
