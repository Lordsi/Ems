import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loginAs, makeUser, setupEnv, type Client, type MadeUser, type TestEnv } from './helpers';
import { auditLogs, payrollRecords } from '../server/db/schema';

let env: TestEnv;
let fin1: MadeUser, fin2: MadeUser, admin: MadeUser, a: MadeUser, b: MadeUser, c: MadeUser;
let cl: Record<string, Client>;
let augustId: string;
let septemberId: string;
let bDraftId: string;

const M = 100; // minor units per currency unit

async function approvedRecord(employeeId: string, periodId: string, basic: number, items: unknown[], opts: { paid?: boolean } = {}) {
  const rec = await cl.fin1
    .post('/api/payroll/records', {
      employeeId,
      periodId,
      basicSalary: basic,
      lineItems: items,
    })
    .expect(200);
  await cl.fin1.post(`/api/payroll/records/${rec.body.id}/submit`).expect(200);
  await cl.fin2.post(`/api/payroll/records/${rec.body.id}/approve`, {}).expect(200);
  if (opts.paid)
    await cl.fin1
      .post(`/api/payroll/records/${rec.body.id}/mark-paid`, {
        paymentDate: '2026-08-25',
      })
      .expect(200);
  return rec.body.id as string;
}

beforeAll(async () => {
  env = await setupEnv();
  fin1 = await makeUser(env, { roles: ['finance'] });
  fin2 = await makeUser(env, { roles: ['finance'] });
  admin = await makeUser(env, { roles: ['admin'] });
  a = await makeUser(env, { dept: 'PRT' });
  b = await makeUser(env, { dept: 'CON', loc: env.loc['SITE-A'] });
  c = await makeUser(env, { dept: 'PRT' });
  cl = {
    fin1: await loginAs(env, fin1.username),
    fin2: await loginAs(env, fin2.username),
    admin: await loginAs(env, admin.username),
    a: await loginAs(env, a.username),
  };
  augustId = (
    await cl.fin1
      .post('/api/payroll/periods', {
        code: '2026-08',
        name: 'August 2026',
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        payDate: '2026-08-25',
      })
      .expect(200)
  ).body.id;
  septemberId = (
    await cl.fin1
      .post('/api/payroll/periods', {
        code: '2026-09',
        name: 'September 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        payDate: '2026-09-25',
      })
      .expect(200)
  ).body.id;

  await approvedRecord(
    a.employeeId,
    augustId,
    500_000 * M,
    [
      {
        kind: 'earning',
        category: 'allowance',
        label: 'Housing allowance',
        amount: 50_000 * M,
      },
      { kind: 'deduction', category: 'tax', label: 'PAYE', amount: 75_000 * M },
      {
        kind: 'deduction',
        category: 'pension',
        label: 'Pension 5%',
        amount: 25_000 * M,
      },
    ],
    { paid: true },
  );
  await approvedRecord(b.employeeId, augustId, 300_000 * M, [{ kind: 'deduction', category: 'tax', label: 'PAYE', amount: 30_000 * M }], { paid: true });
  await cl.fin1.post(`/api/payroll/periods/${augustId}/close`, {}).expect(200);

  // September: A gets a 20% rise, C is new, B is still a draft.
  await approvedRecord(a.employeeId, septemberId, 600_000 * M, [
    {
      kind: 'earning',
      category: 'allowance',
      label: 'Housing allowance',
      amount: 60_000 * M,
    },
    { kind: 'deduction', category: 'tax', label: 'PAYE', amount: 90_000 * M },
    {
      kind: 'deduction',
      category: 'pension',
      label: 'Pension 5%',
      amount: 30_000 * M,
    },
    {
      kind: 'deduction',
      category: 'loan',
      label: 'Staff loan',
      amount: 20_000 * M,
    },
  ]);
  await approvedRecord(c.employeeId, septemberId, 400_000 * M, [
    {
      kind: 'earning',
      category: 'overtime',
      label: 'Overtime',
      amount: 10_000 * M,
    },
    { kind: 'deduction', category: 'tax', label: 'PAYE', amount: 40_000 * M },
    {
      kind: 'deduction',
      category: 'pension',
      label: 'Pension 5%',
      amount: 20_000 * M,
    },
  ]);
  bDraftId = (
    await cl.fin1
      .post('/api/payroll/records', {
        employeeId: b.employeeId,
        periodId: septemberId,
        basicSalary: 300_000 * M,
        lineItems: [],
      })
      .expect(200)
  ).body.id;
});
afterAll(async () => {
  await env.close();
});

