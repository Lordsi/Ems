import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db, Tx } from '../db/client';
import {
  employees,
  moderatorScopes,
  rolePermissions,
  roles,
  sessions,
  userPermissionGrants,
  userRoles,
  users,
} from '../db/schema';
import { config } from '../config';
import { randomToken, sha256 } from '../lib/crypto';
import type { Actor, ScopeGrant } from '../context';
import type { Permission, RoleKey } from '../../shared/permissions';

export const SESSION_COOKIE = 'ems_sid';
export const CSRF_COOKIE = 'ems_csrf';

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProd,
    path: '/',
    maxAge: config.session.absoluteHours * 3600_000,
  };
}

export async function createSession(
  db: Tx,
  userId: string,
  opts: { ip?: string; userAgent?: string; mfaPending?: boolean; now?: Date },
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = randomToken(32);
  const id = sha256(token);
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + config.session.absoluteHours * 3600_000);
  await db.insert(sessions).values({
    id,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    mfaPending: opts.mfaPending ?? false,
    reauthAt: opts.mfaPending ? null : now,
    ip: opts.ip?.slice(0, 64),
    userAgent: opts.userAgent?.slice(0, 300),
  });
  return { token, id, expiresAt };
}

export async function revokeSession(db: Tx, id: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
}

/** Immediately invalidates every session for a user (role change, suspension, password reset). */
export async function revokeAllSessions(db: Tx, userId: string, exceptId?: string) {
  const cond = exceptId
    ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.id} <> ${exceptId}`)
    : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
  await db.update(sessions).set({ revokedAt: new Date() }).where(cond);
}

export interface LoadedSession {
  session: typeof sessions.$inferSelect;
  user: typeof users.$inferSelect;
}

export async function loadSession(db: Db, token: string, now = new Date()): Promise<LoadedSession | null> {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));
  if (!row) return null;
  const { session, user } = row;
  const idleMs = config.session.idleMinutes * 60_000;
  if (session.revokedAt || session.expiresAt <= now || now.getTime() - session.lastSeenAt.getTime() > idleMs) return null;
  if (user.status === 'suspended' || user.status === 'deactivated') return null;
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }
  return row;
}

/** Builds the actor from the database on every request so role/scope changes apply immediately. */
export async function loadActor(db: Db, loaded: LoadedSession): Promise<Actor> {
  const { user, session } = loaded;
  const [roleRows, grantRows, scopeRows, empRows] = await Promise.all([
    db
      .select({ key: roles.key, perm: rolePermissions.permissionKey })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(userRoles.userId, user.id)),
    db.select({ perm: userPermissionGrants.permissionKey }).from(userPermissionGrants).where(eq(userPermissionGrants.userId, user.id)),
    db.select().from(moderatorScopes).where(eq(moderatorScopes.userId, user.id)),
    db.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id)),
  ]);
  const roleKeys = [...new Set(roleRows.map((r) => r.key as RoleKey))];
  const perms = new Set<Permission>();
  // Pending or MFA-incomplete sessions receive no permissions at all.
  if (user.status === 'active' && !session.mfaPending) {
    for (const r of roleRows) if (r.perm) perms.add(r.perm as Permission);
    for (const g of grantRows) perms.add(g.perm as Permission);
  }
  const scopes: ScopeGrant[] = roleKeys.includes('moderator')
    ? scopeRows.map((s) => ({
        id: s.id,
        scopeType: s.scopeType as ScopeGrant['scopeType'],
        departmentId: s.departmentId,
        locationId: s.locationId,
      }))
    : [];
  return {
    userId: user.id,
    sessionId: session.id,
    displayName: user.displayName,
    username: user.username,
    email: user.email,
    status: session.mfaPending ? 'mfa_pending' : user.status,
    roles: roleKeys,
    permissions: perms,
    employeeId: empRows[0]?.id ?? null,
    scopes,
    reauthAt: session.reauthAt,
    mfaEnabled: user.mfaEnabled,
    mustChangePassword: user.mustChangePassword,
  };
}
