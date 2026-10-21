/**
 * DEVELOPMENT-ONLY demo data.
 *
 *   npm run seed:demo
 *
 * Creates demo accounts for every role (all sharing DEMO_PASSWORD below), locations, job titles,
 * grades, employees, an approved and paid payroll period with payslips, an open payroll period,
 * an announcement, an event and one pending self-registration. Business actions go through the
 * real service layer, so approvals, audit entries and notifications are genuine.
 *
 * Refuses to run when NODE_ENV=production, and refuses to touch an external DATABASE_URL unless
 * --allow-database-url is passed. Never run this against a production database.
 */
import { eq } from 'drizzle-orm';
import { config } from '../server/config';
import { createDb, runMigrations, type Db } from '../server/db/client';
import { seedBase } from '../server/db/seed';
import {
  departmentLocations,
  departments,
  employees,
  employmentGrades,
  jobTitles,
  moderatorScopes,
  nextOfKin,
  roles,
  userRoles,
  users,
  workLocations,
} from '../server/db/schema';
import type { Actor, Ctx } from '../server/context';
import { hashPassword } from '../server/lib/crypto';
import { issueEmploymentNumber } from '../server/services/employmentNumbers';
import * as payroll from '../server/services/payroll';
import * as comms from '../server/services/comms';
import { register } from '../server/services/auth';
import { ROLE_PERMISSIONS, type Permission, type RoleKey } from '../shared/permissions';

export const DEMO_PASSWORD = 'Demo-Password-2026';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data with NODE_ENV=production.');
  process.exit(1);
}
if (config.databaseUrl && !process.argv.includes('--allow-database-url')) {
  console.error('DATABASE_URL is set. Demo data is intended for the local PGlite database.');
  console.error('If this really is a disposable development database, re-run with: npm run seed:demo -- --allow-database-url');
  process.exit(1);
}

const now = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftMonths = (months: number, base = now) => {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, Math.min(base.getUTCDate(), 28)));
  return d;
};
/** Date of birth such that the person turns `age` in `monthsAhead` months. */
const dobTurning = (age: number, monthsAhead: number) => {
  const d = shiftMonths(monthsAhead);
  d.setUTCFullYear(d.getUTCFullYear() - age);
  return iso(d);
};

function ctxFor(db: Db, actor: Actor | null): Ctx {
  return { db, actor, meta: { requestId: 'seed-demo' }, now: () => new Date() };
}

function actorFor(u: { userId: string; employeeId: string; username: string; roles: RoleKey[] }): Actor {
  const perms = new Set<Permission>(u.roles.flatMap((r) => ROLE_PERMISSIONS[r]));
  return {
    userId: u.userId,
    sessionId: 'seed-demo',
    displayName: u.username,
    username: u.username,
    email: `${u.username}@demo.local`,
    status: 'active',
    roles: u.roles,
    permissions: perms,
    employeeId: u.employeeId,
    scopes: [],
    reauthAt: new Date(),
    mfaEnabled: false,
    mustChangePassword: false,
  };
}

const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
const db = handle.db;

