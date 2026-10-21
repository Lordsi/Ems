import { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, or, sql, type SQL } from 'drizzle-orm';
import { announcements, comments, employees, events, users } from '../db/schema';
import type { Tx } from '../db/client';
import type { AuthedCtx, Ctx } from '../context';
import { deniedRecord, has, requireActor, requirePerm } from '../authz/policy';
import { AppError, badRequest, conflict } from '../lib/errors';
import { parse, zOptText, zPage, zTrim } from '../lib/validate';
import { audit, diff } from './audit';
import { notify } from './notifications';

type Targeted = { targetDepartmentIds: string[]; targetLocationIds: string[] };

async function actorPlacement(ctx: AuthedCtx) {
  if (!ctx.actor.employeeId) return { departmentId: null, locationId: null };
  const [e] = await ctx.db
    .select({ departmentId: employees.departmentId, locationId: employees.locationId })
    .from(employees)
    .where(eq(employees.id, ctx.actor.employeeId));
  return e ?? { departmentId: null, locationId: null };
}

function isTargetedAt(item: Targeted, place: { departmentId: string | null; locationId: string | null }) {
  const noTargets = !item.targetDepartmentIds.length && !item.targetLocationIds.length;
  return (
    noTargets ||
    (!!place.departmentId && item.targetDepartmentIds.includes(place.departmentId)) ||
    (!!place.locationId && item.targetLocationIds.includes(place.locationId))
  );
}

function targetSql(table: typeof announcements | typeof events, place: { departmentId: string | null; locationId: string | null }): SQL {
  const clauses: SQL[] = [sql`(jsonb_array_length(${table.targetDepartmentIds}) = 0 and jsonb_array_length(${table.targetLocationIds}) = 0)`];
  if (place.departmentId) clauses.push(sql`${table.targetDepartmentIds} @> ${JSON.stringify([place.departmentId])}::jsonb`);
  if (place.locationId) clauses.push(sql`${table.targetLocationIds} @> ${JSON.stringify([place.locationId])}::jsonb`);
  return or(...clauses)!;
}

/** Active users in the targeted audience (everyone when no targets are set). */
async function audienceUserIds(tx: Tx, item: Targeted): Promise<string[]> {
  const noTargets = !item.targetDepartmentIds.length && !item.targetLocationIds.length;
  if (noTargets) {
    const rows = await tx.select({ id: users.id }).from(users).where(eq(users.status, 'active'));
    return rows.map((r) => r.id);
  }
  const clauses: SQL[] = [];
  if (item.targetDepartmentIds.length) clauses.push(inArray(employees.departmentId, item.targetDepartmentIds));
  if (item.targetLocationIds.length) clauses.push(inArray(employees.locationId, item.targetLocationIds));
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(employees, eq(employees.userId, users.id))
    .where(and(eq(users.status, 'active'), or(...clauses)));
  return rows.map((r) => r.id);
}

const targetsSchema = {
  targetDepartmentIds: z.array(z.uuid()).max(50).default([]),
  targetLocationIds: z.array(z.uuid()).max(100).default([]),
  commentsEnabled: z.boolean().default(false),
};

/* ------------------------------------------------------------------ */
/* Announcements                                                      */
/* ------------------------------------------------------------------ */

const announcementInput = z.object({ title: zTrim(200), body: zTrim(20000), ...targetsSchema }).strict();

export async function listAnnouncements(ctx: Ctx, query: unknown) {
  requireActor(ctx);
  const q = parse(zPage.extend({ status: z.enum(['draft', 'published', 'archived', 'all']).optional() }), query);
  const manage = has(ctx.actor, 'announcement.manage');
  const conds: SQL[] = [];
  if (manage) {
    if (q.status && q.status !== 'all') conds.push(eq(announcements.status, q.status));
  } else {
    conds.push(eq(announcements.status, 'published'));
    conds.push(targetSql(announcements, await actorPlacement(ctx)));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [items, [{ total }]] = await Promise.all([
    ctx.db
      .select({
        id: announcements.id,
        title: announcements.title,
        excerpt: sql<string>`left(${announcements.body}, 280)`,
        status: announcements.status,
        publishedAt: announcements.publishedAt,
        createdAt: announcements.createdAt,
        commentsEnabled: announcements.commentsEnabled,
        targetDepartmentIds: announcements.targetDepartmentIds,
        targetLocationIds: announcements.targetLocationIds,
        authorName: users.displayName,
        commentCount: sql<number>`(select count(*)::int from comments c where c.target_type = 'announcement' and c.target_id = announcements.id and c.status = 'visible')`,
      })
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.createdBy))
      .where(where)
      .orderBy(desc(sql`coalesce(${announcements.publishedAt}, ${announcements.createdAt})`))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql<number>`count(*)::int` }).from(announcements).where(where),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize, canManage: manage };
}

