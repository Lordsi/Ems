import { sql } from 'drizzle-orm';
import { config } from './config';
import { createDb, runMigrations, type DbHandle } from './db/client';
import { seedBase } from './db/seed';
import { createApp } from './app';
import { countActiveSuperAdmins, provisionSuperAdmin } from './services/auth';
import { runScheduledJobs } from './services/jobs';

/** Host and port only, so a connection string with a password can be logged. */
function describeDatabaseHost(url: string | undefined): string {
  try {
    const u = new URL(url ?? '');
    return `${u.hostname}:${u.port || '5432'}`;
  } catch {
    return 'an unparseable DATABASE_URL';
  }
}

/** Fail quickly with a hint instead of letting the first migration query hang on an unreachable host. */
async function checkDatabaseConnection(handle: DbHandle): Promise<void> {
  if (handle.kind !== 'pg') return;
  try {
    await handle.db.execute(sql`select 1`);
  } catch (err) {
    // Drizzle wraps driver errors as "Failed query: ..." with the real reason in `cause`.
    const root = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const message = root instanceof Error ? root.message : String(root);
    const hints = [`Could not connect to ${describeDatabaseHost(config.databaseUrl)}: ${message}`];
    if (/timeout|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|ECONNREFUSED/i.test(message)) {
      hints.push('Check that DATABASE_URL is reachable from this network. Supabase: the direct connection (db.<project>.supabase.co) is IPv6-only; use the Session pooler string (aws-<region>.pooler.supabase.com:5432, user postgres.<project>) and make sure the project is not paused.');
    }
    if (/password|authentication|SASL/i.test(message)) {
      hints.push('Check the database user and password in DATABASE_URL; characters such as @ # : / in the password must be URL-encoded.');
    }
    throw new Error(hints.join('\n'));
  }
}

async function main() {
  if (config.isProd && !config.databaseUrl) throw new Error('DATABASE_URL is required in production');
  const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
  console.log(`[ems] database: ${handle.kind === 'pg' ? `PostgreSQL at ${describeDatabaseHost(config.databaseUrl)}` : `PGlite (${config.pgliteDir})`}`);
  await checkDatabaseConnection(handle);
  console.log('[ems] applying migrations and reference data');
  await runMigrations(handle);
  await seedBase(handle.db);

  // One-time bootstrap: only acts when no active super admin exists. Remove the variables afterwards.
  const b = config.bootstrap;
  if (b.email && b.username && b.password) {
    if ((await countActiveSuperAdmins(handle.db)) === 0) {
      await provisionSuperAdmin(handle.db, { email: b.email, username: b.username, password: b.password, name: b.name ?? 'Super Admin' }, { requestId: 'bootstrap' });
      console.warn('[ems] Bootstrap super admin provisioned. Remove BOOTSTRAP_SUPERADMIN_* variables now; a password change is required at first login.');
    }
  } else if ((await countActiveSuperAdmins(handle.db)) === 0) {
    console.warn('[ems] No super admin exists yet. Run `npm run setup:superadmin` (see README).');
  }

  const app = createApp({ db: handle.db, serveClient: true });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[ems] listening on http://${config.host}:${config.port}`);
  });

  let timer: NodeJS.Timeout | undefined;
  if (config.runJobsInProcess) {
    const tick = () =>
      runScheduledJobs(handle.db).catch((err) => console.error('[ems] scheduled jobs failed', err));
    setTimeout(tick, 10_000);
    timer = setInterval(tick, config.jobIntervalMinutes * 60_000);
  }

  const shutdown = async (signal: string) => {
    console.log(`[ems] ${signal} received, shutting down`);
    if (timer) clearInterval(timer);
    server.close(async () => {
      await handle.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[ems] fatal startup error', err);
  process.exit(1);
});
