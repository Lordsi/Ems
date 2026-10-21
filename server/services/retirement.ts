import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, lte, or, gte, sql, type SQL } from 'drizzle-orm';
import {
  approvalRequests,
  departments,
  employees,
  employmentHistory,
  retirementPolicies,
  retirementReviews,
  retirementSettlements,
  users,
} from '../db/schema';
import type { Db, Tx } from '../db/client';
import type { AuthedCtx, Ctx } from '../context';
import { deniedRecord, has, requirePerm, requireRecentAuth } from '../authz/policy';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { parse, zDate, zOptDate, zOptText, zOptUuid, zPage, zTrim } from '../lib/validate';
import { addMonths, addYears, ageOn, todayIso } from '../lib/dates';
import { toCsv } from '../lib/csv';
import { revokeAllSessions } from '../auth/sessions';
import { audit } from './audit';
import { notify, usersWithPermission } from './notifications';
import { getSetting } from './settings';
import { assertNotLastSuperAdmin } from './users';

type Policy = typeof retirementPolicies.$inferSelect;

const DEFAULT_ACTIONS = [
  'Prepare estimated retirement statement (Finance)',
  'Verify statement and employment details (Reviewer)',
  'Executive decision (Super Admin)',
];

/* ------------------------------------------------------------------ */
/* Policy resolution                                                  */
/* ------------------------------------------------------------------ */

export function isPolicyEffective(p: Policy, today: string): boolean {
  return p.adopted && p.effectiveFrom <= today && (!p.effectiveTo || p.effectiveTo >= today);
}

/** A department-specific adopted policy takes precedence over the organisation-wide one. */
export function policyFor(policies: Policy[], departmentId: string, today: string): Policy | null {
  const effective = policies.filter((p) => isPolicyEffective(p, today));
  return effective.find((p) => p.departmentId === departmentId) ?? effective.find((p) => !p.departmentId) ?? null;
}

export function expectedRetirementDate(dob: string, policy: Pick<Policy, 'retirementAge'>): string {
  return addYears(dob, policy.retirementAge);
}

/* ------------------------------------------------------------------ */
/* Policies                                                           */
/* ------------------------------------------------------------------ */

export async function listPolicies(ctx: Ctx) {
  requirePerm(ctx, 'retirement.read', 'retirement.policy.manage');
  return ctx.db
    .select({ policy: retirementPolicies, departmentName: departments.name, adoptedByName: users.displayName })
    .from(retirementPolicies)
    .leftJoin(departments, eq(departments.id, retirementPolicies.departmentId))
    .leftJoin(users, eq(users.id, retirementPolicies.adoptedBy))
    .orderBy(desc(retirementPolicies.createdAt))
    .then((rows) => rows.map((r) => ({ ...r.policy, departmentName: r.departmentName, adoptedByName: r.adoptedByName, effectiveToday: isPolicyEffective(r.policy, todayIso(ctx.now())) })));
}

const policyInput = z
  .object({
    name: zTrim(120),
    retirementAge: z.number().int().min(40).max(80),
    reviewLeadMonths: z.number().int().min(1).max(36).default(6),
    upcomingWindowMonths: z.number().int().min(1).max(60).default(12),
    departmentId: zOptUuid,
    effectiveFrom: zDate,
    effectiveTo: zOptDate,
    legalReference: zOptText(500),
    notes: zOptText(2000),
  })
  .strict();

export async function createPolicy(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'retirement.policy.manage');
  const body = parse(policyInput, input);
  if (body.upcomingWindowMonths < body.reviewLeadMonths) throw badRequest('Validation failed', { fields: { upcomingWindowMonths: 'Must be at least the review lead time' } });
  if (body.effectiveTo && body.effectiveTo < body.effectiveFrom) throw badRequest('Validation failed', { fields: { effectiveTo: 'Must be after the effective date' } });
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.insert(retirementPolicies).values({ ...body, createdBy: ctx.actor.userId, adopted: false }).returning();
    await audit(tx, ctx, { action: 'retirement.policy_create', targetType: 'retirement_policy', targetId: p.id, newValues: body });
    return p;
  });
}

