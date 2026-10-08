import type { NextConfig } from 'next';
import { API_URL, LIVE_URL } from './app/site';

const ANALYTICS_ORIGIN = 'https://cdn.radostit.com';
// The dev server evaluates modules and reloads them over its own WebSocket.
const isDevelopment = process.env.NODE_ENV === 'development';

// Next.js and the theme script run inline, so blocking inline scripts would
// need per-request nonces and turn every static page dynamic. Limiting where
// scripts load from and where the page may send data still keeps an injected
// script from loading more code or posting a session token to another host.
const contentSecurityPolicy = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  `script-src 'self' 'unsafe-inline' ${ANALYTICS_ORIGIN}${isDevelopment ? " 'unsafe-eval'" : ''}`,
  `connect-src 'self' ${API_URL} ${LIVE_URL} ${ANALYTICS_ORIGIN}${isDevelopment ? ' ws:' : ''}`,
  "img-src 'self' data: blob:",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source, so Next compiles them itself.
  transpilePackages: [
    '@handshake/arena',
    '@handshake/config',
    '@handshake/core',
    '@handshake/store',
  ],
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
