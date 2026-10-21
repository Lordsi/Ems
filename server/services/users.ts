import { z } from 'zod';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  departments,
  employees,
  moderatorScopes,
  permissions,
  roles,
  userPermissionGrants,
  userRoles,
  users,
  workLocations,
} from '../db/schema';
import type { Tx } from '../db/client';
import type { AuthedCtx, Ctx } from '../context';
import { has, hasAny, requirePerm, requireRecentAuth } from '../authz/policy';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { parse, zPage, zTrim } from '../lib/validate';
import { hashPassword, randomToken } from '../lib/crypto';
import { revokeAllSessions } from '../auth/sessions';
import { audit } from './audit';
import { notify } from './notifications';
import { ALL_PERMISSIONS, ROLE_KEYS, ROLE_META, type RoleKey } from '../../shared/permissions';
import { countActiveSuperAdmins } from './auth';

export async function isActiveSuperAdmin(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.key, 'super_admin')))
    .where(and(eq(users.id, userId), eq(users.status, 'active')));
  return !!row;
}

/** Throws if removing/deactivating `userId` would leave the organisation without an active super admin. */
export async function assertNotLastSuperAdmin(tx: Tx, userId: string) {
  if ((await isActiveSuperAdmin(tx, userId)) && (await countActiveSuperAdmins(tx)) <= 1) {
    throw conflict('This is the last active super admin account. Promote another super admin first.');
  }
}

export async function rolesOf(tx: Tx, userId: string): Promise<RoleKey[]> {
  const rows = await tx
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.key as RoleKey);
}

function requireUserAdmin(ctx: Ctx): asserts ctx is AuthedCtx {
  requirePerm(ctx, 'role.assign', 'user.manage', 'scope.manage');
}

/* ------------------------------------------------------------------ */
/* Listing                                                            */
/* ------------------------------------------------------------------ */