describe('period-end accounting', () => {
  it('is restricted to finance', async () => {
    for (const path of ['checklist', 'remittances', 'allocation', 'journal', 'variance']) {
      expect((await cl.admin.get(`/api/payroll/periods/${septemberId}/${path}`)).status).toBe(403);
      expect((await cl.a.get(`/api/payroll/periods/${septemberId}/${path}`)).status).toBe(403);
    }
    expect((await cl.admin.get(`/api/payroll/periods/${septemberId}/register.csv`)).status).toBe(403);
    expect(
      (
        await cl.admin.post(`/api/payroll/periods/${septemberId}/pay-run`, {
          paymentDate: '2026-09-25',
        })
      ).status,
    ).toBe(403);
  });

  it('shows the close checklist with what still blocks closing', async () => {
    const res = await cl.fin1.get(`/api/payroll/periods/${septemberId}/checklist`).expect(200);
    expect(res.body.records).toMatchObject({
      draft: 1,
      pending: 0,
      approved: 2,
    });
    expect(res.body.readyToClose).toBe(false);
    expect(res.body.unpaidApproved).toBe(2);
    expect(res.body.payslipsMissing).toBe(2);
    // Finance officers and the administrator are current employees without September records.
    expect(res.body.missing.count).toBe(3);
    expect(res.body.missing.items.map((m: { id: string }) => m.id).sort()).toEqual([fin1.employeeId, fin2.employeeId, admin.employeeId].sort());
    const steps = Object.fromEntries(res.body.steps.map((s: { key: string; done: boolean; blocksClose: boolean }) => [s.key, s]));
    expect(steps.drafts).toMatchObject({ done: false, blocksClose: true });
    expect(steps.approvals).toMatchObject({ done: true, blocksClose: true });
    expect(steps.payment.done).toBe(false);

    const closed = await cl.fin1.get(`/api/payroll/periods/${augustId}/checklist`).expect(200);
    expect(closed.body.steps.every((s: { done: boolean }) => s.done)).toBe(false);
    expect(closed.body.steps.filter((s: { done: boolean }) => !s.done).every((s: { detail: string | null }) => s.detail)).toBe(true);
    expect(closed.body.readyToClose).toBe(false);
  });

  it('totals deductions to remit by category and label, from approved records only', async () => {
    const res = await cl.fin1.get(`/api/payroll/periods/${septemberId}/remittances`).expect(200);
    expect(res.body.approvedRecords).toBe(2);
    const cat = Object.fromEntries(res.body.categories.map((x: { category: string }) => [x.category, x]));
    expect(cat.tax.total).toBe(130_000 * M);
    expect(cat.tax.employees).toBe(2);
    expect(cat.tax.lines).toEqual([{ label: 'PAYE', total: 130_000 * M, employees: 2 }]);
    expect(cat.pension.total).toBe(50_000 * M);
    expect(cat.loan.total).toBe(20_000 * M);
    expect(cat.other_deduction.total).toBe(0);
    expect(res.body.totalDeductions).toBe(200_000 * M);
    expect(res.body.employees.find((e: { employeeId: string }) => e.employeeId === a.employeeId).byCategory).toEqual({
      tax: 90_000 * M,
      pension: 30_000 * M,
      loan: 20_000 * M,
      other_deduction: 0,
    });

    const csv = await cl.fin1.get(`/api/payroll/periods/${septemberId}/remittances.csv`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('TOTAL,,,MWK,130000.00,50000.00,20000.00,0.00,200000.00');
  });

  it('allocates approved cost to departments and locations', async () => {
    const res = await cl.fin1.get(`/api/payroll/periods/${septemberId}/allocation`).expect(200);
    expect(res.body.byDepartment).toHaveLength(1);
    expect(res.body.byDepartment[0]).toMatchObject({
      name: 'Printing',
      employees: 2,
      basic: 1_000_000 * M,
      otherEarnings: 70_000 * M,
      gross: 1_070_000 * M,
      deductions: 200_000 * M,
      net: 870_000 * M,
    });
    expect(res.body.byLocation[0]).toMatchObject({
      employees: 2,
      net: 870_000 * M,
    });
    expect(res.body.totals.net).toBe(870_000 * M);
    const csv = await cl.fin1.get(`/api/payroll/periods/${septemberId}/allocation.csv`).expect(200);
    expect(csv.text).toContain('Department,Printing,2,MWK,1000000.00,70000.00,1070000.00,200000.00,870000.00');
  });

  it('produces a balanced salaries journal', async () => {
    const res = await cl.fin1.get(`/api/payroll/periods/${septemberId}/journal`).expect(200);
    expect(res.body.balanced).toBe(true);
    expect(res.body.totals).toEqual({
      debit: 1_070_000 * M,
      credit: 1_070_000 * M,
    });
    const by = (account: string) => res.body.lines.find((l: { account: string }) => l.account === account);
    expect(by('Basic salaries')).toMatchObject({
      costCentre: 'Printing',
      debit: 1_000_000 * M,
    });
    expect(by('Allowances')).toMatchObject({ debit: 60_000 * M });
    expect(by('Overtime')).toMatchObject({ debit: 10_000 * M });
    expect(by('Income tax (PAYE) payable')).toMatchObject({
      credit: 130_000 * M,
    });
    expect(by('Staff loan recoveries')).toMatchObject({ credit: 20_000 * M });
    expect(by('Net salaries payable')).toMatchObject({ credit: 870_000 * M });
    expect(by('Bonuses')).toBeUndefined();
    const csv = await cl.fin1.get(`/api/payroll/periods/${septemberId}/journal.csv`).expect(200);
    expect(csv.text).toContain('2026-09,Net salaries payable,,MWK,0.00,870000.00');
    expect(csv.text).toContain('2026-09,TOTAL,,MWK,1070000.00,1070000.00');
  });

  it('compares each person with the previous period and flags what changed', async () => {
    const res = await cl.fin1.get(`/api/payroll/periods/${septemberId}/variance`).expect(200);
    expect(res.body.previous.code).toBe('2026-08');
    expect(res.body.threshold).toBe(10);
    const by = Object.fromEntries(res.body.items.map((i: { employeeId: string }) => [i.employeeId, i]));
    expect(by[a.employeeId]).toMatchObject({
      previousNet: 450_000 * M,
      currentNet: 520_000 * M,
      deltaNet: 70_000 * M,
      pct: 15.6,
      flag: 'increase',
    });
    expect(by[c.employeeId]).toMatchObject({
      previousNet: null,
      currentNet: 350_000 * M,
      flag: 'new',
    });
    expect(by[b.employeeId]).toMatchObject({
      previousNet: 270_000 * M,
      currentNet: 300_000 * M,
      currentStatus: 'draft',
      flag: 'increase',
    });
    expect(res.body.summary.flagged).toBe(3);
    expect(res.body.items[0].flag).not.toBeNull();

    const strict = await cl.fin1.get(`/api/payroll/periods/${septemberId}/variance?threshold=20`).expect(200);
    const strictBy = Object.fromEntries(strict.body.items.map((i: { employeeId: string }) => [i.employeeId, i]));
    expect(strictBy[a.employeeId].flag).toBeNull();
    expect(strictBy[b.employeeId].flag).toBeNull();
    expect(strict.body.summary.flagged).toBe(1);
    expect((await cl.fin1.get(`/api/payroll/periods/${septemberId}/variance?threshold=0`)).status).toBe(400);

    // The person who still has no record this month shows up once the draft is removed.
    await cl.fin1.del(`/api/payroll/records/${bDraftId}`).expect(200);
    const gone = await cl.fin1.get(`/api/payroll/periods/${septemberId}/variance`).expect(200);
    expect(gone.body.items.find((i: { employeeId: string }) => i.employeeId === b.employeeId)).toMatchObject({ currentNet: null, flag: 'missing' });
    const first = await cl.fin1.get(`/api/payroll/periods/${augustId}/variance`).expect(200);
    expect(first.body.previous).toBeNull();
    expect(first.body.items.every((i: { flag: string }) => i.flag === 'new')).toBe(true);
  });

  it('exports a register with one column per earning and deduction category', async () => {
    const csv = await cl.fin1.get(`/api/payroll/periods/${septemberId}/register.csv`).expect(200);
    const [header, ...lines] = csv.text.trim().split('\r\n');
    expect(header).toBe(
      'Period,Employment number,Name,Department,Location,Revision,Status,Currency,Basic,Allowances,Bonuses,Overtime,Other earnings,Gross,Tax,Pension,Loans,Other deductions,Total deductions,Net,Payment status,Payment date,Payslip number',
    );
    expect(lines).toHaveLength(2);
    const rowA = lines.find((l) => l.includes(a.employmentNumber))!;
    expect(rowA).toContain(',600000.00,60000.00,0.00,0.00,0.00,660000.00,90000.00,30000.00,20000.00,0.00,140000.00,520000.00,unpaid,');
    const exports = await env.db.select().from(auditLogs).where(eq(auditLogs.action, 'payroll.export'));
    expect(exports.map((e) => (e.newValues as { kind?: string }).kind).sort()).toEqual(['allocation', 'journal', 'register', 'remittances']);
  });

  it('records a pay run across every approved unpaid record', async () => {
    const run = await cl.fin1
      .post(`/api/payroll/periods/${septemberId}/pay-run`, {
        paymentDate: '2026-09-25',
      })
      .expect(200);
    expect(run.body).toEqual({
      paid: 2,
      netPay: 870_000 * M,
      paymentDate: '2026-09-25',
    });
    const rows = await env.db.select().from(payrollRecords).where(eq(payrollRecords.periodId, septemberId));
    expect(rows.filter((r) => r.status === 'approved').every((r) => r.paymentStatus === 'paid' && r.paymentDate === '2026-09-25')).toBe(true);
    expect(
      (
        await cl.fin1.post(`/api/payroll/periods/${septemberId}/pay-run`, {
          paymentDate: '2026-09-26',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await cl.fin1.post(`/api/payroll/periods/${septemberId}/pay-run`, {
          paymentDate: 'tomorrow',
        })
      ).status,
    ).toBe(400);
    const [entry] = await env.db.select().from(auditLogs).where(eq(auditLogs.action, 'payroll.pay_run'));
    expect(entry.newValues).toMatchObject({
      records: 2,
      netPay: 870_000 * M,
      paymentDate: '2026-09-25',
    });
    const check = await cl.fin1.get(`/api/payroll/periods/${septemberId}/checklist`).expect(200);
    expect(check.body.unpaidApproved).toBe(0);
    expect(check.body.readyToClose).toBe(true);
  });
});
