import type { NextConfig } from 'next';

// Scripts are not restricted: Next.js and the theme script run inline, so a
// script-src policy would need per-request nonces. These headers stop framing,
// MIME sniffing and plugin content without touching scripts.
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source, so Next compiles them itself.
  transpilePackages: ['@handshake/arena', '@handshake/config', '@handshake/core'],
  headers() {
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

export default nextConfig;
