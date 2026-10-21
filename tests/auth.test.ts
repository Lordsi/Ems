import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { anonClient, loginAs, makeUser, PASSWORD, registrationBody, setupEnv, type TestEnv } from './helpers';
import { auditLogs, sessions, userRoles, users } from '../server/db/schema';
import { currentTotp } from '../server/auth/totp';
import { decrypt } from '../server/lib/crypto';

let env: TestEnv;
beforeAll(async () => {
  env = await setupEnv();
});
afterAll(async () => {
  await env.close();
});

describe('registration', () => {
  it('creates a pending account with no roles and no employment number', async () => {
    const c = await anonClient(env);
    const body = registrationBody(env);
    const res = await c.post('/api/auth/register', body);
    expect(res.status).toBe(200);
    const me = await c.get('/api/auth/me');
    expect(me.body.user.status).toBe('pending_verification');
    expect(me.body.user.roles).toEqual([]);
    expect(me.body.user.permissions).toEqual([]);
    expect(me.body.employee.employmentNumber).toBeNull();
  });

  it('cannot create an administrator or super admin via public registration', async () => {
    const c = await anonClient(env);
    const base = registrationBody(env);
    for (const tamper of [
      { ...base, role: 'super_admin' },
      { ...base, account: { ...base.account, role: 'admin' } },
      { ...base, profile: { ...base.profile, employmentStatus: 'active' } },
      { ...base, profile: { ...base.profile, employmentNumber: 'ADM-000001' } },
      { ...base, roles: ['super_admin'] },
    ]) {
      const res = await c.post('/api/auth/register', tamper);
      expect(res.status).toBe(400);
    }
    const result = (await env.db.execute(
      // no user with this email should exist
      (await import('drizzle-orm')).sql`select count(*)::int as n from users where lower(email) = ${base.account.email.toLowerCase()}`,
    )) as unknown as { rows: { n: number }[] };
    const [{ n }] = result.rows;
    expect(n).toBe(0);
  });

  it('unverified accounts cannot access protected employee functionality', async () => {
    const c = await anonClient(env);
    await c.post('/api/auth/register', registrationBody(env)).expect(200);
    for (const url of ['/api/employees', '/api/dashboard', '/api/announcements', '/api/me/payroll', '/api/lookups']) {
      const res = await c.get(url);
      expect([401, 403]).toContain(res.status);
    }
  });

  it('validates required fields and plausible dates', async () => {
    const c = await anonClient(env);
    const body = registrationBody(env);
    const res = await c.post('/api/auth/register', { ...body, profile: { ...body.profile, dateOfBirth: '2020-01-01' } });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.dateOfBirth).toBeTruthy();
    const weak = await c.post('/api/auth/register', { ...body, account: { ...body.account, password: 'short' } });
    expect(weak.status).toBe(400);
  });

  it('rejects duplicate emails, never accepts a chosen username, and lets the registrant sign in by email', async () => {
    const c = await anonClient(env);
    const body = registrationBody(env);
    await c.post('/api/auth/register', body).expect(200);
    const c2 = await anonClient(env);
    const dup = await c2.post('/api/auth/register', { ...registrationBody(env), account: { ...body.account, email: body.account.email.toUpperCase() } });
    expect(dup.status).toBe(409);
    const withUsername = await c2.post('/api/auth/register', { ...registrationBody(env), account: { ...registrationBody(env).account, username: 'chosen' } });
    expect(withUsername.status).toBe(400);
    const c3 = await anonClient(env);
    const login = await c3.post('/api/auth/login', { identifier: body.account.email, password: body.account.password });
    expect(login.status).toBe(200);
  });

  it('generates unique usernames when email prefixes collide', async () => {
    const prefix = `same${Math.random().toString(36).slice(2, 6)}`;
    for (const domain of ['a.example.org', 'b.example.org']) {
      const c = await anonClient(env);
      const body = registrationBody(env);
      await c.post('/api/auth/register', { ...body, account: { ...body.account, email: `${prefix}@${domain}` } }).expect(200);
    }
    const result = (await env.db.execute(
      (await import('drizzle-orm')).sql`select username from users where email like ${`${prefix}@%`} order by created_at`,
    )) as unknown as { rows: { username: string }[] };
    expect(result.rows.map((r) => r.username)).toEqual([prefix, `${prefix}2`]);
  });
});

