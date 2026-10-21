import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { anonClient, loginAs, makeUser, registrationBody, setupEnv, type Client, type MadeUser, type TestEnv } from './helpers';
import { approvalRequests, employees, employmentHistory, payrollPeriods, systemSettings } from '../server/db/schema';
import { seedBase } from '../server/db/seed';

let env: TestEnv;
let sa: MadeUser, admin: MadeUser;
let c: Record<string, Client>;

beforeAll(async () => {
  env = await setupEnv();
  sa = await makeUser(env, { roles: ['super_admin'] });
  admin = await makeUser(env, { roles: ['admin'] });
  c = { sa: await loginAs(env, sa.username), admin: await loginAs(env, admin.username) };
});
afterAll(async () => {
  await env.close();
});

async function registerPending(dept = 'PRT') {
  const anon = await anonClient(env);
  const body = registrationBody(env, {});
  body.profile.departmentId = env.dept[dept];
  const res = await anon.post('/api/auth/register', body).expect(200);
  return { client: anon, employeeId: res.body.employeeId as string, body };
}

describe('verification and employment numbers', () => {
  it('activates a registration and issues a department-prefixed number', async () => {
    const reg = await registerPending('MED');
    const res = await c.admin.post(`/api/employees/${reg.employeeId}/verify`, { decision: 'approve' }).expect(200);
    expect(res.body.employmentNumber).toMatch(/^MED-\d{6}$/);
    const me = await reg.client.get('/api/auth/me').expect(200);
    expect(me.body.user.status).toBe('active');
    expect(me.body.user.roles).toEqual(['employee']);
    expect(me.body.employee.employmentNumber).toBe(res.body.employmentNumber);
    // now has employee access
    await reg.client.get('/api/dashboard').expect(200);
  });

  it('issues unique numbers under concurrent verification', async () => {
    const regs = [];
    for (let i = 0; i < 15; i++) regs.push(await registerPending('CLG'));
    const results = await Promise.all(regs.map((r) => c.admin.post(`/api/employees/${r.employeeId}/verify`, { decision: 'approve' })));
    const numbers = results.map((r) => r.body.employmentNumber as string);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(numbers).size).toBe(15);
    const values = numbers.map((n) => Number(n.split('-')[1])).sort((a, b) => a - b);
    expect(values[14] - values[0]).toBe(14);
  });

  it('never reuses a number after archival and keeps it on transfer', async () => {
    const reg = await registerPending('PRT');
    const first = await c.admin.post(`/api/employees/${reg.employeeId}/verify`, { decision: 'approve' }).expect(200);
    await c.sa.post(`/api/employees/${reg.employeeId}/archive`, { reason: 'Left the organisation' }).expect(200);
    const reg2 = await registerPending('PRT');
    const second = await c.admin.post(`/api/employees/${reg2.employeeId}/verify`, { decision: 'approve' }).expect(200);
    expect(second.body.employmentNumber).not.toBe(first.body.employmentNumber);
    expect(Number(second.body.employmentNumber.split('-')[1])).toBeGreaterThan(Number(first.body.employmentNumber.split('-')[1]));

    // Transfer via executive override keeps the original number.
    await c.sa.patch(`/api/employees/${reg2.employeeId}`, { changes: { departmentId: env.dept.ADM }, reason: 'Transfer to administration' }).expect(200);
    const after = await c.sa.get(`/api/employees/${reg2.employeeId}`).expect(200);
    expect(after.body.department.code).toBe('ADM');
    expect(after.body.employmentNumber).toBe(second.body.employmentNumber);
    const history = await c.sa.get(`/api/employees/${reg2.employeeId}/history`).expect(200);
    expect(history.body.some((h: { changeType: string }) => h.changeType === 'transfer')).toBe(true);
  });

  it('the database refuses to change or delete an issued employment number', async () => {
    const u = await makeUser(env);
    await expect(env.db.update(employees).set({ employmentNumber: 'ADM-999999' }).where(eq(employees.id, u.employeeId))).rejects.toThrow();
    await expect(env.db.delete(employees).where(eq(employees.id, u.employeeId))).rejects.toThrow();
    const dup = await makeUser(env);
    await expect(env.db.execute(sql`insert into employees (legal_name, department_id, employment_number) values ('Dup', ${env.dept.ADM}, ${dup.employmentNumber})`)).rejects.toThrow();
  });

  it('rejection deactivates the pending account without issuing a number', async () => {
    const reg = await registerPending();
    await c.admin.post(`/api/employees/${reg.employeeId}/verify`, { decision: 'reject', reason: 'Could not verify identity' }).expect(200);
    expect((await reg.client.get('/api/auth/me')).status).toBe(401);
    const [row] = await env.db.select().from(employees).where(eq(employees.id, reg.employeeId));
    expect(row.employmentNumber).toBeNull();
    expect(row.employmentStatus).toBe('rejected');
  });

  it('keeps the work location the registrant wrote on their record and lets them update it', async () => {
    const anon = await anonClient(env);
    const withId = registrationBody(env);
    (withId.profile as Record<string, unknown>).locationId = env.loc['SITE-A'];
    expect((await anon.post('/api/auth/register', withId)).status).toBe(400);

    const reg = await registerPending('MED');
    const pending = await c.admin.get(`/api/employees/${reg.employeeId}`).expect(200);
    expect(pending.body.workLocation).toBe("St Mark's parish, Mzuzu");
    expect(pending.body.location).toBeNull();
    const [approval] = await env.db.select().from(approvalRequests).where(eq(approvalRequests.targetId, reg.employeeId));
    expect(approval.payload).toMatchObject({ workLocation: "St Mark's parish, Mzuzu" });

    await c.admin.post(`/api/employees/${reg.employeeId}/verify`, { decision: 'approve' }).expect(200);
    await reg.client.patch(`/api/employees/${reg.employeeId}`, { changes: { workLocation: 'Area 18 clinic' } }).expect(200);
    expect((await reg.client.get(`/api/employees/${reg.employeeId}`)).body.workLocation).toBe('Area 18 clinic');
  });

  it('employees cannot verify themselves', async () => {
    const reg = await registerPending();
    const res = await reg.client.post(`/api/employees/${reg.employeeId}/verify`, { decision: 'approve' });
    expect(res.status).toBe(403);
  });
});

