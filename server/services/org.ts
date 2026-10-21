import { z } from 'zod';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  departmentLocations,
  departments,
  employees,
  employmentGrades,
  jobTitles,
  workLocations,
} from '../db/schema';
import type { Tx } from '../db/client';
import type { Ctx } from '../context';
import { hasAny, requireActor, requirePerm } from '../authz/policy';
import { badRequest, conflict, notFound } from '../lib/errors';
import { parse, zOptText, zOptUuid, zTrim } from '../lib/validate';
import { audit, diff } from './audit';
import { sequenceHasIssued } from './employmentNumbers';

/* ------------------------------------------------------------------ */
/* Lookups                                                            */
/* ------------------------------------------------------------------ */

async function activeLookups(tx: Tx) {
  const [deps, locs, titles, grades, links] = await Promise.all([
    tx.select({ id: departments.id, code: departments.code, name: departments.name }).from(departments).where(eq(departments.status, 'active')).orderBy(asc(departments.name)),
    tx.select({ id: workLocations.id, code: workLocations.code, name: workLocations.name }).from(workLocations).where(eq(workLocations.status, 'active')).orderBy(asc(workLocations.name)),
    tx.select({ id: jobTitles.id, name: jobTitles.name, departmentId: jobTitles.departmentId }).from(jobTitles).where(eq(jobTitles.status, 'active')).orderBy(asc(jobTitles.name)),
    tx.select({ id: employmentGrades.id, code: employmentGrades.code, name: employmentGrades.name }).from(employmentGrades).where(eq(employmentGrades.status, 'active')).orderBy(asc(employmentGrades.rank)),
    tx.select().from(departmentLocations),
  ]);
  return {
    departments: deps.map((d) => ({ ...d, locationIds: links.filter((l) => l.departmentId === d.id).map((l) => l.locationId) })),
    locations: locs,
    jobTitles: titles,
    grades,
  };
}

/** Non-sensitive organisational reference data needed by the public registration form. */
export async function publicLookups(ctx: Ctx) {
  return activeLookups(ctx.db);
}

export async function lookups(ctx: Ctx) {
  requireActor(ctx);
  return activeLookups(ctx.db);
}

/* ------------------------------------------------------------------ */
/* Departments                                                        */
/* ------------------------------------------------------------------ */

function requireOrgView(ctx: Ctx) {
  requirePerm(ctx, 'org.manage', 'employee.read.all', 'report.org', 'report.finance');
}

export async function listDepartments(ctx: Ctx) {
  requireOrgView(ctx);
  // Drizzle renders columns unqualified in single-table selections, so correlated subqueries must name the outer table explicitly.
  const head = sql<string | null>`(select legal_name from employees h where h.id = departments.head_employee_id)`;
  const rows = await ctx.db
    .select({
      id: departments.id,
      code: departments.code,
      name: departments.name,
      description: departments.description,
      status: departments.status,
      headEmployeeId: departments.headEmployeeId,
      headName: head,
      activeEmployees: sql<number>`(select count(*)::int from employees e where e.department_id = departments.id and e.archived_at is null and e.employment_status in ('active','on_leave'))`,
    })
    .from(departments)
    .orderBy(asc(departments.name));
  const links = await ctx.db
    .select({ departmentId: departmentLocations.departmentId, id: workLocations.id, name: workLocations.name })
    .from(departmentLocations)
    .innerJoin(workLocations, eq(workLocations.id, departmentLocations.locationId));
  return rows.map((r) => ({ ...r, locations: links.filter((l) => l.departmentId === r.id).map(({ id, name }) => ({ id, name })) }));
}

const deptInput = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,8}$/, '2-8 capital letters'),
    name: zTrim(120),
    description: zOptText(1000),
    headEmployeeId: zOptUuid,
    status: z.enum(['active', 'archived']).default('active'),
    locationIds: z.array(z.uuid()).max(100).default([]),
  })
  .strict();

async function setDepartmentLocations(tx: Tx, departmentId: string, locationIds: string[]) {
  await tx.delete(departmentLocations).where(eq(departmentLocations.departmentId, departmentId));
  const unique = [...new Set(locationIds)];
  if (unique.length) {
    const found = await tx.select({ id: workLocations.id }).from(workLocations).where(inArray(workLocations.id, unique));
    if (found.length !== unique.length) throw badRequest('Validation failed', { fields: { locationIds: 'Unknown location' } });
    await tx.insert(departmentLocations).values(unique.map((locationId) => ({ departmentId, locationId })));
  }
}

