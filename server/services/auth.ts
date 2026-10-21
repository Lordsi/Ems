import { z } from 'zod';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import {
  approvalRequests,
  departments,
  employees,
  employmentGrades,
  invitations,
  jobTitles,
  nextOfKin,
  roles,
  sessions,
  userRoles,
  users,
  workLocations,
} from '../db/schema';
import type { Db, Tx } from '../db/client';
import type { Ctx, RequestMeta } from '../context';
import { AppError, badRequest, conflict, forbidden, unauthorized } from '../lib/errors';
import { burnPasswordCheck, decrypt, encrypt, hashPassword, sha256, verifyPassword } from '../lib/crypto';
import {
  parse,
  zDate,
  zEmail,
  zOptDate,
  zOptEmail,
  zOptText,
  zOptUuid,
  zPassword,
  zPhone,
  zTrim,
  zUsername,
  zUuid,
} from '../lib/validate';
import { addYears, todayIso } from '../lib/dates';
import { createSession, loadActor, revokeAllSessions, revokeSession, type LoadedSession } from '../auth/sessions';
import { generateTotpSecret, totpEnrollment, verifyTotp } from '../auth/totp';
import { requireActor, requireRecentAuth } from '../authz/policy';
import { audit } from './audit';
import { notify, usersWithPermission } from './notifications';
import { getSetting, getSettings } from './settings';
import { PRIVILEGED_ROLES, type RoleKey } from '../../shared/permissions';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

/* ------------------------------------------------------------------ */
/* Registration                                                       */
/* ------------------------------------------------------------------ */

const accountSchema = z
  .object({
    displayName: zTrim(120),
    email: zEmail,
    password: zPassword,
  })
  .strict();

export const employmentProfileSchema = z
  .object({
    legalName: zTrim(160),
    preferredName: zOptText(120),
    dateOfBirth: zDate,
    phone: zPhone,
    personalEmail: zOptEmail,
    address: zOptText(500),
    departmentId: zUuid,
    jobTitleId: zOptUuid,
    gradeId: zOptUuid,
    workLocation: zOptText(160),
    employmentDate: zDate,
    employmentType: z.enum(['permanent', 'contract', 'temporary', 'volunteer', 'intern']),
    contractEndDate: zOptDate,
    supervisorName: zOptText(160),
  })
  .strict();

export const nextOfKinSchema = z
  .object({
    fullName: zTrim(160),
    relationship: zTrim(60),
    phone: zPhone,
    address: zOptText(500),
  })
  .strict();

/** Public registration deliberately has no role, status or employment-number fields; `.strict()` rejects them. */
export const registrationSchema = z
  .object({ account: accountSchema, profile: employmentProfileSchema, nextOfKin: nextOfKinSchema })
  .strict();

export function validateEmploymentDates(p: {
  dateOfBirth?: string | null;
  employmentDate?: string | null;
  contractEndDate?: string | null;
  employmentType?: string | null;
}, today = todayIso()) {
  const fields: Record<string, string> = {};
  if (p.dateOfBirth) {
    if (p.dateOfBirth >= today) fields.dateOfBirth = 'Date of birth must be in the past';
    else if (addYears(p.dateOfBirth, 16) > today) fields.dateOfBirth = 'Employees must be at least 16 years old';
    else if (addYears(p.dateOfBirth, 100) < today) fields.dateOfBirth = 'Please check the date of birth';
  }
  if (p.employmentDate && p.dateOfBirth && p.employmentDate < addYears(p.dateOfBirth, 14)) {
    fields.employmentDate = 'Employment date is not plausible for the date of birth';
  }
  if (p.employmentDate && p.employmentDate > addYears(today, 1)) fields.employmentDate = 'Employment date is too far in the future';
  if (p.employmentType === 'contract' && p.contractEndDate === null) fields.contractEndDate = 'Contract end date is required for contract staff';
  if (p.contractEndDate && p.employmentDate && p.contractEndDate <= p.employmentDate) {
    fields.contractEndDate = 'Contract end date must be after the employment date';
  }
  if (Object.keys(fields).length) throw badRequest('Validation failed', { fields });
}

