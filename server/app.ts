import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import type { Db } from './db/client';
import type { Ctx } from './context';
import { config } from './config';
import { AppError } from './lib/errors';
import { CSRF_COOKIE, SESSION_COOKIE, loadActor, loadSession, type LoadedSession } from './auth/sessions';
import { audit } from './services/audit';
import { getSetting } from './services/settings';
import { buildRouter } from './routes';
import { PRIVILEGED_ROLES } from '../shared/permissions';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: Ctx;
      loaded: LoadedSession | null;
    }
  }
}

export interface AppOptions {
  db: Db;
  now?: () => Date;
  /** Disable rate limiting (tests only). */
  disableRateLimit?: boolean;
  serveClient?: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Endpoints reachable while a password change or MFA enrolment is outstanding. */
const RESTRICTED_ALLOW = [/^\/api\/auth\//, /^\/api\/public\//];

export function createApp(opts: AppOptions) {
  const app = express();
  const now = opts.now ?? (() => new Date());
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Request correlation id.
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && /^[a-zA-Z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    req.ctx = { db: opts.db, actor: null, meta: { requestId, ip: req.ip, userAgent: req.get('user-agent') }, now };
    req.loaded = null;
    next();
  });

  // CORS: same-origin by default; explicit allow-list only.
  app.use('/api', (req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });

  app.use('/api', express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // CSRF: double-submit cookie. Every state-changing API request must echo the cookie in a header.
  app.use('/api', (req, res, next) => {
    let token = req.cookies?.[CSRF_COOKIE] as string | undefined;
    if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
      token = crypto.randomBytes(24).toString('base64url');
      res.cookie(CSRF_COOKIE, token, { httpOnly: false, sameSite: 'lax', secure: config.isProd, path: '/' });
      req.cookies[CSRF_COOKIE] = token;
      if (!SAFE_METHODS.has(req.method)) {
        next(new AppError(403, 'CSRF_FAILED', 'Security token missing. Please reload the page and try again.'));
        return;
      }
    }
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.get('x-csrf-token') ?? '';
      const a = Buffer.from(header);
      const b = Buffer.from(token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        next(new AppError(403, 'CSRF_FAILED', 'Security token mismatch. Please reload the page and try again.'));
        return;
      }
    }
    next();
  });

  // Authentication: resolve session and build the actor fresh from the database.
  app.use('/api', async (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      const loaded = await loadSession(opts.db, token, now());
      if (loaded) {
        req.loaded = loaded;
        req.ctx.actor = await loadActor(opts.db, loaded);
      }
    }
    const actor = req.ctx.actor;
    if (actor && actor.status === 'active' && !RESTRICTED_ALLOW.some((r) => r.test(req.originalUrl))) {
      if (actor.mustChangePassword) {
        next(new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'You must change your password before continuing'));
        return;
      }
      if (actor.roles.some((r) => PRIVILEGED_ROLES.includes(r)) && !actor.mfaEnabled && (await getSetting(opts.db, 'security.require_mfa_for_privileged'))) {
        next(new AppError(403, 'MFA_SETUP_REQUIRED', 'Two-factor authentication is required for your role. Set it up on your account page.'));
        return;
      }
    }
    next();
  });

  app.use('/api', buildRouter({ disableRateLimit: !!opts.disableRateLimit }));

  app.use('/api', (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Endpoint not found')));

  if (opts.serveClient) {
    const clientDir = path.resolve('dist/client');
    if (fs.existsSync(clientDir)) {
      app.use(express.static(clientDir, { index: false, maxAge: '1h', setHeaders: (res, file) => {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } }));
      app.get('/{*splat}', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(clientDir, 'index.html'));
      });
    }
  }

  // Central error handler: never leaks stack traces, SQL or internal identifiers.
  app.use(async (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const ctx = req.ctx;
    let status = 500;
    let body: Record<string, unknown> = { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', requestId: ctx?.meta.requestId } };
    const pgCode = (err as { code?: string; cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code;
    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, details: err.details, requestId: ctx?.meta.requestId } };
      const denied = (err as AppError & { auditDenied?: string }).auditDenied;
      if (denied && ctx) {
        await audit(ctx.db, ctx, {
          action: 'authz.denied',
          outcome: 'denied',
          targetType: 'endpoint',
          targetId: null,
          newValues: { method: req.method, path: req.originalUrl.split('?')[0].slice(0, 200), required: denied },
        }).catch(() => undefined);
      }
    } else if ((err as { type?: string })?.type === 'entity.parse.failed') {
      status = 400;
      body = { error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } };
    } else if ((err as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
      status = 400;
      body = { error: { code: 'BAD_REQUEST', message: 'File is too large' } };
    } else if (pgCode === '23505') {
      status = 409;
      body = { error: { code: 'CONFLICT', message: 'This conflicts with an existing record', requestId: ctx?.meta.requestId } };
    } else if (pgCode === '42501') {
      status = 409;
      body = { error: { code: 'IMMUTABLE', message: 'This record is locked and cannot be changed', requestId: ctx?.meta.requestId } };
    } else if (pgCode === '23503' || pgCode === '23514') {
      status = 400;
      body = { error: { code: 'BAD_REQUEST', message: 'The submitted data is not valid', requestId: ctx?.meta.requestId } };
    }
    if (status >= 500 && !config.isTest) {
      console.error(`[${ctx?.meta.requestId}]`, err);
    }
    res.status(status).json(body);
  });

  return app;
}
