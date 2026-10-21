import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  approvalRequests,
  departments,
  employees,
  jobTitles,
  payrollLineItems,
  payrollPeriods,
  payrollRecords,
  payslips,
  retirementReviews,
  retirementSettlements,
  users,
  workLocations,
} from '../db/schema';
import type { Tx } from '../db/client';
import type { AuthedCtx, Ctx } from '../context';
import { deniedRecord, has, hasAny, requireActor, requirePerm } from '../authz/policy';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { parse, zDate, zMoney, zOptDate, zOptText, zPage, zTrim, zUuid } from '../lib/validate';
import { toCsv, minorToDecimal } from '../lib/csv';
import { audit } from './audit';
import { notify, usersWithPermission } from './notifications';
import { getSetting, getSettings } from './settings';

const EARNING_CATEGORIES = ['allowance', 'bonus', 'overtime', 'other_earning'] as const;
const DEDUCTION_CATEGORIES = ['tax', 'pension', 'loan', 'other_deduction'] as const;

const lineItemSchema = z
  .object({
    kind: z.enum(['earning', 'deduction']),
    category: z.enum([...EARNING_CATEGORIES, ...DEDUCTION_CATEGORIES]),
    label: zTrim(120),
    amount: zMoney,
  })
  .strict()
  .refine((li) => (li.kind === 'earning' ? (EARNING_CATEGORIES as readonly string[]).includes(li.category) : (DEDUCTION_CATEGORIES as readonly string[]).includes(li.category)), {
    message: 'Category does not match line item kind',
    path: ['category'],
  });

const recordBody = {
  basicSalary: zMoney,
  lineItems: z.array(lineItemSchema).max(50).default([]),
  notes: zOptText(1000),
  paymentDate: zOptDate,
};

type LineItemInput = z.infer<typeof lineItemSchema>;

/** Totals are always computed server-side from integer minor units; client totals are ignored. */
export function computeTotals(basicSalary: number, items: LineItemInput[]) {
  const earnings = items.filter((i) => i.kind === 'earning').reduce((s, i) => s + i.amount, 0);
  const totalDeductions = items.filter((i) => i.kind === 'deduction').reduce((s, i) => s + i.amount, 0);
  const grossEarnings = basicSalary + earnings;
  const netPay = grossEarnings - totalDeductions;
  if (!Number.isSafeInteger(grossEarnings) || !Number.isSafeInteger(totalDeductions)) throw badRequest('Amounts are too large');
  if (netPay < 0) throw badRequest('Validation failed', { fields: { lineItems: 'Deductions cannot exceed gross earnings' } });
  return { grossEarnings, totalDeductions, netPay };
}

function requirePayrollRead(ctx: Ctx): asserts ctx is AuthedCtx {
  requirePerm(ctx, 'payroll.read');
}

async function loadRecord(tx: Tx, id: string, lock = false) {
  if (!z.uuid().safeParse(id).success) return null;
  const q = tx.select().from(payrollRecords).where(eq(payrollRecords.id, id));
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

async function loadPeriod(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await tx.select().from(payrollPeriods).where(eq(payrollPeriods.id, id));
  return row ?? null;
}

/* ------------------------------------------------------------------ */
/* Periods                                                            */
/* ------------------------------------------------------------------ */

export async function listPeriods(ctx: Ctx) {
  requirePerm(ctx, 'payroll.read', 'report.finance');
  const rows = await ctx.db.select().from(payrollPeriods).orderBy(desc(payrollPeriods.startDate));
  const stats = await ctx.db
    .select({
      periodId: payrollRecords.periodId,
      status: payrollRecords.status,
      n: sql<number>`count(*)::int`,
      net: sql<string>`coalesce(sum(${payrollRecords.netPay}),0)`,
    })
    .from(payrollRecords)
    .groupBy(payrollRecords.periodId, payrollRecords.status);
  return rows.map((p) => {
    const s = stats.filter((x) => x.periodId === p.id);
    const by = (st: string) => s.find((x) => x.status === st)?.n ?? 0;
    return {
      ...p,
      counts: { draft: by('draft'), pending: by('pending_approval'), approved: by('approved') },
      approvedNet: Number(s.find((x) => x.status === 'approved')?.net ?? 0),
    };
  });
}

const periodInput = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/, '3-20 letters, numbers or hyphens'),
    name: zTrim(80),
    startDate: zDate,
    endDate: zDate,
    payDate: zDate,
  })
  .strict();

export async function createPeriod(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'payroll.period.manage');
  const body = parse(periodInput, input);
  if (body.endDate < body.startDate) throw badRequest('Validation failed', { fields: { endDate: 'End date must be on or after the start date' } });
  return ctx.db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: payrollPeriods.id }).from(payrollPeriods).where(eq(payrollPeriods.code, body.code));
    if (dup) throw conflict('A payroll period with that code already exists');
    const [p] = await tx.insert(payrollPeriods).values({ ...body, createdBy: ctx.actor.userId }).returning();
    await audit(tx, ctx, { action: 'payroll.period_create', targetType: 'payroll_period', targetId: p.id, newValues: body });
    return p;
  });
}

