import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { loginAs, makeUser, setupEnv, type Client, type MadeUser, type TestEnv } from './helpers';
import { auditLogs, employees, notifications, payrollRecords, retirementPolicies, retirementReviews } from '../server/db/schema';
import { runRetirementScan } from '../server/services/retirement';
import { runScheduledJobs } from '../server/services/jobs';
import { addMonths, addYears } from '../server/lib/dates';

let env: TestEnv;
let sa: MadeUser, admin: MadeUser, fin1: MadeUser, fin2: MadeUser, staff: MadeUser, staff2: MadeUser;
let c: Record<string, Client>;
let periodId: string;

beforeAll(async () => {
  env = await setupEnv();
  sa = await makeUser(env, { roles: ['super_admin'] });
  admin = await makeUser(env, { roles: ['admin'] });
  fin1 = await makeUser(env, { roles: ['finance'] });
  fin2 = await makeUser(env, { roles: ['finance'] });
  staff = await makeUser(env, { dept: 'PRT' });
  staff2 = await makeUser(env, { dept: 'PRT' });
  c = {
    sa: await loginAs(env, sa.username),
    admin: await loginAs(env, admin.username),
    fin1: await loginAs(env, fin1.username),
    fin2: await loginAs(env, fin2.username),
    staff: await loginAs(env, staff.username),
    staff2: await loginAs(env, staff2.username),
  };
  const p = await c.fin1.post('/api/payroll/periods', { code: '2026-09', name: 'September 2026', startDate: '2026-09-01', endDate: '2026-09-30', payDate: '2026-09-28' }).expect(200);
  periodId = p.body.id;
});
afterAll(async () => {
  await env.close();
});

const items = [
  { kind: 'earning', category: 'allowance', label: 'Housing allowance', amount: 5_000_000 },
  { kind: 'deduction', category: 'tax', label: 'PAYE', amount: 7_500_000 },
  { kind: 'deduction', category: 'pension', label: 'Pension 5%', amount: 2_500_000 },
];

