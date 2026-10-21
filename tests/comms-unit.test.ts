import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { loginAs, makeUser, setupEnv, type Client, type MadeUser, type TestEnv } from './helpers';
import { notifications } from '../server/db/schema';
import { addMonths, ageOn } from '../server/lib/dates';
import { computeTotals } from '../server/services/payroll';
import { toCsv, minorToDecimal } from '../server/lib/csv';
import { detectFileType } from '../server/services/documents';
import { redact } from '../server/services/audit';
import { formatEmploymentNumber } from '../server/services/employmentNumbers';
import { inModeratorScope } from '../server/authz/policy';

describe('announcements, events and comments', () => {
  let env: TestEnv;
  let admin: MadeUser, conStaff: MadeUser, medStaff: MadeUser;
  let c: Record<string, Client>;

  beforeAll(async () => {
    env = await setupEnv();
    admin = await makeUser(env, { roles: ['admin'] });
    conStaff = await makeUser(env, { dept: 'CON' });
    medStaff = await makeUser(env, { dept: 'MED' });
    c = { admin: await loginAs(env, admin.username), con: await loginAs(env, conStaff.username), med: await loginAs(env, medStaff.username) };
  });
  afterAll(async () => {
    await env.close();
  });

  it('targets announcements to departments and hides drafts', async () => {
    const a = await c.admin.post('/api/announcements', { title: 'Site safety briefing', body: 'Hard hats required.', targetDepartmentIds: [env.dept.CON], commentsEnabled: true }).expect(200);
    expect((await c.con.get(`/api/announcements/${a.body.id}`)).status).toBe(404);
    await c.admin.post(`/api/announcements/${a.body.id}/status`, { status: 'published' }).expect(200);
    await c.con.get(`/api/announcements/${a.body.id}`).expect(200);
    expect((await c.med.get(`/api/announcements/${a.body.id}`)).status).toBe(404);
    const medList = await c.med.get('/api/announcements').expect(200);
    expect(medList.body.items.find((i: { id: string }) => i.id === a.body.id)).toBeUndefined();
    const conNote = await env.db.select().from(notifications).where(and(eq(notifications.userId, conStaff.userId), eq(notifications.type, 'announcement.published')));
    const medNote = await env.db.select().from(notifications).where(and(eq(notifications.userId, medStaff.userId), eq(notifications.type, 'announcement.published')));
    expect(conNote).toHaveLength(1);
    expect(medNote).toHaveLength(0);
    // republishing never duplicates notifications
    await c.admin.post(`/api/announcements/${a.body.id}/status`, { status: 'draft' }).expect(200);
    await c.admin.post(`/api/announcements/${a.body.id}/status`, { status: 'published' }).expect(200);
    expect(await env.db.select().from(notifications).where(and(eq(notifications.userId, conStaff.userId), eq(notifications.type, 'announcement.published')))).toHaveLength(1);

    // comments: allowed for the audience, rate limited, moderated
    await c.con.post(`/api/comments/announcement/${a.body.id}`, { body: 'Noted, thanks.' }).expect(200);
    expect((await c.con.post(`/api/comments/announcement/${a.body.id}`, { body: 'Noted, thanks.' })).status).toBe(409);
    expect((await c.med.post(`/api/comments/announcement/${a.body.id}`, { body: 'Hello' })).status).toBe(404);
    for (let i = 0; i < 4; i++) await c.con.post(`/api/comments/announcement/${a.body.id}`, { body: `Comment ${i}` });
    expect((await c.con.post(`/api/comments/announcement/${a.body.id}`, { body: 'One more' })).status).toBe(429);
    const list = await c.con.get(`/api/comments/announcement/${a.body.id}`).expect(200);
    const target = list.body[0];
    expect((await c.med.patch(`/api/comments/${target.id}`, { status: 'hidden' })).status).toBe(404);
    await c.admin.patch(`/api/comments/${target.id}`, { status: 'hidden', reason: 'Off topic' }).expect(200);
    const after = await c.con.get(`/api/comments/announcement/${a.body.id}`).expect(200);
    expect(after.body.find((x: { id: string }) => x.id === target.id)).toBeUndefined();
  });

  it('blocks comments where disabled and enforces event status transitions', async () => {
    const start = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
    const e = await c.admin.post('/api/events', { title: 'Staff day', startsAt: start, venue: 'Head Office' }).expect(200);
    await c.admin.post(`/api/events/${e.body.id}/status`, { status: 'published' }).expect(200);
    expect((await c.con.post(`/api/comments/event/${e.body.id}`, { body: 'Hi' })).status).toBe(400);
    await c.admin.post(`/api/events/${e.body.id}/status`, { status: 'cancelled' }).expect(200);
    expect((await c.admin.post(`/api/events/${e.body.id}/status`, { status: 'published' })).status).toBe(400);
    expect((await c.con.post('/api/events', { title: 'x', startsAt: start })).status).toBe(403);
  });
});

