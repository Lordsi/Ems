import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createDb, runMigrations, type Db, type DbHandle } from '../server/db/client';
import { seedBase } from '../server/db/seed';
import { createApp } from '../server/app';
import { departments, employees, moderatorScopes, nextOfKin, roles, userRoles, users, workLocations } from '../server/db/schema';
import { hashPassword } from '../server/lib/crypto';
import { issueEmploymentNumber } from '../server/services/employmentNumbers';
import type { RoleKey } from '../shared/permissions';

export const PASSWORD = 'Correct-Horse-9-Battery';

export interface TestEnv {
  handle: DbHandle;
  db: Db;
  app: ReturnType<typeof createApp>;
  clock: { offsetMs: number };
  dept: Record<string, string>;
  loc: Record<string, string>;
  close: () => Promise<void>;
}

export async function setupEnv(): Promise<TestEnv> {
  const handle = await createDb({ memory: true });
  await runMigrations(handle);
  await seedBase(handle.db);
  const clock = { offsetMs: 0 };
  const app = createApp({ db: handle.db, disableRateLimit: true, now: () => new Date(Date.now() + clock.offsetMs) });
  const deps = await handle.db.select().from(departments);
  const dept = Object.fromEntries(deps.map((d) => [d.code, d.id]));
  const locRows = await handle.db
    .insert(workLocations)
    .values([
      { code: 'HQ', name: 'Head Office' },
      { code: 'SITE-A', name: 'Construction Site A' },
      { code: 'SITE-B', name: 'Construction Site B' },
    ])
    .returning();
  const loc = Object.fromEntries(locRows.map((l) => [l.code, l.id]));
  return { handle, db: handle.db, app, clock, dept, loc, close: () => handle.close() };
}

let seq = 0;

export interface MadeUser {
  userId: string;
  employeeId: string;
  username: string;
  employmentNumber: string;
}

/** Creates an active, verified user + employee directly in the database. */
export async function makeUser(
  env: TestEnv,
  opts: {
    roles?: RoleKey[];
    dept?: string;
    loc?: string | null;
    username?: string;
    dob?: string;
    supervisorId?: string | null;
    scopes?: { scopeType?: 'org_unit' | 'direct_reports'; departmentId?: string | null; locationId?: string | null }[];
  } = {},
): Promise<MadeUser> {
  seq += 1;
  const username = opts.username ?? `user${seq}${Math.random().toString(36).slice(2, 6)}`;
  const db = env.db;
  const [user] = await db
    .insert(users)
    .values({ email: `${username}@example.org`, username, displayName: `User ${username}`, passwordHash: await hashPassword(PASSWORD), status: 'active' })
    .returning();
  const roleKeys = [...new Set<RoleKey>(['employee', ...(opts.roles ?? [])])];
  for (const key of roleKeys) {
    const [role] = await db.select().from(roles).where(eq(roles.key, key));
    await db.insert(userRoles).values({ userId: user.id, roleId: role.id });
  }
  const departmentId = env.dept[opts.dept ?? 'ADM'];
  const employmentNumber = await issueEmploymentNumber(db, departmentId);
  const [emp] = await db
    .insert(employees)
    .values({
      userId: user.id,
      employmentNumber,
      numberDepartmentId: departmentId,
      legalName: `Legal ${username}`,
      dateOfBirth: opts.dob ?? '1985-04-12',
      phone: '+265 999 000 111',
      personalEmail: `${username}@personal.example`,
      departmentId,
      locationId: opts.loc === undefined ? env.loc.HQ : opts.loc,
      supervisorId: opts.supervisorId ?? null,
      employmentType: 'permanent',
      employmentDate: '2015-01-05',
      employmentStatus: 'active',
      verifiedAt: new Date(),
    })
    .returning();
  await db.insert(nextOfKin).values({ employeeId: emp.id, fullName: 'Kin Person', relationship: 'Spouse', phone: '+265 888 111 222' });
  for (const s of opts.scopes ?? []) {
    await db.insert(moderatorScopes).values({ userId: user.id, scopeType: s.scopeType ?? 'org_unit', departmentId: s.departmentId ?? null, locationId: s.locationId ?? null });
  }
  return { userId: user.id, employeeId: emp.id, username, employmentNumber };
}

export interface Client {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: unknown) => request.Test;
  put: (url: string, body?: unknown) => request.Test;
  patch: (url: string, body?: unknown) => request.Test;
  del: (url: string, body?: unknown) => request.Test;
}

function csrfFrom(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith('ems_csrf='));
  if (!c) throw new Error('no csrf cookie');
  return c.split(';')[0].split('=')[1];
}

export async function anonClient(env: TestEnv): Promise<Client> {
  const agent = request.agent(env.app);
  const res = await agent.get('/api/auth/csrf');
  const csrf = csrfFrom(res);
  return {
    agent,
    csrf,
    get: (url) => agent.get(url),
    post: (url, body) => agent.post(url).set('x-csrf-token', csrf).send(body as object),
    put: (url, body) => agent.put(url).set('x-csrf-token', csrf).send(body as object),
    patch: (url, body) => agent.patch(url).set('x-csrf-token', csrf).send(body as object),
    del: (url, body) => agent.delete(url).set('x-csrf-token', csrf).send(body as object),
  };
}

export async function loginAs(env: TestEnv, username: string, password = PASSWORD): Promise<Client> {
  const c = await anonClient(env);
  const res = await c.post('/api/auth/login', { identifier: username, password });
  if (res.status !== 200) throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  return c;
}

export const registrationBody = (env: TestEnv, overrides: Record<string, unknown> = {}) => ({
  account: { displayName: 'New Person', email: `new${Math.random().toString(36).slice(2, 8)}@example.org`, password: PASSWORD },
  profile: {
    legalName: 'New Person Phiri',
    dateOfBirth: '1990-06-15',
    phone: '+265 991 234 567',
    departmentId: env.dept.CON,
    workLocation: 'Kanengo depot, Lilongwe',
    employmentDate: '2020-02-01',
    employmentType: 'permanent',
  },
  nextOfKin: { fullName: 'Kin Phiri', relationship: 'Sibling', phone: '+265 881 234 567' },
  ...overrides,
});
