import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { loginAs, makeUser, setupEnv, type Client, type MadeUser, type TestEnv } from './helpers';
import { auditLogs, payrollPeriods } from '../server/db/schema';

let env: TestEnv;
let sa: MadeUser, admin: MadeUser, finance: MadeUser, finance2: MadeUser, employee: MadeUser, other: MadeUser;
let modSiteA: MadeUser, modCon: MadeUser, conSiteA: MadeUser, conSiteB: MadeUser, medStaff: MadeUser;
let c: Record<string, Client>;

beforeAll(async () => {
  env = await setupEnv();
  sa = await makeUser(env, { roles: ['super_admin'] });
  admin = await makeUser(env, { roles: ['admin'] });
  finance = await makeUser(env, { roles: ['finance'] });
  finance2 = await makeUser(env, { roles: ['finance'] });
  employee = await makeUser(env, { dept: 'PRT' });
  other = await makeUser(env, { dept: 'PRT' });
  conSiteA = await makeUser(env, { dept: 'CON', loc: env.loc['SITE-A'] });
  conSiteB = await makeUser(env, { dept: 'CON', loc: env.loc['SITE-B'] });
  medStaff = await makeUser(env, { dept: 'MED' });
  // Moderator scoped to Construction at Site A only (department ∩ location).
  modSiteA = await makeUser(env, { roles: ['moderator'], dept: 'CON', loc: env.loc['SITE-A'], scopes: [{ departmentId: env.dept.CON, locationId: env.loc['SITE-A'] }] });
  // Moderator scoped to the whole Construction department.
  modCon = await makeUser(env, { roles: ['moderator'], dept: 'CON', scopes: [{ departmentId: env.dept.CON }] });
  c = {
    sa: await loginAs(env, sa.username),
    admin: await loginAs(env, admin.username),
    finance: await loginAs(env, finance.username),
    finance2: await loginAs(env, finance2.username),
    employee: await loginAs(env, employee.username),
    modSiteA: await loginAs(env, modSiteA.username),
    modCon: await loginAs(env, modCon.username),
  };
});
afterAll(async () => {
  await env.close();
});

