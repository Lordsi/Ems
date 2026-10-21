import { z } from 'zod';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  approvalRequests,
  auditLogs,
  departments,
  employees,
  employmentHistory,
  payrollPeriods,
  payrollRecords,
  retirementReviews,
  users,
  workLocations,
} from '../db/schema';
import type { AuthedCtx, Ctx } from '../context';
import { canSeeOthers, employeeVisibilitySql, has, requireActor, requirePerm } from '../authz/policy';
import { badRequest } from '../lib/errors';
import { parse } from '../lib/validate';
import { toCsv, minorToDecimal } from '../lib/csv';
import type { Permission } from '../../shared/permissions';
import { audit } from './audit';
import { listAnnouncements, listEvents } from './comms';
import { getSetting } from './settings';
import { listApprovals } from './approvals';

export const REPORTS: Record<string, { title: string; perm: Permission[] }> = {
  headcount: { title: 'Employee headcount by status', perm: ['report.org'] },
  departments: { title: 'Department distribution', perm: ['report.org', 'report.finance'] },
  locations: { title: 'Location distribution', perm: ['report.org', 'report.finance'] },
  onboarding: { title: 'Recruitment and onboarding (last 12 months)', perm: ['report.org'] },
  movements: { title: 'Transfers and promotions (last 12 months)', perm: ['report.org'] },
  retirement: { title: 'Retirement schedule', perm: ['retirement.read'] },
  approvals: { title: 'Pending approvals', perm: ['report.org', 'approval.read'] },
  activity: { title: 'Administrative activity (last 30 days)', perm: ['audit.read'] },
  payroll: { title: 'Payroll summary by period', perm: ['report.finance'] },
};

type Report = { title: string; columns: string[]; rows: (string | number | null)[][] };

const CURRENT = sql`${employees.archivedAt} is null and ${employees.employmentStatus} in ('active','on_leave','suspended')`;

