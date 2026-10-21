import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { employees } from '../db/schema';
import type { Actor, Ctx, AuthedCtx } from '../context';
import type { Permission } from '../../shared/permissions';
import { AppError, forbidden, notFound, reauthRequired, unauthorized } from '../lib/errors';
import { config } from '../config';

/* ------------------------------------------------------------------ */
/* Primitive checks (deny by default)                                 */
/* ------------------------------------------------------------------ */

export function has(actor: Actor | null | undefined, perm: Permission): boolean {
  return !!actor && actor.status === 'active' && actor.permissions.has(perm);
}

export function hasAny(actor: Actor | null | undefined, perms: Permission[]): boolean {
  return perms.some((p) => has(actor, p));
}

export function requireActor(ctx: Ctx): asserts ctx is AuthedCtx {
  if (!ctx.actor) throw unauthorized();
  if (ctx.actor.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_NOT_ACTIVE', 'Your account is not active yet');
  }
}

export function requirePerm(ctx: Ctx, ...perms: Permission[]): asserts ctx is AuthedCtx {
  requireActor(ctx);
  if (!perms.some((p) => ctx.actor!.permissions.has(p))) {
    const err = forbidden();
    (err as AppError & { auditDenied?: string }).auditDenied = perms.join('|');
    throw err;
  }
}

/** Sensitive operations need a password confirmation within the configured window. */
export function requireRecentAuth(ctx: AuthedCtx): void {
  const at = ctx.actor.reauthAt?.getTime() ?? 0;
  if (ctx.now().getTime() - at > config.session.reauthWindowMinutes * 60_000) throw reauthRequired();
}

/** Denied access to a specific record is reported as 404 so record existence is not disclosed. */
export function deniedRecord(what = 'Record'): AppError {
  const err = notFound(`${what} not found`);
  (err as AppError & { auditDenied?: string }).auditDenied = 'record';
  return err;
}

/* ------------------------------------------------------------------ */
/* Employee visibility & scope                                        */
/* ------------------------------------------------------------------ */

export interface EmployeeScopeFields {
  id: string;
  departmentId: string;
  locationId: string | null;
  supervisorId: string | null;
}

export function isSelf(actor: Actor, emp: Pick<EmployeeScopeFields, 'id'>): boolean {
  return !!actor.employeeId && actor.employeeId === emp.id;
}

export function inModeratorScope(actor: Actor, emp: EmployeeScopeFields): boolean {
  return actor.scopes.some((s) =>
    s.scopeType === 'direct_reports'
      ? !!actor.employeeId && emp.supervisorId === actor.employeeId
      : (!s.departmentId || s.departmentId === emp.departmentId) && (!s.locationId || s.locationId === emp.locationId),
  );
}

/** Can the actor see this employee's employment record (beyond their own)? */
export function canViewEmployee(actor: Actor, emp: EmployeeScopeFields): boolean {
  if (actor.status !== 'active') return false;
  if (isSelf(actor, emp)) return true;
  if (has(actor, 'employee.read.all')) return true;
  if (has(actor, 'employee.read.scoped') && inModeratorScope(actor, emp)) return true;
  return false;
}

/** SQL predicate restricting employee queries to rows the actor may view. */
export function employeeVisibilitySql(actor: Actor): SQL {
  if (has(actor, 'employee.read.all')) return sql`true`;
  const clauses: SQL[] = [];
  if (actor.employeeId) clauses.push(eq(employees.id, actor.employeeId));
  if (has(actor, 'employee.read.scoped')) {
    for (const s of actor.scopes) {
      if (s.scopeType === 'direct_reports') {
        if (actor.employeeId) clauses.push(eq(employees.supervisorId, actor.employeeId));
      } else {
        const parts: SQL[] = [];
        if (s.departmentId) parts.push(eq(employees.departmentId, s.departmentId));
        if (s.locationId) parts.push(eq(employees.locationId, s.locationId));
        if (parts.length) clauses.push(and(...parts)!);
      }
    }
  }
  return clauses.length ? or(...clauses)! : sql`false`;
}

/** Non-self visibility only (used for directory/report counts that exclude the actor's own record). */
export function canSeeOthers(actor: Actor): boolean {
  return has(actor, 'employee.read.all') || (has(actor, 'employee.read.scoped') && actor.scopes.length > 0);
}