describe('employee self-service boundaries', () => {
  it('can view own profile including employment number and next of kin', async () => {
    const res = await c.employee.get(`/api/employees/${employee.employeeId}`).expect(200);
    expect(res.body.employmentNumber).toBe(employee.employmentNumber);
    expect(res.body.nextOfKin.fullName).toBe('Kin Person');
    expect(res.body.access.directFields).toEqual(['preferredName', 'phone', 'personalEmail', 'address', 'workLocation']);
  });

  it("cannot view another employee's profile (indistinguishable from not found)", async () => {
    const res = await c.employee.get(`/api/employees/${other.employeeId}`);
    expect(res.status).toBe(404);
    const missing = await c.employee.get('/api/employees/00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);
    expect(res.body.error.message).toBe(missing.body.error.message);
  });

  it('cannot list the directory, history, payroll or documents of others', async () => {
    expect((await c.employee.get('/api/employees')).status).toBe(403);
    expect((await c.employee.get(`/api/employees/${other.employeeId}/history`)).status).toBe(404);
    expect((await c.employee.get(`/api/employees/${other.employeeId}/payroll`)).status).toBe(404);
    expect((await c.employee.get(`/api/employees/${other.employeeId}/documents`)).status).toBe(404);
  });

  it('cannot edit protected fields or anyone else', async () => {
    const own = await c.employee.patch(`/api/employees/${employee.employeeId}`, { changes: { dateOfBirth: '1980-01-01' } });
    expect(own.status).toBe(403);
    const num = await c.employee.patch(`/api/employees/${employee.employeeId}`, { changes: { employmentNumber: 'PRT-999999' } });
    expect(num.status).toBe(400);
    const otherRes = await c.employee.patch(`/api/employees/${other.employeeId}`, { changes: { phone: '+265 111 111 111' } });
    expect(otherRes.status).toBe(404);
    const ok = await c.employee.patch(`/api/employees/${employee.employeeId}`, { changes: { phone: '+265 222 333 444' } });
    expect(ok.status).toBe(200);
  });

  it('cannot reach administrative APIs', async () => {
    for (const url of ['/api/users', '/api/audit', '/api/settings', '/api/payroll/periods', '/api/retirement/reviews', '/api/reports/headcount', '/api/departments']) {
      expect((await c.employee.get(url)).status).toBe(403);
    }
    expect((await c.employee.put(`/api/users/${employee.userId}/roles`, { roles: ['super_admin'], reason: 'self promote' })).status).toBe(403);
    expect((await c.employee.post('/api/announcements', { title: 'x', body: 'y' })).status).toBe(403);
  });

  it('logs denied authorization attempts', async () => {
    await c.employee.get('/api/audit');
    const rows = await env.db.select().from(auditLogs).where(and(eq(auditLogs.actorUserId, employee.userId), eq(auditLogs.action, 'authz.denied')));
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('moderator scope enforcement', () => {
  it('sees only employees inside the assigned department and location', async () => {
    const res = await c.modSiteA.get('/api/employees?pageSize=100').expect(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(conSiteA.employeeId);
    expect(ids).not.toContain(conSiteB.employeeId);
    expect(ids).not.toContain(medStaff.employeeId);
    expect(ids).not.toContain(employee.employeeId);
  });

  it('cannot open or edit an out-of-scope employee by changing the URL', async () => {
    expect((await c.modSiteA.get(`/api/employees/${conSiteB.employeeId}`)).status).toBe(404);
    expect((await c.modSiteA.patch(`/api/employees/${conSiteB.employeeId}`, { changes: { phone: '+265 777 777 777' } })).status).toBe(404);
    expect((await c.modSiteA.get(`/api/employees/${medStaff.employeeId}/history`)).status).toBe(404);
  });

  it('cannot find out-of-scope employees through search filters', async () => {
    const res = await c.modSiteA.get(`/api/employees?locationId=${env.loc['SITE-B']}`).expect(200);
    expect(res.body.total).toBe(0);
    const byNumber = await c.modSiteA.get(`/api/employees?q=${encodeURIComponent(conSiteB.employmentNumber)}`).expect(200);
    expect(byNumber.body.total).toBe(0);
  });

  it('department-wide scope covers every site in that department only', async () => {
    const res = await c.modCon.get('/api/employees?pageSize=100').expect(200);
    const ids = res.body.items.map((i: { id: string }) => i.id);
    expect(ids).toEqual(expect.arrayContaining([conSiteA.employeeId, conSiteB.employeeId]));
    expect(ids).not.toContain(medStaff.employeeId);
  });

  it('can directly update low-risk fields in scope but controlled fields go to approval', async () => {
    const direct = await c.modSiteA.patch(`/api/employees/${conSiteA.employeeId}`, { changes: { phone: '+265 555 000 111' } }).expect(200);
    expect(direct.body.applied).toEqual(['phone']);
    const controlled = await c.modSiteA
      .patch(`/api/employees/${conSiteA.employeeId}`, { changes: { locationId: env.loc['SITE-B'] }, reason: 'Moving to site B' })
      .expect(200);
    expect(controlled.body.applied).toEqual([]);
    expect(controlled.body.pendingApprovalId).toBeTruthy();
    const still = await c.sa.get(`/api/employees/${conSiteA.employeeId}`).expect(200);
    expect(still.body.location.id).toBe(env.loc['SITE-A']);
  });

  it('cannot change own role or scope, and gets only self-service rights on own record', async () => {
    expect((await c.modSiteA.put(`/api/users/${modSiteA.userId}/scopes`, { scopes: [{ scopeType: 'org_unit', departmentId: env.dept.MED }], reason: 'expand' })).status).toBe(403);
    expect((await c.modSiteA.put(`/api/users/${modSiteA.userId}/roles`, { roles: ['admin'], reason: 'expand' })).status).toBe(403);
    const own = await c.modSiteA.get(`/api/employees/${modSiteA.employeeId}`).expect(200);
    expect(own.body.access.updateMode).toBe('self');
    expect((await c.modSiteA.patch(`/api/employees/${modSiteA.employeeId}`, { changes: { gradeId: null, jobTitleId: null, departmentId: env.dept.ADM } })).status).toBe(403);
  });

  it('cannot see next of kin or payroll of scoped employees', async () => {
    const res = await c.modSiteA.get(`/api/employees/${conSiteA.employeeId}`).expect(200);
    expect(res.body.nextOfKin).toBeUndefined();
    expect(res.body.access.payroll).toBe(false);
    expect((await c.modSiteA.get(`/api/employees/${conSiteA.employeeId}/payroll`)).status).toBe(404);
  });
});

describe('administrator restrictions', () => {
  it('cannot grant roles, including to themselves', async () => {
    expect((await c.admin.put(`/api/users/${admin.userId}/roles`, { roles: ['super_admin'], reason: 'self promotion' })).status).toBe(403);
    expect((await c.admin.put(`/api/users/${employee.userId}/roles`, { roles: ['finance'], reason: 'help out' })).status).toBe(403);
    expect((await c.admin.post(`/api/users/${admin.userId}/grants`, { permission: 'payroll.read', reason: 'curious' })).status).toBe(403);
  });

  it('cannot see payroll amounts or next-of-kin details', async () => {
    const res = await c.admin.get(`/api/employees/${employee.employeeId}`).expect(200);
    expect(res.body.nextOfKin).toBeUndefined();
    expect(res.body.personal.phone).toBeTruthy();
    expect((await c.admin.get('/api/payroll/periods')).status).toBe(403);
    expect((await c.admin.get(`/api/employees/${employee.employeeId}/payroll`)).status).toBe(404);
  });

  it('cannot change security settings, view audit logs or approve executive changes', async () => {
    expect((await c.admin.put('/api/settings', { values: { 'payroll.require_second_approval': false } })).status).toBe(403);
    expect((await c.admin.get('/api/audit')).status).toBe(403);
    expect((await c.admin.post('/api/retirement/policies', { name: 'x', retirementAge: 55, effectiveFrom: '2026-01-01' })).status).toBe(403);
  });

  it('cannot apply controlled changes directly', async () => {
    const res = await c.admin.patch(`/api/employees/${employee.employeeId}`, { changes: { employmentDate: '2010-01-01' }, reason: 'Fix date' }).expect(200);
    expect(res.body.applied).toEqual([]);
    expect(res.body.pendingFields).toEqual(['employmentDate']);
  });

  it('can assign moderator scopes but not to themselves', async () => {
    await c.admin.put(`/api/users/${modCon.userId}/scopes`, { scopes: [{ scopeType: 'org_unit', departmentId: env.dept.CON }], reason: 'Confirm scope' }).expect(200);
    expect((await c.admin.put(`/api/users/${admin.userId}/scopes`, { scopes: [], reason: 'self change' })).status).toBe(403);
  });
});

describe('finance officer restrictions', () => {
  it('cannot change roles, permissions or scopes', async () => {
    expect((await c.finance.put(`/api/users/${employee.userId}/roles`, { roles: ['admin'], reason: 'nope' })).status).toBe(403);
    expect((await c.finance.put(`/api/users/${modCon.userId}/scopes`, { scopes: [], reason: 'nope' })).status).toBe(403);
    expect((await c.finance.get('/api/users')).status).toBe(403);
  });

  it('sees the employee matrix with age but not contact or next-of-kin details', async () => {
    const res = await c.finance.get(`/api/employees/${employee.employeeId}`).expect(200);
    expect(res.body.personal.age).toBeGreaterThan(30);
    expect(res.body.personal.phone).toBeUndefined();
    expect(res.body.nextOfKin).toBeUndefined();
  });

  it('cannot change authoritative employee fields', async () => {
    expect((await c.finance.patch(`/api/employees/${employee.employeeId}`, { changes: { dateOfBirth: '1970-01-01' } })).status).toBe(403);
  });

  it('cannot prepare their own payroll record', async () => {
    const [period] = await env.db.insert(payrollPeriods).values({ code: 'AUTHZ-01', name: 'Authz', startDate: '2026-01-01', endDate: '2026-01-31', payDate: '2026-01-31' }).returning();
    const res = await c.finance.post('/api/payroll/records', { employeeId: finance.employeeId, periodId: period.id, basicSalary: 100000 });
    expect(res.status).toBe(403);
  });
});

describe('unauthorized access to governance data', () => {
  it('only audit.read holders can read audit logs, and reads are themselves audited', async () => {
    for (const k of ['admin', 'finance', 'modCon', 'employee']) expect((await c[k].get('/api/audit')).status).toBe(403);
    await c.sa.get('/api/audit').expect(200);
    const rows = await env.db.select().from(auditLogs).where(and(eq(auditLogs.actorUserId, sa.userId), eq(auditLogs.action, 'audit.view')));
    expect(rows.length).toBeGreaterThan(0);
  });

  it('audit logs cannot be modified or deleted, even directly in the database', async () => {
    const { sql } = await import('drizzle-orm');
    await expect(env.db.execute(sql`update audit_logs set action = 'tampered'`)).rejects.toThrow();
    await expect(env.db.execute(sql`delete from audit_logs`)).rejects.toThrow();
  });

  it('restricted financial reports are denied to non-finance roles', async () => {
    for (const k of ['admin', 'modCon', 'employee']) expect((await c[k].get('/api/reports/payroll')).status).toBe(403);
    await c.finance.get('/api/reports/payroll').expect(200);
  });
});

describe('super admin safeguards', () => {
  it('cannot remove or deactivate the last active super admin', async () => {
    const res = await c.sa.put(`/api/users/${sa.userId}/roles`, { roles: [], reason: 'Stepping down' });
    expect(res.status).toBe(409);
    const sa2 = await makeUser(env, { roles: ['super_admin'] });
    const c2 = await loginAs(env, sa2.username);
    // A second super admin can step the first one down; the remaining one cannot then be removed.
    await c2.put(`/api/users/${sa.userId}/roles`, { roles: ['admin'], reason: 'Handover complete' }).expect(200);
    expect((await c2.put(`/api/users/${sa2.userId}/roles`, { roles: [], reason: 'leaving' })).status).toBe(409);
    expect((await c2.post(`/api/users/${sa2.userId}/status`, { status: 'deactivated', reason: 'leaving' })).status).toBe(403);
    // restore for later tests
    await c2.put(`/api/users/${sa.userId}/roles`, { roles: ['super_admin'], reason: 'Restore for tests' }).expect(200);
    c.sa = await loginAs(env, sa.username);
  });
});
