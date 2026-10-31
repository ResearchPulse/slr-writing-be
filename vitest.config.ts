import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    globals: true,
    // Integration tests talk to a real PostgreSQL, and a Dockerised database can take seconds per request.
    testTimeout: 30_000,
    // Dev auth lets API tests act as different users. It is ignored when NODE_ENV is production.
    // Tests that exercise slr-be access, manual import and rate limiting switch those on themselves.
    env: {
      DEV_AUTH_ENABLED: 'true',
      LOG_LEVEL: 'silent',
      SLR_VERIFY_PROJECT_ACCESS: 'false',
      FROM_SLR_RATE_LIMIT_PER_MINUTE: '10000',
    },
  },
});
