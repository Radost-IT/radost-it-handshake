import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source, so Next compiles them itself.
  transpilePackages: ['@handshake/arena', '@handshake/config', '@handshake/core'],
};

export default nextConfig;