export async function listUsers(ctx: Ctx, query: unknown) {
  requireUserAdmin(ctx);
  const q = parse(
    zPage.extend({
      q: z.string().trim().max(100).optional(),
      role: z.enum(ROLE_KEYS).optional(),
      status: z.enum(['pending_verification', 'active', 'suspended', 'deactivated']).optional(),
    }),
    query,
  );
  const conds = [];
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
    conds.push(or(ilike(users.displayName, like), ilike(users.username, like), ilike(users.email, like), ilike(employees.employmentNumber, like)));
  }
  if (q.status) conds.push(eq(users.status, q.status));
  if (q.role) {
    conds.push(
      sql`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = ${users.id} and r.key = ${q.role})`,
    );
  }
  const where = conds.length ? and(...conds) : undefined;
  const rows = await ctx.db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      email: users.email,
      status: users.status,
      mfaEnabled: users.mfaEnabled,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      employeeId: employees.id,
      employmentNumber: employees.employmentNumber,
    })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(where)
    .orderBy(asc(users.displayName))
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize);
  const [{ total }] = await ctx.db
    .select({ total: sql<number>`count(*)::int` })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(where);
  const ids = rows.map((r) => r.id);
  const roleRows = ids.length
    ? await ctx.db
        .select({ userId: userRoles.userId, key: roles.key })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(inArray(userRoles.userId, ids))
    : [];
  return {
    items: rows.map((r) => ({ ...r, roles: roleRows.filter((x) => x.userId === r.id).map((x) => x.key) })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function getUser(ctx: Ctx, userId: string) {
  requireUserAdmin(ctx);
  const [u] = await ctx.db
    .select({
      id: users.id,
      displayName: users.displayName,
      username: users.username,
      email: users.email,
      status: users.status,
      mfaEnabled: users.mfaEnabled,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      employeeId: employees.id,
      employmentNumber: employees.employmentNumber,
      legalName: employees.legalName,
    })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(eq(users.id, userId));
  if (!u) throw notFound('User not found');
  const [userRoleKeys, grants, scopes] = await Promise.all([
    rolesOf(ctx.db, userId),
    ctx.db.select().from(userPermissionGrants).where(eq(userPermissionGrants.userId, userId)),
    ctx.db
      .select({
        id: moderatorScopes.id,
        scopeType: moderatorScopes.scopeType,
        departmentId: moderatorScopes.departmentId,
        locationId: moderatorScopes.locationId,
        departmentName: departments.name,
        locationName: workLocations.name,
      })
      .from(moderatorScopes)
      .leftJoin(departments, eq(departments.id, moderatorScopes.departmentId))
      .leftJoin(workLocations, eq(workLocations.id, moderatorScopes.locationId))
      .where(eq(moderatorScopes.userId, userId)),
  ]);
  return {
    ...u,
    roles: userRoleKeys,
    grants,
    scopes,
    isSelf: userId === ctx.actor.userId,
    can: {
      assignRoles: has(ctx.actor, 'role.assign'),
      manageStatus: has(ctx.actor, 'user.manage') && userId !== ctx.actor.userId,
      manageScopes: has(ctx.actor, 'scope.manage') && userId !== ctx.actor.userId,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Roles                                                              */
/* ------------------------------------------------------------------ */

const rolesInput = z.object({ roles: z.array(z.enum(ROLE_KEYS)).max(5), reason: zTrim(500, 5) }).strict();

/**
 * Replaces a user's roles. Only holders of role.assign (super admins) may do this, with recent
 * re-authentication. Self-elevation is impossible because role.assign already implies the top
 * role; self-demotion is allowed only while another active super admin remains.
 */
export async function setUserRoles(ctx: Ctx, userId: string, input: unknown) {
  requirePerm(ctx, 'role.assign');
  requireRecentAuth(ctx);
  const body = parse(rolesInput, input);
  const next = [...new Set<RoleKey>(['employee', ...body.roles])];
  return ctx.db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, userId));
    if (!target) throw notFound('User not found');
    if (target.status === 'pending_verification' && next.some((r) => r !== 'employee')) {
      throw badRequest('Verify the account before granting privileged roles');
    }
    const before = await rolesOf(tx, userId);
    if (before.includes('super_admin') && !next.includes('super_admin')) await assertNotLastSuperAdmin(tx, userId);
    const roleRows = await tx.select().from(roles).where(inArray(roles.key, next));
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx.insert(userRoles).values(roleRows.map((r) => ({ userId, roleId: r.id, grantedBy: ctx.actor.userId })));
    if (!next.includes('moderator')) await tx.delete(moderatorScopes).where(eq(moderatorScopes.userId, userId));
    const removed = before.filter((r) => !next.includes(r));
    // Losing a role invalidates existing sessions so stale privileges cannot linger in open tabs.
    if (removed.length && userId !== ctx.actor.userId) await revokeAllSessions(tx, userId);
    await audit(tx, ctx, {
      action: 'role.change',
      targetType: 'user',
      targetId: userId,
      oldValues: { roles: before },
      newValues: { roles: next },
      reason: body.reason,
    });
    await notify(tx, [userId], {
      type: 'role.changed',
      title: 'Your access roles have changed',
      body: `Your roles are now: ${next.map((r) => ROLE_META[r].name).join(', ')}.`,
      link: '/account',
    });
    return { roles: next };
  });
}

const grantInput = z.object({ permission: z.enum(ALL_PERMISSIONS as [string, ...string[]]), reason: zTrim(500, 5) }).strict();

export async function addGrant(ctx: Ctx, userId: string, input: unknown) {
  requirePerm(ctx, 'role.assign');
  requireRecentAuth(ctx);
  const body = parse(grantInput, input);
  if (userId === ctx.actor.userId) throw forbidden('You cannot grant permissions to yourself');
  return ctx.db.transaction(async (tx) => {
    const [target] = await tx.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (!target) throw notFound('User not found');
    if (target.status !== 'active') throw badRequest('Grants can only be added to active accounts');
    const [perm] = await tx.select().from(permissions).where(eq(permissions.key, body.permission));
    if (!perm) throw badRequest('Unknown permission');
    await tx
      .insert(userPermissionGrants)
      .values({ userId, permissionKey: body.permission, grantedBy: ctx.actor.userId, reason: body.reason })
      .onConflictDoNothing();
    await audit(tx, ctx, { action: 'permission.grant', targetType: 'user', targetId: userId, newValues: { permission: body.permission }, reason: body.reason });
    return { ok: true };
  });
}

export async function removeGrant(ctx: Ctx, userId: string, permission: string, input: unknown) {
  requirePerm(ctx, 'role.assign');
  requireRecentAuth(ctx);
  const body = parse(z.object({ reason: zTrim(500, 5) }), input);
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .delete(userPermissionGrants)
      .where(and(eq(userPermissionGrants.userId, userId), eq(userPermissionGrants.permissionKey, permission)))
      .returning();
    if (!rows.length) throw notFound('Grant not found');
    await revokeAllSessions(tx, userId);
    await audit(tx, ctx, { action: 'permission.revoke', targetType: 'user', targetId: userId, oldValues: { permission }, reason: body.reason });
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* Moderator scopes                                                   */
/* ------------------------------------------------------------------ */

const scopesInput = z
  .object({
    scopes: z
      .array(
        z.object({
          scopeType: z.enum(['org_unit', 'direct_reports']),
          departmentId: z.uuid().nullable().optional(),
          locationId: z.uuid().nullable().optional(),
        }),
      )
      .max(50),
    reason: zTrim(500, 5),
  })
  .strict();

export async function setModeratorScopes(ctx: Ctx, userId: string, input: unknown) {
  requirePerm(ctx, 'scope.manage');
  const body = parse(scopesInput, input);
  if (userId === ctx.actor.userId) throw forbidden('You cannot change your own scope');
  return ctx.db.transaction(async (tx) => {
    const targetRoles = await rolesOf(tx, userId);
    if (!targetRoles.includes('moderator')) throw badRequest('Scopes can only be assigned to users with the moderator role');
    const normalized = body.scopes.map((s) =>
      s.scopeType === 'direct_reports'
        ? { scopeType: 'direct_reports', departmentId: null, locationId: null }
        : { scopeType: 'org_unit', departmentId: s.departmentId ?? null, locationId: s.locationId ?? null },
    );
    for (const s of normalized) {
      if (s.scopeType === 'org_unit' && !s.departmentId && !s.locationId) throw badRequest('Each scope needs a department and/or location');
      if (s.departmentId) {
        const [d] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, s.departmentId));
        if (!d) throw badRequest('Unknown department in scope');
      }
      if (s.locationId) {
        const [l] = await tx.select({ id: workLocations.id }).from(workLocations).where(eq(workLocations.id, s.locationId));
        if (!l) throw badRequest('Unknown location in scope');
      }
    }
    const before = await tx
      .select({ scopeType: moderatorScopes.scopeType, departmentId: moderatorScopes.departmentId, locationId: moderatorScopes.locationId })
      .from(moderatorScopes)
      .where(eq(moderatorScopes.userId, userId));
    await tx.delete(moderatorScopes).where(eq(moderatorScopes.userId, userId));
    if (normalized.length) {
      await tx.insert(moderatorScopes).values(normalized.map((s) => ({ ...s, userId, createdBy: ctx.actor.userId })));
    }
    await audit(tx, ctx, {
      action: 'scope.change',
      targetType: 'user',
      targetId: userId,
      oldValues: { scopes: before },
      newValues: { scopes: normalized },
      reason: body.reason,
    });
    await notify(tx, [userId], { type: 'scope.changed', title: 'Your moderation scope has changed', link: '/account' });
    return { scopes: normalized };
  });
}