export async function updatePolicy(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'retirement.policy.manage');
  const body = parse(policyInput, input);
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(retirementPolicies).where(eq(retirementPolicies.id, id));
    if (!p) throw notFound('Policy not found');
    if (p.adopted) throw conflict('Adopted policies cannot be edited. End this policy and create a new version.');
    await tx.update(retirementPolicies).set(body).where(eq(retirementPolicies.id, id));
    await audit(tx, ctx, { action: 'retirement.policy_update', targetType: 'retirement_policy', targetId: id, oldValues: p, newValues: body });
    return { id };
  });
}

/** Adopting a policy is an explicit, re-authenticated executive act confirming it was verified. */
export async function adoptPolicy(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'retirement.policy.manage');
  requireRecentAuth(ctx);
  const body = parse(z.object({ confirmation: z.literal(true), reason: zTrim(1000, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(retirementPolicies).where(eq(retirementPolicies.id, id));
    if (!p) throw notFound('Policy not found');
    if (p.adopted) throw conflict('Policy already adopted');
    const overlapping = await tx
      .select({ id: retirementPolicies.id })
      .from(retirementPolicies)
      .where(
        and(
          eq(retirementPolicies.adopted, true),
          p.departmentId ? eq(retirementPolicies.departmentId, p.departmentId) : isNull(retirementPolicies.departmentId),
          or(isNull(retirementPolicies.effectiveTo), gte(retirementPolicies.effectiveTo, p.effectiveFrom)),
          p.effectiveTo ? lte(retirementPolicies.effectiveFrom, p.effectiveTo) : sql`true`,
        ),
      );
    if (overlapping.length) throw conflict('Another adopted policy covers the same scope and dates. End it first.');
    await tx.update(retirementPolicies).set({ adopted: true, adoptedBy: ctx.actor.userId, adoptedAt: ctx.now() }).where(eq(retirementPolicies.id, id));
    await audit(tx, ctx, { action: 'retirement.policy_adopt', targetType: 'retirement_policy', targetId: id, newValues: { retirementAge: p.retirementAge, departmentId: p.departmentId }, reason: body.reason });
    return { adopted: true };
  });
}

export async function endPolicy(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'retirement.policy.manage');
  requireRecentAuth(ctx);
  const body = parse(z.object({ effectiveTo: zDate, reason: zTrim(1000, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(retirementPolicies).where(eq(retirementPolicies.id, id));
    if (!p) throw notFound('Policy not found');
    if (body.effectiveTo < p.effectiveFrom) throw badRequest('End date must be after the effective date');
    await tx.update(retirementPolicies).set({ effectiveTo: body.effectiveTo }).where(eq(retirementPolicies.id, id));
    await audit(tx, ctx, { action: 'retirement.policy_end', targetType: 'retirement_policy', targetId: id, oldValues: { effectiveTo: p.effectiveTo }, newValues: { effectiveTo: body.effectiveTo }, reason: body.reason });
    return { id };
  });
}

/* ------------------------------------------------------------------ */
/* Monitoring scan (scheduled, idempotent)                            */
/* ------------------------------------------------------------------ */

async function notifyReviewRequired(tx: Tx, review: { id: string; expectedRetirementDate: string }, name: string) {
  const recipients = [...new Set([...(await usersWithPermission(tx, 'retirement.read'))])];
  await notify(tx, recipients, {
    type: 'retirement.review_required',
    title: `Retirement review required: ${name}`,
    body: `Expected retirement date ${review.expectedRetirementDate}. Prepare and verify the retirement statement.`,
    link: `/retirement/${review.id}`,
    dedupeKey: `retirement-review:${review.id}:${review.expectedRetirementDate}`,
  });
}

export async function runRetirementScan(db: Db, now: Date = new Date()) {
  const today = todayIso(now);
  const systemCtx = { actor: null, meta: { requestId: `job-retirement-${today}` } };
  return db.transaction(async (tx) => {
    const policies = await tx.select().from(retirementPolicies);
    if (!policies.some((p) => isPolicyEffective(p, today))) return { created: 0, flagged: 0, updated: 0, skipped: 'no_adopted_policy' as const };
    const emps = await tx
      .select({ id: employees.id, legalName: employees.legalName, dateOfBirth: employees.dateOfBirth, departmentId: employees.departmentId })
      .from(employees)
      .where(
        and(
          isNull(employees.archivedAt),
          inArray(employees.employmentStatus, ['active', 'on_leave', 'suspended']),
          sql`${employees.dateOfBirth} is not null`,
          sql`${employees.employmentNumber} is not null`,
        ),
      );
    const reviews = await tx.select().from(retirementReviews);
    const open = new Map(reviews.filter((r) => !['completed', 'rejected'].includes(r.status)).map((r) => [r.employeeId, r]));
    const closed = new Set(reviews.filter((r) => ['completed', 'rejected'].includes(r.status)).map((r) => `${r.employeeId}|${r.expectedRetirementDate}`));
    let created = 0;
    let flagged = 0;
    let updated = 0;
    for (const emp of emps) {
      const policy = policyFor(policies, emp.departmentId, today);
      if (!policy) continue;
      const expected = expectedRetirementDate(emp.dateOfBirth!, policy);
      const reviewStart = addMonths(expected, -policy.reviewLeadMonths);
      const upcomingStart = addMonths(expected, -policy.upcomingWindowMonths);
      const existing = open.get(emp.id);
      if (!existing) {
        if (today < upcomingStart || closed.has(`${emp.id}|${expected}`)) continue;
        const due = today >= reviewStart;
        const [r] = await tx
          .insert(retirementReviews)
          .values({
            employeeId: emp.id,
            policyId: policy.id,
            expectedRetirementDate: expected,
            status: due ? 'review_required' : 'upcoming',
            flaggedAt: due ? now : null,
            outstandingActions: DEFAULT_ACTIONS,
          })
          .onConflictDoNothing()
          .returning();
        if (!r) continue;
        created++;
        await audit(tx, systemCtx, { actorUserId: null, action: 'retirement.review_created', targetType: 'retirement_review', targetId: r.id, newValues: { employeeId: emp.id, expected, status: r.status, policyId: policy.id } });
        if (due) {
          flagged++;
          await notifyReviewRequired(tx, r, emp.legalName);
        }
        continue;
      }
      if (['upcoming', 'review_required'].includes(existing.status) && (existing.expectedRetirementDate !== expected || existing.policyId !== policy.id)) {
        await tx.update(retirementReviews).set({ expectedRetirementDate: expected, policyId: policy.id, updatedAt: now }).where(eq(retirementReviews.id, existing.id));
        existing.expectedRetirementDate = expected;
        updated++;
      }
      if (existing.status === 'upcoming' && today >= addMonths(existing.expectedRetirementDate, -policy.reviewLeadMonths)) {
        await tx.update(retirementReviews).set({ status: 'review_required', flaggedAt: now, updatedAt: now }).where(eq(retirementReviews.id, existing.id));
        await audit(tx, systemCtx, { actorUserId: null, action: 'retirement.review_flagged', targetType: 'retirement_review', targetId: existing.id, newValues: { expected: existing.expectedRetirementDate } });
        await notifyReviewRequired(tx, existing, emp.legalName);
        flagged++;
      } else if (existing.status === 'deferred' && existing.deferredUntil && today >= addMonths(existing.deferredUntil, -policy.reviewLeadMonths)) {
        await tx
          .update(retirementReviews)
          .set({ status: 'review_required', expectedRetirementDate: existing.deferredUntil, flaggedAt: now, updatedAt: now })
          .where(eq(retirementReviews.id, existing.id));
        await audit(tx, systemCtx, { actorUserId: null, action: 'retirement.review_flagged', targetType: 'retirement_review', targetId: existing.id, newValues: { expected: existing.deferredUntil, afterDeferral: true } });
        await notifyReviewRequired(tx, { id: existing.id, expectedRetirementDate: existing.deferredUntil }, emp.legalName);
        flagged++;
      }
    }
    return { created, flagged, updated, skipped: null };
  });
}

/* ------------------------------------------------------------------ */
/* Reviews                                                            */
/* ------------------------------------------------------------------ */

function reviewBase(tx: Tx) {
  return tx
    .select({
      id: retirementReviews.id,
      status: retirementReviews.status,
      expectedRetirementDate: retirementReviews.expectedRetirementDate,
      deferredUntil: retirementReviews.deferredUntil,
      flaggedAt: retirementReviews.flaggedAt,
      outstandingActions: retirementReviews.outstandingActions,
      decisionReason: retirementReviews.decisionReason,
      decisionAt: retirementReviews.decisionAt,
      completedAt: retirementReviews.completedAt,
      policyId: retirementReviews.policyId,
      policyName: retirementPolicies.name,
      retirementAge: retirementPolicies.retirementAge,
      employeeId: employees.id,
      legalName: employees.legalName,
      employmentNumber: employees.employmentNumber,
      dateOfBirth: employees.dateOfBirth,
      employmentDate: employees.employmentDate,
      departmentName: departments.name,
      departmentId: employees.departmentId,
    })
    .from(retirementReviews)
    .innerJoin(employees, eq(employees.id, retirementReviews.employeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .innerJoin(retirementPolicies, eq(retirementPolicies.id, retirementReviews.policyId));
}

const reviewQuery = zPage.extend({
  status: z.enum(['upcoming', 'review_required', 'pending_approval', 'approved', 'deferred', 'completed', 'rejected', 'open']).default('open'),
  departmentId: z.uuid().optional(),
});

export async function listReviews(ctx: Ctx, query: unknown) {
  requirePerm(ctx, 'retirement.read');
  const q = parse(reviewQuery, query);
  const conds: SQL[] = [];
  if (q.status === 'open') conds.push(inArray(retirementReviews.status, ['upcoming', 'review_required', 'pending_approval', 'approved', 'deferred']));
  else conds.push(eq(retirementReviews.status, q.status));
  if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
  const where = and(...conds);
  const today = todayIso(ctx.now());
  const [rows, [{ total }], counts, policies] = await Promise.all([
    reviewBase(ctx.db).where(where).orderBy(asc(retirementReviews.expectedRetirementDate)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql<number>`count(*)::int` }).from(retirementReviews).innerJoin(employees, eq(employees.id, retirementReviews.employeeId)).where(where),
    ctx.db.select({ status: retirementReviews.status, n: sql<number>`count(*)::int` }).from(retirementReviews).groupBy(retirementReviews.status),
    ctx.db.select().from(retirementPolicies),
  ]);
  return {
    items: rows.map((r) => ({ ...r, age: r.dateOfBirth ? ageOn(r.dateOfBirth, today) : null })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    policyAdopted: policies.some((p) => isPolicyEffective(p, today)),
  };
}

export async function getReview(ctx: Ctx, id: string) {
  requirePerm(ctx, 'retirement.read');
  if (!z.uuid().safeParse(id).success) throw notFound('Review not found');
  const [row] = await reviewBase(ctx.db).where(eq(retirementReviews.id, id));
  if (!row) throw notFound('Review not found');
  const settlements = await ctx.db
    .select({ s: retirementSettlements, preparedByName: users.displayName })
    .from(retirementSettlements)
    .leftJoin(users, eq(users.id, retirementSettlements.preparedBy))
    .where(eq(retirementSettlements.reviewId, id))
    .orderBy(desc(retirementSettlements.version));
  const latest = settlements[0]?.s;
  const today = todayIso(ctx.now());
  const open = !['completed', 'rejected'].includes(row.status);
  return {
    ...row,
    age: row.dateOfBirth ? ageOn(row.dateOfBirth, today) : null,
    settlements: settlements.map((x) => ({ ...x.s, preparedByName: x.preparedByName })),
    can: {
      prepare:
        has(ctx.actor, 'retirement.prepare') &&
        open &&
        ['upcoming', 'review_required', 'deferred'].includes(row.status) &&
        (!latest || ['rejected', 'verified'].includes(latest.verificationStatus)),
      editDraft: has(ctx.actor, 'retirement.prepare') && latest?.verificationStatus === 'draft',
      verify: has(ctx.actor, 'retirement.verify') && latest?.verificationStatus === 'submitted' && latest.preparedBy !== ctx.actor.userId,
      decide: has(ctx.actor, 'retirement.decide') && ['review_required', 'pending_approval', 'deferred'].includes(row.status),
      approve: has(ctx.actor, 'retirement.decide') && row.status === 'pending_approval',
      complete: has(ctx.actor, 'retirement.decide') && row.status === 'approved',
    },
  };
}

export async function employeeRetirement(ctx: Ctx, employeeId: string) {
  requirePerm(ctx, 'retirement.read');
  const [emp] = z.uuid().safeParse(employeeId).success ? await ctx.db.select().from(employees).where(eq(employees.id, employeeId)) : [];
  if (!emp) throw deniedRecord('Employee');
  const today = todayIso(ctx.now());
  const policies = await ctx.db.select().from(retirementPolicies);
  const policy = policyFor(policies, emp.departmentId, today);
  const reviews = await reviewBase(ctx.db).where(eq(retirementReviews.employeeId, employeeId)).orderBy(desc(retirementReviews.createdAt));
  return {
    policy: policy ? { id: policy.id, name: policy.name, retirementAge: policy.retirementAge, reviewLeadMonths: policy.reviewLeadMonths } : null,
    expectedRetirementDate: policy && emp.dateOfBirth ? expectedRetirementDate(emp.dateOfBirth, policy) : null,
    reviews,
  };
}

/* ------------------------------------------------------------------ */
/* Settlements                                                        */
/* ------------------------------------------------------------------ */

const settlementInput = z
  .object({
    calculationMethod: zTrim(4000, 10),
    policyReference: zOptText(500),
    sourceFigures: z.record(z.string().max(80), z.union([z.string().max(200), z.number()])).default({}),
    lineItems: z
      .array(z.object({ label: zTrim(120), kind: z.enum(['credit', 'debit']), amount: z.number().int().min(0).max(1e13) }).strict())
      .max(50),
  })
  .strict();

const settlementTotal = (items: { kind: 'credit' | 'debit'; amount: number }[]) =>
  items.reduce((s, i) => s + (i.kind === 'credit' ? i.amount : -i.amount), 0);

async function loadReviewForUpdate(tx: Tx, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [r] = await tx.select().from(retirementReviews).where(eq(retirementReviews.id, id)).for('update');
  return r ?? null;
}

export async function createSettlement(ctx: Ctx, reviewId: string, input: unknown) {
  requirePerm(ctx, 'retirement.prepare');
  const body = parse(settlementInput, input);
  return ctx.db.transaction(async (tx) => {
    const review = await loadReviewForUpdate(tx, reviewId);
    if (!review) throw notFound('Review not found');
    if (!['upcoming', 'review_required', 'deferred'].includes(review.status)) throw conflict('A statement cannot be prepared at this stage');
    const [latest] = await tx.select().from(retirementSettlements).where(eq(retirementSettlements.reviewId, reviewId)).orderBy(desc(retirementSettlements.version)).limit(1);
    if (latest && ['draft', 'submitted'].includes(latest.verificationStatus)) throw conflict('A statement is already in progress for this review');
    const currency = await getSetting(tx, 'org.currency');
    const [s] = await tx
      .insert(retirementSettlements)
      .values({ ...body, reviewId, version: (latest?.version ?? 0) + 1, currency, totalAmount: settlementTotal(body.lineItems), preparedBy: ctx.actor.userId })
      .returning();
    await audit(tx, ctx, { action: 'retirement.settlement_create', targetType: 'retirement_settlement', targetId: s.id, newValues: { reviewId, version: s.version, totalAmount: s.totalAmount, method: body.calculationMethod.slice(0, 200) } });
    return { id: s.id };
  });
}

export async function updateSettlement(ctx: Ctx, settlementId: string, input: unknown) {
  requirePerm(ctx, 'retirement.prepare');
  const body = parse(settlementInput, input);
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(retirementSettlements).where(eq(retirementSettlements.id, settlementId)).for('update');
    if (!s) throw notFound('Statement not found');
    if (s.verificationStatus !== 'draft') throw conflict('Only draft statements can be edited');
    const total = settlementTotal(body.lineItems);
    await tx.update(retirementSettlements).set({ ...body, totalAmount: total, preparedBy: ctx.actor.userId, updatedAt: ctx.now() }).where(eq(retirementSettlements.id, settlementId));
    await audit(tx, ctx, { action: 'retirement.settlement_update', targetType: 'retirement_settlement', targetId: settlementId, oldValues: { totalAmount: s.totalAmount }, newValues: { totalAmount: total } });
    return { id: settlementId };
  });
}

export async function submitSettlement(ctx: Ctx, settlementId: string) {
  requirePerm(ctx, 'retirement.prepare');
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(retirementSettlements).where(eq(retirementSettlements.id, settlementId)).for('update');
    if (!s) throw notFound('Statement not found');
    if (s.verificationStatus !== 'draft') throw conflict('Only draft statements can be submitted');
    await tx.update(retirementSettlements).set({ verificationStatus: 'submitted', updatedAt: ctx.now() }).where(eq(retirementSettlements.id, settlementId));
    await audit(tx, ctx, { action: 'retirement.settlement_submit', targetType: 'retirement_settlement', targetId: settlementId });
    const verifiers = (await usersWithPermission(tx, 'retirement.verify')).filter((u) => u !== ctx.actor.userId);
    await notify(tx, verifiers, {
      type: 'retirement.statement_submitted',
      title: 'Retirement statement awaiting verification',
      link: `/retirement/${s.reviewId}`,
      dedupeKey: `retirement-statement:${settlementId}`,
    });
    return { status: 'submitted' };
  });
}

