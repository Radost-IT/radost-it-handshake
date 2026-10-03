import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The workspace packages ship TypeScript source, so Next compiles them itself.
  transpilePackages: ['@handshake/config'],
};

export default nextConfig;
