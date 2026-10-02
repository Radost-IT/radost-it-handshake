import { defineConfig } from 'vitest/config';

// Integration tests call real sandbox APIs, so they read the local .env like `pnpm dev`.
process.loadEnvFile('.env');

export default defineConfig({
  test: {
    include: ['{packages,services,scripts}/**/*.integration.test.ts'],
    testTimeout: 60_000,
    passWithNoTests: true,
  },
});