export async function closePeriod(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'payroll.period.manage');
  const body = parse(z.object({ reason: zOptText(500) }).strict(), input ?? {});
  return ctx.db.transaction(async (tx) => {
    const p = await loadPeriod(tx, id);
    if (!p) throw notFound('Payroll period not found');
    if (p.status === 'closed') throw conflict('Period already closed');
    const [{ open }] = await tx
      .select({ open: sql<number>`count(*)::int` })
      .from(payrollRecords)
      .where(and(eq(payrollRecords.periodId, id), inArray(payrollRecords.status, ['draft', 'pending_approval'])));
    if (open > 0) throw conflict(`${open} payroll record(s) are still draft or awaiting approval`);
    await tx.update(payrollPeriods).set({ status: 'closed' }).where(eq(payrollPeriods.id, id));
    await audit(tx, ctx, { action: 'payroll.period_close', targetType: 'payroll_period', targetId: id, reason: body.reason });
    return { status: 'closed' };
  });
}

/* ------------------------------------------------------------------ */
/* Records                                                            */
/* ------------------------------------------------------------------ */

const recordListQuery = zPage.extend({
  q: z.string().trim().max(100).optional(),
  departmentId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  status: z.enum(['draft', 'pending_approval', 'approved', 'superseded', 'all_live']).default('all_live'),
  paymentStatus: z.enum(['unpaid', 'paid']).optional(),
});

function recordsBase(tx: Tx) {
  return tx
    .select({
      id: payrollRecords.id,
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
      preparedBy: payrollRecords.preparedBy,
      approvedBy: payrollRecords.approvedBy,
      updatedAt: payrollRecords.updatedAt,
      employeeId: employees.id,
      legalName: employees.legalName,
      employmentNumber: employees.employmentNumber,
      departmentName: departments.name,
      locationName: workLocations.name,
      payslipId: payslips.id,
    })
    .from(payrollRecords)
    .innerJoin(employees, eq(employees.id, payrollRecords.employeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(workLocations, eq(workLocations.id, employees.locationId))
    .leftJoin(payslips, eq(payslips.payrollRecordId, payrollRecords.id));
}

export async function listRecords(ctx: Ctx, periodId: string, query: unknown) {
  requirePayrollRead(ctx);
  const q = parse(recordListQuery, query);
  const period = await loadPeriod(ctx.db, periodId);
  if (!period) throw notFound('Payroll period not found');
  const conds: SQL[] = [eq(payrollRecords.periodId, periodId)];
  if (q.status === 'all_live') conds.push(inArray(payrollRecords.status, ['draft', 'pending_approval', 'approved']));
  else conds.push(eq(payrollRecords.status, q.status));
  if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
  if (q.locationId) conds.push(eq(employees.locationId, q.locationId));
  if (q.paymentStatus) conds.push(eq(payrollRecords.paymentStatus, q.paymentStatus));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(or(ilike(employees.legalName, like), ilike(employees.employmentNumber, like))!);
  }
  const where = and(...conds);
  const [items, [{ total }], [totals]] = await Promise.all([
    recordsBase(ctx.db).where(where).orderBy(asc(employees.legalName), desc(payrollRecords.revision)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql<number>`count(*)::int` }).from(payrollRecords).innerJoin(employees, eq(employees.id, payrollRecords.employeeId)).where(where),
    ctx.db
      .select({
        gross: sql<string>`coalesce(sum(${payrollRecords.grossEarnings}),0)`,
        deductions: sql<string>`coalesce(sum(${payrollRecords.totalDeductions}),0)`,
        net: sql<string>`coalesce(sum(${payrollRecords.netPay}),0)`,
      })
      .from(payrollRecords)
      .innerJoin(employees, eq(employees.id, payrollRecords.employeeId))
      .where(where),
  ]);
  return {
    period,
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    totals: { gross: Number(totals.gross), deductions: Number(totals.deductions), net: Number(totals.net) },
  };
}