async function loadVisibleAnnouncement(ctx: AuthedCtx, id: string) {
  if (!z.uuid().safeParse(id).success) throw deniedRecord('Announcement');
  const [a] = await ctx.db.select().from(announcements).where(eq(announcements.id, id));
  if (!a) throw deniedRecord('Announcement');
  if (has(ctx.actor, 'announcement.manage')) return a;
  if (a.status !== 'published' || !isTargetedAt(a, await actorPlacement(ctx))) throw deniedRecord('Announcement');
  return a;
}

export async function getAnnouncement(ctx: Ctx, id: string) {
  requireActor(ctx);
  const a = await loadVisibleAnnouncement(ctx, id);
  const [author] = await ctx.db.select({ name: users.displayName }).from(users).where(eq(users.id, a.createdBy));
  return { ...a, authorName: author?.name ?? null, canManage: has(ctx.actor, 'announcement.manage') };
}

export async function createAnnouncement(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'announcement.manage');
  const body = parse(announcementInput, input);
  const [a] = await ctx.db.insert(announcements).values({ ...body, createdBy: ctx.actor.userId }).returning();
  await audit(ctx.db, ctx, { action: 'announcement.create', targetType: 'announcement', targetId: a.id, newValues: { title: body.title } });
  return a;
}

export async function updateAnnouncement(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'announcement.manage');
  const body = parse(announcementInput, input);
  return ctx.db.transaction(async (tx) => {
    const [a] = await tx.select().from(announcements).where(eq(announcements.id, id));
    if (!a) throw deniedRecord('Announcement');
    if (a.status === 'archived') throw conflict('Archived announcements cannot be edited');
    await tx.update(announcements).set({ ...body, updatedAt: ctx.now() }).where(eq(announcements.id, id));
    const d = diff(a as unknown as Record<string, unknown>, body as Record<string, unknown>);
    await audit(tx, ctx, { action: 'announcement.update', targetType: 'announcement', targetId: id, oldValues: d.oldValues, newValues: d.newValues });
    return { id };
  });
}

export async function setAnnouncementStatus(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'announcement.manage');
  const body = parse(z.object({ status: z.enum(['draft', 'published', 'archived']) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [a] = await tx.select().from(announcements).where(eq(announcements.id, id));
    if (!a) throw deniedRecord('Announcement');
    const publishing = body.status === 'published' && a.status !== 'published';
    await tx
      .update(announcements)
      .set({ status: body.status, publishedAt: publishing ? ctx.now() : a.publishedAt, updatedAt: ctx.now() })
      .where(eq(announcements.id, id));
    await audit(tx, ctx, { action: `announcement.${body.status}`, targetType: 'announcement', targetId: id, oldValues: { status: a.status }, newValues: { status: body.status } });
    if (publishing) {
      await notify(tx, await audienceUserIds(tx, a), {
        type: 'announcement.published',
        title: a.title,
        link: `/announcements/${id}`,
        dedupeKey: `announcement:${id}`,
      });
    }
    return { status: body.status };
  });
}

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

const eventInput = z
  .object({
    title: zTrim(200),
    description: z.string().trim().max(20000).default(''),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date().nullable().optional(),
    venue: zOptText(200),
    ...targetsSchema,
  })
  .strict()
  .refine((e) => !e.endsAt || e.endsAt >= e.startsAt, { message: 'End must be after start', path: ['endsAt'] });

