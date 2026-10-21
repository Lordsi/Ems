/**
 * Post-deploy smoke check. Read-only apart from an optional sign-in.
 *
 *   npm run smoke -- --url https://ems.example.org
 *   SMOKE_USERNAME=... SMOKE_PASSWORD=... npm run smoke -- --url http://localhost:3000
 *
 * Verifies the API is up, the SPA is served, security headers are present, CSRF and
 * authentication are enforced, and (when credentials are supplied) that sign-in works.
 */
const i = process.argv.indexOf('--url');
const base = (i >= 0 ? process.argv[i + 1] : process.env.SMOKE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

const cookies = new Map<string, string>();
function remember(res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const [k, ...v] = pair.split('=');
    cookies.set(k.trim(), v.join('='));
  }
}
const cookieHeader = () => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

async function call(method: string, path: string, body?: unknown, csrf = true) {
  const headers: Record<string, string> = { cookie: cookieHeader() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrf && cookies.get('ems_csrf')) headers['x-csrf-token'] = cookies.get('ems_csrf')!;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  remember(res);
  return res;
}

const health = await call('GET', '/api/health');
check('API health', health.status === 200, `HTTP ${health.status}`);

const index = await call('GET', '/');
const html = await index.text();
check('SPA index served', index.status === 200 && html.includes('id="root"'), `HTTP ${index.status}`);
check('Content-Security-Policy header', !!index.headers.get('content-security-policy'));
check('X-Content-Type-Options header', index.headers.get('x-content-type-options') === 'nosniff');

const info = await call('GET', '/api/public/info');
check('Public info', info.status === 200, `HTTP ${info.status}`);

const me = await call('GET', '/api/auth/me');
check('Unauthenticated /auth/me is rejected', me.status === 401, `HTTP ${me.status}`);

const noCsrf = await call('POST', '/api/auth/login', { identifier: 'x', password: 'y' }, false);
check('POST without CSRF token is rejected', noCsrf.status === 403, `HTTP ${noCsrf.status}`);

const protectedRes = await call('GET', '/api/employees');
check('Protected API requires sign-in', protectedRes.status === 401, `HTTP ${protectedRes.status}`);

const user = process.env.SMOKE_USERNAME;
const pass = process.env.SMOKE_PASSWORD;
if (user && pass) {
  await call('GET', '/api/auth/csrf');
  const login = await call('POST', '/api/auth/login', { identifier: user, password: pass });
  const body = (await login.json().catch(() => ({}))) as { status?: string };
  check('Sign-in', login.status === 200, `HTTP ${login.status}${body.status ? `, ${body.status}` : ''}`);
  if (login.status === 200) {
    const me2 = await call('GET', '/api/auth/me');
    check('Session works', me2.status === 200, `HTTP ${me2.status}`);
    const out = await call('POST', '/api/auth/logout', {});
    check('Sign-out', out.status === 200, `HTTP ${out.status}`);
  }
} else {
  console.log('SKIP  Sign-in (set SMOKE_USERNAME and SMOKE_PASSWORD to include it)');
}

console.log(failures ? `\n${failures} check(s) failed against ${base}` : `\nAll checks passed against ${base}`);
process.exit(failures ? 1 : 0);

export {};
