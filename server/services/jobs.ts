import { and, eq, inArray, isNull, isNotNull, lte, gte, sql } from 'drizzle-orm';
import { employees, jobRuns, nextOfKin } from '../db/schema';
import type { Db } from '../db/client';
import { addDays, todayIso } from '../lib/dates';
import { runRetirementScan } from './retirement';
import { sendEventReminders } from './comms';
import { notify, usersWithPermission } from './notifications';
import { getSettings } from './settings';

/**
 * Runs a job at most once per run key (e.g. per day). The job_runs unique index makes this
 * safe even if several app instances or a cron job run concurrently.
 */
async function once<T>(db: Db, jobName: string, runKey: string, fn: () => Promise<T>, force = false) {
  const claimed = force
    ? [{ id: 'forced' }]
    : await db.insert(jobRuns).values({ jobName, runKey }).onConflictDoNothing().returning({ id: jobRuns.id });
  if (!claimed.length) return { jobName, skipped: true as const };
  try {
    const details = await fn();
    if (!force) await db.update(jobRuns).set({ status: 'success', finishedAt: new Date(), details: details as Record<string, unknown> }).where(eq(jobRuns.id, claimed[0].id));
    return { jobName, skipped: false as const, details };
  } catch (err) {
    if (!force) {
      // Release the claim so the next scheduled run retries.
      await db.delete(jobRuns).where(eq(jobRuns.id, claimed[0].id));
    }
    throw err;
  }
}

async function contractExpiryNotices(db: Db, now: Date, days: number) {
  const today = todayIso(now);
  const horizon = addDays(today, days);
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: employees.id, legalName: employees.legalName, userId: employees.userId, contractEndDate: employees.contractEndDate })
      .from(employees)
      .where(
        and(
          isNull(employees.archivedAt),
          inArray(employees.employmentStatus, ['active', 'on_leave']),
          isNotNull(employees.contractEndDate),
          gte(employees.contractEndDate, today),
          lte(employees.contractEndDate, horizon),
        ),
      );
    const managers = await usersWithPermission(tx, 'employee.update.all');
    let sent = 0;
    for (const r of rows) {
      sent += await notify(tx, managers, {
        type: 'contract.expiring',
        title: `Contract ending soon: ${r.legalName}`,
        body: `Contract end date ${r.contractEndDate}.`,
        link: `/employees/${r.id}`,
        dedupeKey: `contract-expiry:${r.id}:${r.contractEndDate}`,
      });
      sent += await notify(tx, [r.userId], {
        type: 'contract.expiring',
        title: 'Your contract end date is approaching',
        body: `Your contract is due to end on ${r.contractEndDate}.`,
        link: '/profile',
        dedupeKey: `contract-expiry-self:${r.id}:${r.contractEndDate}`,
      });
    }
    return sent;
  });
}

async function profileCompletionNotices(db: Db) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: employees.id, userId: employees.userId, phone: employees.phone, nok: nextOfKin.id })
      .from(employees)
      .leftJoin(nextOfKin, eq(nextOfKin.employeeId, employees.id))
      .where(and(isNull(employees.archivedAt), eq(employees.employmentStatus, 'active'), isNotNull(employees.userId), sql`(${employees.phone} is null or ${nextOfKin.id} is null)`));
    let sent = 0;
    for (const r of rows) {
      sent += await notify(tx, [r.userId], {
        type: 'profile.incomplete',
        title: 'Please complete your profile',
        body: !r.nok ? 'Add your next-of-kin details.' : 'Add a contact phone number.',
        link: '/profile',
        dedupeKey: `profile-incomplete:${r.id}`,
      });
    }
    return sent;
  });
}

export async function runScheduledJobs(db: Db, now: Date = new Date(), opts: { force?: boolean } = {}) {
  const day = todayIso(now);
  const hour = now.toISOString().slice(0, 13);
  const settings = await getSettings(db);
  const results = [];
  results.push(await once(db, 'retirement_scan', day, () => runRetirementScan(db, now), opts.force));
  results.push(
    await once(db, 'event_reminders', hour, async () => ({ sent: await db.transaction((tx) => sendEventReminders(tx, now, settings['notifications.event_reminder_hours'])) }), opts.force),
  );
  results.push(await once(db, 'contract_expiry', day, async () => ({ sent: await contractExpiryNotices(db, now, settings['notifications.contract_expiry_days']) }), opts.force));
  results.push(await once(db, 'profile_completion', day, async () => ({ sent: await profileCompletionNotices(db) }), opts.force));
  return results;
}