async function build(ctx: AuthedCtx, name: string): Promise<Report> {
  const title = REPORTS[name].title;
  const since12 = new Date(ctx.now().getTime() - 365 * 24 * 3600_000);
  switch (name) {
    case 'headcount': {
      const rows = await ctx.db
        .select({ status: employees.employmentStatus, archived: sql<boolean>`${employees.archivedAt} is not null`, n: sql<number>`count(*)::int` })
        .from(employees)
        .groupBy(employees.employmentStatus, sql`${employees.archivedAt} is not null`)
        .orderBy(employees.employmentStatus);
      return { title, columns: ['Status', 'Archived', 'Employees'], rows: rows.map((r) => [r.status, r.archived ? 'yes' : 'no', r.n]) };
    }
    case 'departments': {
      const rows = await ctx.db
        .select({ code: departments.code, name: departments.name, n: sql<number>`count(${employees.id}) filter (where ${CURRENT})::int` })
        .from(departments)
        .leftJoin(employees, eq(employees.departmentId, departments.id))
        .groupBy(departments.id, departments.code, departments.name)
        .orderBy(departments.name);
      return { title, columns: ['Code', 'Department', 'Current employees'], rows: rows.map((r) => [r.code, r.name, r.n]) };
    }
    case 'locations': {
      const rows = await ctx.db
        .select({ name: sql<string>`coalesce(${workLocations.name}, 'Unassigned')`, n: sql<number>`count(*)::int` })
        .from(employees)
        .leftJoin(workLocations, eq(workLocations.id, employees.locationId))
        .where(CURRENT)
        .groupBy(workLocations.name)
        .orderBy(workLocations.name);
      return { title, columns: ['Location', 'Current employees'], rows: rows.map((r) => [r.name, r.n]) };
    }
    case 'onboarding': {
      const rows = await ctx.db
        .select({
          month: sql<string>`to_char(date_trunc('month', ${employees.createdAt}), 'YYYY-MM')`,
          registered: sql<number>`count(*)::int`,
          verified: sql<number>`count(*) filter (where ${employees.verifiedAt} is not null)::int`,
          pending: sql<number>`count(*) filter (where ${employees.employmentStatus} = 'pending_verification')::int`,
          rejected: sql<number>`count(*) filter (where ${employees.employmentStatus} = 'rejected')::int`,
        })
        .from(employees)
        .where(gte(employees.createdAt, since12))
        .groupBy(sql`1`)
        .orderBy(sql`1`);
      return { title, columns: ['Month', 'New records', 'Verified', 'Pending', 'Rejected'], rows: rows.map((r) => [r.month, r.registered, r.verified, r.pending, r.rejected]) };
    }
    case 'movements': {
      const rows = await ctx.db
        .select({ month: sql<string>`to_char(date_trunc('month', ${employmentHistory.createdAt}), 'YYYY-MM')`, type: employmentHistory.changeType, n: sql<number>`count(*)::int` })
        .from(employmentHistory)
        .where(and(gte(employmentHistory.createdAt, since12), inArray(employmentHistory.changeType, ['transfer', 'grade_change', 'title_change', 'location_change', 'supervisor_change'])))
        .groupBy(sql`1`, employmentHistory.changeType)
        .orderBy(sql`1`);
      return { title, columns: ['Month', 'Change type', 'Count'], rows: rows.map((r) => [r.month, r.type, r.n]) };
    }
    case 'retirement': {
      const rows = await ctx.db
        .select({ number: employees.employmentNumber, name: employees.legalName, dept: departments.name, expected: retirementReviews.expectedRetirementDate, deferred: retirementReviews.deferredUntil, status: retirementReviews.status })
        .from(retirementReviews)
        .innerJoin(employees, eq(employees.id, retirementReviews.employeeId))
        .innerJoin(departments, eq(departments.id, employees.departmentId))
        .orderBy(retirementReviews.expectedRetirementDate);
      return { title, columns: ['Employment number', 'Name', 'Department', 'Expected retirement', 'Deferred until', 'Status'], rows: rows.map((r) => [r.number, r.name, r.dept, r.expected, r.deferred, r.status]) };
    }
    case 'approvals': {
      const rows = await ctx.db
        .select({ type: approvalRequests.type, n: sql<number>`count(*)::int`, oldest: sql<string>`min(${approvalRequests.requestedAt})::text` })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.status, 'pending'), inArray(approvalRequests.requiredPermission, [...ctx.actor.permissions])))
        .groupBy(approvalRequests.type);
      return { title, columns: ['Type', 'Pending', 'Oldest request'], rows: rows.map((r) => [r.type, r.n, r.oldest?.slice(0, 16) ?? null]) };
    }
    case 'activity': {
      const rows = await ctx.db
        .select({ actor: sql<string>`coalesce(${users.username}, 'system')`, action: auditLogs.action, n: sql<number>`count(*)::int` })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(and(gte(auditLogs.occurredAt, new Date(ctx.now().getTime() - 30 * 24 * 3600_000)), sql`${auditLogs.action} not like 'audit.view%'`))
        .groupBy(sql`1`, auditLogs.action)
        .orderBy(desc(sql`3`))
        .limit(500);
      return { title, columns: ['Actor', 'Action', 'Count'], rows: rows.map((r) => [r.actor, r.action, r.n]) };
    }
    case 'payroll': {
      const rows = await ctx.db
        .select({
          code: payrollPeriods.code,
          name: payrollPeriods.name,
          status: payrollPeriods.status,
          records: sql<number>`count(${payrollRecords.id}) filter (where ${payrollRecords.status} = 'approved')::int`,
          gross: sql<string>`coalesce(sum(${payrollRecords.grossEarnings}) filter (where ${payrollRecords.status} = 'approved'),0)`,
          deductions: sql<string>`coalesce(sum(${payrollRecords.totalDeductions}) filter (where ${payrollRecords.status} = 'approved'),0)`,
          net: sql<string>`coalesce(sum(${payrollRecords.netPay}) filter (where ${payrollRecords.status} = 'approved'),0)`,
        })
        .from(payrollPeriods)
        .leftJoin(payrollRecords, eq(payrollRecords.periodId, payrollPeriods.id))
        .groupBy(payrollPeriods.id, payrollPeriods.code, payrollPeriods.name, payrollPeriods.status)
        .orderBy(desc(payrollPeriods.startDate));
      const cur = await getSetting(ctx.db, 'org.currency');
      return {
        title,
        columns: ['Period', 'Name', 'Status', 'Approved records', `Gross (${cur})`, `Deductions (${cur})`, `Net (${cur})`],
        rows: rows.map((r) => [r.code, r.name, r.status, r.records, minorToDecimal(Number(r.gross)), minorToDecimal(Number(r.deductions)), minorToDecimal(Number(r.net))]),
      };
    }
    default:
      throw badRequest('Unknown report');
  }
}

export async function getReport(ctx: Ctx, name: string, query: unknown) {
  requireActor(ctx);
  const { format } = parse(z.object({ format: z.enum(['json', 'csv']).default('json') }), query);
  const def = REPORTS[name];
  if (!def) throw badRequest('Unknown report');
  requirePerm(ctx, ...def.perm);
  const report = await build(ctx, name);
  if (format === 'csv') {
    await audit(ctx.db, ctx, { action: 'report.export', targetType: 'report', targetId: name, newValues: { rows: report.rows.length } });
    return { csv: toCsv(report.columns, report.rows) };
  }
  return report;
}

