import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { notifications, rolePermissions, roles, userPermissionGrants, userRoles, users } from '../db/schema';
import type { Tx } from '../db/client';
import type { Ctx } from '../context';
import { requireActor } from '../authz/policy';
import { parse, zPage } from '../lib/validate';
import type { Permission } from '../../shared/permissions';

export interface NotificationInput {
  type: string;
  title: string;
  /** Must never contain salary figures, next-of-kin details or other confidential data. */
  body?: string;
  link?: string;
  /** Idempotency key; the same key is delivered at most once per user. */
  dedupeKey?: string;
}

export async function notify(tx: Tx, userIds: (string | null | undefined)[], n: NotificationInput): Promise<number> {
  let ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return 0;
  // Announcements and events can be muted from the account page. Employment, payroll,
  // approval and security notices are always delivered.
  const preference = n.type.startsWith('announcement.')
    ? users.notifyAnnouncements
    : n.type.startsWith('event.')
      ? users.notifyEvents
      : null;
  if (preference) {
    const allowed = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(preference, true)));
    ids = allowed.map((r) => r.id);
    if (!ids.length) return 0;
  }
  const rows = await tx
    .insert(notifications)
    .values(ids.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })))
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  return rows.length;
}

/** Active users holding a permission through a role or an individual grant. */
export async function usersWithPermission(tx: Tx, perm: Permission): Promise<string[]> {
  const viaRole = await tx
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, and(eq(rolePermissions.roleId, roles.id), eq(rolePermissions.permissionKey, perm)))
    .where(eq(users.status, 'active'));
  const viaGrant = await tx
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userPermissionGrants, and(eq(userPermissionGrants.userId, users.id), eq(userPermissionGrants.permissionKey, perm)))
    .where(eq(users.status, 'active'));
  return [...new Set([...viaRole, ...viaGrant].map((r) => r.id))];
}

export async function listNotifications(ctx: Ctx, query: unknown) {
  requireActor(ctx);
  const q = parse(zPage.extend({ unread: z.coerce.boolean().optional() }), query);
  const where = q.unread
    ? and(eq(notifications.userId, ctx.actor.userId), isNull(notifications.readAt))
    : eq(notifications.userId, ctx.actor.userId);
  const [items, [{ total }], [{ unread }]] = await Promise.all([
    ctx.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql<number>`count(*)::int` }).from(notifications).where(where),
    ctx.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.actor.userId), isNull(notifications.readAt))),
  ]);
  return { items, total, unread, page: q.page, pageSize: q.pageSize };
}

export async function markRead(ctx: Ctx, input: unknown) {
  requireActor(ctx);
  const body = parse(z.object({ ids: z.array(z.uuid()).max(200).optional(), all: z.boolean().optional() }), input);
  const own = eq(notifications.userId, ctx.actor.userId);
  const where = body.all ? and(own, isNull(notifications.readAt)) : and(own, inArray(notifications.id, body.ids ?? []));
  if (!body.all && !body.ids?.length) return { updated: 0 };
  const rows = await ctx.db.update(notifications).set({ readAt: ctx.now() }).where(where).returning({ id: notifications.id });
  return { updated: rows.length };
}