async function validateHead(tx: Tx, headEmployeeId: string | null) {
  if (!headEmployeeId) return;
  const [e] = await tx.select().from(employees).where(eq(employees.id, headEmployeeId));
  if (!e || e.archivedAt || !['active', 'on_leave'].includes(e.employmentStatus)) {
    throw badRequest('Validation failed', { fields: { headEmployeeId: 'Select an active employee' } });
  }
}

export async function createDepartment(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'org.manage');
  const body = parse(deptInput, input);
  return ctx.db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.code, body.code));
    if (dup) throw conflict('A department with that code already exists');
    await validateHead(tx, body.headEmployeeId);
    const { locationIds, ...values } = body;
    const [d] = await tx.insert(departments).values(values).returning();
    await tx.execute(sql`insert into employment_number_sequences (department_id, next_value) values (${d.id}, 1) on conflict do nothing`);
    await setDepartmentLocations(tx, d.id, locationIds);
    await audit(tx, ctx, { action: 'org.department_create', targetType: 'department', targetId: d.id, newValues: body });
    return d;
  });
}

export async function updateDepartment(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'org.manage');
  const body = parse(deptInput, input);
  return ctx.db.transaction(async (tx) => {
    const [d] = await tx.select().from(departments).where(eq(departments.id, id)).for('update');
    if (!d) throw notFound('Department not found');
    if (body.code !== d.code) {
      // Codes prefix issued employment numbers; once a number exists the code is frozen so numbers stay unique and meaningful.
      if (await sequenceHasIssued(tx, id)) throw conflict('The department code cannot change after employment numbers have been issued');
      const [dup] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.code, body.code));
      if (dup) throw conflict('A department with that code already exists');
    }
    if (body.status === 'archived' && d.status !== 'archived') {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .where(and(eq(employees.departmentId, id), isNull(employees.archivedAt), inArray(employees.employmentStatus, ['active', 'on_leave', 'suspended', 'pending_verification'])));
      if (n > 0) throw conflict(`Transfer the ${n} current employee(s) before archiving this department`);
    }
    await validateHead(tx, body.headEmployeeId);
    const { locationIds, ...values } = body;
    await tx.update(departments).set({ ...values, updatedAt: ctx.now() }).where(eq(departments.id, id));
    await setDepartmentLocations(tx, id, locationIds);
    const d2 = diff(d as unknown as Record<string, unknown>, values as Record<string, unknown>);
    await audit(tx, ctx, { action: 'org.department_update', targetType: 'department', targetId: id, oldValues: d2.oldValues, newValues: { ...d2.newValues, locationIds } });
    return { id };
  });
}

/* ------------------------------------------------------------------ */
/* Locations                                                          */
/* ------------------------------------------------------------------ */

export async function listLocations(ctx: Ctx) {
  requireOrgView(ctx);
  return ctx.db
    .select({
      id: workLocations.id,
      code: workLocations.code,
      name: workLocations.name,
      address: workLocations.address,
      status: workLocations.status,
      activeEmployees: sql<number>`(select count(*)::int from employees e where e.location_id = work_locations.id and e.archived_at is null and e.employment_status in ('active','on_leave'))`,
    })
    .from(workLocations)
    .orderBy(asc(workLocations.name));
}

const locInput = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/, '2-16 letters, digits or hyphens'),
    name: zTrim(120),
    address: zOptText(500),
    status: z.enum(['active', 'archived']).default('active'),
  })
  .strict();

export async function createLocation(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'org.manage');
  const body = parse(locInput, input);
  return ctx.db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: workLocations.id }).from(workLocations).where(eq(workLocations.code, body.code));
    if (dup) throw conflict('A location with that code already exists');
    const [l] = await tx.insert(workLocations).values(body).returning();
    await audit(tx, ctx, { action: 'org.location_create', targetType: 'location', targetId: l.id, newValues: body });
    return l;
  });
}