/** Ensures referenced organisational records exist and are active. */
export async function validateOrgRefs(
  tx: Tx,
  p: { departmentId?: string | null; jobTitleId?: string | null; gradeId?: string | null; locationId?: string | null },
) {
  const fields: Record<string, string> = {};
  if (p.departmentId) {
    const [d] = await tx.select({ status: departments.status }).from(departments).where(eq(departments.id, p.departmentId));
    if (!d || d.status !== 'active') fields.departmentId = 'Select an active department';
  }
  if (p.jobTitleId) {
    const [j] = await tx.select({ status: jobTitles.status, departmentId: jobTitles.departmentId }).from(jobTitles).where(eq(jobTitles.id, p.jobTitleId));
    if (!j || j.status !== 'active') fields.jobTitleId = 'Select an active job title';
    else if (j.departmentId && p.departmentId && j.departmentId !== p.departmentId) fields.jobTitleId = 'Job title belongs to another department';
  }
  if (p.gradeId) {
    const [g] = await tx.select({ status: employmentGrades.status }).from(employmentGrades).where(eq(employmentGrades.id, p.gradeId));
    if (!g || g.status !== 'active') fields.gradeId = 'Select an active grade';
  }
  if (p.locationId) {
    const [l] = await tx.select({ status: workLocations.status }).from(workLocations).where(eq(workLocations.id, p.locationId));
    if (!l || l.status !== 'active') fields.locationId = 'Select an active work location';
  }
  if (Object.keys(fields).length) throw badRequest('Validation failed', { fields });
}

async function assertEmailFree(tx: Tx, email: string) {
  const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
  if (taken) throw conflict('That email address is already registered');
}

