/**
 * Period-end accounting on top of approved payroll: the close checklist, statutory and
 * third-party remittances, cost allocation by department and location, the salaries journal,
 * variance against the previous period, a payment run and the detailed register.
 *
 * Figures come from approved records only, except the checklist, the variance check and the
 * register, which deliberately look at work in progress. Nothing here changes a payroll amount.
 */
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { departments, employees, payrollLineItems, payrollPeriods, payrollRecords, payslips, workLocations } from '../db/schema';
import type { Tx } from '../db/client';
import type { Ctx } from '../context';
import { requirePerm } from '../authz/policy';
import { conflict, notFound } from '../lib/errors';
import { parse, zDate, zUuid } from '../lib/validate';
import { toCsv, minorToDecimal } from '../lib/csv';
import { audit } from './audit';
import { getSetting } from './settings';

const LIVE = ['draft', 'pending_approval', 'approved'] as const;
const EARNING_CATEGORIES = ['allowance', 'bonus', 'overtime', 'other_earning'] as const;
const DEDUCTION_CATEGORIES = ['tax', 'pension', 'loan', 'other_deduction'] as const;
type EarningCategory = (typeof EARNING_CATEGORIES)[number];
type DeductionCategory = (typeof DEDUCTION_CATEGORIES)[number];

/** Ledger wording for journal lines. Account codes are left to the organisation's chart of accounts. */
const ACCOUNT_NAMES: Record<EarningCategory | DeductionCategory | 'basic' | 'net', string> = {
  basic: 'Basic salaries',
  allowance: 'Allowances',
  bonus: 'Bonuses',
  overtime: 'Overtime',
  other_earning: 'Other earnings',
  tax: 'Income tax (PAYE) payable',
  pension: 'Pension contributions payable',
  loan: 'Staff loan recoveries',
  other_deduction: 'Other deductions payable',
  net: 'Net salaries payable',
};

async function loadPeriod(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, id));
  return row ?? null;
}

async function requirePeriod(tx: Tx, id: string) {
  const period = await loadPeriod(tx, id);
  if (!period) throw notFound('Payroll period not found');
  return period;
}

