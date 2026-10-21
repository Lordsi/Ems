import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
/** A database handle or an open transaction; services accept either. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

export interface DbHandle {
  db: Db;
  kind: 'pg' | 'pglite';
  close: () => Promise<void>;
}

function migrationsFolder(): string {
  const candidates = [
    path.resolve('server/db/migrations'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
  ];
  const found = candidates.find((p) => fs.existsSync(path.join(p, 'meta', '_journal.json')));
  if (!found) throw new Error('Could not locate database migrations folder');
  return found;
}

/**
 * Production uses node-postgres against DATABASE_URL.
 * Development and tests use PGlite: real PostgreSQL compiled to WASM, so constraints,
 * row locks and triggers behave identically. `memory` creates a throwaway database.
 */
export async function createDb(opts: { url?: string; pgliteDir?: string; memory?: boolean } = {}): Promise<DbHandle> {
  if (opts.url && !opts.memory) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const sslDisabled = /sslmode=disable/.test(opts.url) || /localhost|127\.0\.0\.1/.test(opts.url);
    const pool = new Pool({
      connectionString: opts.url,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      ssl: sslDisabled ? undefined : { rejectUnauthorized: false },
    });
    const db = drizzle(pool, { schema }) as unknown as Db;
    return { db, kind: 'pg', close: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  let client: InstanceType<typeof PGlite>;
  if (opts.memory) {
    client = new PGlite();
  } else {
    const dir = opts.pgliteDir ?? path.resolve('.data/pglite');
    fs.mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, kind: 'pglite', close: () => client.close() };
}

export async function runMigrations(handle: DbHandle): Promise<void> {
  const folder = migrationsFolder();
  if (handle.kind === 'pg') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(handle.db as never, { migrationsFolder: folder });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(handle.db as never, { migrationsFolder: folder });
  }
}
