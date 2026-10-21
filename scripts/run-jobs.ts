/** Entry point for an external scheduler (e.g. a Render Cron Job): runs date-based jobs once. */
import { config } from '../server/config';
import { createDb, runMigrations } from '../server/db/client';
import { runScheduledJobs } from '../server/services/jobs';

const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
try {
  await runMigrations(handle);
  const results = await runScheduledJobs(handle.db, new Date(), { force: process.argv.includes('--force') });
  console.log(JSON.stringify(results, null, 2));
} finally {
  await handle.close();
}
