import { z } from 'zod';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { approvalRequests, employees, users } from '../db/schema';
import type { AuthedCtx, Ctx } from '../context';
import { canViewEmployee, deniedRecord, has, requireActor } from '../authz/policy';
import { badRequest, conflict, forbidden } from '../lib/errors';
import { parse, zOptDate, zOptText, zPage } from '../lib/validate';
import type { Permission } from '../../shared/permissions';
import { audit } from './audit';
import { notify } from './notifications';
import { applyEmployeeChanges, loadEmployee, parseChanges, verifyRegistration } from './employees';
import { approveRecord, rejectRecord } from './payroll';
import { decideReview } from './retirement';

const decider = alias(users, 'decider');

function visibilitySql(ctx: AuthedCtx): SQL {
  const perms = [...ctx.actor.permissions];
  const clauses: SQL[] = [eq(approvalRequests.requestedBy, ctx.actor.userId)];
  if (perms.length) clauses.push(inArray(approvalRequests.requiredPermission, perms));
  return or(...clauses)!;
}

function canDecide(ctx: AuthedCtx, r: { requiredPermission: string; requestedBy: string | null; status: string }) {
  return r.status === 'pending' && has(ctx.actor, r.requiredPermission as Permission) && r.requestedBy !== ctx.actor.userId;
}

export async function listApprovals(ctx: Ctx, query: unknown) {
  requireActor(ctx);
  const q = parse(
    zPage.extend({
      status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'all']).default('pending'),
      type: z.enum(['registration', 'employee_change', 'profile_correction', 'payroll_record', 'retirement_decision']).optional(),
      mine: z.coerce.boolean().optional(),
      targetId: z.uuid().optional(),
    }),
    query,
  );
  const conds: SQL[] = [visibilitySql(ctx)];
  if (q.status !== 'all') conds.push(eq(approvalRequests.status, q.status));
  if (q.type) conds.push(eq(approvalRequests.type, q.type));
  if (q.mine) conds.push(eq(approvalRequests.requestedBy, ctx.actor.userId));
  if (q.targetId) conds.push(eq(approvalRequests.targetId, q.targetId));
  const where = and(...conds);
  const rows = await ctx.db
    .select({ a: approvalRequests, requesterName: users.displayName, deciderName: decider.displayName })
    .from(approvalRequests)
    .leftJoin(users, eq(users.id, approvalRequests.requestedBy))
    .leftJoin(decider, eq(decider.id, approvalRequests.decidedBy))
    .where(where)
    .orderBy(desc(approvalRequests.requestedAt))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const [{ total }] = await ctx.db.select({ total: sql<number>`count(*)::int` }).from(approvalRequests).where(where);

  // Employee-targeted requests are additionally filtered by record visibility (moderator scope etc.).
  const empIds = rows.filter((r) => r.a.targetType === 'employee').map((r) => r.a.targetId);
  const emps = empIds.length ? await ctx.db.select().from(employees).where(inArray(employees.id, empIds)) : [];
  const items = rows
    .filter((r) => {
      if (r.a.targetType !== 'employee' || r.a.requestedBy === ctx.actor.userId) return true;
      const e = emps.find((x) => x.id === r.a.targetId);
      return !!e && canViewEmployee(ctx.actor, e);
    })
    .map((r) => ({
      ...r.a,
      requesterName: r.requesterName,
      deciderName: r.deciderName,
      canDecide: canDecide(ctx, r.a),
      canCancel: r.a.status === 'pending' && r.a.requestedBy === ctx.actor.userId && ['employee_change', 'profile_correction'].includes(r.a.type),
    }));
  return { items, total, page: q.page, pageSize: q.pageSize };
}

const decideInput = z
  .object({
    decision: z.enum(['approve', 'reject', 'defer']),
    reason: zOptText(1000),
    deferredUntil: zOptDate,
    corrections: z.unknown().optional(),
  })
  .strict();