/** Registrants and invitees sign in with their email, so they get an internal username derived from it. */
async function usernameFromEmail(tx: Tx, email: string): Promise<string> {
  const base = (email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'user').padEnd(3, '0').slice(0, 32);
  const rows = await tx
    .select({ username: users.username })
    .from(users)
    .where(sql`lower(${users.username}) like ${`${base.replace(/[%_\\]/g, '\\$&')}%`}`);
  const taken = new Set(rows.map((r) => r.username.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

export async function register(ctx: Ctx, input: unknown) {
  const body = parse(registrationSchema, input);
  if (!(await getSetting(ctx.db, 'registration.open'))) throw forbidden('Self-registration is currently closed. Ask an administrator for an invitation.');
  validateEmploymentDates(body.profile, todayIso(ctx.now()));

  const result = await ctx.db.transaction(async (tx) => {
    await validateOrgRefs(tx, body.profile);
    await assertEmailFree(tx, body.account.email);
    const [user] = await tx
      .insert(users)
      .values({
        email: body.account.email,
        username: await usernameFromEmail(tx, body.account.email),
        displayName: body.account.displayName,
        passwordHash: await hashPassword(body.account.password),
        status: 'pending_verification',
        passwordChangedAt: ctx.now(),
      })
      .returning();
    const { supervisorName, ...profile } = body.profile;
    const [emp] = await tx
      .insert(employees)
      .values({
        ...profile,
        personalEmail: profile.personalEmail ?? body.account.email,
        userId: user.id,
        employmentStatus: 'pending_verification',
        createdBy: user.id,
      })
      .returning();
    await tx.insert(nextOfKin).values({ ...body.nextOfKin, employeeId: emp.id });
    const [approval] = await tx
      .insert(approvalRequests)
      .values({
        type: 'registration',
        targetType: 'employee',
        targetId: emp.id,
        departmentId: emp.departmentId,
        summary: `New registration: ${emp.legalName}`,
        payload: { supervisorName: supervisorName ?? null, workLocation: emp.workLocation },
        requiredPermission: 'employee.verify',
        requestedBy: user.id,
      })
      .returning();
    await audit(tx, { ...ctx, actor: null }, {
      actorUserId: user.id,
      action: 'auth.register',
      targetType: 'employee',
      targetId: emp.id,
      newValues: { username: user.username, departmentId: emp.departmentId },
      approvalId: approval.id,
    });
    await notify(tx, await usersWithPermission(tx, 'employee.verify'), {
      type: 'registration.pending',
      title: 'Registration awaiting verification',
      body: `${emp.legalName} has registered and needs identity and employment verification.`,
      link: `/approvals?id=${approval.id}`,
      dedupeKey: `registration:${approval.id}`,
    });
    const session = await createSession(tx, user.id, { ip: ctx.meta.ip, userAgent: ctx.meta.userAgent, now: ctx.now() });
    return { session, userId: user.id, employeeId: emp.id };
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Login / logout                                                     */
/* ------------------------------------------------------------------ */

const loginSchema = z.object({ identifier: z.string().trim().min(1).max(254), password: z.string().min(1).max(200) });

export async function login(ctx: Ctx, input: unknown) {
  const body = parse(loginSchema, input);
  const ident = body.identifier.toLowerCase();
  const [user] = await ctx.db
    .select()
    .from(users)
    .where(or(sql`lower(${users.email}) = ${ident}`, sql`lower(${users.username}) = ${ident}`));
  const fail = async (userId: string | null, why: string) => {
    await audit(ctx.db, { ...ctx, actor: null }, {
      actorUserId: userId,
      action: 'auth.login',
      outcome: 'failure',
      targetType: 'user',
      targetId: userId,
      newValues: { identifier: body.identifier.slice(0, 80), why },
    });
  };
  if (!user) {
    await burnPasswordCheck(body.password);
    await fail(null, 'unknown_identifier');
    throw unauthorized('Invalid username/email or password');
  }
  const now = ctx.now();
  if (user.lockedUntil && user.lockedUntil > now) {
    await burnPasswordCheck(body.password);
    await fail(user.id, 'locked');
    throw new AppError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.');
  }
  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    const count = user.failedLoginCount + 1;
    await ctx.db
      .update(users)
      .set({
        failedLoginCount: count >= MAX_FAILED_LOGINS ? 0 : count,
        lockedUntil: count >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : user.lockedUntil,
      })
      .where(eq(users.id, user.id));
    await fail(user.id, count >= MAX_FAILED_LOGINS ? 'bad_password_locked' : 'bad_password');
    throw unauthorized('Invalid username/email or password');
  }
  if (user.status === 'suspended' || user.status === 'deactivated') {
    await fail(user.id, `status_${user.status}`);
    throw forbidden('This account is not active. Contact an administrator.');
  }
  await ctx.db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id));
  const session = await createSession(ctx.db, user.id, {
    ip: ctx.meta.ip,
    userAgent: ctx.meta.userAgent,
    mfaPending: user.mfaEnabled,
    now,
  });
  await audit(ctx.db, { ...ctx, actor: null }, {
    actorUserId: user.id,
    action: user.mfaEnabled ? 'auth.login.password_ok' : 'auth.login',
    targetType: 'user',
    targetId: user.id,
  });
  return { session, mfaRequired: user.mfaEnabled };
}

export async function verifyMfaLogin(ctx: Ctx, loaded: LoadedSession | null, input: unknown) {
  const { code } = parse(z.object({ code: z.string().trim().max(10) }), input);
  if (!loaded || !loaded.session.mfaPending) throw unauthorized();
  const user = loaded.user;
  if (!user.mfaSecretEnc || !verifyTotp(decrypt(user.mfaSecretEnc), code)) {
    await audit(ctx.db, { ...ctx, actor: null }, { actorUserId: user.id, action: 'auth.mfa', outcome: 'failure', targetType: 'user', targetId: user.id });
    throw unauthorized('Invalid verification code');
  }
  // Rotate the session identifier once the second factor succeeds.
  await revokeSession(ctx.db, loaded.session.id);
  const session = await createSession(ctx.db, user.id, { ip: ctx.meta.ip, userAgent: ctx.meta.userAgent, now: ctx.now() });
  await audit(ctx.db, { ...ctx, actor: null }, { actorUserId: user.id, action: 'auth.login', targetType: 'user', targetId: user.id, newValues: { mfa: true } });
  return { session };
}

export async function logout(ctx: Ctx, sessionId: string | undefined) {
  if (!sessionId) return;
  await revokeSession(ctx.db, sessionId);
  if (ctx.actor) await audit(ctx.db, ctx, { action: 'auth.logout', targetType: 'user', targetId: ctx.actor.userId });
}

/* ------------------------------------------------------------------ */
/* Current user                                                       */
/* ------------------------------------------------------------------ */

export async function me(ctx: Ctx) {
  if (!ctx.actor) throw unauthorized();
  const a = ctx.actor;
  const settings = await getSettings(ctx.db);
  let employee: Record<string, unknown> | null = null;
  if (a.employeeId) {
    const [e] = await ctx.db
      .select({
        id: employees.id,
        legalName: employees.legalName,
        preferredName: employees.preferredName,
        employmentNumber: employees.employmentNumber,
        employmentStatus: employees.employmentStatus,
        departmentName: departments.name,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.id, a.employeeId));
    employee = e ?? null;
  }
  const privileged = a.roles.some((r) => PRIVILEGED_ROLES.includes(r));
  return {
    user: {
      id: a.userId,
      displayName: a.displayName,
      username: a.username,
      email: a.email,
      status: a.status,
      roles: a.roles,
      permissions: [...a.permissions].sort(),
      employeeId: a.employeeId,
      mfaEnabled: a.mfaEnabled,
      mustChangePassword: a.mustChangePassword,
      mfaSetupRequired: privileged && settings['security.require_mfa_for_privileged'] && !a.mfaEnabled,
      scopes: a.scopes,
    },
    employee,
    org: { name: settings['org.name'], currency: settings['org.currency'] },
  };
}

/* ------------------------------------------------------------------ */
/* Re-authentication, password and MFA                                */
/* ------------------------------------------------------------------ */

export async function reauthenticate(ctx: Ctx, input: unknown) {
  requireActor(ctx);
  const body = parse(z.object({ password: z.string().min(1).max(200), code: z.string().trim().max(10).optional() }), input);
  const [user] = await ctx.db.select().from(users).where(eq(users.id, ctx.actor.userId));
  const passOk = await verifyPassword(body.password, user.passwordHash);
  const mfaOk = !user.mfaEnabled || (!!body.code && !!user.mfaSecretEnc && verifyTotp(decrypt(user.mfaSecretEnc), body.code));
  if (!passOk || !mfaOk) {
    await audit(ctx.db, ctx, { action: 'auth.reauth', outcome: 'failure', targetType: 'user', targetId: user.id });
    throw new AppError(401, 'REAUTH_FAILED', user.mfaEnabled ? 'Incorrect password or verification code' : 'Incorrect password');
  }
  await ctx.db.update(sessions).set({ reauthAt: ctx.now() }).where(eq(sessions.id, ctx.actor.sessionId));
  await audit(ctx.db, ctx, { action: 'auth.reauth', targetType: 'user', targetId: user.id });
  return { ok: true };
}

export async function changePassword(ctx: Ctx, input: unknown) {
  if (!ctx.actor) throw unauthorized();
  const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: zPassword }), input);
  const [user] = await ctx.db.select().from(users).where(eq(users.id, ctx.actor.userId));
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    await audit(ctx.db, ctx, { action: 'auth.password_change', outcome: 'failure', targetType: 'user', targetId: user.id });
    throw badRequest('Validation failed', { fields: { currentPassword: 'Current password is incorrect' } });
  }
  if (body.currentPassword === body.newPassword) throw badRequest('Validation failed', { fields: { newPassword: 'Choose a different password' } });
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), passwordChangedAt: ctx.now(), mustChangePassword: false, updatedAt: ctx.now() })
      .where(eq(users.id, user.id));
    await revokeAllSessions(tx, user.id, ctx.actor!.sessionId);
    await audit(tx, ctx, { action: 'auth.password_change', targetType: 'user', targetId: user.id });
  });
  return { ok: true };
}

