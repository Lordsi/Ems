import path from 'node:path';

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test' || env.VITEST === 'true';

function required(name: string, fallbackForDev?: string): string {
  const v = env[name];
  if (v && v.length > 0) return v;
  if (!isProd && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}

export const config = {
  isProd,
  isTest,
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  /** Postgres connection string. When absent outside production, an embedded PGlite database is used. */
  databaseUrl: env.DATABASE_URL,
  pgliteDir: env.PGLITE_DIR ?? path.resolve('.data/pglite'),
  /** Secret used to encrypt MFA secrets at rest. Must be >= 32 chars in production. */
  appSecret: required('APP_SECRET', 'dev-only-insecure-secret-change-me-0123456789'),
  appUrl: env.APP_URL ?? env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173',
  corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: env.TRUST_PROXY ?? (isProd ? '1' : 'loopback'),
  session: {
    idleMinutes: Number(env.SESSION_IDLE_MINUTES ?? 30),
    absoluteHours: Number(env.SESSION_ABSOLUTE_HOURS ?? 12),
    reauthWindowMinutes: Number(env.REAUTH_WINDOW_MINUTES ?? 10),
  },
  runJobsInProcess: (env.RUN_JOBS_IN_PROCESS ?? (isTest ? 'false' : 'true')) === 'true',
  jobIntervalMinutes: Number(env.JOB_INTERVAL_MINUTES ?? 60),
  maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024),
  bootstrap: {
    email: env.BOOTSTRAP_SUPERADMIN_EMAIL,
    username: env.BOOTSTRAP_SUPERADMIN_USERNAME,
    password: env.BOOTSTRAP_SUPERADMIN_PASSWORD,
    name: env.BOOTSTRAP_SUPERADMIN_NAME,
  },
};

if (isProd && config.appSecret.length < 32) {
  throw new Error('APP_SECRET must be at least 32 characters in production');
}
