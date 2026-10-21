import { z } from 'zod';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  approvalRequests,
  departments,
  employees,
  employmentGrades,
  employmentHistory,
  invitations,
  jobTitles,
  nextOfKin,
  roles,
  userRoles,
  users,
  workLocations,
} from '../db/schema';
import type { Tx } from '../db/client';
import type { Actor, AuthedCtx, Ctx } from '../context';
import {
  CONTROLLED_FIELDS,
  canViewEmployee,
  deniedRecord,
  directFieldsFor,
  employeeVisibilitySql,
  fieldAccess,
  has,
  isSelf,
  proposableFieldsFor,
  requireActor,
  requirePerm,
  requireRecentAuth,
  updateMode,
  ADMIN_DIRECT_FIELDS,
  type EditableField,
} from '../authz/policy';
import { AppError, badRequest, conflict, forbidden } from '../lib/errors';
import {
  parse,
  zDate,
  zEmail,
  zOptDate,
  zOptEmail,
  zOptPhone,
  zOptText,
  zOptUuid,
  zPage,
  zPhone,
  zTrim,
  zUuid,
} from '../lib/validate';
import { ageOn, todayIso } from '../lib/dates';
import { randomToken, sha256 } from '../lib/crypto';
import { toCsv } from '../lib/csv';
import { config } from '../config';
import { revokeAllSessions } from '../auth/sessions';
import { audit, diff } from './audit';
import { notify, usersWithPermission } from './notifications';
import { issueEmploymentNumber } from './employmentNumbers';
import { nextOfKinSchema, validateEmploymentDates, validateOrgRefs } from './auth';
import { assertNotLastSuperAdmin } from './users';
import { ROLE_KEYS, type RoleKey } from '../../shared/permissions';

export type EmployeeRow = typeof employees.$inferSelect;
const supervisor = alias(employees, 'supervisor');

export const CHANGEABLE_STATUSES = ['active', 'on_leave', 'suspended', 'terminated'] as const;

/* ------------------------------------------------------------------ */
/* Loading helpers                                                    */
/* ------------------------------------------------------------------ */

export async function loadEmployee(tx: Tx, id: string, lock = false): Promise<EmployeeRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const q = tx.select().from(employees).where(eq(employees.id, id));
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}

/** Loads an employee the actor may view; otherwise responds as if it does not exist. */
export async function requireViewableEmployee(ctx: AuthedCtx, id: string, tx: Tx = ctx.db): Promise<EmployeeRow> {
  const emp = await loadEmployee(tx, id);
  if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord('Employee');
  return emp;
}

async function labelFor(tx: Tx, field: string, id: unknown): Promise<string | null> {
  if (!id || typeof id !== 'string') return null;
  const lookups: Record<string, () => Promise<{ label: string }[]>> = {
    departmentId: () => tx.select({ label: departments.name }).from(departments).where(eq(departments.id, id)),
    locationId: () => tx.select({ label: workLocations.name }).from(workLocations).where(eq(workLocations.id, id)),
    jobTitleId: () => tx.select({ label: jobTitles.name }).from(jobTitles).where(eq(jobTitles.id, id)),
    gradeId: () => tx.select({ label: employmentGrades.name }).from(employmentGrades).where(eq(employmentGrades.id, id)),
    supervisorId: () => tx.select({ label: employees.legalName }).from(employees).where(eq(employees.id, id)),
  };
  const fn = lookups[field];
  if (!fn) return null;
  const [row] = await fn();
  return row?.label ?? null;
}

/* ------------------------------------------------------------------ */
/* Directory                                                          */
/* ------------------------------------------------------------------ */