export async function updateLocation(ctx: Ctx, id: string, input: unknown) {
  requirePerm(ctx, 'org.manage');
  const body = parse(locInput, input);
  return ctx.db.transaction(async (tx) => {
    const [l] = await tx.select().from(workLocations).where(eq(workLocations.id, id));
    if (!l) throw notFound('Location not found');
    if (body.code !== l.code) {
      const [dup] = await tx.select({ id: workLocations.id }).from(workLocations).where(eq(workLocations.code, body.code));
      if (dup) throw conflict('A location with that code already exists');
    }
    if (body.status === 'archived' && l.status !== 'archived') {
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .where(and(eq(employees.locationId, id), isNull(employees.archivedAt), inArray(employees.employmentStatus, ['active', 'on_leave', 'suspended'])));
      if (n > 0) throw conflict(`Move the ${n} current employee(s) before archiving this location`);
    }
    await tx.update(workLocations).set({ ...body, updatedAt: ctx.now() }).where(eq(workLocations.id, id));
    const d = diff(l as unknown as Record<string, unknown>, body as Record<string, unknown>);
    await audit(tx, ctx, { action: 'org.location_update', targetType: 'location', targetId: id, oldValues: d.oldValues, newValues: d.newValues });
    return { id };
  });
}

/* ------------------------------------------------------------------ */
/* Job titles & grades                                                */
/* ------------------------------------------------------------------ */

export async function listJobTitles(ctx: Ctx) {
  requirePerm(ctx, 'org.manage');
  return ctx.db
    .select({ id: jobTitles.id, name: jobTitles.name, status: jobTitles.status, departmentId: jobTitles.departmentId, departmentName: departments.name })
    .from(jobTitles)
    .leftJoin(departments, eq(departments.id, jobTitles.departmentId))
    .orderBy(asc(jobTitles.name));
}

const titleInput = z.object({ name: zTrim(120), departmentId: zOptUuid, status: z.enum(['active', 'archived']).default('active') }).strict();

export async function upsertJobTitle(ctx: Ctx, id: string | null, input: unknown) {
  requirePerm(ctx, 'org.manage');
  const body = parse(titleInput, input);
  return ctx.db.transaction(async (tx) => {
    if (id) {
      const [t] = await tx.select().from(jobTitles).where(eq(jobTitles.id, id));
      if (!t) throw notFound('Job title not found');
      await tx.update(jobTitles).set(body).where(eq(jobTitles.id, id));
      await audit(tx, ctx, { action: 'org.job_title_update', targetType: 'job_title', targetId: id, oldValues: t, newValues: body });
      return { id };
    }
    const [t] = await tx.insert(jobTitles).values(body).onConflictDoNothing().returning();
    if (!t) throw conflict('That job title already exists');
    await audit(tx, ctx, { action: 'org.job_title_create', targetType: 'job_title', targetId: t.id, newValues: body });
    return { id: t.id };
  });
}

export async function listGrades(ctx: Ctx) {
  requirePerm(ctx, 'org.manage');
  return ctx.db.select().from(employmentGrades).orderBy(asc(employmentGrades.rank));
}

const gradeInput = z
  .object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,16}$/), name: zTrim(120), rank: z.number().int().min(0).max(1000), status: z.enum(['active', 'archived']).default('active') })
  .strict();

export async function upsertGrade(ctx: Ctx, id: string | null, input: unknown) {
  requirePerm(ctx, 'org.manage');
  const body = parse(gradeInput, input);
  return ctx.db.transaction(async (tx) => {
    if (id) {
      const [g] = await tx.select().from(employmentGrades).where(eq(employmentGrades.id, id));
      if (!g) throw notFound('Grade not found');
      await tx.update(employmentGrades).set(body).where(eq(employmentGrades.id, id));
      await audit(tx, ctx, { action: 'org.grade_update', targetType: 'grade', targetId: id, oldValues: g, newValues: body });
      return { id };
    }
    const [g] = await tx.insert(employmentGrades).values(body).onConflictDoNothing().returning();
    if (!g) throw conflict('A grade with that code already exists');
    await audit(tx, ctx, { action: 'org.grade_create', targetType: 'grade', targetId: g.id, newValues: body });
    return { id: g.id };
  });
}

export const canViewOrg = (ctx: Ctx) => hasAny(ctx.actor, ['org.manage', 'employee.read.all', 'report.org', 'report.finance']);