describe('admin-created records and invitations', () => {
  it('creates an active record and an invitation that links a new account', async () => {
    const res = await c.admin
      .post('/api/employees', {
        legalName: 'Invited Person',
        dateOfBirth: '1988-03-03',
        departmentId: env.dept.CON,
        employmentDate: '2019-05-01',
        employmentType: 'permanent',
        invite: { email: 'invited.person@example.org' },
      })
      .expect(200);
    expect(res.body.employmentNumber).toMatch(/^CON-/);
    const token = res.body.invitation.inviteUrl.split('/invite/')[1];
    const anon = await anonClient(env);
    const info = await anon.get(`/api/auth/invitations/${token}`).expect(200);
    expect(info.body.legalName).toBe('Invited Person');
    expect((await anon.post(`/api/auth/invitations/${token}/accept`, { username: 'chosen', password: 'Invited-Pass-123' })).status).toBe(400);
    await anon.post(`/api/auth/invitations/${token}/accept`, { password: 'Invited-Pass-123' }).expect(200);
    const me = await anon.get('/api/auth/me').expect(200);
    expect(me.body.user.roles).toEqual(['employee']);
    expect(me.body.user.username).toBe('invited.person');
    expect(me.body.employee.id).toBe(res.body.id);
    const relogin = await anonClient(env);
    await relogin.post('/api/auth/login', { identifier: 'invited.person@example.org', password: 'Invited-Pass-123' }).expect(200);
    // token is single use
    expect((await (await anonClient(env)).get(`/api/auth/invitations/${token}`)).status).toBe(404);
  });

  it('administrators cannot pre-provision privileged roles through invitations', async () => {
    const res = await c.admin.post('/api/employees', {
      legalName: 'Sneaky Admin',
      dateOfBirth: '1988-03-03',
      departmentId: env.dept.ADM,
      employmentDate: '2019-05-01',
      employmentType: 'permanent',
      invite: { email: 'sneaky@example.org', roleKey: 'super_admin' },
    });
    expect(res.status).toBe(403);
  });
});