export async function mfaSetup(ctx: Ctx) {
  requireActor(ctx);
  const [user] = await ctx.db.select().from(users).where(eq(users.id, ctx.actor.userId));
  if (user.mfaEnabled) throw conflict('Two-factor authentication is already enabled');
  const secret = generateTotpSecret();
  await ctx.db.update(users).set({ mfaSecretEnc: encrypt(secret) }).where(eq(users.id, user.id));
  const orgName = await getSetting(ctx.db, 'org.name');
  const enrollment = await totpEnrollment(secret, user.username, orgName);
  return { ...enrollment, secret };
}

export async function mfaEnable(ctx: Ctx, input: unknown) {
  requireActor(ctx);
  const { code } = parse(z.object({ code: z.string().trim().max(10) }), input);
  const [user] = await ctx.db.select().from(users).where(eq(users.id, ctx.actor.userId));
  if (!user.mfaSecretEnc || !verifyTotp(decrypt(user.mfaSecretEnc), code)) throw badRequest('Invalid verification code');
  await ctx.db.update(users).set({ mfaEnabled: true }).where(eq(users.id, user.id));
  await audit(ctx.db, ctx, { action: 'auth.mfa_enabled', targetType: 'user', targetId: user.id });
  return { ok: true };
}

export async function mfaDisable(ctx: Ctx) {
  requireActor(ctx);
  requireRecentAuth(ctx);
  await ctx.db.update(users).set({ mfaEnabled: false, mfaSecretEnc: null }).where(eq(users.id, ctx.actor.userId));
  await audit(ctx.db, ctx, { action: 'auth.mfa_disabled', targetType: 'user', targetId: ctx.actor.userId });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Invitations                                                        */
/* ------------------------------------------------------------------ */

async function findInvitation(db: Tx, token: string, now: Date) {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .select({ inv: invitations, legalName: employees.legalName, employeeUserId: employees.userId, employmentStatus: employees.employmentStatus })
    .from(invitations)
    .innerJoin(employees, eq(employees.id, invitations.employeeId))
    .where(eq(invitations.tokenHash, sha256(token)));
  if (!row || row.inv.acceptedAt || row.inv.revokedAt || row.inv.expiresAt <= now || row.employeeUserId) return null;
  return row;
}

export async function getInvitation(ctx: Ctx, token: string) {
  const row = await findInvitation(ctx.db, token, ctx.now());
  if (!row) throw new AppError(404, 'INVITATION_INVALID', 'This invitation is invalid or has expired');
  return { email: row.inv.email, legalName: row.legalName };
}

export async function acceptInvitation(ctx: Ctx, token: string, input: unknown) {
  const body = parse(z.object({ password: zPassword, displayName: zTrim(120).optional() }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const row = await findInvitation(tx, token, ctx.now());
    if (!row) throw new AppError(404, 'INVITATION_INVALID', 'This invitation is invalid or has expired');
    await assertEmailFree(tx, row.inv.email);
    const active = row.employmentStatus === 'active' || row.employmentStatus === 'on_leave';
    const [user] = await tx
      .insert(users)
      .values({
        email: row.inv.email,
        username: await usernameFromEmail(tx, row.inv.email),
        displayName: body.displayName ?? row.legalName,
        passwordHash: await hashPassword(body.password),
        status: active ? 'active' : 'pending_verification',
        passwordChangedAt: ctx.now(),
      })
      .returning();
    const linked = await tx
      .update(employees)
      .set({ userId: user.id, updatedAt: ctx.now() })
      .where(and(eq(employees.id, row.inv.employeeId), isNull(employees.userId)))
      .returning({ id: employees.id });
    if (!linked.length) throw conflict('This employee record is already linked to an account');
    const roleKey = row.inv.roleKey as RoleKey;
    const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey));
    await tx.insert(userRoles).values({ userId: user.id, roleId: role.id, grantedBy: row.inv.createdBy });
    await tx.update(invitations).set({ acceptedAt: ctx.now() }).where(eq(invitations.id, row.inv.id));
    await audit(tx, { ...ctx, actor: null }, {
      actorUserId: user.id,
      action: 'auth.invitation_accepted',
      targetType: 'employee',
      targetId: row.inv.employeeId,
      newValues: { username: user.username, role: roleKey },
    });
    const session = await createSession(tx, user.id, { ip: ctx.meta.ip, userAgent: ctx.meta.userAgent, now: ctx.now() });
    return { session };
  });
}