export async function getRecord(ctx: Ctx, id: string) {
  requireActor(ctx);
  const rec = await loadRecord(ctx.db, id);
  if (!rec) throw deniedRecord('Payroll record');
  const [emp] = await ctx.db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, rec.employeeId));
  const own = !!emp?.userId && emp.userId === ctx.actor.userId;
  const finance = has(ctx.actor, 'payroll.read');
  if (!finance && !(own && ['approved', 'superseded'].includes(rec.status))) throw deniedRecord('Payroll record');
  const [row] = await recordsBase(ctx.db).where(eq(payrollRecords.id, id));
  const [items, period, revisions, people] = await Promise.all([
    ctx.db.select().from(payrollLineItems).where(eq(payrollLineItems.recordId, id)).orderBy(asc(payrollLineItems.sortOrder)),
    loadPeriod(ctx.db, rec.periodId),
    ctx.db
      .select({ id: payrollRecords.id, revision: payrollRecords.revision, status: payrollRecords.status, netPay: payrollRecords.netPay, adjustmentReason: payrollRecords.adjustmentReason })
      .from(payrollRecords)
      .where(and(eq(payrollRecords.employeeId, rec.employeeId), eq(payrollRecords.periodId, rec.periodId)))
      .orderBy(asc(payrollRecords.revision)),
    ctx.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, [rec.preparedBy, rec.approvedBy].filter((x): x is string => !!x))),
  ]);
  const name = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  const requireSecond = await getSetting(ctx.db, 'payroll.require_second_approval');
  const selfRecord = !!ctx.actor.employeeId && ctx.actor.employeeId === rec.employeeId;
  return {
    ...row,
    notes: finance ? rec.notes : null,
    adjustmentReason: rec.adjustmentReason,
    discrepancyNote: finance ? rec.discrepancyNote : null,
    supersedesId: rec.supersedesId,
    submittedAt: rec.submittedAt,
    approvedAt: rec.approvedAt,
    preparedByName: finance ? name(rec.preparedBy) : null,
    approvedByName: finance ? name(rec.approvedBy) : null,
    period,
    lineItems: items,
    revisions: finance ? revisions : revisions.filter((r) => ['approved', 'superseded'].includes(r.status)),
    can: {
      edit: has(ctx.actor, 'payroll.prepare') && rec.status === 'draft' && !selfRecord,
      submit: has(ctx.actor, 'payroll.prepare') && rec.status === 'draft' && !selfRecord,
      approve:
        has(ctx.actor, 'payroll.approve') && rec.status === 'pending_approval' && !selfRecord && (!requireSecond || rec.preparedBy !== ctx.actor.userId),
      adjust: has(ctx.actor, 'payroll.prepare') && rec.status === 'approved' && !selfRecord,
      markPaid: has(ctx.actor, 'payroll.prepare') && rec.status === 'approved' && rec.paymentStatus === 'unpaid',
      issuePayslip: has(ctx.actor, 'payroll.prepare') && rec.status === 'approved' && !row.payslipId,
      delete: has(ctx.actor, 'payroll.prepare') && rec.status === 'draft',
    },
  };
}

async function assertPreparable(tx: Tx, ctx: AuthedCtx, employeeId: string) {
  if (ctx.actor.employeeId === employeeId) throw forbidden('You cannot prepare your own payroll record');
  const [emp] = await tx.select().from(employees).where(eq(employees.id, employeeId));
  if (!emp) throw badRequest('Validation failed', { fields: { employeeId: 'Unknown employee' } });
  if (!emp.employmentNumber || emp.archivedAt || !['active', 'on_leave', 'suspended'].includes(emp.employmentStatus)) {
    throw badRequest('Validation failed', { fields: { employeeId: 'Payroll can only be prepared for verified, current employees' } });
  }
  return emp;
}

async function writeItems(tx: Tx, recordId: string, items: LineItemInput[]) {
  await tx.delete(payrollLineItems).where(eq(payrollLineItems.recordId, recordId));
  if (items.length) {
    await tx.insert(payrollLineItems).values(items.map((li, i) => ({ ...li, recordId, sortOrder: i })));
  }
}

export async function createRecord(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'payroll.prepare');
  const body = parse(z.object({ employeeId: zUuid, periodId: zUuid, ...recordBody }).strict(), input);
  const totals = computeTotals(body.basicSalary, body.lineItems);
  return ctx.db.transaction(async (tx) => {
    const period = await loadPeriod(tx, body.periodId);
    if (!period) throw badRequest('Validation failed', { fields: { periodId: 'Unknown payroll period' } });
    if (period.status === 'closed') throw conflict('This payroll period is closed');
    await assertPreparable(tx, ctx, body.employeeId);
    const [existing] = await tx
      .select({ id: payrollRecords.id })
      .from(payrollRecords)
      .where(and(eq(payrollRecords.employeeId, body.employeeId), eq(payrollRecords.periodId, body.periodId)));
    if (existing) throw conflict('A payroll record already exists for this employee and period. Use an adjustment to correct it.');
    const currency = await getSetting(tx, 'org.currency');
    const [rec] = await tx
      .insert(payrollRecords)
      .values({
        employeeId: body.employeeId,
        periodId: body.periodId,
        currency,
        basicSalary: body.basicSalary,
        ...totals,
        notes: body.notes,
        paymentDate: body.paymentDate ?? period.payDate,
        preparedBy: ctx.actor.userId,
      })
      .returning();
    await writeItems(tx, rec.id, body.lineItems);
    await audit(tx, ctx, {
      action: 'payroll.record_create',
      targetType: 'payroll_record',
      targetId: rec.id,
      newValues: { employeeId: body.employeeId, periodId: body.periodId, basicSalary: body.basicSalary, ...totals, items: body.lineItems.length },
    });
    return { id: rec.id };
  });
}