export function availableReports(ctx: Ctx) {
  requireActor(ctx);
  return Object.entries(REPORTS)
    .filter(([, d]) => d.perm.some((p) => has(ctx.actor, p)))
    .map(([key, d]) => ({ key, title: d.title }));
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                          */
/* ------------------------------------------------------------------ */

export async function dashboard(ctx: Ctx) {
  requireActor(ctx);
  const a = ctx.actor;
  const out: Record<string, unknown> = {};

  if (a.employeeId) {
    const [me] = await ctx.db
      .select({ legalName: employees.legalName, employmentNumber: employees.employmentNumber, status: employees.employmentStatus, departmentName: departments.name, employmentDate: employees.employmentDate })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.id, a.employeeId));
    out.me = me ?? null;
  }

  if (canSeeOthers(a)) {
    const vis = employeeVisibilitySql(a);
    const [counts] = await ctx.db
      .select({
        current: sql<number>`count(*) filter (where ${CURRENT})::int`,
        pending: sql<number>`count(*) filter (where ${employees.employmentStatus} = 'pending_verification')::int`,
        onLeave: sql<number>`count(*) filter (where ${employees.employmentStatus} = 'on_leave' and ${employees.archivedAt} is null)::int`,
      })
      .from(employees)
      .where(vis);
    const byDept = await ctx.db
      .select({ name: departments.name, n: sql<number>`count(*)::int` })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(vis, CURRENT))
      .groupBy(departments.name)
      .orderBy(departments.name);
    out.workforce = { ...counts, byDepartment: byDept, scoped: !has(a, 'employee.read.all') };
  }

  const approvals = await listApprovals(ctx, { status: 'pending', pageSize: 50 });
  out.approvals = {
    toDecide: approvals.items.filter((i) => i.canDecide).length,
    mine: approvals.items.filter((i) => i.requestedBy === a.userId).length,
    items: approvals.items.filter((i) => i.canDecide).slice(0, 5).map((i) => ({ id: i.id, type: i.type, summary: i.summary, requestedAt: i.requestedAt })),
  };

  if (has(a, 'retirement.read')) {
    const rows = await ctx.db
      .select({ id: retirementReviews.id, status: retirementReviews.status, expected: retirementReviews.expectedRetirementDate, name: employees.legalName })
      .from(retirementReviews)
      .innerJoin(employees, eq(employees.id, retirementReviews.employeeId))
      .where(inArray(retirementReviews.status, ['upcoming', 'review_required', 'pending_approval', 'approved', 'deferred']))
      .orderBy(retirementReviews.expectedRetirementDate)
      .limit(5);
    const [c] = await ctx.db
      .select({
        reviewRequired: sql<number>`count(*) filter (where ${retirementReviews.status} = 'review_required')::int`,
        pendingApproval: sql<number>`count(*) filter (where ${retirementReviews.status} = 'pending_approval')::int`,
        upcoming: sql<number>`count(*) filter (where ${retirementReviews.status} = 'upcoming')::int`,
      })
      .from(retirementReviews);
    out.retirement = { ...c, next: rows };
  }

  if (has(a, 'payroll.read')) {
    const [period] = await ctx.db.select().from(payrollPeriods).orderBy(desc(payrollPeriods.startDate)).limit(1);
    if (period) {
      const rows = await ctx.db
        .select({ status: payrollRecords.status, n: sql<number>`count(*)::int`, net: sql<string>`coalesce(sum(${payrollRecords.netPay}),0)` })
        .from(payrollRecords)
        .where(and(eq(payrollRecords.periodId, period.id), inArray(payrollRecords.status, ['draft', 'pending_approval', 'approved'])))
        .groupBy(payrollRecords.status);
      out.payroll = {
        period: { id: period.id, name: period.name, status: period.status },
        byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
        net: rows.reduce((s, r) => s + Number(r.net), 0),
        currency: await getSetting(ctx.db, 'org.currency'),
      };
    } else out.payroll = { period: null };
  }

  if (has(a, 'audit.read')) {
    const since = new Date(ctx.now().getTime() - 7 * 24 * 3600_000);
    const [sec] = await ctx.db
      .select({
        failedLogins: sql<number>`count(*) filter (where ${auditLogs.action} in ('auth.login','auth.mfa') and ${auditLogs.outcome} = 'failure')::int`,
        denied: sql<number>`count(*) filter (where ${auditLogs.outcome} = 'denied')::int`,
        roleChanges: sql<number>`count(*) filter (where ${auditLogs.action} in ('role.change','permission.grant','permission.revoke','scope.change'))::int`,
      })
      .from(auditLogs)
      .where(gte(auditLogs.occurredAt, since));
    const recent = await ctx.db
      .select({ id: auditLogs.id, action: auditLogs.action, outcome: auditLogs.outcome, occurredAt: auditLogs.occurredAt, actor: users.username })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(and(gte(auditLogs.occurredAt, since), sql`(${auditLogs.outcome} <> 'success' or ${auditLogs.action} like 'role.%' or ${auditLogs.action} like 'security.%' or ${auditLogs.action} like 'user.%')`))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(8);
    out.security = { ...sec, recent };
  }

  const [ann, evs] = await Promise.all([listAnnouncements(ctx, { status: 'published', pageSize: 3 }), listEvents(ctx, { when: 'upcoming', status: 'published', pageSize: 3 })]);
  out.announcements = ann.items;
  out.events = evs.items;
  return out;
}
