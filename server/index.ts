import { config } from './config';
import { createDb, runMigrations } from './db/client';
import { seedBase } from './db/seed';
import { createApp } from './app';
import { countActiveSuperAdmins, provisionSuperAdmin } from './services/auth';
import { runScheduledJobs } from './services/jobs';

async function main() {
  if (config.isProd && !config.databaseUrl) throw new Error('DATABASE_URL is required in production');
  const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
  console.log(`[ems] database: ${handle.kind === 'pg' ? 'PostgreSQL' : `PGlite (${config.pgliteDir})`}`);
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