export async function decideApproval(ctx: Ctx, id: string, input: unknown) {
  requireActor(ctx);
  const body = parse(decideInput, input);
  if (!z.uuid().safeParse(id).success) throw deniedRecord('Approval request');
  const [req] = await ctx.db.select().from(approvalRequests).where(and(eq(approvalRequests.id, id), visibilitySql(ctx)));
  if (!req) throw deniedRecord('Approval request');
  if (req.status !== 'pending') throw conflict('This request has already been decided');
  if (req.requestedBy === ctx.actor.userId) throw forbidden('You cannot decide a request you submitted');
  if (!has(ctx.actor, req.requiredPermission as Permission)) throw forbidden();
  if (body.decision === 'defer' && req.type !== 'retirement_decision') throw badRequest('Only retirement decisions can be deferred');

  switch (req.type) {
    case 'registration':
      return verifyRegistration(
        ctx,
        req.targetId,
        { decision: body.decision === 'approve' ? 'approve' : 'reject', reason: body.reason ?? undefined, ...(body.corrections ? { corrections: body.corrections } : {}) },
        req.id,
      );
    case 'payroll_record':
      return body.decision === 'approve'
        ? approveRecord(ctx, req.targetId, { reason: body.reason ?? undefined })
        : rejectRecord(ctx, req.targetId, { reason: body.reason ?? '' });
    case 'retirement_decision':
      return decideReview(ctx, req.targetId, { decision: body.decision, reason: body.reason ?? '', deferredUntil: body.deferredUntil });
    case 'employee_change':
    case 'profile_correction':
      return decideEmployeeChange(ctx, req, body);
    default:
      throw badRequest('Unsupported request type');
  }
}

async function decideEmployeeChange(ctx: AuthedCtx, req: typeof approvalRequests.$inferSelect, body: z.infer<typeof decideInput>) {
  if (body.decision === 'reject' && !body.reason) throw badRequest('Validation failed', { fields: { reason: 'A reason is required when rejecting' } });
  return ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, req.id)).for('update');
    if (locked.status !== 'pending') throw conflict('This request has already been decided');
    const emp = await loadEmployee(tx, req.targetId, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord('Employee');
    if (emp.userId === ctx.actor.userId) throw forbidden('You cannot approve changes to your own record');
    let applied: string[] = [];
    if (body.decision === 'approve') {
      const changes = parseChanges((req.payload as { changes?: unknown }).changes ?? {});
      const result = await applyEmployeeChanges(tx, ctx, emp, changes, {
        reason: [req.reason, body.reason].filter(Boolean).join(' — ') || null,
        approvalId: req.id,
        action: req.type === 'profile_correction' ? 'employee.correction_approved' : 'employee.change_approved',
      });
      applied = result.changed;
    }
    await tx
      .update(approvalRequests)
      .set({ status: body.decision === 'approve' ? 'approved' : 'rejected', decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason })
      .where(eq(approvalRequests.id, req.id));
    if (body.decision === 'reject') {
      await audit(tx, ctx, { action: `${req.type}.rejected`, targetType: 'employee', targetId: emp.id, reason: body.reason, approvalId: req.id });
    }
    await notify(tx, [req.requestedBy], {
      type: 'approval.decided',
      title: `Your ${req.type === 'profile_correction' ? 'correction request' : 'change request'} was ${body.decision === 'approve' ? 'approved' : 'rejected'}`,
      body: body.reason ?? undefined,
      link: `/approvals?id=${req.id}`,
    });
    return { status: body.decision === 'approve' ? 'approved' : 'rejected', applied };
  });
}

export async function cancelApproval(ctx: Ctx, id: string) {
  requireActor(ctx);
  if (!z.uuid().safeParse(id).success) throw deniedRecord('Approval request');
  return ctx.db.transaction(async (tx) => {
    const [req] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for('update');
    if (!req || req.requestedBy !== ctx.actor.userId) throw deniedRecord('Approval request');
    if (req.status !== 'pending') throw conflict('Only pending requests can be cancelled');
    if (!['employee_change', 'profile_correction'].includes(req.type)) throw badRequest('This request cannot be cancelled');
    await tx.update(approvalRequests).set({ status: 'cancelled', decidedBy: ctx.actor.userId, decidedAt: ctx.now() }).where(eq(approvalRequests.id, id));
    await audit(tx, ctx, { action: 'approval.cancel', targetType: 'approval_request', targetId: id });
    return { status: 'cancelled' };
  });
}
