import { describe, expect, it } from 'vitest';
import { clientIp, ORIGIN_VERIFY_HEADER } from './client-ip';

const originSecret = 'a'.repeat(64);

describe('clientIp', () => {
  it('strips the port from an IPv4 CloudFront viewer address', () => {
    expect(clientIp(new Headers({ 'cloudfront-viewer-address': '203.0.113.7:46532' }), null)).toBe(
      '203.0.113.7',
    );
  });

  it('strips the port from an IPv6 CloudFront viewer address', () => {
    expect(clientIp(new Headers({ 'cloudfront-viewer-address': '2001:db8::1:46532' }), null)).toBe(
      '2001:db8::1',
    );
  });

  it('falls back to the first forwarded address', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' }), null)).toBe(
      '198.51.100.2',
    );
  });

  it('returns unknown without address headers', () => {
    expect(clientIp(new Headers(), null)).toBe('unknown');
  });

  it('trusts the address when CloudFront sent the origin secret', () => {
    const headers = new Headers({
      'cloudfront-viewer-address': '203.0.113.7:46532',
      [ORIGIN_VERIFY_HEADER]: originSecret,
    });
    expect(clientIp(headers, originSecret)).toBe('203.0.113.7');
  });

  it('refuses a request that skipped CloudFront', () => {
    const spoofed = new Headers({ 'cloudfront-viewer-address': '203.0.113.7:46532' });
    expect(clientIp(spoofed, originSecret)).toBeNull();

    spoofed.set(ORIGIN_VERIFY_HEADER, 'b'.repeat(64));
    expect(clientIp(spoofed, originSecret)).toBeNull();
  });
});