describe('pure helpers', () => {
  it('calculates age from date of birth, including leap days', () => {
    expect(ageOn('1990-06-15', '2026-06-14')).toBe(35);
    expect(ageOn('1990-06-15', '2026-06-15')).toBe(36);
    expect(ageOn('2000-02-29', '2026-02-28')).toBe(25);
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2026-10-31', -6)).toBe('2026-04-30');
  });

  it('computes payroll totals and rejects negative net pay', () => {
    expect(computeTotals(1000, [{ kind: 'earning', category: 'bonus', label: 'b', amount: 200 }, { kind: 'deduction', category: 'tax', label: 't', amount: 300 }])).toEqual({
      grossEarnings: 1200,
      totalDeductions: 300,
      netPay: 900,
    });
    expect(() => computeTotals(100, [{ kind: 'deduction', category: 'tax', label: 't', amount: 300 }])).toThrow();
    expect(minorToDecimal(1234567)).toBe('12345.67');
    expect(minorToDecimal(5)).toBe('0.05');
  });

  it('neutralises CSV formula injection', () => {
    const out = toCsv(['a'], [['=HYPERLINK("http://evil")'], ['plain, with comma']]);
    expect(out).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(out).toContain('"plain, with comma"');
  });

  it('detects file types from content, not names', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7 ...'))?.mime).toBe('application/pdf');
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(detectFileType(Buffer.from('<script>alert(1)</script>'))).toBeNull();
  });

  it('redacts secrets from audit values', () => {
    expect(redact({ password: 'x', nested: { mfaSecretEnc: 'y', code: 'ADM' }, token: 't' })).toEqual({
      password: '[redacted]',
      nested: { mfaSecretEnc: '[redacted]', code: 'ADM' },
      token: '[redacted]',
    });
  });

  it('formats employment numbers with fixed width', () => {
    expect(formatEmploymentNumber('CON', 7)).toBe('CON-000007');
    expect(formatEmploymentNumber('MED', 1234567)).toBe('MED-1234567');
  });

  it('evaluates moderator scopes as union of grants with department ∩ location rows', () => {
    const actor = {
      employeeId: 'm1',
      scopes: [
        { id: '1', scopeType: 'org_unit' as const, departmentId: 'CON', locationId: 'A' },
        { id: '2', scopeType: 'direct_reports' as const, departmentId: null, locationId: null },
      ],
    } as never;
    expect(inModeratorScope(actor, { id: 'e', departmentId: 'CON', locationId: 'A', supervisorId: null })).toBe(true);
    expect(inModeratorScope(actor, { id: 'e', departmentId: 'CON', locationId: 'B', supervisorId: null })).toBe(false);
    expect(inModeratorScope(actor, { id: 'e', departmentId: 'MED', locationId: 'B', supervisorId: 'm1' })).toBe(true);
  });
});