/* ------------------------------------------------------------------ */
/* Account status & recovery                                          */
/* ------------------------------------------------------------------ */

const statusInput = z.object({ status: z.enum(['active', 'suspended', 'deactivated']), reason: zTrim(500, 5) }).strict();

export async function setUserStatus(ctx: Ctx, userId: string, input: unknown) {
  requirePerm(ctx, 'user.manage');
  requireRecentAuth(ctx);
  const body = parse(statusInput, input);
  if (userId === ctx.actor.userId) throw forbidden('You cannot change the status of your own account');
  return ctx.db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, userId));
    if (!target) throw notFound('User not found');
    if (target.status === 'pending_verification') throw badRequest('Pending accounts are activated through registration verification');
    if (body.status !== 'active') {
      await assertNotLastSuperAdmin(tx, userId);
      await revokeAllSessions(tx, userId);
    }
    await tx.update(users).set({ status: body.status, updatedAt: ctx.now() }).where(eq(users.id, userId));
    await audit(tx, ctx, {
      action: 'user.status_change',
      targetType: 'user',
      targetId: userId,
      oldValues: { status: target.status },
      newValues: { status: body.status },
      reason: body.reason,
    });
    return { status: body.status };
  });
}

/**
 * Access recovery: issues a one-time temporary password (shown once to the super admin for
 * out-of-band delivery), clears MFA and lockouts, revokes sessions and forces a password change.
 */
export async function recoverAccess(ctx: Ctx, userId: string, input: unknown) {
  requirePerm(ctx, 'user.manage');
  requireRecentAuth(ctx);
  const body = parse(z.object({ reason: zTrim(500, 5) }), input);
  if (userId === ctx.actor.userId) throw forbidden('Use the account page to change your own password');
  const temporaryPassword = `Tmp-${randomToken(9)}9a`;
  await ctx.db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, userId));
    if (!target) throw notFound('User not found');
    if (target.status === 'deactivated') throw badRequest('Reactivate the account before recovering access');
    await tx
      .update(users)
      .set({
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        mfaEnabled: false,
        mfaSecretEnc: null,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: ctx.now(),
      })
      .where(eq(users.id, userId));
    await revokeAllSessions(tx, userId);
    await audit(tx, ctx, { action: 'user.access_recovery', targetType: 'user', targetId: userId, reason: body.reason });
  });
  return { temporaryPassword };
}

export function canAccessUserAdmin(ctx: Ctx) {
  return hasAny(ctx.actor, ['role.assign', 'user.manage', 'scope.manage']);
}
