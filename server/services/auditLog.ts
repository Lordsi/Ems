import { z } from 'zod';
import { and, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm';
import { auditLogs, users } from '../db/schema';
import type { Ctx } from '../context';
import { requirePerm } from '../authz/policy';
import { parse, zDate, zPage } from '../lib/validate';
import { toCsv } from '../lib/csv';
import { audit } from './audit';

const auditQuery = zPage.extend({
  actorUserId: z.uuid().optional(),
  action: z.string().trim().max(80).optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(64).optional(),
  outcome: z.enum(['success', 'denied', 'failure']).optional(),
  from: zDate.optional(),
  to: zDate.optional(),
});

function whereFor(q: z.infer<typeof auditQuery>): SQL | undefined {
  const conds: SQL[] = [];
  if (q.actorUserId) conds.push(eq(auditLogs.actorUserId, q.actorUserId));
  if (q.action) conds.push(ilike(auditLogs.action, `${q.action.replace(/[%_\\]/g, '\\$&')}%`));
  if (q.targetType) conds.push(eq(auditLogs.targetType, q.targetType));
  if (q.targetId) conds.push(eq(auditLogs.targetId, q.targetId));
  if (q.outcome) conds.push(eq(auditLogs.outcome, q.outcome));
  if (q.from) conds.push(gte(auditLogs.occurredAt, new Date(`${q.from}T00:00:00Z`)));
  if (q.to) conds.push(lte(auditLogs.occurredAt, new Date(`${q.to}T23:59:59.999Z`)));
  return conds.length ? and(...conds) : undefined;
}

/** Reading the audit log is itself audited. */
export async function searchAudit(ctx: Ctx, query: unknown) {
  requirePerm(ctx, 'audit.read');
  const q = parse(auditQuery, query);
  const where = whereFor(q);
  const [items, [{ total }]] = await Promise.all([
    ctx.db
      .select({ log: auditLogs, actorName: users.displayName, actorUsername: users.username })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
  ]);
  const { page, pageSize, ...filters } = q;
  await audit(ctx.db, ctx, { action: 'audit.view', targetType: 'audit_log', newValues: { filters, page } });
  return { items: items.map((r) => ({ ...r.log, actorName: r.actorName, actorUsername: r.actorUsername })), total, page, pageSize };
}

export async function exportAuditCsv(ctx: Ctx, query: unknown) {
  requirePerm(ctx, 'audit.read');
  const q = parse(auditQuery.omit({ page: true, pageSize: true }), query);
  const where = whereFor({ ...q, page: 1, pageSize: 1 });
  const rows = await ctx.db
    .select({ log: auditLogs, actorUsername: users.username })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.occurredAt))
    .limit(50000);
  await audit(ctx.db, ctx, { action: 'audit.export', targetType: 'audit_log', newValues: { filters: q, rows: rows.length } });
  return toCsv(
    ['Time', 'Actor', 'Action', 'Outcome', 'Target type', 'Target id', 'Reason', 'Approval', 'Request', 'IP', 'Old values', 'New values'],
    rows.map(({ log, actorUsername }) => [
      log.occurredAt, actorUsername ?? log.actorUserId ?? 'system', log.action, log.outcome, log.targetType, log.targetId, log.reason, log.approvalId, log.requestId, log.ip,
      log.oldValues ? JSON.stringify(log.oldValues) : '', log.newValues ? JSON.stringify(log.newValues) : '',
    ]),
  );
}