const listQuery = zPage.extend({
  q: z.string().trim().max(100).optional(),
  departmentId: z.uuid().optional(),
  locationId: z.uuid().optional(),
  jobTitleId: z.uuid().optional(),
  supervisorId: z.uuid().optional(),
  status: z.enum(['pending_verification', 'active', 'on_leave', 'suspended', 'retired', 'terminated', 'rejected']).optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  sort: z.enum(['name', 'employmentNumber', 'department', 'employmentDate', 'status']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

function directoryWhere(actor: Actor, q: z.infer<typeof listQuery>): SQL {
  const conds: SQL[] = [employeeVisibilitySql(actor)];
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(
      or(
        ilike(employees.legalName, like),
        ilike(employees.preferredName, like),
        ilike(employees.employmentNumber, like),
        ilike(users.username, like),
      )!,
    );
  }
  if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
  if (q.locationId) conds.push(eq(employees.locationId, q.locationId));
  if (q.jobTitleId) conds.push(eq(employees.jobTitleId, q.jobTitleId));
  if (q.supervisorId) conds.push(eq(employees.supervisorId, q.supervisorId));
  if (q.status) conds.push(eq(employees.employmentStatus, q.status));
  else conds.push(ne(employees.employmentStatus, 'rejected'));
  const canArchived = has(actor, 'employee.archive') || has(actor, 'employee.read.all');
  if (q.archived === 'only' && canArchived) conds.push(isNotNull(employees.archivedAt));
  else if (q.archived === 'include' && canArchived) {
    /* no filter */
  } else conds.push(isNull(employees.archivedAt));
  return and(...conds)!;
}

function directoryQuery(tx: Tx) {
  return tx
    .select({
      id: employees.id,
      legalName: employees.legalName,
      preferredName: employees.preferredName,
      employmentNumber: employees.employmentNumber,
      employmentStatus: employees.employmentStatus,
      employmentType: employees.employmentType,
      employmentDate: employees.employmentDate,
      dateOfBirth: employees.dateOfBirth,
      phone: employees.phone,
      personalEmail: employees.personalEmail,
      archivedAt: employees.archivedAt,
      departmentId: employees.departmentId,
      departmentName: departments.name,
      departmentCode: departments.code,
      locationId: employees.locationId,
      locationName: workLocations.name,
      workLocation: employees.workLocation,
      jobTitleId: employees.jobTitleId,
      jobTitleName: jobTitles.name,
      gradeId: employees.gradeId,
      gradeName: employmentGrades.name,
      supervisorId: employees.supervisorId,
      supervisorName: supervisor.legalName,
      username: users.username,
    })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(workLocations, eq(workLocations.id, employees.locationId))
    .leftJoin(jobTitles, eq(jobTitles.id, employees.jobTitleId))
    .leftJoin(employmentGrades, eq(employmentGrades.id, employees.gradeId))
    .leftJoin(supervisor, eq(supervisor.id, employees.supervisorId))
    .leftJoin(users, eq(users.id, employees.userId));
}

type DirectoryRow = Awaited<ReturnType<ReturnType<typeof directoryQuery>['execute']>>[number];

function serializeSummary(actor: Actor, r: DirectoryRow, today: string) {
  const access = fieldAccess(actor, r);
  return {
    id: r.id,
    legalName: r.legalName,
    preferredName: r.preferredName,
    employmentNumber: access.employment ? r.employmentNumber : null,
    employmentStatus: r.employmentStatus,
    employmentType: access.employment ? r.employmentType : null,
    employmentDate: access.employment ? r.employmentDate : null,
    archived: !!r.archivedAt,
    department: { id: r.departmentId, name: r.departmentName, code: r.departmentCode },
    location: r.locationId ? { id: r.locationId, name: r.locationName } : null,
    workLocation: r.workLocation,
    jobTitle: r.jobTitleId ? { id: r.jobTitleId, name: r.jobTitleName } : null,
    grade: r.gradeName,
    gradeId: r.gradeId,
    supervisor: r.supervisorId ? { id: r.supervisorId, name: r.supervisorName } : null,
    age: access.age && r.dateOfBirth ? ageOn(r.dateOfBirth, today) : null,
    dateOfBirth: access.age ? r.dateOfBirth : null,
    phone: access.personal ? r.phone : null,
  };
}

const SORTS = {
  name: employees.legalName,
  employmentNumber: employees.employmentNumber,
  department: departments.name,
  employmentDate: employees.employmentDate,
  status: employees.employmentStatus,
} as const;

export async function listEmployees(ctx: Ctx, query: unknown) {
  requirePerm(ctx, 'employee.read.all', 'employee.read.scoped');
  const q = parse(listQuery, query);
  const where = directoryWhere(ctx.actor, q);
  const order = q.dir === 'desc' ? desc(SORTS[q.sort]) : asc(SORTS[q.sort]);
  const [rows, [{ total }]] = await Promise.all([
    directoryQuery(ctx.db).where(where).orderBy(order, asc(employees.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db
      .select({ total: sql<number>`count(*)::int` })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(users, eq(users.id, employees.userId))
      .where(where),
  ]);
  const today = todayIso(ctx.now());
  return { items: rows.map((r) => serializeSummary(ctx.actor, r, today)), total, page: q.page, pageSize: q.pageSize };
}

/** Lightweight picker (e.g. choosing a supervisor) restricted to visible, active employees. */
export async function employeeOptions(ctx: Ctx, query: unknown) {
  requirePerm(ctx, 'employee.read.all', 'employee.read.scoped', 'payroll.read');
  const q = parse(z.object({ q: z.string().trim().max(100).optional(), departmentId: z.uuid().optional() }), query);
  const conds: SQL[] = [isNull(employees.archivedAt), inArray(employees.employmentStatus, ['active', 'on_leave'])];
  if (!has(ctx.actor, 'payroll.read')) conds.push(employeeVisibilitySql(ctx.actor));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(or(ilike(employees.legalName, like), ilike(employees.employmentNumber, like))!);
  }
  if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
  return ctx.db
    .select({ id: employees.id, legalName: employees.legalName, employmentNumber: employees.employmentNumber, departmentCode: departments.code })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(...conds))
    .orderBy(asc(employees.legalName))
    .limit(25);
}

export async function exportEmployeesCsv(ctx: Ctx, query: unknown) {
  requirePerm(ctx, 'employee.export');
  const q = parse(listQuery.omit({ page: true, pageSize: true }), query);
  const where = directoryWhere(ctx.actor, { ...q, page: 1, pageSize: 1 });
  const rows = await directoryQuery(ctx.db).where(where).orderBy(asc(employees.legalName)).limit(10000);
  const today = todayIso(ctx.now());
  const personal = has(ctx.actor, 'employee.read.personal');
  const age = personal || has(ctx.actor, 'employee.read.age');
  const header = ['Employment number', 'Legal name', 'Preferred name', 'Department', 'Location', 'Work location (as written)', 'Job title', 'Grade', 'Supervisor', 'Status', 'Employment type', 'Employment date'];
  if (age) header.push('Date of birth', 'Age');
  if (personal) header.push('Phone', 'Personal email');
  const data = rows.map((r) => {
    const line: unknown[] = [r.employmentNumber, r.legalName, r.preferredName, r.departmentName, r.locationName, r.workLocation, r.jobTitleName, r.gradeName, r.supervisorName, r.employmentStatus, r.employmentType, r.employmentDate];
    if (age) line.push(r.dateOfBirth, r.dateOfBirth ? ageOn(r.dateOfBirth, today) : '');
    if (personal) line.push(r.phone, r.personalEmail);
    return line;
  });
  await audit(ctx.db, ctx, { action: 'employee.export', targetType: 'employee', newValues: { filters: q, rows: rows.length, personal, age } });
  return toCsv(header, data);
}

/* ------------------------------------------------------------------ */
/* Profile                                                            */
/* ------------------------------------------------------------------ */

export async function getEmployee(ctx: Ctx, id: string) {
  requireActor(ctx);
  const emp = await requireViewableEmployee(ctx, id);
  const access = fieldAccess(ctx.actor, emp);
  const [row] = await directoryQuery(ctx.db).where(eq(employees.id, id));
  const today = todayIso(ctx.now());
  const mode = updateMode(ctx.actor, emp);
  const [nok] = access.nextOfKin ? await ctx.db.select().from(nextOfKin).where(eq(nextOfKin.employeeId, id)) : [];
  const [account] =
    access.account && emp.userId
      ? await ctx.db.select({ id: users.id, username: users.username, email: users.email, status: users.status }).from(users).where(eq(users.id, emp.userId))
      : [];
  const [pendingInvite] =
    !emp.userId && has(ctx.actor, 'employee.create')
      ? await ctx.db
          .select({ email: invitations.email, expiresAt: invitations.expiresAt })
          .from(invitations)
          .where(and(eq(invitations.employeeId, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)))
          .orderBy(desc(invitations.createdAt))
          .limit(1)
      : [];
  const archived = !!emp.archivedAt;
  return {
    ...serializeSummary(ctx.actor, row, today),
    employment: access.employment
      ? {
          employmentNumber: emp.employmentNumber,
          employmentType: emp.employmentType,
          employmentDate: emp.employmentDate,
          contractEndDate: emp.contractEndDate,
          verifiedAt: emp.verifiedAt,
          archivedAt: emp.archivedAt,
          archiveReason: emp.archiveReason,
        }
      : null,
    personal: access.personal
      ? {
          dateOfBirth: emp.dateOfBirth,
          age: emp.dateOfBirth ? ageOn(emp.dateOfBirth, today) : null,
          phone: emp.phone,
          personalEmail: emp.personalEmail,
          address: emp.address,
        }
      : access.age
        ? { dateOfBirth: emp.dateOfBirth, age: emp.dateOfBirth ? ageOn(emp.dateOfBirth, today) : null }
        : null,
    nextOfKin: access.nextOfKin ? (nok ? { fullName: nok.fullName, relationship: nok.relationship, phone: nok.phone, address: nok.address } : null) : undefined,
    account: account ?? null,
    pendingInvitation: pendingInvite ?? null,
    access: {
      ...access,
      updateMode: archived ? 'none' : mode,
      directFields: archived ? [] : directFieldsFor(mode),
      proposableFields: archived ? [] : proposableFieldsFor(mode),
      canEditNextOfKin: !archived && (access.self || mode === 'override'),
      canRequestCorrection: !archived && access.self && emp.employmentStatus !== 'pending_verification',
      canArchive: has(ctx.actor, 'employee.archive') && !access.self,
      canVerify: emp.employmentStatus === 'pending_verification' && has(ctx.actor, 'employee.verify') && !access.self,
      canInvite: !emp.userId && !archived && has(ctx.actor, 'employee.create'),
    },
  };
}

export async function getEmploymentHistory(ctx: Ctx, id: string) {
  requireActor(ctx);
  const emp = await requireViewableEmployee(ctx, id);
  const access = fieldAccess(ctx.actor, emp);
  if (!access.employment) throw deniedRecord('Employee');
  return ctx.db
    .select({
      id: employmentHistory.id,
      changeType: employmentHistory.changeType,
      fromValues: employmentHistory.fromValues,
      toValues: employmentHistory.toValues,
      effectiveDate: employmentHistory.effectiveDate,
      reason: employmentHistory.reason,
      createdAt: employmentHistory.createdAt,
      actorName: users.displayName,
      approvalId: employmentHistory.approvalId,
    })
    .from(employmentHistory)
    .leftJoin(users, eq(users.id, employmentHistory.actorUserId))
    .where(eq(employmentHistory.employeeId, id))
    .orderBy(desc(employmentHistory.createdAt));
}

/* ------------------------------------------------------------------ */
/* Creation, invitations and verification                             */
/* ------------------------------------------------------------------ */

const createSchema = z
  .object({
    legalName: zTrim(160),
    preferredName: zOptText(120),
    dateOfBirth: zDate,
    phone: zOptPhone,
    personalEmail: zOptEmail,
    address: zOptText(500),
    departmentId: zUuid,
    jobTitleId: zOptUuid,
    gradeId: zOptUuid,
    locationId: zOptUuid,
    workLocation: zOptText(160),
    supervisorId: zOptUuid,
    employmentDate: zDate,
    employmentType: z.enum(['permanent', 'contract', 'temporary', 'volunteer', 'intern']),
    contractEndDate: zOptDate,
    nextOfKin: nextOfKinSchema.optional(),
    invite: z.object({ email: zEmail, roleKey: z.enum(ROLE_KEYS).default('employee') }).strict().optional(),
  })
  .strict();

async function validateSupervisor(tx: Tx, employeeId: string | null, supervisorId: string | null | undefined) {
  if (!supervisorId) return;
  if (supervisorId === employeeId) throw badRequest('Validation failed', { fields: { supervisorId: 'An employee cannot supervise themselves' } });
  const sup = await loadEmployee(tx, supervisorId);
  if (!sup || sup.archivedAt || !['active', 'on_leave'].includes(sup.employmentStatus)) {
    throw badRequest('Validation failed', { fields: { supervisorId: 'Select an active supervisor' } });
  }
  // Reject reporting cycles.
  let cursor: string | null = sup.supervisorId;
  for (let i = 0; cursor && i < 50; i++) {
    if (cursor === employeeId) throw badRequest('Validation failed', { fields: { supervisorId: 'This would create a reporting cycle' } });
    const next = await loadEmployee(tx, cursor);
    cursor = next?.supervisorId ?? null;
  }
}

async function assertInviteRoleAllowed(ctx: AuthedCtx, roleKey: RoleKey) {
  if (roleKey !== 'employee') {
    if (!has(ctx.actor, 'role.assign')) throw forbidden('Only a super admin can pre-provision privileged roles');
    requireRecentAuth(ctx);
  }
}

async function createInvitationTx(tx: Tx, ctx: AuthedCtx, employeeId: string, email: string, roleKey: RoleKey) {
  const [emailTaken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  if (emailTaken) throw conflict('That email address already belongs to an account');
  await tx
    .update(invitations)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(invitations.employeeId, employeeId), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  const token = randomToken(32);
  await tx.insert(invitations).values({
    tokenHash: sha256(token),
    email,
    employeeId,
    roleKey,
    createdBy: ctx.actor.userId,
    expiresAt: new Date(ctx.now().getTime() + 7 * 24 * 3600_000),
  });
  await audit(tx, ctx, { action: 'employee.invitation_created', targetType: 'employee', targetId: employeeId, newValues: { email, roleKey } });
  // Email delivery is an integration boundary: the link is returned once for out-of-band delivery.
  return { inviteUrl: `${config.appUrl.replace(/\/$/, '')}/invite/${token}`, expiresInDays: 7 };
}

/** Administrators create records directly. Holders of employee.verify activate them immediately. */
export async function createEmployee(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'employee.create');
  const body = parse(createSchema, input);
  validateEmploymentDates(body, todayIso(ctx.now()));
  if (body.invite) await assertInviteRoleAllowed(ctx, body.invite.roleKey);
  const verifyNow = has(ctx.actor, 'employee.verify');
  return ctx.db.transaction(async (tx) => {
    await validateOrgRefs(tx, body);
    await validateSupervisor(tx, null, body.supervisorId);
    const { nextOfKin: nok, invite, ...profile } = body;
    const employmentNumber = verifyNow ? await issueEmploymentNumber(tx, profile.departmentId) : null;
    const [emp] = await tx
      .insert(employees)
      .values({
        ...profile,
        employmentNumber,
        numberDepartmentId: verifyNow ? profile.departmentId : null,
        employmentStatus: verifyNow ? 'active' : 'pending_verification',
        verifiedAt: verifyNow ? ctx.now() : null,
        verifiedBy: verifyNow ? ctx.actor.userId : null,
        createdBy: ctx.actor.userId,
      })
      .returning();
    if (nok) await tx.insert(nextOfKin).values({ ...nok, employeeId: emp.id });
    await tx.insert(employmentHistory).values({
      employeeId: emp.id,
      changeType: 'hire',
      toValues: { departmentId: emp.departmentId, departmentName: await labelFor(tx, 'departmentId', emp.departmentId), employmentNumber },
      effectiveDate: emp.employmentDate ?? todayIso(ctx.now()),
      actorUserId: ctx.actor.userId,
      reason: 'Record created by administrator',
    });
    if (!verifyNow) {
      await tx.insert(approvalRequests).values({
        type: 'registration',
        targetType: 'employee',
        targetId: emp.id,
        departmentId: emp.departmentId,
        summary: `New employee record: ${emp.legalName}`,
        requiredPermission: 'employee.verify',
        requestedBy: ctx.actor.userId,
      });
    }
    await audit(tx, ctx, {
      action: 'employee.create',
      targetType: 'employee',
      targetId: emp.id,
      newValues: { legalName: emp.legalName, departmentId: emp.departmentId, employmentNumber, status: emp.employmentStatus },
    });
    const invitation = invite ? await createInvitationTx(tx, ctx, emp.id, invite.email, invite.roleKey) : null;
    return { id: emp.id, employmentNumber, status: emp.employmentStatus, invitation };
  });
}

export async function inviteEmployee(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'employee.create');
  const body = parse(z.object({ email: zEmail, roleKey: z.enum(ROLE_KEYS).default('employee') }).strict(), input);
  await assertInviteRoleAllowed(ctx, body.roleKey);
  return ctx.db.transaction(async (tx) => {
    const emp = await requireViewableEmployee(ctx, id, tx);
    if (emp.userId) throw conflict('This employee already has an account');
    if (emp.archivedAt) throw badRequest('Restore the employee before inviting them');
    return createInvitationTx(tx, ctx, emp.id, body.email, body.roleKey);
  });
}

const verifySchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: zOptText(500),
    corrections: z
      .object({
        departmentId: zUuid.optional(),
        jobTitleId: zOptUuid,
        gradeId: zOptUuid,
        locationId: zOptUuid,
        supervisorId: zOptUuid,
        employmentDate: zDate.optional(),
        employmentType: z.enum(['permanent', 'contract', 'temporary', 'volunteer', 'intern']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Verifies (or rejects) a pending registration. On approval the employment number is issued
 * inside the same transaction that activates the record, using the final department.
 */
export async function verifyRegistration(ctx: Ctx, id: string, input: unknown, approvalId?: string) {
  requirePerm(ctx, 'employee.verify');
  const raw = (input ?? {}) as { corrections?: Record<string, unknown> };
  const body = parse(verifySchema, input);
  if (body.decision === 'reject' && !body.reason) throw badRequest('Validation failed', { fields: { reason: 'A reason is required when rejecting' } });
  const result = await ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord('Employee');
    if (isSelf(ctx.actor, emp)) throw forbidden('You cannot verify your own registration');
    if (emp.employmentStatus !== 'pending_verification') throw conflict('This registration has already been processed');
    const [pending] = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.type, 'registration'), eq(approvalRequests.targetId, id), eq(approvalRequests.status, 'pending')));
    const reqId = approvalId ?? pending?.id ?? null;

    if (body.decision === 'reject') {
      await tx.update(employees).set({ employmentStatus: 'rejected', updatedAt: ctx.now() }).where(eq(employees.id, id));
      if (emp.userId) {
        await tx.update(users).set({ status: 'deactivated', updatedAt: ctx.now() }).where(eq(users.id, emp.userId));
        await revokeAllSessions(tx, emp.userId);
      }
      if (reqId) {
        await tx
          .update(approvalRequests)
          .set({ status: 'rejected', decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason })
          .where(eq(approvalRequests.id, reqId));
      }
      await audit(tx, ctx, { action: 'employee.registration_rejected', targetType: 'employee', targetId: id, reason: body.reason, approvalId: reqId });
      return { status: 'rejected' as const, employmentNumber: null };
    }

    const provided = Object.keys(raw.corrections ?? {});
    const corrections = Object.fromEntries(
      Object.entries(body.corrections ?? {}).filter(([k]) => provided.includes(k)),
    ) as Partial<EmployeeRow>;
    const final = { ...emp, ...corrections };
    await validateOrgRefs(tx, final);
    await validateSupervisor(tx, emp.id, final.supervisorId);
    validateEmploymentDates(final, todayIso(ctx.now()));
    const employmentNumber = await issueEmploymentNumber(tx, final.departmentId);
    await tx
      .update(employees)
      .set({
        ...corrections,
        employmentNumber,
        numberDepartmentId: final.departmentId,
        employmentStatus: 'active',
        verifiedAt: ctx.now(),
        verifiedBy: ctx.actor.userId,
        updatedAt: ctx.now(),
      })
      .where(eq(employees.id, id));
    if (emp.userId) {
      await tx.update(users).set({ status: 'active', updatedAt: ctx.now() }).where(eq(users.id, emp.userId));
      const [hasRole] = await tx.select({ r: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, emp.userId));
      if (!hasRole) {
        const [role] = await tx.select().from(roles).where(eq(roles.key, 'employee'));
        await tx.insert(userRoles).values({ userId: emp.userId, roleId: role.id, grantedBy: ctx.actor.userId });
      }
    }
    await tx.insert(employmentHistory).values({
      employeeId: id,
      changeType: 'hire',
      fromValues: provided.length ? Object.fromEntries(provided.map((k) => [k, (emp as Record<string, unknown>)[k]])) : null,
      toValues: { departmentId: final.departmentId, departmentName: await labelFor(tx, 'departmentId', final.departmentId), employmentNumber },
      effectiveDate: final.employmentDate ?? todayIso(ctx.now()),
      actorUserId: ctx.actor.userId,
      approvalId: reqId,
      reason: body.reason ?? 'Registration verified',
    });
    if (reqId) {
      await tx
        .update(approvalRequests)
        .set({ status: 'approved', decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason })
        .where(eq(approvalRequests.id, reqId));
    }
    await audit(tx, ctx, {
      action: 'employee.verified',
      targetType: 'employee',
      targetId: id,
      oldValues: { status: 'pending_verification' },
      newValues: { status: 'active', employmentNumber, ...corrections },
      reason: body.reason,
      approvalId: reqId,
    });
    await notify(tx, [emp.userId], {
      type: 'registration.approved',
      title: 'Your registration has been verified',
      body: `Welcome! Your employment number is ${employmentNumber}.`,
      link: '/profile',
      dedupeKey: `registration-approved:${id}`,
    });
    return { status: 'active' as const, employmentNumber };
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Updates                                                            */
/* ------------------------------------------------------------------ */

const changeFields = {
  legalName: zTrim(160),
  preferredName: zOptText(120),
  dateOfBirth: zDate,
  phone: zOptPhone,
  personalEmail: zOptEmail,
  address: zOptText(500),
  workLocation: zOptText(160),
  departmentId: zUuid,
  locationId: zOptUuid,
  jobTitleId: zOptUuid,
  gradeId: zOptUuid,
  supervisorId: zOptUuid,
  employmentDate: zDate,
  employmentType: z.enum(['permanent', 'contract', 'temporary', 'volunteer', 'intern']),
  contractEndDate: zOptDate,
  employmentStatus: z.enum(CHANGEABLE_STATUSES),
} satisfies Record<EditableField, z.ZodType>;

const changesSchema = z.object(Object.fromEntries(Object.entries(changeFields).map(([k, v]) => [k, v.optional()]))).strict();

/** Parses a partial change set, keeping only keys the client actually sent (so `null` clears but absence keeps). */
export function parseChanges(raw: unknown): Partial<Record<EditableField, unknown>> {
  const parsed = parse(changesSchema, raw ?? {}) as Record<string, unknown>;
  const provided = Object.keys((raw ?? {}) as object);
  return Object.fromEntries(provided.filter((k) => k in changeFields).map((k) => [k, parsed[k] ?? null])) as Partial<Record<EditableField, unknown>>;
}

const HISTORY_TYPE: Partial<Record<EditableField, string>> = {
  departmentId: 'transfer',
  locationId: 'location_change',
  jobTitleId: 'title_change',
  gradeId: 'grade_change',
  supervisorId: 'supervisor_change',
  employmentStatus: 'status_change',
  legalName: 'correction',
  dateOfBirth: 'correction',
  employmentDate: 'correction',
  employmentType: 'contract_change',
  contractEndDate: 'contract_change',
};

/**
 * Applies validated changes to an employee inside a transaction: writes the record, employment
 * history (one entry per change category) and the audit trail, and handles side effects.
 */
export async function applyEmployeeChanges(
  tx: Tx,
  ctx: AuthedCtx,
  emp: EmployeeRow,
  changes: Partial<Record<EditableField, unknown>>,
  opts: { reason?: string | null; approvalId?: string | null; action: string; effectiveDate?: string },
) {
  const d = diff(emp as unknown as Record<string, unknown>, changes as Record<string, unknown>);
  if (!d.changed.length) return { changed: [] as string[] };
  if (emp.archivedAt) throw conflict('Archived records cannot be changed. Restore the record first.');
  const final = { ...emp, ...changes } as EmployeeRow;
  if ('employmentStatus' in d.newValues && emp.employmentStatus === 'pending_verification') {
    throw badRequest('Pending registrations must be verified before their status can change');
  }
  if ('employmentStatus' in d.newValues && ['retired', 'rejected'].includes(emp.employmentStatus)) {
    throw badRequest('This employment record is closed');
  }
  await validateOrgRefs(tx, {
    departmentId: 'departmentId' in d.newValues ? final.departmentId : null,
    jobTitleId: 'jobTitleId' in d.newValues ? final.jobTitleId : null,
    gradeId: 'gradeId' in d.newValues ? final.gradeId : null,
    locationId: 'locationId' in d.newValues ? final.locationId : null,
  });
  if ('jobTitleId' in d.newValues || 'departmentId' in d.newValues) {
    if (final.jobTitleId) await validateOrgRefs(tx, { jobTitleId: final.jobTitleId, departmentId: final.departmentId });
  }
  if ('supervisorId' in d.newValues) await validateSupervisor(tx, emp.id, final.supervisorId);
  validateEmploymentDates(final, todayIso(ctx.now()));

  await tx.update(employees).set({ ...(changes as Partial<EmployeeRow>), updatedAt: ctx.now() }).where(eq(employees.id, emp.id));

  const effectiveDate = opts.effectiveDate ?? todayIso(ctx.now());
  const groups = new Map<string, { from: Record<string, unknown>; to: Record<string, unknown> }>();
  for (const key of d.changed as EditableField[]) {
    const type = HISTORY_TYPE[key];
    if (!type) continue;
    const g = groups.get(type) ?? { from: {}, to: {} };
    g.from[key] = d.oldValues[key];
    g.to[key] = d.newValues[key];
    const label = key.endsWith('Id') ? key.slice(0, -2) + 'Name' : null;
    if (label) {
      g.from[label] = await labelFor(tx, key, d.oldValues[key]);
      g.to[label] = await labelFor(tx, key, d.newValues[key]);
    }
    groups.set(type, g);
  }
  for (const [changeType, g] of groups) {
    await tx.insert(employmentHistory).values({
      employeeId: emp.id,
      changeType,
      fromValues: g.from,
      toValues: g.to,
      effectiveDate,
      reason: opts.reason ?? null,
      actorUserId: ctx.actor.userId,
      approvalId: opts.approvalId ?? null,
    });
  }

  if (d.newValues.employmentStatus === 'terminated' && emp.userId) {
    await assertNotLastSuperAdmin(tx, emp.userId);
    await tx.update(users).set({ status: 'deactivated', updatedAt: ctx.now() }).where(eq(users.id, emp.userId));
    await revokeAllSessions(tx, emp.userId);
  }
  await audit(tx, ctx, {
    action: opts.action,
    targetType: 'employee',
    targetId: emp.id,
    oldValues: d.oldValues,
    newValues: d.newValues,
    reason: opts.reason,
    approvalId: opts.approvalId,
  });
  if (groups.has('transfer')) {
    await notify(tx, [emp.userId], {
      type: 'employee.transfer',
      title: 'Your department has changed',
      body: `You have been transferred to ${groups.get('transfer')!.to.departmentName ?? 'a new department'}. Your employment number is unchanged.`,
      link: '/profile',
    });
  }
  return { changed: d.changed };
}

const updateSchema = z.object({ changes: z.unknown(), nextOfKin: nextOfKinSchema.optional(), reason: zOptText(500) }).strict();

export async function updateEmployee(ctx: Ctx, id: string, input: unknown) {
  requireActor(ctx);
  const body = parse(updateSchema, input);
  const changes = parseChanges(body.changes);
  return ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord('Employee');
    const mode = updateMode(ctx.actor, emp);
    if (mode === 'none') throw forbidden('You cannot edit this employee');
    if (emp.archivedAt) throw conflict('Archived records cannot be changed. Restore the record first.');
    const direct = new Set(directFieldsFor(mode));
    const proposable = new Set(proposableFieldsFor(mode));
    const effective = diff(emp as unknown as Record<string, unknown>, changes as Record<string, unknown>);
    const denied = effective.changed.filter((k) => !direct.has(k) && !proposable.has(k));
    if (denied.length) {
      throw new AppError(403, 'FIELD_FORBIDDEN', mode === 'self'
        ? 'Some fields can only be changed through a correction request'
        : 'You are not allowed to change some of these fields', { fields: Object.fromEntries(denied.map((k) => [k, 'Not editable'])) });
    }
    const directChanges = Object.fromEntries(effective.changed.filter((k) => direct.has(k)).map((k) => [k, effective.newValues[k]]));
    const proposed = Object.fromEntries(effective.changed.filter((k) => proposable.has(k)).map((k) => [k, effective.newValues[k]]));
    const isOverride = mode === 'override' && Object.keys(directChanges).some((k) => (CONTROLLED_FIELDS as readonly string[]).includes(k) && !(ADMIN_DIRECT_FIELDS as readonly string[]).includes(k));
    if (isOverride && (!body.reason || body.reason.length < 5)) {
      throw badRequest('Validation failed', { fields: { reason: 'A reason is required for executive overrides of controlled fields' } });
    }
    if (body.nextOfKin && !(mode === 'self' || mode === 'override')) throw forbidden('You cannot change next-of-kin details for this employee');

    const applied = await applyEmployeeChanges(tx, ctx, emp, directChanges, {
      reason: body.reason,
      action: isOverride ? 'employee.override' : mode === 'self' ? 'employee.self_update' : 'employee.update',
    });

    if (body.nextOfKin) {
      const [old] = await tx.select().from(nextOfKin).where(eq(nextOfKin.employeeId, id));
      if (old) await tx.update(nextOfKin).set({ ...body.nextOfKin, updatedAt: ctx.now() }).where(eq(nextOfKin.employeeId, id));
      else await tx.insert(nextOfKin).values({ ...body.nextOfKin, employeeId: id });
      await audit(tx, ctx, { action: 'employee.next_of_kin_update', targetType: 'employee', targetId: id, reason: body.reason });
    }

    let approval: { id: string } | null = null;
    if (Object.keys(proposed).length) {
      const before = Object.fromEntries(Object.keys(proposed).map((k) => [k, (emp as Record<string, unknown>)[k] ?? null]));
      [approval] = await tx
        .insert(approvalRequests)
        .values({
          type: 'employee_change',
          targetType: 'employee',
          targetId: id,
          departmentId: emp.departmentId,
          summary: `Change to ${emp.legalName}: ${Object.keys(proposed).join(', ')}`,
          payload: { changes: proposed, before },
          reason: body.reason,
          requiredPermission: 'employee.approve_changes',
          requestedBy: ctx.actor.userId,
        })
        .returning({ id: approvalRequests.id });
      await audit(tx, ctx, { action: 'employee.change_requested', targetType: 'employee', targetId: id, oldValues: before, newValues: proposed, reason: body.reason, approvalId: approval.id });
      await notify(tx, await usersWithPermission(tx, 'employee.approve_changes'), {
        type: 'approval.pending',
        title: 'Employment change awaiting approval',
        body: `A change to ${emp.legalName}'s employment record needs your decision.`,
        link: `/approvals?id=${approval.id}`,
        dedupeKey: `approval:${approval.id}`,
      });
    }
    return { applied: applied.changed, pendingApprovalId: approval?.id ?? null, pendingFields: Object.keys(proposed) };
  });
}

