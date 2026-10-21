import { Router, type Request, type Response, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import type { Ctx } from './context';
import { config } from './config';
import { SESSION_COOKIE, sessionCookieOptions } from './auth/sessions';
import { requirePerm } from './authz/policy';
import * as auth from './services/auth';
import * as emp from './services/employees';
import * as users from './services/users';
import * as org from './services/org';
import * as approvals from './services/approvals';
import * as payroll from './services/payroll';
import * as accounts from './services/payrollAccounts';
import * as retirement from './services/retirement';
import * as comms from './services/comms';
import * as docs from './services/documents';
import * as notifications from './services/notifications';
import * as auditLog from './services/auditLog';
import * as reports from './services/reports';
import * as settings from './services/settings';
import { runScheduledJobs } from './services/jobs';

type Handler = (ctx: Ctx, req: Request, res: Response) => Promise<unknown> | unknown;

/** Wraps a service call: services receive the request context and enforce authorization themselves. */
const h =
  (fn: Handler): RequestHandler =>
  async (req, res) => {
    const result = await fn(req.ctx, req, res);
    if (!res.headersSent) res.json(result ?? { ok: true });
  };

const csv = (filename: string, fn: (ctx: Ctx, req: Request) => Promise<string>): RequestHandler =>
  async (req, res) => {
    const body = await fn(req.ctx, req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  };

const p = (req: Request, name: string) => String(req.params[name]);

function setSession(res: Response, session: { token: string }) {
  res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions());
}

export function buildRouter(opts: { disableRateLimit: boolean }) {
  const r = Router();
  const limiter = (windowMinutes: number, limit: number): RequestHandler =>
    opts.disableRateLimit
      ? (_req, _res, next) => next()
      : rateLimit({
          windowMs: windowMinutes * 60_000,
          limit,
          standardHeaders: 'draft-8',
          legacyHeaders: false,
          handler: (_req, res) => {
            res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' } });
          },
        });
  const authLimit = limiter(15, 20);
  const registerLimit = limiter(60, 10);
  const sensitiveLimit = limiter(15, 15);
  r.use(limiter(15, 1500));

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /* ---------------- Public ---------------- */
  r.get('/public/lookups', h((ctx) => org.publicLookups(ctx)));
  r.get(
    '/public/info',
    h(async (ctx) => {
      const s = await settings.getSettings(ctx.db);
      return { orgName: s['org.name'], registrationOpen: s['registration.open'] };
    }),
  );
  r.get('/health', h(() => ({ status: 'ok' })));

  /* ---------------- Auth ---------------- */
  r.get('/auth/csrf', h(() => ({ ok: true })));
  r.post(
    '/auth/register',
    registerLimit,
    h(async (ctx, req, res) => {
      const result = await auth.register(ctx, req.body);
      setSession(res, result.session);
      return { ok: true, employeeId: result.employeeId };
    }),
  );
  r.post(
    '/auth/login',
    authLimit,
    h(async (ctx, req, res) => {
      const result = await auth.login(ctx, req.body);
      setSession(res, result.session);
      return { ok: true, mfaRequired: result.mfaRequired };
    }),
  );
  r.post(
    '/auth/mfa/verify',
    authLimit,
    h(async (ctx, req, res) => {
      const result = await auth.verifyMfaLogin(ctx, req.loaded, req.body);
      setSession(res, result.session);
      return { ok: true };
    }),
  );
  r.post(
    '/auth/logout',
    h(async (ctx, req, res) => {
      await auth.logout(ctx, req.loaded?.session.id);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    }),
  );
  r.get('/auth/me', h((ctx) => auth.me(ctx)));
  r.patch('/auth/profile', h((ctx, req) => auth.updateProfile(ctx, req.body)));
  r.get('/auth/sessions', h((ctx) => auth.listSessions(ctx)));
  r.post('/auth/sessions/revoke-others', h((ctx) => auth.revokeOtherSessions(ctx)));
  r.post('/auth/sessions/:id/revoke', h((ctx, req) => auth.revokeOwnSession(ctx, p(req, 'id'))));
  r.get('/auth/activity', h((ctx) => auth.ownSecurityActivity(ctx)));
  r.post('/auth/reauth', sensitiveLimit, h((ctx, req) => auth.reauthenticate(ctx, req.body)));
  r.post('/auth/password', sensitiveLimit, h((ctx, req) => auth.changePassword(ctx, req.body)));
  r.post('/auth/mfa/setup', sensitiveLimit, h((ctx) => auth.mfaSetup(ctx)));
  r.post('/auth/mfa/enable', sensitiveLimit, h((ctx, req) => auth.mfaEnable(ctx, req.body)));
  r.post('/auth/mfa/disable', sensitiveLimit, h((ctx) => auth.mfaDisable(ctx)));
  r.get('/auth/invitations/:token', authLimit, h((ctx, req) => auth.getInvitation(ctx, p(req, 'token'))));
  r.post(
    '/auth/invitations/:token/accept',
    registerLimit,
    h(async (ctx, req, res) => {
      const result = await auth.acceptInvitation(ctx, p(req, 'token'), req.body);
      setSession(res, result.session);
      return { ok: true };
    }),
  );

  /* ---------------- Core ---------------- */
  r.get('/dashboard', h((ctx) => reports.dashboard(ctx)));
  r.get('/lookups', h((ctx) => org.lookups(ctx)));

  /* ---------------- Employees ---------------- */
  r.get('/employees', h((ctx, req) => emp.listEmployees(ctx, req.query)));
  r.get('/employees/options', h((ctx, req) => emp.employeeOptions(ctx, req.query)));
  r.get('/employees/export.csv', csv('employees.csv', (ctx, req) => emp.exportEmployeesCsv(ctx, req.query)));
  r.post('/employees', h((ctx, req) => emp.createEmployee(ctx, req.body)));
  r.get('/employees/:id', h((ctx, req) => emp.getEmployee(ctx, p(req, 'id'))));
  r.patch('/employees/:id', h((ctx, req) => emp.updateEmployee(ctx, p(req, 'id'), req.body)));
  r.post('/employees/:id/verify', h((ctx, req) => emp.verifyRegistration(ctx, p(req, 'id'), req.body)));
  r.post('/employees/:id/corrections', h((ctx, req) => emp.requestCorrection(ctx, p(req, 'id'), req.body)));
  r.post('/employees/:id/archive', h((ctx, req) => emp.archiveEmployee(ctx, p(req, 'id'), req.body)));
  r.post('/employees/:id/restore', h((ctx, req) => emp.restoreEmployee(ctx, p(req, 'id'), req.body)));
  r.post('/employees/:id/invite', h((ctx, req) => emp.inviteEmployee(ctx, p(req, 'id'), req.body)));
  r.get('/employees/:id/history', h((ctx, req) => emp.getEmploymentHistory(ctx, p(req, 'id'))));
  r.get('/employees/:id/payroll', h((ctx, req) => payroll.employeePayroll(ctx, p(req, 'id'))));
  r.get('/employees/:id/retirement', h((ctx, req) => retirement.employeeRetirement(ctx, p(req, 'id'))));
  r.get('/employees/:id/approvals', h((ctx, req) => approvals.listApprovals(ctx, { status: 'all', targetId: p(req, 'id'), pageSize: 50 })));
  r.get(
    '/employees/:id/audit',
    h(async (ctx, req) => {
      requirePerm(ctx, 'audit.read');
      return auditLog.searchAudit(ctx, { targetType: 'employee', targetId: p(req, 'id'), pageSize: 100 });
    }),
  );
  r.get('/employees/:id/documents', h((ctx, req) => docs.listDocuments(ctx, 'employee', p(req, 'id'))));
  r.post('/employees/:id/documents', upload.single('file'), h((ctx, req) => docs.uploadDocument(ctx, 'employee', p(req, 'id'), req.file, req.body)));

  /* ---------------- Documents ---------------- */
  r.get('/documents/:id/download', async (req, res) => {
    const doc = await docs.downloadDocument(req.ctx, p(req, 'id'));
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Length', String(doc.sizeBytes));
    res.setHeader('Content-Disposition', `attachment; filename="${doc.filename.replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.send(doc.data);
  });
  r.delete('/documents/:id', h((ctx, req) => docs.archiveDocument(ctx, p(req, 'id'))));

  /* ---------------- Organisation ---------------- */
  r.get('/departments', h((ctx) => org.listDepartments(ctx)));
  r.post('/departments', h((ctx, req) => org.createDepartment(ctx, req.body)));
  r.put('/departments/:id', h((ctx, req) => org.updateDepartment(ctx, p(req, 'id'), req.body)));
  r.get('/locations', h((ctx) => org.listLocations(ctx)));
  r.post('/locations', h((ctx, req) => org.createLocation(ctx, req.body)));
  r.put('/locations/:id', h((ctx, req) => org.updateLocation(ctx, p(req, 'id'), req.body)));
  r.get('/job-titles', h((ctx) => org.listJobTitles(ctx)));
  r.post('/job-titles', h((ctx, req) => org.upsertJobTitle(ctx, null, req.body)));
  r.put('/job-titles/:id', h((ctx, req) => org.upsertJobTitle(ctx, p(req, 'id'), req.body)));
  r.get('/grades', h((ctx) => org.listGrades(ctx)));
  r.post('/grades', h((ctx, req) => org.upsertGrade(ctx, null, req.body)));
  r.put('/grades/:id', h((ctx, req) => org.upsertGrade(ctx, p(req, 'id'), req.body)));

  /* ---------------- Users & access ---------------- */
  r.get('/users', h((ctx, req) => users.listUsers(ctx, req.query)));
  r.get('/users/:id', h((ctx, req) => users.getUser(ctx, p(req, 'id'))));
  r.put('/users/:id/roles', sensitiveLimit, h((ctx, req) => users.setUserRoles(ctx, p(req, 'id'), req.body)));
  r.post('/users/:id/grants', sensitiveLimit, h((ctx, req) => users.addGrant(ctx, p(req, 'id'), req.body)));
  r.delete('/users/:id/grants/:perm', sensitiveLimit, h((ctx, req) => users.removeGrant(ctx, p(req, 'id'), p(req, 'perm'), req.body)));
  r.put('/users/:id/scopes', h((ctx, req) => users.setModeratorScopes(ctx, p(req, 'id'), req.body)));
  r.post('/users/:id/status', sensitiveLimit, h((ctx, req) => users.setUserStatus(ctx, p(req, 'id'), req.body)));
  r.post('/users/:id/recovery', sensitiveLimit, h((ctx, req) => users.recoverAccess(ctx, p(req, 'id'), req.body)));

  /* ---------------- Approvals ---------------- */
  r.get('/approvals', h((ctx, req) => approvals.listApprovals(ctx, req.query)));
  r.post('/approvals/:id/decide', h((ctx, req) => approvals.decideApproval(ctx, p(req, 'id'), req.body)));
  r.post('/approvals/:id/cancel', h((ctx, req) => approvals.cancelApproval(ctx, p(req, 'id'))));

  /* ---------------- Payroll ---------------- */
  r.get('/payroll/summary', h((ctx, req) => payroll.financeSummary(ctx, req.query)));
  r.get('/payroll/periods', h((ctx) => payroll.listPeriods(ctx)));
  r.post('/payroll/periods', h((ctx, req) => payroll.createPeriod(ctx, req.body)));
  r.post('/payroll/periods/:id/close', h((ctx, req) => payroll.closePeriod(ctx, p(req, 'id'), req.body)));
  r.get('/payroll/periods/:id/records', h((ctx, req) => payroll.listRecords(ctx, p(req, 'id'), req.query)));
  r.post('/payroll/periods/:id/generate-drafts', h((ctx, req) => payroll.generateDrafts(ctx, p(req, 'id'))));
  r.post('/payroll/periods/:id/payslips', h((ctx, req) => payroll.issuePayslipsForPeriod(ctx, p(req, 'id'))));
  r.get('/payroll/periods/:id/export.csv', csv('payroll.csv', (ctx, req) => payroll.exportPeriodCsv(ctx, p(req, 'id'))));
  r.get('/payroll/periods/:id/checklist', h((ctx, req) => accounts.periodChecklist(ctx, p(req, 'id'))));
  r.get('/payroll/periods/:id/remittances', h((ctx, req) => accounts.periodRemittances(ctx, p(req, 'id'))));
  r.get('/payroll/periods/:id/remittances.csv', csv('remittances.csv', (ctx, req) => accounts.periodRemittancesCsv(ctx, p(req, 'id'))));
  r.get('/payroll/periods/:id/allocation', h((ctx, req) => accounts.periodAllocation(ctx, p(req, 'id'))));
  r.get('/payroll/periods/:id/allocation.csv', csv('cost-allocation.csv', (ctx, req) => accounts.periodAllocationCsv(ctx, p(req, 'id'))));
  r.get('/payroll/periods/:id/journal', h((ctx, req) => accounts.periodJournal(ctx, p(req, 'id'))));
  r.get('/payroll/periods/:id/journal.csv', csv('salaries-journal.csv', (ctx, req) => accounts.periodJournalCsv(ctx, p(req, 'id'))));
  r.get('/payroll/periods/:id/variance', h((ctx, req) => accounts.periodVariance(ctx, p(req, 'id'), req.query)));
  r.get('/payroll/periods/:id/register.csv', csv('payroll-register.csv', (ctx, req) => accounts.periodRegisterCsv(ctx, p(req, 'id'))));
  r.post('/payroll/periods/:id/pay-run', h((ctx, req) => accounts.markPeriodPaid(ctx, p(req, 'id'), req.body)));
  r.post('/payroll/records', h((ctx, req) => payroll.createRecord(ctx, req.body)));
  r.get('/payroll/records/:id', h((ctx, req) => payroll.getRecord(ctx, p(req, 'id'))));
  r.put('/payroll/records/:id', h((ctx, req) => payroll.updateRecord(ctx, p(req, 'id'), req.body)));
  r.delete('/payroll/records/:id', h((ctx, req) => payroll.deleteDraft(ctx, p(req, 'id'))));
  r.post('/payroll/records/:id/submit', h((ctx, req) => payroll.submitRecord(ctx, p(req, 'id'))));
  r.post('/payroll/records/:id/approve', h((ctx, req) => payroll.approveRecord(ctx, p(req, 'id'), req.body)));
  r.post('/payroll/records/:id/reject', h((ctx, req) => payroll.rejectRecord(ctx, p(req, 'id'), req.body)));
  r.post('/payroll/records/:id/adjust', h((ctx, req) => payroll.adjustRecord(ctx, p(req, 'id'), req.body)));
  r.post('/payroll/records/:id/mark-paid', h((ctx, req) => payroll.markPaid(ctx, p(req, 'id'), req.body)));
  r.post('/payroll/records/:id/payslip', h((ctx, req) => payroll.issuePayslip(ctx, p(req, 'id'))));
  r.get('/payslips/:id', h((ctx, req) => payroll.getPayslip(ctx, p(req, 'id'))));
  r.get(
    '/me/payroll',
    h(async (ctx) => (ctx.actor?.employeeId ? payroll.employeePayroll(ctx, ctx.actor.employeeId) : [])),
  );

  /* ---------------- Retirement ---------------- */
  r.get('/retirement/reviews', h((ctx, req) => retirement.listReviews(ctx, req.query)));
  r.get('/retirement/reviews/:id', h((ctx, req) => retirement.getReview(ctx, p(req, 'id'))));
  r.post('/retirement/reviews/:id/settlements', h((ctx, req) => retirement.createSettlement(ctx, p(req, 'id'), req.body)));
  r.post('/retirement/reviews/:id/decision', h((ctx, req) => retirement.decideReview(ctx, p(req, 'id'), req.body)));
  r.post('/retirement/reviews/:id/complete', h((ctx, req) => retirement.completeRetirement(ctx, p(req, 'id'), req.body)));
  r.put('/retirement/settlements/:id', h((ctx, req) => retirement.updateSettlement(ctx, p(req, 'id'), req.body)));
  r.post('/retirement/settlements/:id/submit', h((ctx, req) => retirement.submitSettlement(ctx, p(req, 'id'))));
  r.post('/retirement/settlements/:id/verify', h((ctx, req) => retirement.verifySettlement(ctx, p(req, 'id'), req.body)));
  r.get('/retirement/policies', h((ctx) => retirement.listPolicies(ctx)));
  r.post('/retirement/policies', h((ctx, req) => retirement.createPolicy(ctx, req.body)));
  r.put('/retirement/policies/:id', h((ctx, req) => retirement.updatePolicy(ctx, p(req, 'id'), req.body)));
  r.post('/retirement/policies/:id/adopt', sensitiveLimit, h((ctx, req) => retirement.adoptPolicy(ctx, p(req, 'id'), req.body)));
  r.post('/retirement/policies/:id/end', sensitiveLimit, h((ctx, req) => retirement.endPolicy(ctx, p(req, 'id'), req.body)));
  r.get('/retirement/export.csv', csv('retirement.csv', (ctx) => retirement.exportRetirementCsv(ctx)));

  /* ---------------- Communications ---------------- */
  r.get('/announcements', h((ctx, req) => comms.listAnnouncements(ctx, req.query)));
  r.post('/announcements', h((ctx, req) => comms.createAnnouncement(ctx, req.body)));
  r.get('/announcements/:id', h((ctx, req) => comms.getAnnouncement(ctx, p(req, 'id'))));
  r.put('/announcements/:id', h((ctx, req) => comms.updateAnnouncement(ctx, p(req, 'id'), req.body)));
  r.post('/announcements/:id/status', h((ctx, req) => comms.setAnnouncementStatus(ctx, p(req, 'id'), req.body)));
  r.get('/announcements/:id/documents', h((ctx, req) => docs.listDocuments(ctx, 'announcement', p(req, 'id'))));
  r.post('/announcements/:id/documents', upload.single('file'), h((ctx, req) => docs.uploadDocument(ctx, 'announcement', p(req, 'id'), req.file, { category: 'attachment' })));
  r.get('/events', h((ctx, req) => comms.listEvents(ctx, req.query)));
  r.post('/events', h((ctx, req) => comms.createEvent(ctx, req.body)));
  r.get('/events/:id', h((ctx, req) => comms.getEvent(ctx, p(req, 'id'))));
  r.put('/events/:id', h((ctx, req) => comms.updateEvent(ctx, p(req, 'id'), req.body)));
  r.post('/events/:id/status', h((ctx, req) => comms.setEventStatus(ctx, p(req, 'id'), req.body)));
  r.get('/comments/:type/:id', h((ctx, req) => comms.listComments(ctx, p(req, 'type'), p(req, 'id'))));
  r.post('/comments/:type/:id', h((ctx, req) => comms.createComment(ctx, p(req, 'type'), p(req, 'id'), req.body)));
  r.patch('/comments/:id', h((ctx, req) => comms.moderateComment(ctx, p(req, 'id'), req.body)));

  /* ---------------- Notifications ---------------- */
  r.get('/notifications', h((ctx, req) => notifications.listNotifications(ctx, req.query)));
  r.post('/notifications/read', h((ctx, req) => notifications.markRead(ctx, req.body)));

  /* ---------------- Governance ---------------- */
  r.get('/audit', h((ctx, req) => auditLog.searchAudit(ctx, req.query)));
  r.get('/audit/export.csv', csv('audit-log.csv', (ctx, req) => auditLog.exportAuditCsv(ctx, req.query)));
  r.get('/reports', h((ctx) => reports.availableReports(ctx)));
  r.get(
    '/reports/:name',
    async (req, res) => {
      const result = await reports.getReport(req.ctx, p(req, 'name'), req.query);
      if ('csv' in result) {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${p(req, 'name').replace(/[^a-z]/g, '')}-report.csv"`);
        res.send(result.csv);
      } else res.json(result);
    },
  );
  r.get(
    '/settings',
    h(async (ctx) => {
      requirePerm(ctx, 'settings.manage');
      return settings.getSettings(ctx.db);
    }),
  );
  r.put('/settings', sensitiveLimit, h((ctx, req) => settings.updateSettings(ctx, req.body)));
  r.post(
    '/jobs/run',
    h(async (ctx) => {
      requirePerm(ctx, 'settings.manage');
      return runScheduledJobs(ctx.db, ctx.now(), { force: true });
    }),
  );

  return r;
}