export async function updateRecord(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'payroll.prepare');
  const body = parse(z.object({ ...recordBody, discrepancyFlag: z.boolean().optional(), discrepancyNote: zOptText(500) }).strict(), input);
  const totals = computeTotals(body.basicSalary, body.lineItems);
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound('Payroll record not found');
    if (rec.status !== 'draft') throw conflict('Only draft records can be edited');
    await assertPreparable(tx, ctx, rec.employeeId);
    await tx
      .update(payrollRecords)
      .set({
        basicSalary: body.basicSalary,
        ...totals,
        notes: body.notes,
        paymentDate: body.paymentDate ?? rec.paymentDate,
        discrepancyFlag: body.discrepancyFlag ?? rec.discrepancyFlag,
        discrepancyNote: body.discrepancyNote ?? rec.discrepancyNote,
        preparedBy: ctx.actor.userId,
        updatedAt: ctx.now(),
      })
      .where(eq(payrollRecords.id, id));
    await writeItems(tx, id, body.lineItems);
    await audit(tx, ctx, {
      action: 'payroll.record_update',
      targetType: 'payroll_record',
      targetId: id,
      oldValues: { basicSalary: rec.basicSalary, grossEarnings: rec.grossEarnings, totalDeductions: rec.totalDeductions, netPay: rec.netPay },
      newValues: { basicSalary: body.basicSalary, ...totals, discrepancyFlag: body.discrepancyFlag },
    });
    return { id };
  });
}

export async function deleteDraft(ctx: Ctx, id: string) {
  requirePerm(ctx, 'payroll.prepare');
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound('Payroll record not found');
    if (rec.status !== 'draft') throw conflict('Only draft records can be deleted');
    await tx.delete(payrollRecords).where(eq(payrollRecords.id, id));
    await audit(tx, ctx, { action: 'payroll.record_delete_draft', targetType: 'payroll_record', targetId: id, oldValues: { employeeId: rec.employeeId, revision: rec.revision, netPay: rec.netPay } });
    return { deleted: true };
  });
}

export async function submitRecord(ctx: Ctx, id: string) {
  requirePerm(ctx, 'payroll.prepare');
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound('Payroll record not found');
    if (rec.status !== 'draft') throw conflict('Only draft records can be submitted');
    const emp = await assertPreparable(tx, ctx, rec.employeeId);
    const [approval] = await tx
      .insert(approvalRequests)
      .values({
        type: 'payroll_record',
        targetType: 'payroll_record',
        targetId: id,
        departmentId: emp.departmentId,
        summary: `Payroll for ${emp.legalName}${rec.revision > 1 ? ` (revision ${rec.revision})` : ''}`,
        payload: { revision: rec.revision, periodId: rec.periodId },
        reason: rec.adjustmentReason,
        requiredPermission: 'payroll.approve',
        requestedBy: ctx.actor.userId,
      })
      .returning({ id: approvalRequests.id });
    await tx.update(payrollRecords).set({ status: 'pending_approval', submittedAt: ctx.now(), approvalId: approval.id, updatedAt: ctx.now() }).where(eq(payrollRecords.id, id));
    await audit(tx, ctx, { action: 'payroll.record_submit', targetType: 'payroll_record', targetId: id, approvalId: approval.id });
    const approvers = (await usersWithPermission(tx, 'payroll.approve')).filter((u) => u !== ctx.actor.userId);
    await notify(tx, approvers, {
      type: 'approval.pending',
      title: 'Payroll record awaiting approval',
      body: `A payroll record for ${emp.legalName} was submitted for approval.`,
      link: `/finance/records/${id}`,
      dedupeKey: `approval:${approval.id}`,
    });
    return { status: 'pending_approval', approvalId: approval.id };
  });
}

export async function approveRecord(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'payroll.approve');
  const body = parse(z.object({ reason: zOptText(500) }).strict(), input ?? {});
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound('Payroll record not found');
    if (rec.status !== 'pending_approval') throw conflict('Record is not awaiting approval');
    if (ctx.actor.employeeId === rec.employeeId) throw forbidden('You cannot approve your own payroll record');
    const requireSecond = await getSetting(tx, 'payroll.require_second_approval');
    if (requireSecond && rec.preparedBy === ctx.actor.userId) {
      throw forbidden('Second-person approval is required: you prepared this record');
    }
    if (rec.supersedesId) {
      await tx.update(payrollRecords).set({ status: 'superseded', updatedAt: ctx.now() }).where(eq(payrollRecords.id, rec.supersedesId));
    }
    await tx
      .update(payrollRecords)
      .set({ status: 'approved', approvedBy: ctx.actor.userId, approvedAt: ctx.now(), updatedAt: ctx.now() })
      .where(eq(payrollRecords.id, id));
    if (rec.approvalId) {
      await tx
        .update(approvalRequests)
        .set({ status: 'approved', decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason })
        .where(and(eq(approvalRequests.id, rec.approvalId), eq(approvalRequests.status, 'pending')));
    }
    await audit(tx, ctx, {
      action: rec.supersedesId ? 'payroll.adjustment_approve' : 'payroll.record_approve',
      targetType: 'payroll_record',
      targetId: id,
      newValues: { netPay: rec.netPay, revision: rec.revision, supersedes: rec.supersedesId },
      reason: body.reason,
      approvalId: rec.approvalId,
    });
    await notify(tx, [rec.preparedBy], {
      type: 'payroll.approved',
      title: 'Payroll record approved',
      link: `/finance/records/${id}`,
      dedupeKey: `payroll-approved:${id}`,
    });
    return { status: 'approved' };
  });
}