/** Employees request corrections to protected fields; reviewers decide via the approval queue. */
export async function requestCorrection(ctx: Ctx, id: string, input: unknown) {
  requireActor(ctx);
  const body = parse(z.object({ changes: z.unknown(), reason: zTrim(1000, 5) }).strict(), input);
  const changes = parseChanges(body.changes);
  return ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id);
    if (!emp || !isSelf(ctx.actor, emp)) throw deniedRecord('Employee');
    if (emp.archivedAt || emp.employmentStatus === 'pending_verification') throw badRequest('Corrections are not available for this record');
    if ('employmentStatus' in changes) throw badRequest('Employment status cannot be changed by request');
    const d = diff(emp as unknown as Record<string, unknown>, changes as Record<string, unknown>);
    if (!d.changed.length) throw badRequest('No changes were requested');
    const operationalOnly = d.changed.every((k) => (ADMIN_DIRECT_FIELDS as readonly string[]).includes(k));
    const [approval] = await tx
      .insert(approvalRequests)
      .values({
        type: 'profile_correction',
        targetType: 'employee',
        targetId: id,
        departmentId: emp.departmentId,
        summary: `Correction request from ${emp.legalName}: ${d.changed.join(', ')}`,
        payload: { changes: d.newValues, before: d.oldValues },
        reason: body.reason,
        requiredPermission: operationalOnly ? 'employee.update.all' : 'employee.approve_changes',
        requestedBy: ctx.actor.userId,
      })
      .returning({ id: approvalRequests.id, requiredPermission: approvalRequests.requiredPermission });
    await audit(tx, ctx, { action: 'employee.correction_requested', targetType: 'employee', targetId: id, oldValues: d.oldValues, newValues: d.newValues, reason: body.reason, approvalId: approval.id });
    await notify(tx, await usersWithPermission(tx, approval.requiredPermission as 'employee.update.all'), {
      type: 'approval.pending',
      title: 'Correction request awaiting review',
      body: `${emp.legalName} has asked for a correction to their employment record.`,
      link: `/approvals?id=${approval.id}`,
      dedupeKey: `approval:${approval.id}`,
    });
    return { approvalId: approval.id };
  });
}