export async function verifySettlement(ctx: Ctx, settlementId: string, input: unknown) {
  requirePerm(ctx, 'retirement.verify');
  const body = parse(z.object({ decision: z.enum(['verify', 'reject']), note: zTrim(1000, 3) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(retirementSettlements).where(eq(retirementSettlements.id, settlementId)).for('update');
    if (!s) throw notFound('Statement not found');
    if (s.verificationStatus !== 'submitted') throw conflict('Statement is not awaiting verification');
    if (s.preparedBy === ctx.actor.userId) throw forbidden('You cannot verify a statement you prepared');
    const review = (await loadReviewForUpdate(tx, s.reviewId))!;
    await tx
      .update(retirementSettlements)
      .set({ verificationStatus: body.decision === 'verify' ? 'verified' : 'rejected', verifiedBy: ctx.actor.userId, verifiedAt: ctx.now(), verificationNote: body.note, updatedAt: ctx.now() })
      .where(eq(retirementSettlements.id, settlementId));
    let approvalId: string | null = null;
    if (body.decision === 'verify') {
      const [emp] = await tx.select({ legalName: employees.legalName, departmentId: employees.departmentId }).from(employees).where(eq(employees.id, review.employeeId));
      const [approval] = await tx
        .insert(approvalRequests)
        .values({
          type: 'retirement_decision',
          targetType: 'retirement_review',
          targetId: review.id,
          departmentId: emp.departmentId,
          summary: `Retirement decision for ${emp.legalName} (expected ${review.expectedRetirementDate})`,
          payload: { settlementId },
          requiredPermission: 'retirement.decide',
          requestedBy: ctx.actor.userId,
        })
        .returning({ id: approvalRequests.id });
      approvalId = approval.id;
      await tx
        .update(retirementReviews)
        .set({ status: 'pending_approval', approvalId, outstandingActions: ['Executive decision (Super Admin)'], updatedAt: ctx.now() })
        .where(eq(retirementReviews.id, review.id));
      await notify(tx, await usersWithPermission(tx, 'retirement.decide'), {
        type: 'retirement.pending_approval',
        title: `Retirement decision required: ${emp.legalName}`,
        link: `/retirement/${review.id}`,
        dedupeKey: `retirement-decision:${approval.id}`,
      });
    }
    await audit(tx, ctx, { action: `retirement.settlement_${body.decision}`, targetType: 'retirement_settlement', targetId: settlementId, reason: body.note, approvalId });
    await notify(tx, [s.preparedBy], {
      type: 'retirement.statement_reviewed',
      title: body.decision === 'verify' ? 'Retirement statement verified' : 'Retirement statement returned',
      link: `/retirement/${s.reviewId}`,
    });
    return { status: body.decision === 'verify' ? 'verified' : 'rejected' };
  });
}

/* ------------------------------------------------------------------ */
/* Executive decision & finalisation                                  */
/* ------------------------------------------------------------------ */

const decisionInput = z
  .object({ decision: z.enum(['approve', 'reject', 'defer']), reason: zTrim(1000, 5), deferredUntil: zOptDate })
  .strict();

export async function decideReview(ctx: Ctx, reviewId: string, input: unknown) {
  requirePerm(ctx, 'retirement.decide');
  const body = parse(decisionInput, input);
  return ctx.db.transaction(async (tx) => {
    const review = await loadReviewForUpdate(tx, reviewId);
    if (!review) throw notFound('Review not found');
    if (body.decision === 'approve' && review.status !== 'pending_approval') throw conflict('A verified retirement statement is required before approval');
    if (!['review_required', 'pending_approval', 'deferred'].includes(review.status)) throw conflict('This review is not awaiting a decision');
    const [emp] = await tx.select().from(employees).where(eq(employees.id, review.employeeId));
    if (emp.userId === ctx.actor.userId) throw forbidden('You cannot decide your own retirement');
    let set: Partial<typeof retirementReviews.$inferInsert> = { decisionBy: ctx.actor.userId, decisionAt: ctx.now(), decisionReason: body.reason, updatedAt: ctx.now() };
    if (body.decision === 'defer') {
      const base = review.deferredUntil ?? review.expectedRetirementDate;
      if (!body.deferredUntil || body.deferredUntil <= base) throw badRequest('Validation failed', { fields: { deferredUntil: 'Choose a date after the current retirement date' } });
      set = { ...set, status: 'deferred', deferredUntil: body.deferredUntil, outstandingActions: [`Re-review before ${body.deferredUntil}`] };
    } else if (body.decision === 'approve') {
      set = { ...set, status: 'approved', outstandingActions: ['Finalize retirement on the effective date (Super Admin)'] };
    } else {
      set = { ...set, status: 'rejected', outstandingActions: [] };
    }
    await tx.update(retirementReviews).set(set).where(eq(retirementReviews.id, reviewId));
    if (review.approvalId) {
      await tx
        .update(approvalRequests)
        .set({ status: body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : 'cancelled', decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: `${body.decision}: ${body.reason}` })
        .where(and(eq(approvalRequests.id, review.approvalId), eq(approvalRequests.status, 'pending')));
    }
    await audit(tx, ctx, {
      action: `retirement.decision_${body.decision}`,
      targetType: 'retirement_review',
      targetId: reviewId,
      oldValues: { status: review.status },
      newValues: { status: set.status, deferredUntil: set.deferredUntil },
      reason: body.reason,
      approvalId: review.approvalId,
    });
    const recipients = [...(await usersWithPermission(tx, 'retirement.read'))];
    await notify(tx, recipients, {
      type: 'retirement.decision',
      title: `Retirement ${body.decision === 'approve' ? 'approved' : body.decision === 'defer' ? 'deferred' : 'not approved'}: ${emp.legalName}`,
      link: `/retirement/${reviewId}`,
      dedupeKey: `retirement-decision-made:${reviewId}:${body.decision}:${ctx.now().getTime()}`,
    });
    if (body.decision !== 'reject') {
      await notify(tx, [emp.userId], {
        type: 'retirement.decision',
        title: body.decision === 'approve' ? 'A decision has been recorded on your retirement' : 'Your retirement date has been deferred',
        body: body.decision === 'defer' ? `New review date: ${body.deferredUntil}. HR will contact you about next steps.` : 'HR will contact you about next steps.',
        link: '/profile',
      });
    }
    return { status: set.status };
  });
}

export async function completeRetirement(ctx: Ctx, reviewId: string, input: unknown) {
  requirePerm(ctx, 'retirement.decide');
  requireRecentAuth(ctx);
  const body = parse(z.object({ effectiveDate: zDate, reason: zTrim(1000, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const review = await loadReviewForUpdate(tx, reviewId);
    if (!review) throw notFound('Review not found');
    if (review.status !== 'approved') throw conflict('Only approved retirements can be finalized');
    const [emp] = await tx.select().from(employees).where(eq(employees.id, review.employeeId)).for('update');
    if (emp.userId === ctx.actor.userId) throw forbidden('You cannot finalize your own retirement');
    if (emp.userId) {
      await assertNotLastSuperAdmin(tx, emp.userId);
      await tx.update(users).set({ status: 'deactivated', updatedAt: ctx.now() }).where(eq(users.id, emp.userId));
      await revokeAllSessions(tx, emp.userId);
    }
    // The record is archived, never deleted; payroll and history remain intact.
    await tx
      .update(employees)
      .set({ employmentStatus: 'retired', archivedAt: ctx.now(), archivedBy: ctx.actor.userId, archiveReason: `Retired: ${body.reason}`, updatedAt: ctx.now() })
      .where(eq(employees.id, emp.id));
    await tx.insert(employmentHistory).values({
      employeeId: emp.id,
      changeType: 'retirement',
      fromValues: { employmentStatus: emp.employmentStatus },
      toValues: { employmentStatus: 'retired' },
      effectiveDate: body.effectiveDate,
      reason: body.reason,
      actorUserId: ctx.actor.userId,
      approvalId: review.approvalId,
    });
    await tx
      .update(retirementReviews)
      .set({ status: 'completed', completedAt: ctx.now(), completedBy: ctx.actor.userId, outstandingActions: [], updatedAt: ctx.now() })
      .where(eq(retirementReviews.id, reviewId));
    await audit(tx, ctx, {
      action: 'retirement.complete',
      targetType: 'employee',
      targetId: emp.id,
      oldValues: { employmentStatus: emp.employmentStatus },
      newValues: { employmentStatus: 'retired', archived: true, effectiveDate: body.effectiveDate },
      reason: body.reason,
      approvalId: review.approvalId,
    });
    await notify(tx, await usersWithPermission(tx, 'retirement.read'), {
      type: 'retirement.completed',
      title: `Retirement finalized: ${emp.legalName}`,
      link: `/retirement/${reviewId}`,
      dedupeKey: `retirement-completed:${reviewId}`,
    });
    return { status: 'completed' };
  });
}

export async function exportRetirementCsv(ctx: Ctx) {
  requirePerm(ctx, 'retirement.read');
  const rows = await reviewBase(ctx.db).orderBy(asc(retirementReviews.expectedRetirementDate));
  await audit(ctx.db, ctx, { action: 'retirement.export', targetType: 'retirement_review', newValues: { rows: rows.length } });
  return toCsv(
    ['Employment number', 'Name', 'Department', 'Date of birth', 'Expected retirement', 'Deferred until', 'Status', 'Policy'],
    rows.map((r) => [r.employmentNumber, r.legalName, r.departmentName, r.dateOfBirth, r.expectedRetirementDate, r.deferredUntil, r.status, r.policyName]),
  );
}