export async function rejectRecord(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'payroll.approve');
  const body = parse(z.object({ reason: zTrim(500, 3) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound('Payroll record not found');
    if (rec.status !== 'pending_approval') throw conflict('Record is not awaiting approval');
    await tx
      .update(payrollRecords)
      .set({ status: 'draft', submittedAt: null, approvalId: null, discrepancyFlag: true, discrepancyNote: `Returned: ${body.reason}`, updatedAt: ctx.now() })
      .where(eq(payrollRecords.id, id));
    if (rec.approvalId) {
      await tx
        .update(approvalRequests)
        .set({ status: 'rejected', decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason })
        .where(eq(approvalRequests.id, rec.approvalId));
    }
    await audit(tx, ctx, { action: 'payroll.record_reject', targetType: 'payroll_record', targetId: id, reason: body.reason, approvalId: rec.approvalId });
    await notify(tx, [rec.preparedBy], { type: 'payroll.returned', title: 'Payroll record returned for correction', link: `/finance/records/${id}` });
    return { status: 'draft' };
  });
}

/** Corrections to approved payroll create a new draft revision; the original stays intact until the revision is approved. */
export async function adjustRecord(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'payroll.prepare');
  const body = parse(z.object({ reason: zTrim(500, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound('Payroll record not found');
    if (rec.status !== 'approved') throw conflict('Only approved records can be adjusted');
    await assertPreparable(tx, ctx, rec.employeeId);
    const [open] = await tx
      .select({ id: payrollRecords.id })
      .from(payrollRecords)
      .where(and(eq(payrollRecords.employeeId, rec.employeeId), eq(payrollRecords.periodId, rec.periodId), inArray(payrollRecords.status, ['draft', 'pending_approval'])));
    if (open) throw conflict('An adjustment for this record is already in progress');
    const [{ maxRev }] = await tx
      .select({ maxRev: sql<number>`max(${payrollRecords.revision})::int` })
      .from(payrollRecords)
      .where(and(eq(payrollRecords.employeeId, rec.employeeId), eq(payrollRecords.periodId, rec.periodId)));
    const items = await tx.select().from(payrollLineItems).where(eq(payrollLineItems.recordId, id)).orderBy(asc(payrollLineItems.sortOrder));
    const [rev] = await tx
      .insert(payrollRecords)
      .values({
        employeeId: rec.employeeId,
        periodId: rec.periodId,
        revision: maxRev + 1,
        supersedesId: rec.id,
        currency: rec.currency,
        basicSalary: rec.basicSalary,
        grossEarnings: rec.grossEarnings,
        totalDeductions: rec.totalDeductions,
        netPay: rec.netPay,
        paymentDate: rec.paymentDate,
        notes: rec.notes,
        adjustmentReason: body.reason,
        preparedBy: ctx.actor.userId,
      })
      .returning();
    await writeItems(tx, rev.id, items.map((i) => ({ kind: i.kind as 'earning', category: i.category as 'allowance', label: i.label, amount: i.amount })));
    await audit(tx, ctx, { action: 'payroll.adjustment_create', targetType: 'payroll_record', targetId: rev.id, newValues: { supersedes: rec.id, revision: rev.revision }, reason: body.reason });
    return { id: rev.id };
  });
}

export async function markPaid(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'payroll.prepare');
  const body = parse(z.object({ paymentDate: zDate }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound('Payroll record not found');
    if (rec.status !== 'approved') throw conflict('Only approved records can be marked as paid');
    if (rec.paymentStatus === 'paid') throw conflict('Already marked as paid');
    await tx.update(payrollRecords).set({ paymentStatus: 'paid', paymentDate: body.paymentDate, updatedAt: ctx.now() }).where(eq(payrollRecords.id, id));
    await audit(tx, ctx, { action: 'payroll.mark_paid', targetType: 'payroll_record', targetId: id, newValues: { paymentDate: body.paymentDate } });
    return { paymentStatus: 'paid' };
  });
}