/* ------------------------------------------------------------------ */
/* Super admin provisioning (CLI / one-time bootstrap only)           */
/* ------------------------------------------------------------------ */

export async function countActiveSuperAdmins(tx: Tx): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(distinct ${users.id})::int` })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.key, 'super_admin')))
    .where(eq(users.status, 'active'));
  return n;
}

/**
 * Creates a super admin, or restores access to an existing account (recovery).
 * Never exposed over HTTP. Forces a password change on first login.
 */
export async function provisionSuperAdmin(
  db: Db,
  input: { email: string; username: string; password: string; name: string },
  meta: RequestMeta,
  opts: { forceChange?: boolean } = {},
) {
  const email = parse(zEmail, input.email);
  const username = parse(zUsername, input.username);
  parse(zPassword, input.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(or(sql`lower(${users.email}) = ${email}`, sql`lower(${users.username}) = ${username.toLowerCase()}`));
    let userId: string;
    if (existing) {
      await tx
        .update(users)
        .set({
          passwordHash: await hashPassword(input.password),
          status: 'active',
          failedLoginCount: 0,
          lockedUntil: null,
          mfaEnabled: false,
          mfaSecretEnc: null,
          mustChangePassword: opts.forceChange ?? true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id));
      await revokeAllSessions(tx, existing.id);
      userId = existing.id;
    } else {
      const [u] = await tx
        .insert(users)
        .values({
          email,
          username,
          displayName: input.name,
          passwordHash: await hashPassword(input.password),
          status: 'active',
          mustChangePassword: opts.forceChange ?? true,
        })
        .returning();
      userId = u.id;
    }
    const [role] = await tx.select().from(roles).where(eq(roles.key, 'super_admin'));
    await tx.insert(userRoles).values({ userId, roleId: role.id }).onConflictDoNothing();
    await audit(tx, { actor: null, meta }, {
      actorUserId: null,
      action: existing ? 'security.superadmin_recovered' : 'security.superadmin_provisioned',
      targetType: 'user',
      targetId: userId,
      newValues: { username, email },
      reason: 'Provisioned via secure setup procedure',
    });
    return { userId, created: !existing };
  });
}

export { loadActor };