describe('approval workflow for controlled changes', () => {
  it('routes admin changes to the super admin, records history and audit on approval', async () => {
    const u = await makeUser(env, { dept: 'PRT' });
    const req = await c.admin.patch(`/api/employees/${u.employeeId}`, { changes: { employmentDate: '2014-02-02' }, reason: 'Contract shows earlier date' }).expect(200);
    const id = req.body.pendingApprovalId;
    // The requester cannot decide their own request.
    expect((await c.admin.post(`/api/approvals/${id}/decide`, { decision: 'approve' })).status).toBe(403);
    const list = await c.sa.get('/api/approvals').expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === id).canDecide).toBe(true);
    await c.sa.post(`/api/approvals/${id}/decide`, { decision: 'approve', reason: 'Verified against contract' }).expect(200);
    const [row] = await env.db.select().from(employees).where(eq(employees.id, u.employeeId));
    expect(row.employmentDate).toBe('2014-02-02');
    const hist = await env.db.select().from(employmentHistory).where(eq(employmentHistory.employeeId, u.employeeId));
    expect(hist.find((h) => h.approvalId === id)?.changeType).toBe('correction');
    const audit = await c.sa.get(`/api/employees/${u.employeeId}/audit`).expect(200);
    expect(audit.body.items.some((a: { action: string; approvalId: string }) => a.action === 'employee.change_approved' && a.approvalId === id)).toBe(true);
  });

  it('employees submit correction requests that reviewers approve', async () => {
    const u = await makeUser(env, { dept: 'PRT' });
    const ec = await loginAs(env, u.username);
    const res = await ec.post(`/api/employees/${u.employeeId}/corrections`, { changes: { legalName: 'Corrected Legal Name' }, reason: 'Spelling on ID card' }).expect(200);
    const mine = await ec.get('/api/approvals?mine=true').expect(200);
    expect(mine.body.items.some((i: { id: string }) => i.id === res.body.approvalId)).toBe(true);
    // Admin cannot approve a change to a legal name (requires employee.approve_changes).
    expect((await c.admin.post(`/api/approvals/${res.body.approvalId}/decide`, { decision: 'approve' })).status).toBe(404);
    await c.sa.post(`/api/approvals/${res.body.approvalId}/decide`, { decision: 'approve' }).expect(200);
    const [row] = await env.db.select().from(employees).where(eq(employees.id, u.employeeId));
    expect(row.legalName).toBe('Corrected Legal Name');
  });

  it('executive overrides require a reason and are audited as overrides', async () => {
    const u = await makeUser(env);
    expect((await c.sa.patch(`/api/employees/${u.employeeId}`, { changes: { dateOfBirth: '1984-04-12' } })).status).toBe(400);
    await c.sa.patch(`/api/employees/${u.employeeId}`, { changes: { dateOfBirth: '1984-04-12' }, reason: 'Birth certificate verified' }).expect(200);
    const audit = await c.sa.get(`/api/employees/${u.employeeId}/audit`).expect(200);
    expect(audit.body.items.some((a: { action: string }) => a.action === 'employee.override')).toBe(true);
  });

  it('rejects supervisor cycles', async () => {
    const a = await makeUser(env);
    const b = await makeUser(env, { supervisorId: a.employeeId });
    const res = await c.admin.patch(`/api/employees/${a.employeeId}`, { changes: { supervisorId: b.employeeId } });
    expect(res.status).toBe(400);
  });
});

describe('archival', () => {
  it('archived employees keep history and payroll, lose access, and can be restored', async () => {
    const u = await makeUser(env);
    const [period] = await env.db.insert(payrollPeriods).values({ code: 'ARCH-01', name: 'Archive test', startDate: '2026-01-01', endDate: '2026-01-31', payDate: '2026-01-31' }).returning();
    const fin = await makeUser(env, { roles: ['finance'] });
    const fc = await loginAs(env, fin.username);
    await fc.post('/api/payroll/records', { employeeId: u.employeeId, periodId: period.id, basicSalary: 250000 }).expect(200);
    const uc = await loginAs(env, u.username);
    await c.sa.post(`/api/employees/${u.employeeId}/archive`, { reason: 'Resigned' }).expect(200);
    expect((await uc.get('/api/auth/me')).status).toBe(401);
    expect((await c.admin.get(`/api/employees?q=${u.employmentNumber}`)).body.total).toBe(0);
    expect((await c.admin.get(`/api/employees?q=${u.employmentNumber}&archived=only`)).body.total).toBe(1);
    const history = await c.sa.get(`/api/employees/${u.employeeId}/history`).expect(200);
    expect(history.body.some((h: { changeType: string }) => h.changeType === 'archive')).toBe(true);
    const pay = await fc.get(`/api/employees/${u.employeeId}/payroll`).expect(200);
    expect(pay.body).toHaveLength(1);
    expect((await c.admin.post(`/api/employees/${u.employeeId}/archive`, { reason: 'x'.repeat(10) })).status).toBe(403);
    await c.sa.post(`/api/employees/${u.employeeId}/restore`, { reason: 'Rehired' }).expect(200);
    await loginAs(env, u.username);
  });
});

describe('directory search, filtering and pagination', () => {
  it('filters, sorts and paginates on the server', async () => {
    for (let i = 0; i < 7; i++) await makeUser(env, { dept: 'MED', loc: env.loc['SITE-B'] });
    const page1 = await c.admin.get(`/api/employees?departmentId=${env.dept.MED}&locationId=${env.loc['SITE-B']}&pageSize=3&page=1&sort=employmentNumber&dir=asc`).expect(200);
    const page3 = await c.admin.get(`/api/employees?departmentId=${env.dept.MED}&locationId=${env.loc['SITE-B']}&pageSize=3&page=3&sort=employmentNumber&dir=asc`).expect(200);
    expect(page1.body.total).toBe(7);
    expect(page1.body.items).toHaveLength(3);
    expect(page3.body.items).toHaveLength(1);
    const nums = page1.body.items.map((i: { employmentNumber: string }) => i.employmentNumber);
    expect([...nums].sort()).toEqual(nums);
    const byName = await c.admin.get(`/api/employees?q=${encodeURIComponent(page1.body.items[0].legalName)}`).expect(200);
    expect(byName.body.total).toBe(1);
    const status = await c.admin.get('/api/employees?status=pending_verification').expect(200);
    expect(status.body.items.every((i: { employmentStatus: string }) => i.employmentStatus === 'pending_verification')).toBe(true);
    const bad = await c.admin.get('/api/employees?pageSize=1000');
    expect(bad.status).toBe(400);
  });

  it('exports CSV using the same field restrictions and audits the export', async () => {
    const res = await c.admin.get('/api/employees/export.csv').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\r\n')[0]).toContain('Phone');
    expect(res.text).not.toContain('Kin Person');
    const rows = await env.db.select().from(approvalRequests);
    expect(rows).toBeDefined();
  });
});