/** Creates draft records for current employees from their most recent approved pay structure. */
export async function generateDrafts(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.prepare');
  return ctx.db.transaction(async (tx) => {
    const period = await loadPeriod(tx, periodId);
    if (!period) throw notFound('Payroll period not found');
    if (period.status === 'closed') throw conflict('This payroll period is closed');
    const currency = await getSetting(tx, 'org.currency');
    const candidates = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          isNull(employees.archivedAt),
          inArray(employees.employmentStatus, ['active', 'on_leave']),
          sql`${employees.employmentNumber} is not null`,
          sql`not exists (select 1 from ${payrollRecords} pr where pr.employee_id = ${employees.id} and pr.period_id = ${periodId})`,
        ),
      );
    let created = 0;
    let skipped = 0;
    for (const c of candidates) {
      if (c.id === ctx.actor.employeeId) {
        skipped++;
        continue;
      }
      const [prev] = await tx
        .select()
        .from(payrollRecords)
        .where(and(eq(payrollRecords.employeeId, c.id), eq(payrollRecords.status, 'approved')))
        .orderBy(desc(payrollRecords.approvedAt))
        .limit(1);
      if (!prev) {
        skipped++;
        continue;
      }
      const items = await tx.select().from(payrollLineItems).where(eq(payrollLineItems.recordId, prev.id));
      // Carry forward recurring components only; one-off bonuses and overtime are not repeated.
      const recurring = items.filter((i) => !['bonus', 'overtime'].includes(i.category));
      const li = recurring.map((i) => ({ kind: i.kind as 'earning', category: i.category as 'allowance', label: i.label, amount: i.amount }));
      const totals = computeTotals(prev.basicSalary, li);
      const [rec] = await tx
        .insert(payrollRecords)
        .values({ employeeId: c.id, periodId, currency, basicSalary: prev.basicSalary, ...totals, paymentDate: period.payDate, preparedBy: ctx.actor.userId })
        .returning();
      await writeItems(tx, rec.id, li);
      created++;
    }
    await audit(tx, ctx, { action: 'payroll.generate_drafts', targetType: 'payroll_period', targetId: periodId, newValues: { created, skipped } });
    return { created, skipped };
  });
}

/* ------------------------------------------------------------------ */
/* Payslips                                                           */
/* ------------------------------------------------------------------ */

async function issuePayslipTx(tx: Tx, ctx: AuthedCtx, recordId: string) {
  const rec = await loadRecord(tx, recordId, true);
  if (!rec) throw notFound('Payroll record not found');
  if (rec.status !== 'approved') throw conflict('Payslips can only be issued for approved records');
  const [existing] = await tx.select({ id: payslips.id }).from(payslips).where(eq(payslips.payrollRecordId, recordId));
  if (existing) return { id: existing.id, created: false };
  const [emp] = await tx
    .select({
      legalName: employees.legalName,
      employmentNumber: employees.employmentNumber,
      userId: employees.userId,
      departmentName: departments.name,
      jobTitleName: jobTitles.name,
    })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(jobTitles, eq(jobTitles.id, employees.jobTitleId))
    .where(eq(employees.id, rec.employeeId));
  const period = (await loadPeriod(tx, rec.periodId))!;
  const items = await tx.select().from(payrollLineItems).where(eq(payrollLineItems.recordId, recordId)).orderBy(asc(payrollLineItems.sortOrder));
  const settings = await getSettings(tx);
  const payslipNumber = `PS-${period.code}-${emp.employmentNumber}-R${rec.revision}`;
  const snapshot = {
    organization: { name: settings['org.name'], address: settings['org.address'], phone: settings['org.phone'], email: settings['org.email'] },
    employee: { name: emp.legalName, employmentNumber: emp.employmentNumber, department: emp.departmentName, jobTitle: emp.jobTitleName },
    period: { code: period.code, name: period.name, startDate: period.startDate, endDate: period.endDate },
    paymentDate: rec.paymentDate ?? period.payDate,
    paymentStatus: rec.paymentStatus,
    currency: rec.currency,
    revision: rec.revision,
    basicSalary: rec.basicSalary,
    earnings: items.filter((i) => i.kind === 'earning').map((i) => ({ label: i.label, category: i.category, amount: i.amount })),
    deductions: items.filter((i) => i.kind === 'deduction').map((i) => ({ label: i.label, category: i.category, amount: i.amount })),
    grossEarnings: rec.grossEarnings,
    totalDeductions: rec.totalDeductions,
    netPay: rec.netPay,
  };
  const [slip] = await tx.insert(payslips).values({ payslipNumber, payrollRecordId: recordId, employeeId: rec.employeeId, snapshot, issuedBy: ctx.actor.userId }).returning();
  await audit(tx, ctx, { action: 'payslip.issue', targetType: 'payslip', targetId: slip.id, newValues: { payslipNumber, recordId } });
  await notify(tx, [emp.userId], {
    type: 'payslip.available',
    title: `Your payslip for ${period.name} is available`,
    link: `/payslips/${slip.id}`,
    dedupeKey: `payslip:${slip.id}`,
  });
  return { id: slip.id, created: true };
}