try {
  await runMigrations(handle);
  await seedBase(db);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, 'demo.super'));
  if (existing) {
    console.log('Demo data already present (user "demo.super" exists). Nothing to do.');
    console.log('To start over, stop the server and delete the .data/pglite folder.');
    process.exit(0);
  }

  /* ---------------- Organisation ---------------- */
  const dept = Object.fromEntries((await db.select().from(departments)).map((d) => [d.code, d.id])) as Record<string, string>;
  const locRows = await db
    .insert(workLocations)
    .values([
      { code: 'LL-HQ', name: 'Lilongwe Head Office', address: 'Area 3, Lilongwe' },
      { code: 'BT', name: 'Blantyre Branch', address: 'Victoria Avenue, Blantyre' },
      { code: 'SITE-A', name: 'Construction Site A', address: 'Kanengo, Lilongwe' },
      { code: 'MZ-CLINIC', name: 'Mzuzu Clinic', address: 'Mzuzu' },
    ])
    .onConflictDoNothing()
    .returning();
  const loc = Object.fromEntries(locRows.map((l) => [l.code, l.id])) as Record<string, string>;
  const links: [string, string][] = [
    ['ADM', 'LL-HQ'],
    ['ADM', 'BT'],
    ['CLG', 'LL-HQ'],
    ['CLG', 'BT'],
    ['CON', 'SITE-A'],
    ['CON', 'LL-HQ'],
    ['PRT', 'BT'],
    ['MED', 'MZ-CLINIC'],
  ];
  await db.insert(departmentLocations).values(links.map(([d, l]) => ({ departmentId: dept[d], locationId: loc[l] }))).onConflictDoNothing();

  const gradeRows = await db
    .insert(employmentGrades)
    .values([
      { code: 'G1', name: 'Grade 1 — Entry', rank: 10 },
      { code: 'G2', name: 'Grade 2 — Officer', rank: 20 },
      { code: 'G3', name: 'Grade 3 — Senior', rank: 30 },
      { code: 'G4', name: 'Grade 4 — Manager', rank: 40 },
    ])
    .onConflictDoNothing()
    .returning();
  const grade = Object.fromEntries(gradeRows.map((g) => [g.code, g.id])) as Record<string, string>;

  const titleSpec: [string, string | null][] = [
    ['Administrator', 'ADM'],
    ['Accountant', 'ADM'],
    ['HR Officer', 'ADM'],
    ['Pastor', 'CLG'],
    ['Site Supervisor', 'CON'],
    ['Mason', 'CON'],
    ['Press Operator', 'PRT'],
    ['Nurse', 'MED'],
    ['Clinical Officer', 'MED'],
    ['Driver', null],
  ];
  const titleRows = await db
    .insert(jobTitles)
    .values(titleSpec.map(([name, d]) => ({ name, departmentId: d ? dept[d] : null })))
    .onConflictDoNothing()
    .returning();
  const title = Object.fromEntries(titleRows.map((t) => [t.name, t.id])) as Record<string, string>;

  /* ---------------- People ---------------- */
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const roleIds = Object.fromEntries((await db.select().from(roles)).map((r) => [r.key, r.id])) as Record<string, string>;

  type Person = {
    username?: string;
    roles?: RoleKey[];
    name: string;
    dept: string;
    loc: string;
    title: string;
    grade: string;
    dob: string;
    since: string;
    salary: number;
    type?: string;
    contractEnd?: string;
    supervisor?: string;
  };
  const people: Person[] = [
    { username: 'demo.super', roles: ['super_admin'], name: 'Grace Banda', dept: 'ADM', loc: 'LL-HQ', title: 'Administrator', grade: 'G4', dob: '1972-03-14', since: '2008-01-07', salary: 1_850_000_00 },
    { username: 'demo.admin', roles: ['admin'], name: 'Peter Phiri', dept: 'ADM', loc: 'LL-HQ', title: 'HR Officer', grade: 'G3', dob: '1984-07-22', since: '2012-05-02', salary: 1_200_000_00, supervisor: 'demo.super' },
    { username: 'demo.finance', roles: ['finance'], name: 'Mercy Chirwa', dept: 'ADM', loc: 'LL-HQ', title: 'Accountant', grade: 'G3', dob: '1988-11-02', since: '2015-09-01', salary: 1_100_000_00, supervisor: 'demo.super' },
    { username: 'demo.finance2', roles: ['finance'], name: 'Joseph Mwale', dept: 'ADM', loc: 'BT', title: 'Accountant', grade: 'G2', dob: '1991-02-17', since: '2019-03-11', salary: 850_000_00, supervisor: 'demo.finance' },
    { username: 'demo.moderator', roles: ['moderator'], name: 'Chikondi Kaunda', dept: 'CON', loc: 'SITE-A', title: 'Site Supervisor', grade: 'G3', dob: '1980-05-30', since: '2010-02-15', salary: 950_000_00 },
    { username: 'demo.employee', name: 'Tiyamike Gondwe', dept: 'CON', loc: 'SITE-A', title: 'Mason', grade: 'G1', dob: '1995-09-09', since: '2021-06-01', salary: 420_000_00, supervisor: 'demo.moderator' },
    { name: 'Rev. Daniel Nkhoma', dept: 'CLG', loc: 'LL-HQ', title: 'Pastor', grade: 'G3', dob: dobTurning(60, 4), since: '1994-01-10', salary: 900_000_00 },
    { name: 'Esther Zulu', dept: 'MED', loc: 'MZ-CLINIC', title: 'Nurse', grade: 'G2', dob: dobTurning(60, 10), since: '1999-08-16', salary: 780_000_00 },
    { name: 'Blessings Tembo', dept: 'CON', loc: 'SITE-A', title: 'Mason', grade: 'G1', dob: '1990-12-01', since: '2018-04-03', salary: 400_000_00, supervisor: 'demo.moderator' },
    { name: 'Agnes Kamanga', dept: 'CON', loc: 'LL-HQ', title: 'Driver', grade: 'G1', dob: '1986-06-19', since: '2016-10-10', salary: 380_000_00, type: 'contract', contractEnd: iso(shiftMonths(1)) },
    { name: 'Samuel Mbewe', dept: 'PRT', loc: 'BT', title: 'Press Operator', grade: 'G2', dob: '1979-04-04', since: '2005-07-18', salary: 610_000_00 },
    { name: 'Dr. Ruth Msiska', dept: 'MED', loc: 'MZ-CLINIC', title: 'Clinical Officer', grade: 'G4', dob: '1976-01-25', since: '2011-11-01', salary: 1_400_000_00 },
  ];

  const byUsername: Record<string, { userId: string; employeeId: string; username: string; roles: RoleKey[] }> = {};
  const employeeIds: { id: string; salary: number; name: string }[] = [];
  for (const p of people) {
    let userId: string | null = null;
    if (p.username) {
      const [u] = await db
        .insert(users)
        .values({ email: `${p.username}@demo.local`, username: p.username, displayName: p.name, passwordHash, status: 'active' })
        .returning();
      userId = u.id;
      for (const r of new Set<RoleKey>(['employee', ...(p.roles ?? [])])) await db.insert(userRoles).values({ userId: u.id, roleId: roleIds[r] });
    }
    const employmentNumber = await issueEmploymentNumber(db, dept[p.dept]);
    const [e] = await db
      .insert(employees)
      .values({
        userId,
        employmentNumber,
        numberDepartmentId: dept[p.dept],
        legalName: p.name,
        dateOfBirth: p.dob,
        phone: `+265 99${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
        personalEmail: p.username ? `${p.username}@personal.demo` : null,
        departmentId: dept[p.dept],
        locationId: loc[p.loc],
        jobTitleId: title[p.title],
        gradeId: grade[p.grade],
        supervisorId: p.supervisor ? byUsername[p.supervisor]?.employeeId : null,
        employmentType: p.type ?? 'permanent',
        employmentDate: p.since,
        contractEndDate: p.contractEnd ?? null,
        employmentStatus: 'active',
        verifiedAt: new Date(),
      })
      .returning();
    await db.insert(nextOfKin).values({ employeeId: e.id, fullName: `Next of kin of ${p.name.split(' ').pop()}`, relationship: 'Spouse', phone: '+265 888 000 000' });
    if (p.username && userId) byUsername[p.username] = { userId, employeeId: e.id, username: p.username, roles: ['employee', ...(p.roles ?? [])] };
    employeeIds.push({ id: e.id, salary: p.salary, name: p.name });
  }
  await db.insert(moderatorScopes).values([
    { userId: byUsername['demo.moderator'].userId, scopeType: 'org_unit', departmentId: dept.CON, locationId: loc['SITE-A'] },
    { userId: byUsername['demo.moderator'].userId, scopeType: 'direct_reports' },
  ]);
  await db.update(departments).set({ headEmployeeId: byUsername['demo.moderator'].employeeId }).where(eq(departments.id, dept.CON));

  /* ---------------- Payroll ---------------- */
  const sup = actorFor(byUsername['demo.super']);
  const fin1 = actorFor(byUsername['demo.finance']);
  const fin2 = actorFor(byUsername['demo.finance2']);
  const last = shiftMonths(-1);
  const y = last.getUTCFullYear();
  const m = last.getUTCMonth();
  const monthName = (d: Date) => d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const lastPeriod = (await payroll.createPeriod(ctxFor(db, fin1), {
    code: `${y}-${String(m + 1).padStart(2, '0')}`,
    name: monthName(last),
    startDate: iso(new Date(Date.UTC(y, m, 1))),
    endDate: iso(new Date(Date.UTC(y, m + 1, 0))),
    payDate: iso(new Date(Date.UTC(y, m, 25))),
  })) as { id: string };

  for (const e of employeeIds) {
    const preparer = [fin2, fin1].find((a) => a.employeeId !== e.id)!;
    const approver = [fin1, sup, fin2].find((a) => a.userId !== preparer.userId && a.employeeId !== e.id)!;
    const housing = Math.round(e.salary * 0.15);
    const { id } = (await payroll.createRecord(ctxFor(db, preparer), {
      employeeId: e.id,
      periodId: lastPeriod.id,
      basicSalary: e.salary,
      lineItems: [
        { kind: 'earning', category: 'allowance', label: 'Housing allowance', amount: housing },
        { kind: 'deduction', category: 'tax', label: 'Income tax (demo figure, not a statutory calculation)', amount: Math.round((e.salary + housing) * 0.2) },
        { kind: 'deduction', category: 'pension', label: 'Pension contribution (demo figure)', amount: Math.round(e.salary * 0.05) },
      ],
    })) as { id: string };
    await payroll.submitRecord(ctxFor(db, preparer), id);
    await payroll.approveRecord(ctxFor(db, approver), id, { reason: 'Demo approval' });
    await payroll.markPaid(ctxFor(db, preparer), id, { paymentDate: iso(new Date(Date.UTC(y, m, 25))) });
  }
  await payroll.issuePayslipsForPeriod(ctxFor(db, fin2), lastPeriod.id);
  await payroll.closePeriod(ctxFor(db, fin1), lastPeriod.id, { reason: 'Demo period closed' });

  const cur = shiftMonths(0);
  const cy = cur.getUTCFullYear();
  const cm = cur.getUTCMonth();
  await payroll.createPeriod(ctxFor(db, fin1), {
    code: `${cy}-${String(cm + 1).padStart(2, '0')}`,
    name: monthName(cur),
    startDate: iso(new Date(Date.UTC(cy, cm, 1))),
    endDate: iso(new Date(Date.UTC(cy, cm + 1, 0))),
    payDate: iso(new Date(Date.UTC(cy, cm, 25))),
  });

  /* ---------------- Communications ---------------- */
  const adm = actorFor(byUsername['demo.admin']);
  const ann = (await comms.createAnnouncement(ctxFor(db, adm), {
    title: 'Welcome to the new Employee Management System',
    body: 'All staff can now view their employment details and payslips online.\n\nPlease review your profile and submit a correction request if anything is wrong.',
    commentsEnabled: true,
  })) as { id: string };
  await comms.setAnnouncementStatus(ctxFor(db, adm), ann.id, { status: 'published' });
  const siteNotice = (await comms.createAnnouncement(ctxFor(db, adm), {
    title: 'Site A safety briefing',
    body: 'Mandatory safety briefing for all Construction staff at Site A on Monday at 07:30.',
    targetDepartmentIds: [dept.CON],
    targetLocationIds: [loc['SITE-A']],
  })) as { id: string };
  await comms.setAnnouncementStatus(ctxFor(db, adm), siteNotice.id, { status: 'published' });
  const startsAt = new Date(Date.UTC(cy, cm, now.getUTCDate() + 7, 8, 0));
  const ev = (await comms.createEvent(ctxFor(db, adm), {
    title: 'Annual staff meeting',
    description: 'Review of the year and plans for the next. All departments.',
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 3 * 3600_000).toISOString(),
    venue: 'Lilongwe Head Office, main hall',
    commentsEnabled: true,
  })) as { id: string };
  await comms.setEventStatus(ctxFor(db, adm), ev.id, { status: 'published' });

  /* ---------------- Pending registration ---------------- */
  await register(ctxFor(db, null), {
    account: { displayName: 'Chisomo Banda', email: 'demo.pending@demo.local', password: DEMO_PASSWORD },
    profile: {
      legalName: 'Chisomo Banda',
      dateOfBirth: '1997-03-03',
      phone: '+265 991 111 222',
      departmentId: dept.PRT,
      workLocation: 'Blantyre print works',
      jobTitleId: title['Press Operator'],
      employmentDate: iso(shiftMonths(-2)),
      employmentType: 'permanent',
    },
    nextOfKin: { fullName: 'Kondwani Banda', relationship: 'Parent', phone: '+265 881 333 444' },
  });

  console.log('\nDemo data created. All demo accounts use the password:', DEMO_PASSWORD);
  console.table([
    { username: 'demo.super', role: 'Super Admin' },
    { username: 'demo.admin', role: 'Administrator' },
    { username: 'demo.finance', role: 'Finance Officer' },
    { username: 'demo.finance2', role: 'Finance Officer (second approver)' },
    { username: 'demo.moderator', role: 'Moderator (Construction @ Site A + direct reports)' },
    { username: 'demo.employee', role: 'Employee' },
    { username: 'demo.pending', role: 'Pending verification' },
  ]);
  console.log('The proposed retirement policy (age 60) is NOT adopted. Sign in as demo.super → Retirement → Policies to adopt it,');
  console.log('then Settings → Run scheduled jobs to generate retirement reviews.\n');
} catch (err) {
  const e = err as { message?: string; details?: unknown };
  console.error('Demo seed failed:', e.message, e.details ? JSON.stringify(e.details) : '');
  process.exitCode = 1;
} finally {
  await handle.close();
}