function recordRows(tx: Tx) {
  return tx
    .select({
      recordId: payrollRecords.id,
      revision: payrollRecords.revision,
      status: payrollRecords.status,
      currency: payrollRecords.currency,
      basicSalary: payrollRecords.basicSalary,
      grossEarnings: payrollRecords.grossEarnings,
      totalDeductions: payrollRecords.totalDeductions,
      netPay: payrollRecords.netPay,
      paymentStatus: payrollRecords.paymentStatus,
      paymentDate: payrollRecords.paymentDate,
      discrepancyFlag: payrollRecords.discrepancyFlag,
      employeeId: employees.id,
      legalName: employees.legalName,
      employmentNumber: employees.employmentNumber,
      departmentId: departments.id,
      departmentName: departments.name,
      locationId: workLocations.id,
      locationName: workLocations.name,
      payslipNumber: payslips.payslipNumber,
    })
    .from(payrollRecords)
    .innerJoin(employees, eq(employees.id, payrollRecords.employeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(workLocations, eq(workLocations.id, employees.locationId))
    .leftJoin(payslips, eq(payslips.payrollRecordId, payrollRecords.id));
}

type RecordRow = Awaited<ReturnType<ReturnType<typeof recordRows>['execute']>>[number];

function approvedRows(tx: Tx, periodId: string) {
  return recordRows(tx)
    .where(and(eq(payrollRecords.periodId, periodId), eq(payrollRecords.status, 'approved')))
    .orderBy(asc(employees.legalName));
}

async function itemsFor(tx: Tx, recordIds: string[]) {
  if (!recordIds.length) return [];
  return tx.select().from(payrollLineItems).where(inArray(payrollLineItems.recordId, recordIds)).orderBy(asc(payrollLineItems.sortOrder));
}

type Item = Awaited<ReturnType<typeof itemsFor>>[number];

function sumBy<T>(rows: T[], pick: (r: T) => number) {
  return rows.reduce((s, r) => s + pick(r), 0);
}

function emptyCategoryTotals<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

function categoryTotals<K extends string>(items: Item[], keys: readonly K[]) {
  const out = emptyCategoryTotals(keys);
  for (const i of items) if ((keys as readonly string[]).includes(i.category)) out[i.category as K] += i.amount;
  return out;
}

async function currencyFor(tx: Tx, rows: { currency: string }[]) {
  return rows[0]?.currency ?? (await getSetting(tx, 'org.currency'));
}

/* ------------------------------------------------------------------ */
/* Close checklist                                                    */
/* ------------------------------------------------------------------ */

export async function periodChecklist(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.read', 'report.finance');
  const period = await requirePeriod(ctx.db, periodId);
  const live = and(eq(payrollRecords.periodId, periodId), inArray(payrollRecords.status, [...LIVE]));
  const [byStatus, [payment], [slips], [{ activeEmployees }], missing] = await Promise.all([
    ctx.db
      .select({
        status: payrollRecords.status,
        n: sql<number>`count(*)::int`,
        flagged: sql<number>`count(*) filter (where ${payrollRecords.discrepancyFlag})::int`,
      })
      .from(payrollRecords)
      .where(eq(payrollRecords.periodId, periodId))
      .groupBy(payrollRecords.status),
    ctx.db
      .select({
        unpaid: sql<number>`count(*) filter (where ${payrollRecords.paymentStatus} = 'unpaid')::int`,
        unpaidNet: sql<string>`coalesce(sum(${payrollRecords.netPay}) filter (where ${payrollRecords.paymentStatus} = 'unpaid'),0)`,
        approvedNet: sql<string>`coalesce(sum(${payrollRecords.netPay}),0)`,
      })
      .from(payrollRecords)
      .where(and(eq(payrollRecords.periodId, periodId), eq(payrollRecords.status, 'approved'))),
    ctx.db
      .select({ missing: sql<number>`count(*)::int` })
      .from(payrollRecords)
      .leftJoin(payslips, eq(payslips.payrollRecordId, payrollRecords.id))
      .where(and(eq(payrollRecords.periodId, periodId), eq(payrollRecords.status, 'approved'), isNull(payslips.id))),
    ctx.db
      .select({ activeEmployees: sql<number>`count(*)::int` })
      .from(employees)
      .where(currentEmployee()),
    ctx.db
      .select({
        id: employees.id,
        legalName: employees.legalName,
        employmentNumber: employees.employmentNumber,
        departmentName: departments.name,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(
        and(
          currentEmployee(),
          sql`not exists (select 1 from ${payrollRecords} pr where pr.employee_id = ${employees.id} and pr.period_id = ${periodId} and pr.status in ('draft','pending_approval','approved'))`,
        ),
      )
      .orderBy(asc(employees.legalName)),
  ]);
  void live;
  const count = (s: string) => byStatus.find((r) => r.status === s)?.n ?? 0;
  const records = {
    draft: count('draft'),
    pending: count('pending_approval'),
    approved: count('approved'),
    superseded: count('superseded'),
  };
  const flagged = byStatus.filter((r) => LIVE.includes(r.status as (typeof LIVE)[number])).reduce((s, r) => s + r.flagged, 0);
  const steps = [
    {
      key: 'coverage',
      label: 'Every current employee has a payroll record',
      done: missing.length === 0,
      detail: missing.length ? `${missing.length} without a record` : null,
      blocksClose: false,
    },
    {
      key: 'drafts',
      label: 'No draft records remain',
      done: records.draft === 0,
      detail: records.draft ? `${records.draft} draft` : null,
      blocksClose: true,
    },
    {
      key: 'approvals',
      label: 'Nothing is awaiting approval',
      done: records.pending === 0,
      detail: records.pending ? `${records.pending} awaiting approval` : null,
      blocksClose: true,
    },
    {
      key: 'flags',
      label: 'No discrepancy flags are outstanding',
      done: flagged === 0,
      detail: flagged ? `${flagged} flagged` : null,
      blocksClose: false,
    },
    {
      key: 'payment',
      label: 'All approved records are marked paid',
      done: payment.unpaid === 0,
      detail: payment.unpaid ? `${payment.unpaid} unpaid` : null,
      blocksClose: false,
    },
    {
      key: 'payslips',
      label: 'Payslips are issued for every approved record',
      done: slips.missing === 0,
      detail: slips.missing ? `${slips.missing} to issue` : null,
      blocksClose: false,
    },
  ];
  return {
    period,
    currency: await getSetting(ctx.db, 'org.currency'),
    activeEmployees,
    records,
    flagged,
    unpaidApproved: payment.unpaid,
    unpaidNet: Number(payment.unpaidNet),
    approvedNet: Number(payment.approvedNet),
    payslipsMissing: slips.missing,
    missing: { count: missing.length, items: missing.slice(0, 50) },
    steps,
    readyToClose: period.status === 'open' && records.approved > 0 && steps.filter((s) => s.blocksClose).every((s) => s.done),
  };
}

function currentEmployee(): SQL {
  return and(isNull(employees.archivedAt), inArray(employees.employmentStatus, ['active', 'on_leave']), sql`${employees.employmentNumber} is not null`)!;
}

/* ------------------------------------------------------------------ */
/* Remittances                                                        */
/* ------------------------------------------------------------------ */

async function remittanceData(tx: Tx, periodId: string) {
  const period = await requirePeriod(tx, periodId);
  const rows = await approvedRows(tx, periodId);
  const items = (
    await itemsFor(
      tx,
      rows.map((r) => r.recordId),
    )
  ).filter((i) => i.kind === 'deduction');
  const perEmployee = rows.map((r) => ({
    employeeId: r.employeeId,
    legalName: r.legalName,
    employmentNumber: r.employmentNumber,
    departmentName: r.departmentName,
    byCategory: categoryTotals(
      items.filter((i) => i.recordId === r.recordId),
      DEDUCTION_CATEGORIES,
    ),
    total: r.totalDeductions,
  }));
  const categories = DEDUCTION_CATEGORIES.map((category) => {
    const its = items.filter((i) => i.category === category);
    const byLabel = new Map<string, { label: string; total: number; records: Set<string> }>();
    for (const i of its) {
      const e = byLabel.get(i.label) ?? {
        label: i.label,
        total: 0,
        records: new Set<string>(),
      };
      e.total += i.amount;
      e.records.add(i.recordId);
      byLabel.set(i.label, e);
    }
    return {
      category,
      account: ACCOUNT_NAMES[category],
      total: sumBy(its, (i) => i.amount),
      employees: new Set(its.map((i) => i.recordId)).size,
      lines: [...byLabel.values()]
        .map((l) => ({
          label: l.label,
          total: l.total,
          employees: l.records.size,
        }))
        .sort((a, b) => b.total - a.total),
    };
  });
  return {
    period,
    currency: await currencyFor(tx, rows),
    approvedRecords: rows.length,
    totalDeductions: sumBy(rows, (r) => r.totalDeductions),
    categories,
    employees: perEmployee,
  };
}

export async function periodRemittances(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.read', 'report.finance');
  return remittanceData(ctx.db, periodId);
}

export async function periodRemittancesCsv(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.export');
  const d = await remittanceData(ctx.db, periodId);
  await audit(ctx.db, ctx, {
    action: 'payroll.export',
    targetType: 'payroll_period',
    targetId: periodId,
    newValues: { kind: 'remittances', rows: d.employees.length },
  });
  const totals = categoryTotals([], DEDUCTION_CATEGORIES);
  for (const e of d.employees) for (const c of DEDUCTION_CATEGORIES) totals[c] += e.byCategory[c];
  return toCsv(
    ['Employment number', 'Name', 'Department', 'Currency', 'Tax', 'Pension', 'Loans', 'Other deductions', 'Total deductions'],
    [
      ...d.employees.map((e) => [e.employmentNumber, e.legalName, e.departmentName, d.currency, ...DEDUCTION_CATEGORIES.map((c) => minorToDecimal(e.byCategory[c])), minorToDecimal(e.total)]),
      ['TOTAL', '', '', d.currency, ...DEDUCTION_CATEGORIES.map((c) => minorToDecimal(totals[c])), minorToDecimal(d.totalDeductions)],
    ],
  );
}

/* ------------------------------------------------------------------ */
/* Cost allocation                                                    */
/* ------------------------------------------------------------------ */

function allocate(rows: RecordRow[], key: (r: RecordRow) => { id: string | null; name: string | null }) {
  const groups = new Map<
    string,
    {
      id: string | null;
      name: string;
      employees: number;
      basic: number;
      otherEarnings: number;
      gross: number;
      deductions: number;
      net: number;
    }
  >();
  for (const r of rows) {
    const k = key(r);
    const g = groups.get(k.id ?? '') ?? {
      id: k.id,
      name: k.name ?? 'Unassigned',
      employees: 0,
      basic: 0,
      otherEarnings: 0,
      gross: 0,
      deductions: 0,
      net: 0,
    };
    g.employees += 1;
    g.basic += r.basicSalary;
    g.otherEarnings += r.grossEarnings - r.basicSalary;
    g.gross += r.grossEarnings;
    g.deductions += r.totalDeductions;
    g.net += r.netPay;
    groups.set(k.id ?? '', g);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function allocationData(tx: Tx, periodId: string) {
  const period = await requirePeriod(tx, periodId);
  const rows = await approvedRows(tx, periodId);
  return {
    period,
    currency: await currencyFor(tx, rows),
    approvedRecords: rows.length,
    byDepartment: allocate(rows, (r) => ({
      id: r.departmentId,
      name: r.departmentName,
    })),
    byLocation: allocate(rows, (r) => ({
      id: r.locationId,
      name: r.locationName,
    })),
    totals: {
      basic: sumBy(rows, (r) => r.basicSalary),
      otherEarnings: sumBy(rows, (r) => r.grossEarnings - r.basicSalary),
      gross: sumBy(rows, (r) => r.grossEarnings),
      deductions: sumBy(rows, (r) => r.totalDeductions),
      net: sumBy(rows, (r) => r.netPay),
    },
  };
}

export async function periodAllocation(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.read', 'report.finance');
  return allocationData(ctx.db, periodId);
}

export async function periodAllocationCsv(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.export');
  const d = await allocationData(ctx.db, periodId);
  await audit(ctx.db, ctx, {
    action: 'payroll.export',
    targetType: 'payroll_period',
    targetId: periodId,
    newValues: {
      kind: 'allocation',
      rows: d.byDepartment.length + d.byLocation.length,
    },
  });
  const line = (section: string, g: (typeof d.byDepartment)[number]) => [
    section,
    g.name,
    g.employees,
    d.currency,
    minorToDecimal(g.basic),
    minorToDecimal(g.otherEarnings),
    minorToDecimal(g.gross),
    minorToDecimal(g.deductions),
    minorToDecimal(g.net),
  ];
  return toCsv(
    ['Section', 'Cost centre', 'Employees', 'Currency', 'Basic', 'Other earnings', 'Gross', 'Deductions', 'Net'],
    [
      ...d.byDepartment.map((g) => line('Department', g)),
      ...d.byLocation.map((g) => line('Location', g)),
      [
        'TOTAL',
        '',
        d.approvedRecords,
        d.currency,
        minorToDecimal(d.totals.basic),
        minorToDecimal(d.totals.otherEarnings),
        minorToDecimal(d.totals.gross),
        minorToDecimal(d.totals.deductions),
        minorToDecimal(d.totals.net),
      ],
    ],
  );
}

/* ------------------------------------------------------------------ */
/* Salaries journal                                                   */
/* ------------------------------------------------------------------ */

async function journalData(tx: Tx, periodId: string) {
  const period = await requirePeriod(tx, periodId);
  const rows = await approvedRows(tx, periodId);
  const items = await itemsFor(
    tx,
    rows.map((r) => r.recordId),
  );
  const lines: {
    account: string;
    costCentre: string | null;
    debit: number;
    credit: number;
  }[] = [];
  const depts = allocate(rows, (r) => ({
    id: r.departmentId,
    name: r.departmentName,
  }));
  for (const d of depts) {
    const recordIds = new Set(rows.filter((r) => r.departmentId === d.id).map((r) => r.recordId));
    const earnings = categoryTotals(
      items.filter((i) => i.kind === 'earning' && recordIds.has(i.recordId)),
      EARNING_CATEGORIES,
    );
    lines.push({
      account: ACCOUNT_NAMES.basic,
      costCentre: d.name,
      debit: d.basic,
      credit: 0,
    });
    for (const c of EARNING_CATEGORIES)
      if (earnings[c] > 0)
        lines.push({
          account: ACCOUNT_NAMES[c],
          costCentre: d.name,
          debit: earnings[c],
          credit: 0,
        });
  }
  const deductions = categoryTotals(
    items.filter((i) => i.kind === 'deduction'),
    DEDUCTION_CATEGORIES,
  );
  for (const c of DEDUCTION_CATEGORIES)
    if (deductions[c] > 0)
      lines.push({
        account: ACCOUNT_NAMES[c],
        costCentre: null,
        debit: 0,
        credit: deductions[c],
      });
  const net = sumBy(rows, (r) => r.netPay);
  if (rows.length)
    lines.push({
      account: ACCOUNT_NAMES.net,
      costCentre: null,
      debit: 0,
      credit: net,
    });
  const debit = sumBy(lines, (l) => l.debit);
  const credit = sumBy(lines, (l) => l.credit);
  return {
    period,
    currency: await currencyFor(tx, rows),
    approvedRecords: rows.length,
    lines,
    totals: { debit, credit },
    balanced: debit === credit,
  };
}

export async function periodJournal(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.read', 'report.finance');
  return journalData(ctx.db, periodId);
}

export async function periodJournalCsv(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.export');
  const d = await journalData(ctx.db, periodId);
  await audit(ctx.db, ctx, {
    action: 'payroll.export',
    targetType: 'payroll_period',
    targetId: periodId,
    newValues: { kind: 'journal', rows: d.lines.length },
  });
  return toCsv(
    ['Period', 'Account', 'Cost centre', 'Currency', 'Debit', 'Credit'],
    [
      ...d.lines.map((l) => [d.period.code, l.account, l.costCentre, d.currency, minorToDecimal(l.debit), minorToDecimal(l.credit)]),
      [d.period.code, 'TOTAL', '', d.currency, minorToDecimal(d.totals.debit), minorToDecimal(d.totals.credit)],
    ],
  );
}

/* ------------------------------------------------------------------ */
/* Variance against the previous period                              */
/* ------------------------------------------------------------------ */

const varianceQuery = z.object({
  threshold: z.coerce.number().int().min(1).max(100).default(10),
});

export type VarianceFlag = 'new' | 'missing' | 'left' | 'increase' | 'decrease' | null;

export async function periodVariance(ctx: Ctx, periodId: string, query: unknown) {
  requirePerm(ctx, 'payroll.read', 'report.finance');
  const q = parse(varianceQuery, query);
  const period = await requirePeriod(ctx.db, periodId);
  const [previous] = await ctx.db.select().from(payrollPeriods).where(lt(payrollPeriods.startDate, period.startDate)).orderBy(desc(payrollPeriods.startDate)).limit(1);
  const liveRows = await recordRows(ctx.db)
    .where(and(eq(payrollRecords.periodId, periodId), inArray(payrollRecords.status, [...LIVE])))
    .orderBy(asc(employees.legalName), desc(payrollRecords.revision));
  // Several revisions can coexist while an adjustment is in progress; the latest one is what will be paid.
  const current = new Map<string, RecordRow>();
  for (const r of liveRows) if (!current.has(r.employeeId)) current.set(r.employeeId, r);
  const prevRows = previous ? await approvedRows(ctx.db, previous.id) : [];
  const prev = new Map(prevRows.map((r) => [r.employeeId, r]));
  const stillEmployed = new Set((await ctx.db.select({ id: employees.id }).from(employees).where(currentEmployee())).map((e) => e.id));

  const ids = new Set([...current.keys(), ...prev.keys()]);
  const items = [...ids].map((employeeId) => {
    const c = current.get(employeeId) ?? null;
    const p = prev.get(employeeId) ?? null;
    const who = (c ?? p)!;
    const currentNet = c?.netPay ?? null;
    const previousNet = p?.netPay ?? null;
    const deltaNet = c && p ? c.netPay - p.netPay : null;
    const pct = c && p && p.netPay > 0 ? Math.round((deltaNet! / p.netPay) * 1000) / 10 : null;
    let flag: VarianceFlag = null;
    if (!p) flag = 'new';
    else if (!c) flag = stillEmployed.has(employeeId) ? 'missing' : 'left';
    else if (pct !== null && Math.abs(pct) >= q.threshold) flag = deltaNet! > 0 ? 'increase' : 'decrease';
    else if (pct === null && deltaNet !== null && deltaNet !== 0) flag = deltaNet > 0 ? 'increase' : 'decrease';
    return {
      employeeId,
      legalName: who.legalName,
      employmentNumber: who.employmentNumber,
      departmentName: who.departmentName,
      currentRecordId: c?.recordId ?? null,
      currentStatus: c?.status ?? null,
      currentGross: c?.grossEarnings ?? null,
      currentNet,
      previousGross: p?.grossEarnings ?? null,
      previousNet,
      deltaNet,
      pct,
      flag,
    };
  });
  items.sort((a, b) => Number(!!b.flag) - Number(!!a.flag) || a.legalName.localeCompare(b.legalName));
  const sumNet = (rows: RecordRow[]) => sumBy(rows, (r) => r.netPay);
  const currentList = [...current.values()];
  return {
    period,
    previous: previous ?? null,
    currency: await currencyFor(ctx.db, currentList.length ? currentList : prevRows),
    threshold: q.threshold,
    summary: {
      current: {
        records: currentList.length,
        net: sumNet(currentList),
        gross: sumBy(currentList, (r) => r.grossEarnings),
      },
      previous: {
        records: prevRows.length,
        net: sumNet(prevRows),
        gross: sumBy(prevRows, (r) => r.grossEarnings),
      },
      deltaNet: sumNet(currentList) - sumNet(prevRows),
      flagged: items.filter((i) => i.flag).length,
    },
    items,
  };
}

/* ------------------------------------------------------------------ */
/* Payment run                                                        */
/* ------------------------------------------------------------------ */

/** Marks every approved, unpaid record in the period as paid on one date, so the pay run is recorded once. */
export async function markPeriodPaid(ctx: Ctx, periodId: string, input: unknown) {
  requirePerm(ctx, 'payroll.prepare');
  const body = parse(z.object({ paymentDate: zDate, departmentId: zUuid.optional() }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    await requirePeriod(tx, periodId);
    const conds: SQL[] = [eq(payrollRecords.periodId, periodId), eq(payrollRecords.status, 'approved'), eq(payrollRecords.paymentStatus, 'unpaid')];
    if (body.departmentId) conds.push(eq(employees.departmentId, body.departmentId));
    const due = await tx
      .select({ id: payrollRecords.id, netPay: payrollRecords.netPay })
      .from(payrollRecords)
      .innerJoin(employees, eq(employees.id, payrollRecords.employeeId))
      .where(and(...conds))
      .for('update', { of: payrollRecords });
    if (!due.length) throw conflict('No approved records are awaiting payment');
    const ids = due.map((r) => r.id);
    await tx
      .update(payrollRecords)
      .set({
        paymentStatus: 'paid',
        paymentDate: body.paymentDate,
        updatedAt: ctx.now(),
      })
      .where(inArray(payrollRecords.id, ids));
    const netPay = sumBy(due, (r) => r.netPay);
    await audit(tx, ctx, {
      action: 'payroll.pay_run',
      targetType: 'payroll_period',
      targetId: periodId,
      newValues: {
        paymentDate: body.paymentDate,
        departmentId: body.departmentId ?? null,
        records: ids.length,
        netPay,
        recordIds: ids,
      },
    });
    return { paid: ids.length, netPay, paymentDate: body.paymentDate };
  });
}

/* ------------------------------------------------------------------ */
/* Detailed register                                                  */
/* ------------------------------------------------------------------ */

/** One row per live record with every earning and deduction category in its own column. */
export async function periodRegisterCsv(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.export');
  const period = await requirePeriod(ctx.db, periodId);
  const rows = await recordRows(ctx.db)
    .where(and(eq(payrollRecords.periodId, periodId), inArray(payrollRecords.status, [...LIVE])))
    .orderBy(asc(employees.legalName), desc(payrollRecords.revision));
  const items = await itemsFor(
    ctx.db,
    rows.map((r) => r.recordId),
  );
  await audit(ctx.db, ctx, {
    action: 'payroll.export',
    targetType: 'payroll_period',
    targetId: periodId,
    newValues: { kind: 'register', rows: rows.length },
  });
  return toCsv(
    [
      'Period',
      'Employment number',
      'Name',
      'Department',
      'Location',
      'Revision',
      'Status',
      'Currency',
      'Basic',
      'Allowances',
      'Bonuses',
      'Overtime',
      'Other earnings',
      'Gross',
      'Tax',
      'Pension',
      'Loans',
      'Other deductions',
      'Total deductions',
      'Net',
      'Payment status',
      'Payment date',
      'Payslip number',
    ],
    rows.map((r) => {
      const mine = items.filter((i) => i.recordId === r.recordId);
      const e = categoryTotals(mine, EARNING_CATEGORIES);
      const d = categoryTotals(mine, DEDUCTION_CATEGORIES);
      return [
        period.code,
        r.employmentNumber,
        r.legalName,
        r.departmentName,
        r.locationName,
        r.revision,
        r.status,
        r.currency,
        minorToDecimal(r.basicSalary),
        ...EARNING_CATEGORIES.map((c) => minorToDecimal(e[c])),
        minorToDecimal(r.grossEarnings),
        ...DEDUCTION_CATEGORIES.map((c) => minorToDecimal(d[c])),
        minorToDecimal(r.totalDeductions),
        minorToDecimal(r.netPay),
        r.paymentStatus,
        r.paymentDate,
        r.payslipNumber,
      ];
    }),
  );
}