export async function issuePayslip(ctx: Ctx, recordId: string) {
  requirePerm(ctx, 'payroll.prepare');
  return ctx.db.transaction((tx) => issuePayslipTx(tx, ctx as AuthedCtx, recordId));
}

export async function issuePayslipsForPeriod(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.prepare');
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: payrollRecords.id })
      .from(payrollRecords)
      .leftJoin(payslips, eq(payslips.payrollRecordId, payrollRecords.id))
      .where(and(eq(payrollRecords.periodId, periodId), eq(payrollRecords.status, 'approved'), isNull(payslips.id)));
    for (const r of rows) await issuePayslipTx(tx, ctx as AuthedCtx, r.id);
    return { issued: rows.length };
  });
}

export async function getPayslip(ctx: Ctx, id: string) {
  requireActor(ctx);
  if (!z.uuid().safeParse(id).success) throw deniedRecord('Payslip');
  const [slip] = await ctx.db
    .select({ slip: payslips, userId: employees.userId, recordStatus: payrollRecords.status, livePaymentStatus: payrollRecords.paymentStatus })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .innerJoin(payrollRecords, eq(payrollRecords.id, payslips.payrollRecordId))
    .where(eq(payslips.id, id));
  if (!slip) throw deniedRecord('Payslip');
  const own = !!slip.userId && slip.userId === ctx.actor.userId;
  if (!own && !has(ctx.actor, 'payroll.read')) throw deniedRecord('Payslip');
  if (!own) await audit(ctx.db, ctx, { action: 'payslip.view', targetType: 'payslip', targetId: id });
  return {
    id: slip.slip.id,
    payslipNumber: slip.slip.payslipNumber,
    issuedAt: slip.slip.issuedAt,
    payrollRecordId: slip.slip.payrollRecordId,
    superseded: slip.recordStatus === 'superseded',
    currentPaymentStatus: slip.livePaymentStatus,
    ...slip.slip.snapshot,
  };
}

/** Own payroll history: only finalised records are visible to the employee. */
export async function employeePayroll(ctx: Ctx, employeeId: string) {
  requireActor(ctx);
  const [emp] = z.uuid().safeParse(employeeId).success
    ? await ctx.db.select({ id: employees.id, userId: employees.userId }).from(employees).where(eq(employees.id, employeeId))
    : [];
  if (!emp) throw deniedRecord('Employee');
  const own = !!emp.userId && emp.userId === ctx.actor.userId;
  if (!own && !has(ctx.actor, 'payroll.read')) throw deniedRecord('Employee');
  const conds: SQL[] = [eq(payrollRecords.employeeId, employeeId)];
  if (!has(ctx.actor, 'payroll.read')) conds.push(inArray(payrollRecords.status, ['approved', 'superseded']));
  return ctx.db
    .select({
      id: payrollRecords.id,
      periodName: payrollPeriods.name,
      periodCode: payrollPeriods.code,
      startDate: payrollPeriods.startDate,
      revision: payrollRecords.revision,
      status: payrollRecords.status,
      currency: payrollRecords.currency,
      grossEarnings: payrollRecords.grossEarnings,
      totalDeductions: payrollRecords.totalDeductions,
      netPay: payrollRecords.netPay,
      paymentStatus: payrollRecords.paymentStatus,
      paymentDate: payrollRecords.paymentDate,
      payslipId: payslips.id,
    })
    .from(payrollRecords)
    .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRecords.periodId))
    .leftJoin(payslips, eq(payslips.payrollRecordId, payrollRecords.id))
    .where(and(...conds))
    .orderBy(desc(payrollPeriods.startDate), desc(payrollRecords.revision));
}

/* ------------------------------------------------------------------ */
/* Dashboard & exports                                                */
/* ------------------------------------------------------------------ */