/* ------------------------------------------------------------------ */
/* Archive / restore                                                  */
/* ------------------------------------------------------------------ */

export async function archiveEmployee(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'employee.archive');
  const body = parse(z.object({ reason: zTrim(500, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord('Employee');
    if (isSelf(ctx.actor, emp)) throw forbidden('You cannot archive your own record');
    if (emp.archivedAt) throw conflict('Already archived');
    if (emp.userId) {
      await assertNotLastSuperAdmin(tx, emp.userId);
      await tx.update(users).set({ status: 'deactivated', updatedAt: ctx.now() }).where(eq(users.id, emp.userId));
      await revokeAllSessions(tx, emp.userId);
    }
    await tx.update(employees).set({ archivedAt: ctx.now(), archivedBy: ctx.actor.userId, archiveReason: body.reason, updatedAt: ctx.now() }).where(eq(employees.id, id));
    await tx.insert(employmentHistory).values({ employeeId: id, changeType: 'archive', effectiveDate: todayIso(ctx.now()), reason: body.reason, actorUserId: ctx.actor.userId });
    await audit(tx, ctx, { action: 'employee.archive', targetType: 'employee', targetId: id, reason: body.reason });
    return { archived: true };
  });
}

export async function restoreEmployee(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'employee.archive');
  const body = parse(z.object({ reason: zTrim(500, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord('Employee');
    if (!emp.archivedAt) throw conflict('Record is not archived');
    await tx.update(employees).set({ archivedAt: null, archivedBy: null, archiveReason: null, updatedAt: ctx.now() }).where(eq(employees.id, id));
    if (emp.userId && ['active', 'on_leave'].includes(emp.employmentStatus)) {
      await tx.update(users).set({ status: 'active', updatedAt: ctx.now() }).where(eq(users.id, emp.userId));
    }
    await tx.insert(employmentHistory).values({ employeeId: id, changeType: 'restore', effectiveDate: todayIso(ctx.now()), reason: body.reason, actorUserId: ctx.actor.userId });
    await audit(tx, ctx, { action: 'employee.restore', targetType: 'employee', targetId: id, reason: body.reason });
    return { archived: false };
  });
}
