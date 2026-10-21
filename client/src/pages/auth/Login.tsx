import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Alert, Button, Field, Input } from '../../components/ui';
import { AuthShell, usePublicInfo } from './AuthShell';

/** Only same-origin relative paths are accepted as post-login redirects. */
function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  const { me, refresh } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const info = usePublicInfo();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get('next'));

  const mfaStep = me?.user.status === 'mfa_pending';
  if (me && !mfaStep) return <Navigate to={next} replace />;

  const finish = async () => {
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'public-info' });
    await refresh();
    navigate(next, { replace: true });
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ mfaRequired: boolean }>('/auth/login', { identifier, password });
      setPassword('');
      if (r.mfaRequired) await refresh();
      else await finish();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/mfa/verify', { code });
      await finish();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelMfa = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    await refresh();
  };

  if (mfaStep) {
    return (
      <AuthShell title="Two-factor verification" subtitle="Enter the 6-digit code from your authenticator app.">
        <form onSubmit={submitCode} className="space-y-5">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Authentication code" required>
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                className="text-center font-mono text-lg tracking-[0.5em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
            )}
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={code.length !== 6}>
            Verify and sign in
          </Button>
          <button type="button" onClick={cancelMfa} className="w-full text-center text-sm text-slate-500 hover:text-slate-800">
            Use a different account
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in" subtitle="Use your username or work email address.">
      <form onSubmit={submitPassword} className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Username or email" required>
          {(id) => <Input id={id} autoComplete="username" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />}
        </Field>
        <Field label="Password" required>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      <div className="mt-8 space-y-2 border-t border-slate-200 pt-6 text-sm text-slate-600">
        {info.data?.registrationOpen && (
          <p>
            New employee?{' '}
            <Link to="/register" className="font-medium text-brand-700 hover:text-brand-800">
              Register your employment profile
            </Link>
          </p>
        )}
        <p className="text-slate-500">Forgotten your password? Contact your system administrator to recover access.</p>
      </div>
    </AuthShell>
  );
}