export async function financeSummary(ctx: Ctx, query: unknown) {
  requirePerm(ctx, 'payroll.read', 'report.finance');
  const q = parse(z.object({ periodId: z.uuid().optional(), departmentId: z.uuid().optional(), locationId: z.uuid().optional() }), query);
  const empConds: SQL[] = [isNull(employees.archivedAt), inArray(employees.employmentStatus, ['active', 'on_leave'])];
  if (q.departmentId) empConds.push(eq(employees.departmentId, q.departmentId));
  if (q.locationId) empConds.push(eq(employees.locationId, q.locationId));
  const periods = await ctx.db.select().from(payrollPeriods).orderBy(desc(payrollPeriods.startDate)).limit(24);
  const period = q.periodId ? periods.find((p) => p.id === q.periodId) ?? (await loadPeriod(ctx.db, q.periodId)) : periods[0];

  const [[{ activeEmployees }], byDepartment, byLocation] = await Promise.all([
    ctx.db.select({ activeEmployees: sql<number>`count(*)::int` }).from(employees).where(and(...empConds)),
    ctx.db
      .select({ id: departments.id, name: departments.name, n: sql<number>`count(${employees.id})::int` })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(...empConds))
      .groupBy(departments.id, departments.name)
      .orderBy(departments.name),
    ctx.db
      .select({ id: workLocations.id, name: workLocations.name, n: sql<number>`count(${employees.id})::int` })
      .from(employees)
      .leftJoin(workLocations, eq(workLocations.id, employees.locationId))
      .where(and(...empConds))
      .groupBy(workLocations.id, workLocations.name)
      .orderBy(workLocations.name),
  ]);

  let payroll = null as null | Record<string, unknown>;
  if (period) {
    const recConds: SQL[] = [eq(payrollRecords.periodId, period.id), inArray(payrollRecords.status, ['draft', 'pending_approval', 'approved'])];
    if (q.departmentId) recConds.push(eq(employees.departmentId, q.departmentId));
    if (q.locationId) recConds.push(eq(employees.locationId, q.locationId));
    const rows = await ctx.db
      .select({
        status: payrollRecords.status,
        paid: sql<number>`count(*) filter (where ${payrollRecords.paymentStatus} = 'paid')::int`,
        n: sql<number>`count(*)::int`,
        gross: sql<string>`coalesce(sum(${payrollRecords.grossEarnings}),0)`,
        deductions: sql<string>`coalesce(sum(${payrollRecords.totalDeductions}),0)`,
        net: sql<string>`coalesce(sum(${payrollRecords.netPay}),0)`,
      })
      .from(payrollRecords)
      .innerJoin(employees, eq(employees.id, payrollRecords.employeeId))
      .where(and(...recConds))
      .groupBy(payrollRecords.status);
    const sum = (k: 'gross' | 'deductions' | 'net') => rows.reduce((s, r) => s + Number(r[k]), 0);
    const approved = rows.find((r) => r.status === 'approved');
    payroll = {
      period,
      records: rows.reduce((s, r) => s + r.n, 0),
      byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
      paid: approved?.paid ?? 0,
      gross: sum('gross'),
      deductions: sum('deductions'),
      net: sum('net'),
      approvedNet: Number(approved?.net ?? 0),
      missing: Math.max(0, activeEmployees - rows.reduce((s, r) => s + r.n, 0)),
    };
  }

  let retirement = null as null | Record<string, unknown>;
  if (hasAny(ctx.actor, ['retirement.read'])) {
    const [counts] = await ctx.db
      .select({
        upcoming: sql<number>`count(*) filter (where ${retirementReviews.status} = 'upcoming')::int`,
        reviewRequired: sql<number>`count(*) filter (where ${retirementReviews.status} = 'review_required')::int`,
        pendingApproval: sql<number>`count(*) filter (where ${retirementReviews.status} = 'pending_approval')::int`,
      })
      .from(retirementReviews);
    const [liability] = await ctx.db
      .select({
        verified: sql<string>`coalesce(sum(${retirementSettlements.totalAmount}) filter (where ${retirementSettlements.verificationStatus} = 'verified'),0)`,
        estimated: sql<string>`coalesce(sum(${retirementSettlements.totalAmount}) filter (where ${retirementSettlements.verificationStatus} in ('draft','submitted')),0)`,
      })
      .from(retirementSettlements)
      .innerJoin(retirementReviews, eq(retirementReviews.id, retirementSettlements.reviewId))
      .where(inArray(retirementReviews.status, ['upcoming', 'review_required', 'pending_approval', 'approved', 'deferred']));
    retirement = { ...counts, verifiedLiability: Number(liability.verified), estimatedLiability: Number(liability.estimated) };
  }
  const currency = await getSetting(ctx.db, 'org.currency');
  return { currency, activeEmployees, byDepartment, byLocation, periods, payroll, retirement };
}

export async function exportPeriodCsv(ctx: Ctx, periodId: string) {
  requirePerm(ctx, 'payroll.export');
  const period = await loadPeriod(ctx.db, periodId);
  if (!period) throw notFound('Payroll period not found');
  const rows = await recordsBase(ctx.db)
    .where(and(eq(payrollRecords.periodId, periodId), inArray(payrollRecords.status, ['draft', 'pending_approval', 'approved'])))
    .orderBy(asc(employees.legalName));
  await audit(ctx.db, ctx, { action: 'payroll.export', targetType: 'payroll_period', targetId: periodId, newValues: { rows: rows.length } });
  return toCsv(
    ['Employment number', 'Name', 'Department', 'Location', 'Revision', 'Status', 'Currency', 'Basic', 'Gross', 'Deductions', 'Net', 'Payment status', 'Payment date'],
    rows.map((r) => [
      r.employmentNumber, r.legalName, r.departmentName, r.locationName, r.revision, r.status, r.currency,
      minorToDecimal(r.basicSalary), minorToDecimal(r.grossEarnings), minorToDecimal(r.totalDeductions), minorToDecimal(r.netPay),
      r.paymentStatus, r.paymentDate,
    ]),
  );
}