describe('payroll', () => {
  let recordId: string;

  it('computes totals on the server in integer minor units', async () => {
    const res = await c.fin1.post('/api/payroll/records', { employeeId: staff.employeeId, periodId, basicSalary: 50_000_000, lineItems: items, grossEarnings: 1 }).expect(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    const ok = await c.fin1.post('/api/payroll/records', { employeeId: staff.employeeId, periodId, basicSalary: 50_000_000, lineItems: items }).expect(200);
    recordId = ok.body.id;
    const rec = await c.fin1.get(`/api/payroll/records/${recordId}`).expect(200);
    expect(rec.body.grossEarnings).toBe(55_000_000);
    expect(rec.body.totalDeductions).toBe(10_000_000);
    expect(rec.body.netPay).toBe(45_000_000);
    expect((await c.fin1.post('/api/payroll/records', { employeeId: staff2.employeeId, periodId, basicSalary: 100.5 })).status).toBe(400);
  });

  it('enforces second-person approval', async () => {
    await c.fin1.post(`/api/payroll/records/${recordId}/submit`).expect(200);
    const self = await c.fin1.post(`/api/payroll/records/${recordId}/approve`, {});
    expect(self.status).toBe(403);
    // Employees never see unapproved payroll.
    expect((await c.staff.get(`/api/payroll/records/${recordId}`)).status).toBe(404);
    expect((await c.staff.get('/api/me/payroll')).body).toHaveLength(0);
    await c.fin2.post(`/api/payroll/records/${recordId}/approve`, { reason: 'Checked against contract' }).expect(200);
    const audits = await env.db.select().from(auditLogs).where(and(eq(auditLogs.targetId, recordId), eq(auditLogs.action, 'payroll.record_approve')));
    expect(audits[0].actorUserId).toBe(fin2.userId);
  });

  it('approved payroll is immutable, even directly in the database', async () => {
    await expect(env.db.update(payrollRecords).set({ basicSalary: 1 }).where(eq(payrollRecords.id, recordId))).rejects.toThrow();
    await expect(env.db.delete(payrollRecords).where(eq(payrollRecords.id, recordId))).rejects.toThrow();
    const res = await c.fin1.put(`/api/payroll/records/${recordId}`, { basicSalary: 1, lineItems: [] });
    expect(res.status).toBe(409);
  });

  it('issues payslips visible only to the employee and finance', async () => {
    const slip = await c.fin1.post(`/api/payroll/records/${recordId}/payslip`).expect(200);
    const own = await c.staff.get(`/api/payslips/${slip.body.id}`).expect(200);
    expect(own.body.employee.employmentNumber).toBe(staff.employmentNumber);
    expect(own.body.currency).toBe('MWK');
    expect(own.body.netPay).toBe(45_000_000);
    expect(own.body.deductions).toHaveLength(2);
    expect(own.body.employee.age).toBeUndefined();
    expect((await c.staff2.get(`/api/payslips/${slip.body.id}`)).status).toBe(404);
    expect((await c.admin.get(`/api/payslips/${slip.body.id}`)).status).toBe(404);
    await c.fin2.get(`/api/payslips/${slip.body.id}`).expect(200);
    const notes = await env.db.select().from(notifications).where(and(eq(notifications.userId, staff.userId), eq(notifications.type, 'payslip.available')));
    expect(notes).toHaveLength(1);
    expect(JSON.stringify(notes)).not.toMatch(/45000000|450,000/);
  });

  it('corrections create an approved revision that supersedes the original', async () => {
    const adj = await c.fin1.post(`/api/payroll/records/${recordId}/adjust`, { reason: 'Missed overtime' }).expect(200);
    const revId = adj.body.id;
    await c.fin1
      .put(`/api/payroll/records/${revId}`, { basicSalary: 50_000_000, lineItems: [...items, { kind: 'earning', category: 'overtime', label: 'Overtime', amount: 1_000_000 }] })
      .expect(200);
    await c.fin1.post(`/api/payroll/records/${revId}/submit`).expect(200);
    await c.fin2.post(`/api/payroll/records/${revId}/approve`, {}).expect(200);
    const [orig] = await env.db.select().from(payrollRecords).where(eq(payrollRecords.id, recordId));
    const [rev] = await env.db.select().from(payrollRecords).where(eq(payrollRecords.id, revId));
    expect(orig.status).toBe('superseded');
    expect(orig.netPay).toBe(45_000_000);
    expect(rev.revision).toBe(2);
    expect(rev.netPay).toBe(46_000_000);
    const mine = await c.staff.get('/api/me/payroll').expect(200);
    expect(mine.body.map((r: { status: string }) => r.status).sort()).toEqual(['approved', 'superseded']);
  });

  it('respects the configurable approval setting', async () => {
    await c.sa.put('/api/settings', { values: { 'payroll.require_second_approval': false }, reason: 'Single officer during audit week' }).expect(200);
    const rec = await c.fin1.post('/api/payroll/records', { employeeId: staff2.employeeId, periodId, basicSalary: 30_000_000 }).expect(200);
    await c.fin1.post(`/api/payroll/records/${rec.body.id}/submit`).expect(200);
    await c.fin1.post(`/api/payroll/records/${rec.body.id}/approve`, {}).expect(200);
    await c.sa.put('/api/settings', { values: { 'payroll.require_second_approval': true }, reason: 'Restore control' }).expect(200);
  });

  it('summarises the period and exports with an audit entry', async () => {
    const sum = await c.fin1.get(`/api/payroll/summary?periodId=${periodId}`).expect(200);
    expect(sum.body.payroll.approvedNet).toBe(46_000_000 + 30_000_000);
    const csv = await c.fin1.get(`/api/payroll/periods/${periodId}/export.csv`).expect(200);
    expect(csv.text).toContain('460000.00');
    const exp = await env.db.select().from(auditLogs).where(eq(auditLogs.action, 'payroll.export'));
    expect(exp).toHaveLength(1);
  });
});

describe('retirement monitoring', () => {
  const today = new Date('2026-10-08T08:00:00Z');
  let sixMonths: MadeUser, sevenMonths: MadeUser, thirteenMonths: MadeUser, past: MadeUser;

  beforeAll(async () => {
    // Expected retirement (age 60) relative to `today`:
    sixMonths = await makeUser(env, { dob: addYears(addMonths('2026-10-08', 6), -60) });
    sevenMonths = await makeUser(env, { dob: addYears(addMonths('2026-10-08', 7), -60) });
    thirteenMonths = await makeUser(env, { dob: addYears(addMonths('2026-10-08', 13), -60) });
    past = await makeUser(env, { dob: '1950-01-01' });
  });

  it('does nothing until a policy has been explicitly adopted', async () => {
    const result = await runRetirementScan(env.db, today);
    expect(result.skipped).toBe('no_adopted_policy');
    expect(await env.db.select().from(retirementReviews)).toHaveLength(0);
  });

  it('flags employees six months before the expected date and notifies once', async () => {
    const [policy] = await env.db.select().from(retirementPolicies);
    expect((await c.admin.post(`/api/retirement/policies/${policy.id}/adopt`, { confirmation: true, reason: 'x'.repeat(10) })).status).toBe(403);
    await c.sa.post(`/api/retirement/policies/${policy.id}/adopt`, { confirmation: true, reason: 'Board resolution 2026/14 verified' }).expect(200);
    await runRetirementScan(env.db, today);
    const reviews = await env.db.select().from(retirementReviews);
    const status = (u: MadeUser) => reviews.find((r) => r.employeeId === u.employeeId)?.status;
    expect(status(sixMonths)).toBe('review_required');
    expect(status(sevenMonths)).toBe('upcoming');
    expect(status(thirteenMonths)).toBeUndefined();
    expect(status(past)).toBe('review_required');

    // Idempotent: re-running does not duplicate reviews or notifications.
    await runRetirementScan(env.db, today);
    const again = await env.db.select().from(retirementReviews);
    expect(again).toHaveLength(reviews.length);
    const finNotes = await env.db.select().from(notifications).where(and(eq(notifications.userId, fin1.userId), eq(notifications.type, 'retirement.review_required')));
    expect(finNotes).toHaveLength(2);
    // Employees without retirement.read are not notified about colleagues.
    const staffNotes = await env.db.select().from(notifications).where(and(eq(notifications.userId, staff.userId), eq(notifications.type, 'retirement.review_required')));
    expect(staffNotes).toHaveLength(0);

    // A month later the seven-month employee crosses into the review window.
    await runRetirementScan(env.db, new Date('2026-11-09T08:00:00Z'));
    const [r] = await env.db.select().from(retirementReviews).where(eq(retirementReviews.employeeId, sevenMonths.employeeId));
    expect(r.status).toBe('review_required');
  });

  it('scheduled jobs run once per day', async () => {
    const first = await runScheduledJobs(env.db, today);
    const second = await runScheduledJobs(env.db, today);
    expect(first.find((j) => j.jobName === 'retirement_scan')?.skipped).toBe(false);
    expect(second.find((j) => j.jobName === 'retirement_scan')?.skipped).toBe(true);
  });

  it('runs the full statement → verification → executive decision → finalization workflow', async () => {
    const [review] = await env.db.select().from(retirementReviews).where(eq(retirementReviews.employeeId, sixMonths.employeeId));
    const statement = {
      calculationMethod: 'Gratuity per staff handbook section 9.2: 1 month basic per completed year of service (verified by HR).',
      policyReference: 'Staff handbook 2024 s9.2',
      sourceFigures: { monthlyBasic: 50000000, completedYears: 11 },
      lineItems: [
        { label: 'Gratuity', kind: 'credit', amount: 550_000_000 },
        { label: 'Outstanding salary advance', kind: 'debit', amount: 20_000_000 },
      ],
    };
    expect((await c.admin.post(`/api/retirement/reviews/${review.id}/settlements`, statement)).status).toBe(403);
    const s = await c.fin1.post(`/api/retirement/reviews/${review.id}/settlements`, statement).expect(200);
    // Approval is impossible before verification.
    expect((await c.sa.post(`/api/retirement/reviews/${review.id}/decision`, { decision: 'approve', reason: 'Too early' })).status).toBe(409);
    await c.fin1.post(`/api/retirement/settlements/${s.body.id}/submit`).expect(200);
    expect((await c.fin2.post(`/api/retirement/settlements/${s.body.id}/verify`, { decision: 'verify', note: 'ok' })).status).toBe(403);
    await c.admin.post(`/api/retirement/settlements/${s.body.id}/verify`, { decision: 'verify', note: 'Figures match HR records' }).expect(200);
    expect((await c.admin.post(`/api/retirement/reviews/${review.id}/decision`, { decision: 'approve', reason: 'Approve please' })).status).toBe(403);
    await c.sa.post(`/api/retirement/reviews/${review.id}/decision`, { decision: 'approve', reason: 'Approved per policy' }).expect(200);
    const detail = await c.fin1.get(`/api/retirement/reviews/${review.id}`).expect(200);
    expect(detail.body.status).toBe('approved');
    expect(detail.body.settlements[0].totalAmount).toBe(530_000_000);

    const emp = await loginAs(env, sixMonths.username);
    await c.sa.post(`/api/retirement/reviews/${review.id}/complete`, { effectiveDate: '2027-04-08', reason: 'Retirement finalized' }).expect(200);
    expect((await emp.get('/api/auth/me')).status).toBe(401);
    const [row] = await env.db.select().from(employees).where(eq(employees.id, sixMonths.employeeId));
    expect(row.employmentStatus).toBe('retired');
    expect(row.archivedAt).not.toBeNull();
    expect(row.employmentNumber).toBe(sixMonths.employmentNumber);
    const hist = await c.sa.get(`/api/employees/${sixMonths.employeeId}/history`).expect(200);
    expect(hist.body.some((h: { changeType: string }) => h.changeType === 'retirement')).toBe(true);
    const audits = await env.db.select().from(auditLogs).where(sql`${auditLogs.action} like 'retirement.%'`);
    for (const action of ['retirement.settlement_create', 'retirement.settlement_verify', 'retirement.decision_approve', 'retirement.complete', 'retirement.policy_adopt']) {
      expect(audits.some((a) => a.action === action)).toBe(true);
    }
  });

  it('never deletes employment records when retirement age passes', async () => {
    await runRetirementScan(env.db, new Date('2030-01-01T00:00:00Z'));
    const [row] = await env.db.select().from(employees).where(eq(employees.id, past.employeeId));
    expect(row).toBeDefined();
    expect(row.employmentStatus).toBe('active');
  });

  it('supports deferral with a documented decision and re-flags later', async () => {
    const [review] = await env.db.select().from(retirementReviews).where(eq(retirementReviews.employeeId, past.employeeId));
    expect((await c.sa.post(`/api/retirement/reviews/${review.id}/decision`, { decision: 'defer', reason: 'Critical project' })).status).toBe(400);
    await c.sa.post(`/api/retirement/reviews/${review.id}/decision`, { decision: 'defer', reason: 'Extension approved for project', deferredUntil: '2028-06-30' }).expect(200);
    await runRetirementScan(env.db, new Date('2027-06-01T00:00:00Z'));
    let [r] = await env.db.select().from(retirementReviews).where(eq(retirementReviews.id, review.id));
    expect(r.status).toBe('deferred');
    await runRetirementScan(env.db, new Date('2028-01-01T00:00:00Z'));
    [r] = await env.db.select().from(retirementReviews).where(eq(retirementReviews.id, review.id));
    expect(r.status).toBe('review_required');
    expect(r.expectedRetirementDate).toBe('2028-06-30');
  });
});
