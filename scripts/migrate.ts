import { config } from '../server/config';
import { createDb, runMigrations } from '../server/db/client';
import { seedBase } from '../server/db/seed';

const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
await runMigrations(handle);
await seedBase(handle.db);
console.log(`Migrations and base seed applied (${handle.kind}).`);
await handle.close();