/* ------------------------------------------------------------------ */
/* Field-level access                                                 */
/* ------------------------------------------------------------------ */

export interface FieldAccess {
  self: boolean;
  employment: boolean;
  personal: boolean;
  age: boolean;
  nextOfKin: boolean;
  account: boolean;
  payroll: boolean;
  retirement: boolean;
  approvals: boolean;
  audit: boolean;
  documents: boolean;
  manageDocuments: boolean;
}

export function fieldAccess(actor: Actor, emp: EmployeeScopeFields): FieldAccess {
  const self = isSelf(actor, emp);
  const view = canViewEmployee(actor, emp);
  const none: FieldAccess = {
    self: false, employment: false, personal: false, age: false, nextOfKin: false, account: false,
    payroll: false, retirement: false, approvals: false, audit: false, documents: false, manageDocuments: false,
  };
  if (!view) return none;
  const personal = self || has(actor, 'employee.read.personal');
  return {
    self,
    employment: true,
    personal,
    age: personal || has(actor, 'employee.read.age'),
    nextOfKin: self || has(actor, 'employee.read.next_of_kin'),
    account: self || has(actor, 'user.manage') || has(actor, 'role.assign'),
    payroll: self || has(actor, 'payroll.read'),
    retirement: has(actor, 'retirement.read'),
    approvals: self || has(actor, 'approval.read'),
    audit: has(actor, 'audit.read'),
    documents: self || has(actor, 'document.manage'),
    manageDocuments: has(actor, 'document.manage') && (!self || has(actor, 'employee.override')),
  };
}

/* ------------------------------------------------------------------ */
/* Employee update policy                                             */
/* ------------------------------------------------------------------ */

/** Fields an employee may change on their own record. */
export const SELF_FIELDS = ['preferredName', 'phone', 'personalEmail', 'address', 'workLocation'] as const;
/** Operational fields administrators may change directly. */
export const ADMIN_DIRECT_FIELDS = [...SELF_FIELDS, 'jobTitleId', 'gradeId', 'supervisorId', 'locationId'] as const;
/** Moderators may directly change only low-risk fields; reporting/location moves need approval. */
export const MODERATOR_DIRECT_FIELDS = [...SELF_FIELDS, 'jobTitleId', 'gradeId'] as const;
/** Authoritative fields that always go through approval unless an executive override is used. */
export const CONTROLLED_FIELDS = [
  'legalName',
  'dateOfBirth',
  'departmentId',
  'employmentDate',
  'employmentType',
  'contractEndDate',
  'employmentStatus',
  'supervisorId',
  'locationId',
] as const;
export const EDITABLE_FIELDS = [...new Set([...ADMIN_DIRECT_FIELDS, ...CONTROLLED_FIELDS])] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export type UpdateMode = 'override' | 'admin' | 'moderator' | 'self' | 'none';

/**
 * Determines how the actor may edit this employee. Acting on one's own record never grants
 * more than self-service rights, except for an executive override — this prevents privilege
 * escalation through profile edits.
 */
export function updateMode(actor: Actor, emp: EmployeeScopeFields): UpdateMode {
  if (actor.status !== 'active') return 'none';
  const self = isSelf(actor, emp);
  if (has(actor, 'employee.override') && has(actor, 'employee.update.all')) return 'override';
  if (self) return 'self';
  if (has(actor, 'employee.update.all') && canViewEmployee(actor, emp)) return 'admin';
  if (has(actor, 'employee.update.scoped') && inModeratorScope(actor, emp)) return 'moderator';
  return 'none';
}

export function directFieldsFor(mode: UpdateMode): readonly string[] {
  switch (mode) {
    case 'override':
      return EDITABLE_FIELDS;
    case 'admin':
      return ADMIN_DIRECT_FIELDS;
    case 'moderator':
      return MODERATOR_DIRECT_FIELDS;
    case 'self':
      return SELF_FIELDS;
    default:
      return [];
  }
}

/** Fields the actor may propose for approval (not applied directly). */
export function proposableFieldsFor(mode: UpdateMode): readonly string[] {
  if (mode === 'admin' || mode === 'moderator') {
    const direct = new Set(directFieldsFor(mode));
    return CONTROLLED_FIELDS.filter((f) => !direct.has(f));
  }
  return [];
}