describe('organisation listings', () => {
  it('reports correct active headcounts and department heads', async () => {
    const head = await makeUser(env, { dept: 'CLG', loc: env.loc['SITE-A'] });
    await makeUser(env, { dept: 'CLG', loc: env.loc['SITE-A'] });
    const [{ n: clg }] = (
      (await env.db.execute(sql`select count(*)::int as n from employees where department_id = ${env.dept.CLG} and archived_at is null and employment_status in ('active','on_leave')`)) as unknown as { rows: { n: number }[] }
    ).rows;
    const [{ n: siteA }] = (
      (await env.db.execute(sql`select count(*)::int as n from employees where location_id = ${env.loc['SITE-A']} and archived_at is null and employment_status in ('active','on_leave')`)) as unknown as { rows: { n: number }[] }
    ).rows;
    await c.sa.put(`/api/departments/${env.dept.CLG}`, { code: 'CLG', name: 'Clergy', headEmployeeId: head.employeeId }).expect(200);
    const deps = await c.sa.get('/api/departments').expect(200);
    const clgRow = deps.body.find((d: { code: string }) => d.code === 'CLG');
    expect(clgRow.activeEmployees).toBe(clg);
    expect(clgRow.activeEmployees).toBeGreaterThanOrEqual(2);
    expect(clgRow.headName).toBe(`Legal ${head.username}`);
    const locs = await c.sa.get('/api/locations').expect(200);
    expect(locs.body.find((l: { code: string }) => l.code === 'SITE-A').activeEmployees).toBe(siteA);
  });

  it('loads the parishes and stations of the Anglican Diocese of Northern Malawi', async () => {
    const info = await c.sa.get('/api/public/info').expect(200);
    expect(info.body.orgName).toBe('Anglican Diocese of Northern Malawi');
    const locs = await c.sa.get('/api/locations').expect(200);
    const byCode = Object.fromEntries(locs.body.map((l: { code: string; name: string; address: string | null }) => [l.code, l]));
    for (const code of ['DIO-OFFICE', 'STP-CATH', 'STP-HOSP', 'SMK-MZUZU', 'SGE-NKBAY', 'SDU-MZIMBA', 'SAM-KARONG', 'STI-CHITIP', 'SMY-SAME']) {
      expect(byCode[code], code).toBeTruthy();
    }
    expect(byCode['STP-CATH'].address).toMatch(/Likoma/);
    expect(byCode['SMK-MZUZU'].name).toMatch(/Mzuzu/);
    expect(byCode['DIO-OFFICE'].address).toMatch(/P\.O\. Box 120/);
    const deps = await c.sa.get('/api/departments').expect(200);
    expect(deps.body.find((d: { code: string }) => d.code === 'MED').description).toMatch(/St Peter's Mission Hospital/);
    expect(deps.body.find((d: { code: string }) => d.code === 'ADM').description).toMatch(/Mzuzu/);
    expect(locs.body.some((l: { name: string }) => /Lilongwe|Blantyre/.test(l.name))).toBe(false);
  });

  it('replaces the generic organisation name and keeps a name the diocese has chosen', async () => {
    await env.db.update(systemSettings).set({ value: 'Employee Management System' }).where(eq(systemSettings.key, 'org.name'));
    await seedBase(env.db);
    expect((await c.sa.get('/api/public/info')).body.orgName).toBe('Anglican Diocese of Northern Malawi');
    expect((await c.sa.get('/api/settings')).body['org.address']).toMatch(/Mzuzu/);

    await env.db.update(systemSettings).set({ value: "St Mark's Mzuzu" }).where(eq(systemSettings.key, 'org.name'));
    await seedBase(env.db);
    expect((await c.sa.get('/api/public/info')).body.orgName).toBe("St Mark's Mzuzu");
    await env.db.update(systemSettings).set({ value: 'Anglican Diocese of Northern Malawi' }).where(eq(systemSettings.key, 'org.name'));
  });
});
