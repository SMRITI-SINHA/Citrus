// All runtime settings come from the environment so the same build runs in dev, UAT and on CITRUS's server.
const env = process.env;
const num = (v: string | undefined, d: number) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  port: num(env.PORT, 4000),
  env: env.NODE_ENV ?? 'development',
  /** 'pg' locally and in CI; 'oracledb' on CITRUS's Oracle 12c server. */
  dbClient: (env.DB_CLIENT ?? 'pg') as 'pg' | 'oracledb',
  databaseUrl: env.DATABASE_URL ?? 'postgres://citrus:citrus@localhost:5432/citrus',
  oracle: { user: env.ORACLE_USER, password: env.ORACLE_PASSWORD, connectString: env.ORACLE_CONNECT_STRING },
  redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: env.JWT_SECRET ?? 'dev-only-change-me-dev-only-change-me',
  otpPepper: env.OTP_PEPPER ?? 'dev-pepper',
  otpDevEcho: (env.OTP_DEV_ECHO ?? (env.NODE_ENV === 'production' ? '0' : '1')) === '1',
  accessTtlSeconds: num(env.ACCESS_TTL_SECONDS, 900),
  refreshTtlDays: num(env.REFRESH_TTL_DAYS, 30),
  corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
  ginesys: {
    baseUrl: env.GINESYS_BASE_URL ?? 'http://localhost:4100',
    apiKey: env.GINESYS_API_KEY ?? 'dev-key',
    timeoutMs: num(env.GINESYS_TIMEOUT_MS, 5000),
    siteCode: env.GINESYS_SITE_CODE ?? 'CITRUS-WH-BLR',
    /** snapshot DownloadURLs must start with this (they arrive inside webhooks) */
    downloadPrefix: env.GINESYS_DOWNLOAD_PREFIX ?? env.GINESYS_BASE_URL ?? 'http://localhost:4100',
    webhookSecret: env.GINESYS_WEBHOOK_SECRET ?? 'dev-ginesys-secret',
  },
  sync: {
    outboxIntervalMs: num(env.OUTBOX_MS, 1000),
    jobsIntervalMs: num(env.JOBS_MS, 60000),
  },
  workers: (env.WORKERS ?? '1') === '1',
  otpChannels: (env.OTP_CHANNELS ?? 'whatsapp,sms').split(',') as ('whatsapp' | 'sms')[],
  sms: { provider: env.SMS_PROVIDER ?? 'console' },          // console | msg91 (DLT template ids required)
  whatsapp: { provider: env.WHATSAPP_PROVIDER ?? 'console', appSecret: env.WHATSAPP_APP_SECRET ?? 'dev-secret', verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? 'dev-verify' },
  appUrl: env.APP_URL ?? 'http://localhost:5173',
  supportPhone: env.SUPPORT_PHONE ?? '+91 98450 10000',
};