export async function listEvents(ctx: Ctx, query: unknown) {
  requireActor(ctx);
  const q = parse(zPage.extend({ when: z.enum(['upcoming', 'past', 'all']).default('upcoming'), status: z.enum(['draft', 'published', 'completed', 'cancelled']).optional() }), query);
  const manage = has(ctx.actor, 'event.manage');
  const conds: SQL[] = [];
  if (manage) {
    if (q.status) conds.push(eq(events.status, q.status));
  } else {
    conds.push(inArray(events.status, ['published', 'completed', 'cancelled']));
    conds.push(targetSql(events, await actorPlacement(ctx)));
  }
  const now = ctx.now();
  if (q.when === 'upcoming') conds.push(gte(sql`coalesce(${events.endsAt}, ${events.startsAt})`, now));
  if (q.when === 'past') conds.push(sql`coalesce(${events.endsAt}, ${events.startsAt}) < ${now}`);
  const where = conds.length ? and(...conds) : undefined;
  const [items, [{ total }]] = await Promise.all([
    ctx.db
      .select()
      .from(events)
      .where(where)
      .orderBy(q.when === 'past' ? desc(events.startsAt) : asc(events.startsAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql<number>`count(*)::int` }).from(events).where(where),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize, canManage: manage };
}

async function loadVisibleEvent(ctx: AuthedCtx, id: string) {
  if (!z.uuid().safeParse(id).success) throw deniedRecord('Event');
  const [e] = await ctx.db.select().from(events).where(eq(events.id, id));
  if (!e) throw deniedRecord('Event');
  if (has(ctx.actor, 'event.manage')) return e;
  if (e.status === 'draft' || !isTargetedAt(e, await actorPlacement(ctx))) throw deniedRecord('Event');
  return e;
}

export async function getEvent(ctx: Ctx, id: string) {
  requireActor(ctx);
  const e = await loadVisibleEvent(ctx, id);
  return { ...e, canManage: has(ctx.actor, 'event.manage') };
}

export async function createEvent(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'event.manage');
  const body = parse(eventInput, input);
  const [e] = await ctx.db.insert(events).values({ ...body, endsAt: body.endsAt ?? null, createdBy: ctx.actor.userId }).returning();
  await audit(ctx.db, ctx, { action: 'event.create', targetType: 'event', targetId: e.id, newValues: { title: body.title, startsAt: body.startsAt } });
  return e;
}

export async function updateEvent(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'event.manage');
  const body = parse(eventInput, input);
  return ctx.db.transaction(async (tx) => {
    const [e] = await tx.select().from(events).where(eq(events.id, id));
    if (!e) throw deniedRecord('Event');
    if (['completed', 'cancelled'].includes(e.status)) throw conflict('Completed or cancelled events cannot be edited');
    await tx.update(events).set({ ...body, endsAt: body.endsAt ?? null, updatedAt: ctx.now() }).where(eq(events.id, id));
    const d = diff(e as unknown as Record<string, unknown>, body as Record<string, unknown>);
    await audit(tx, ctx, { action: 'event.update', targetType: 'event', targetId: id, oldValues: d.oldValues, newValues: d.newValues });
    if (e.status === 'published' && d.changed.some((k) => ['startsAt', 'endsAt', 'venue'].includes(k))) {
      await notify(tx, await audienceUserIds(tx, { ...e, ...body }), {
        type: 'event.updated',
        title: `Event updated: ${body.title}`,
        link: `/events/${id}`,
        dedupeKey: `event-update:${id}:${ctx.now().getTime()}`,
      });
    }
    return { id };
  });
}

const EVENT_TRANSITIONS: Record<string, string[]> = {
  draft: ['published', 'cancelled'],
  published: ['completed', 'cancelled', 'draft'],
  completed: [],
  cancelled: [],
};

export async function setEventStatus(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'event.manage');
  const body = parse(z.object({ status: z.enum(['draft', 'published', 'completed', 'cancelled']) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [e] = await tx.select().from(events).where(eq(events.id, id));
    if (!e) throw deniedRecord('Event');
    if (!EVENT_TRANSITIONS[e.status].includes(body.status)) throw badRequest(`Cannot change an event from ${e.status} to ${body.status}`);
    await tx.update(events).set({ status: body.status, updatedAt: ctx.now() }).where(eq(events.id, id));
    await audit(tx, ctx, { action: `event.${body.status}`, targetType: 'event', targetId: id, oldValues: { status: e.status }, newValues: { status: body.status } });
    if (body.status === 'published' || (body.status === 'cancelled' && e.status === 'published')) {
      await notify(tx, await audienceUserIds(tx, e), {
        type: body.status === 'published' ? 'event.published' : 'event.cancelled',
        title: body.status === 'published' ? `New event: ${e.title}` : `Event cancelled: ${e.title}`,
        link: `/events/${id}`,
        dedupeKey: `event-${body.status}:${id}`,
      });
    }
    return { status: body.status };
  });
}

