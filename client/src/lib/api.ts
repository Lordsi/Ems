export interface ApiErrorDetails {
  fields?: Record<string, string>;
  [k: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: ApiErrorDetails,
    public requestId?: string,
  ) {
    super(message);
  }
  get fields(): Record<string, string> {
    return this.details?.fields ?? {};
  }
}

function csrfToken(): string {
  const match = document.cookie.split('; ').find((c) => c.startsWith('ems_csrf='));
  return match ? decodeURIComponent(match.slice('ems_csrf='.length)) : '';
}

type ReauthHandler = () => Promise<boolean>;
let reauthHandler: ReauthHandler | null = null;
/** The re-authentication dialog registers itself here; sensitive requests are retried after confirmation. */
export function setReauthHandler(fn: ReauthHandler | null) {
  reauthHandler = fn;
}

const AUTH_STATE_CODES = new Set(['UNAUTHENTICATED', 'PASSWORD_CHANGE_REQUIRED', 'MFA_SETUP_REQUIRED', 'ACCOUNT_NOT_ACTIVE']);

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const unsafe = method !== 'GET';
  if (unsafe && !csrfToken()) await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (unsafe) headers['X-CSRF-Token'] = csrfToken();
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Unable to reach the server. Check your connection and try again.');
  }
  if (res.ok) {
    const type = res.headers.get('content-type') ?? '';
    return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
  }
  let err: { code: string; message: string; details?: ApiErrorDetails; requestId?: string } = {
    code: `HTTP_${res.status}`,
    message: res.status === 429 ? 'Too many requests. Please wait and try again.' : 'The request failed.',
  };
  try {
    const parsed = await res.json();
    if (parsed?.error) err = parsed.error;
  } catch {
    /* non-JSON error body */
  }
  if (err.code === 'REAUTH_REQUIRED' && retry && reauthHandler) {
    if (await reauthHandler()) return request<T>(method, path, body, false);
  }
  if (err.code === 'CSRF_FAILED' && retry) {
    await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    return request<T>(method, path, body, false);
  }
  if (AUTH_STATE_CODES.has(err.code) && !path.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent('ems:auth-changed'));
  }
  throw new ApiError(res.status, err.code, err.message, err.details, err.requestId);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown = {}) => request<T>('PATCH', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form),
};

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Downloads a file from an authenticated GET endpoint (CSV exports, documents). */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) {
    let message = 'Download failed';
    try {
      message = (await res.json()).error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, 'DOWNLOAD_FAILED', message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}
