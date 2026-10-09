import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test', SEED_SCALE: 'demo', DATABASE_URL: 'postgres://citrus:citrus@localhost:5432/citrus_test', REDIS_URL: 'redis://localhost:6379/5',
      GINESYS_BASE_URL: 'http://localhost:4199', GINESYS_DOWNLOAD_PREFIX: 'http://localhost:4199', MOCK_PUBLIC_URL: 'http://localhost:4199',
      GINESYS_WEBHOOK_URL: 'http://localhost:4198/webhooks/ginesys', GINESYS_TIMEOUT_MS: '1500', MOCK_LATENCY_MS: '5', MOCK_SNAPSHOT_S: '0',
      WORKERS: '0', OTP_DEV_ECHO: '1', PORT: '4198',
    },
  },
});