/** Sends one reminder per user per event, `hours` before it starts. Idempotent via dedupe keys. */
export async function sendEventReminders(tx: Tx, now: Date, hours: number) {
  const upcoming = await tx
    .select()
    .from(events)
    .where(and(eq(events.status, 'published'), gte(events.startsAt, now), sql`${events.startsAt} <= ${new Date(now.getTime() + hours * 3600_000)}`));
  let sent = 0;
  for (const e of upcoming) {
    sent += await notify(tx, await audienceUserIds(tx, e), {
      type: 'event.reminder',
      title: `Upcoming event: ${e.title}`,
      body: `Starts ${e.startsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC${e.venue ? ` at ${e.venue}` : ''}.`,
      link: `/events/${e.id}`,
      dedupeKey: `event-reminder:${e.id}`,
    });
  }
  return sent;
}

/* ------------------------------------------------------------------ */
/* Comments                                                           */
/* ------------------------------------------------------------------ */

const targetType = z.enum(['announcement', 'event']);
const COMMENT_RATE = { perMinute: 5, duplicateWindowMinutes: 10 };

async function loadCommentTarget(ctx: AuthedCtx, type: 'announcement' | 'event', id: string) {
  if (type === 'announcement') {
    const a = await loadVisibleAnnouncement(ctx, id);
    return { commentsEnabled: a.commentsEnabled, open: a.status === 'published' };
  }
  const e = await loadVisibleEvent(ctx, id);
  return { commentsEnabled: e.commentsEnabled, open: e.status === 'published' };
}

export async function listComments(ctx: Ctx, type: string, id: string) {
  requireActor(ctx);
  const t = parse(targetType, type);
  await loadCommentTarget(ctx, t, id);
  const moderate = has(ctx.actor, 'comment.moderate');
  const rows = await ctx.db
    .select({ id: comments.id, body: comments.body, status: comments.status, createdAt: comments.createdAt, authorUserId: comments.authorUserId, authorName: users.displayName })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorUserId))
    .where(and(eq(comments.targetType, t), eq(comments.targetId, id), moderate ? undefined : eq(comments.status, 'visible')))
    .orderBy(asc(comments.createdAt))
    .limit(500);
  return rows.map((r) => ({ ...r, mine: r.authorUserId === ctx.actor.userId, canModerate: moderate }));
}

export async function createComment(ctx: Ctx, type: string, id: string, input: unknown) {
  requirePerm(ctx, 'comment.create');
  const t = parse(targetType, type);
  const body = parse(z.object({ body: zTrim(2000) }).strict(), input);
  const target = await loadCommentTarget(ctx, t, id);
  if (!target.commentsEnabled || !target.open) throw badRequest('Comments are not enabled here');
  const since = new Date(ctx.now().getTime() - 60_000);
  const [{ recent }] = await ctx.db
    .select({ recent: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.authorUserId, ctx.actor.userId), gte(comments.createdAt, since)));
  if (recent >= COMMENT_RATE.perMinute) throw new AppError(429, 'RATE_LIMITED', 'You are commenting too quickly. Please wait a moment.');
  const [dup] = await ctx.db
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        eq(comments.authorUserId, ctx.actor.userId),
        eq(comments.targetId, id),
        eq(comments.body, body.body),
        gte(comments.createdAt, new Date(ctx.now().getTime() - COMMENT_RATE.duplicateWindowMinutes * 60_000)),
      ),
    );
  if (dup) throw conflict('You already posted this comment');
  const [c] = await ctx.db.insert(comments).values({ targetType: t, targetId: id, authorUserId: ctx.actor.userId, body: body.body }).returning();
  return c;
}

export async function moderateComment(ctx: Ctx, commentId: string, input: unknown) {
  requireActor(ctx);
  const body = parse(z.object({ status: z.enum(['visible', 'hidden']), reason: zOptText(500) }).strict(), input);
  if (!z.uuid().safeParse(commentId).success) throw deniedRecord('Comment');
  const [c] = await ctx.db.select().from(comments).where(eq(comments.id, commentId));
  if (!c) throw deniedRecord('Comment');
  const own = c.authorUserId === ctx.actor.userId;
  // Authors may remove their own comment; only moderators can restore or hide others'.
  if (!has(ctx.actor, 'comment.moderate') && !(own && body.status === 'hidden')) throw deniedRecord('Comment');
  await loadCommentTarget(ctx, c.targetType as 'announcement', c.targetId);
  await ctx.db.update(comments).set({ status: body.status, moderatedBy: ctx.actor.userId, moderatedAt: ctx.now() }).where(eq(comments.id, commentId));
  if (!own) await audit(ctx.db, ctx, { action: `comment.${body.status === 'hidden' ? 'hide' : 'restore'}`, targetType: 'comment', targetId: commentId, reason: body.reason });
  return { status: body.status };
}