describe('login and sessions', () => {
  it('requires a CSRF token on state-changing requests', async () => {
    const c = await anonClient(env);
    const res = await c.agent.post('/api/auth/login').send({ identifier: 'x', password: 'y' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('logs in, logs out and invalidates the session', async () => {
    const u = await makeUser(env);
    const c = await loginAs(env, u.username);
    expect((await c.get('/api/auth/me')).body.user.username).toBe(u.username);
    await c.post('/api/auth/logout').expect(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('uses a generic error for unknown users and wrong passwords, and audits failures', async () => {
    const u = await makeUser(env);
    const c = await anonClient(env);
    const a = await c.post('/api/auth/login', { identifier: 'nobody-here', password: PASSWORD });
    const b = await c.post('/api/auth/login', { identifier: u.username, password: 'Wrong-Password-1' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
    const logs = await env.db.select().from(auditLogs).where(eq(auditLogs.targetId, u.userId));
    expect(logs.some((l) => l.action === 'auth.login' && l.outcome === 'failure')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('Wrong-Password-1');
  });

  it('locks the account after repeated failures', async () => {
    const u = await makeUser(env);
    const c = await anonClient(env);
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { identifier: u.username, password: 'Wrong-Password-1' });
    const res = await c.post('/api/auth/login', { identifier: u.username, password: PASSWORD });
    expect(res.status).toBe(429);
  });

  it('suspended accounts cannot sign in and existing sessions stop working', async () => {
    const admin = await makeUser(env, { roles: ['super_admin'] });
    const u = await makeUser(env);
    const victim = await loginAs(env, u.username);
    const sa = await loginAs(env, admin.username);
    await sa.post(`/api/users/${u.userId}/status`, { status: 'suspended', reason: 'Investigation pending' }).expect(200);
    expect((await victim.get('/api/auth/me')).status).toBe(401);
    const again = await anonClient(env);
    expect((await again.post('/api/auth/login', { identifier: u.username, password: PASSWORD })).status).toBe(403);
  });

  it('expires idle sessions', async () => {
    const u = await makeUser(env);
    const c = await loginAs(env, u.username);
    env.clock.offsetMs = 31 * 60_000;
    try {
      expect((await c.get('/api/auth/me')).status).toBe(401);
    } finally {
      env.clock.offsetMs = 0;
    }
  });

  it('changes password and revokes other sessions', async () => {
    const u = await makeUser(env);
    const a = await loginAs(env, u.username);
    const b = await loginAs(env, u.username);
    await a.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'Brand-New-Pass-42' }).expect(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    await loginAs(env, u.username, 'Brand-New-Pass-42');
  });
});

describe('multi-factor authentication', () => {
  it('enrols TOTP and then requires a code at login', async () => {
    const u = await makeUser(env, { roles: ['admin'] });
    const c = await loginAs(env, u.username);
    const setup = await c.post('/api/auth/mfa/setup').expect(200);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    await c.post('/api/auth/mfa/enable', { code: currentTotp(setup.body.secret) }).expect(200);

    const fresh = await anonClient(env);
    const login = await fresh.post('/api/auth/login', { identifier: u.username, password: PASSWORD }).expect(200);
    expect(login.body.mfaRequired).toBe(true);
    // Password-only session has no permissions.
    expect((await fresh.get('/api/employees')).status).toBe(403);
    expect((await fresh.post('/api/auth/mfa/verify', { code: '000000' })).status).toBe(401);
    const [row] = await env.db.select().from(users).where(eq(users.id, u.userId));
    await fresh.post('/api/auth/mfa/verify', { code: currentTotp(decrypt(row.mfaSecretEnc!)) }).expect(200);
    expect((await fresh.get('/api/employees')).status).toBe(200);
  });
});

describe('re-authentication for privileged changes', () => {
  it('requires a recent password confirmation before role changes', async () => {
    const sa = await makeUser(env, { roles: ['super_admin'] });
    const target = await makeUser(env);
    const c = await loginAs(env, sa.username);
    await env.db.update(sessions).set({ reauthAt: new Date(Date.now() - 60 * 60_000) }).where(eq(sessions.userId, sa.userId));
    const res = await c.put(`/api/users/${target.userId}/roles`, { roles: ['admin'], reason: 'Promotion approved' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REAUTH_REQUIRED');
    expect((await c.post('/api/auth/reauth', { password: 'nope' })).status).toBe(401);
    await c.post('/api/auth/reauth', { password: PASSWORD }).expect(200);
    await c.put(`/api/users/${target.userId}/roles`, { roles: ['admin'], reason: 'Promotion approved' }).expect(200);
  });
});

describe('role changes take effect immediately', () => {
  it('removes access as soon as a role is revoked', async () => {
    const sa = await makeUser(env, { roles: ['super_admin'] });
    const fin = await makeUser(env, { roles: ['finance'] });
    const finClient = await loginAs(env, fin.username);
    expect((await finClient.get('/api/payroll/periods')).status).toBe(200);
    const saClient = await loginAs(env, sa.username);
    await saClient.put(`/api/users/${fin.userId}/roles`, { roles: [], reason: 'Left finance team' }).expect(200);
    const after = await finClient.get('/api/payroll/periods');
    expect([401, 403]).toContain(after.status);
    const rows = await env.db.select().from(userRoles).where(eq(userRoles.userId, fin.userId));
    expect(rows).toHaveLength(1);
  });
});

describe('error handling', () => {
  it('returns safe error bodies without internals', async () => {
    const u = await makeUser(env);
    const c = await loginAs(env, u.username);
    const notFound = await c.get('/api/does-not-exist');
    expect(notFound.status).toBe(404);
    const malformed = await c.agent.post('/api/auth/reauth').set('x-csrf-token', c.csrf).set('content-type', 'application/json').send('{bad json');
    expect(malformed.status).toBe(400);
    const badId = await c.get('/api/employees/not-a-uuid');
    expect(badId.status).toBe(404);
    for (const r of [notFound, malformed, badId]) {
      const text = JSON.stringify(r.body);
      expect(text).not.toMatch(/stack|select |insert |at Object|node_modules|password_hash/i);
    }
  });
});
