import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth, useMe } from '../../lib/auth';
import { Alert, Button, Field, Input } from '../../components/ui';

function GateShell({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    navigate('/login');
  };
  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-12 sm:items-center">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
        <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">{icon}</div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <div className="mt-3 text-sm text-slate-600">{children}</div>
        <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4 text-sm text-slate-500">
          <span className="truncate">Signed in as {me?.user.username}</span>
          <button type="button" onClick={logout} className="font-medium text-brand-700 hover:text-brand-800">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export function PendingVerification() {
  const me = useMe();
  return (
    <GateShell icon={<Clock className="size-6" />} title="Registration received">
      <p>
        Thank you{me.employee ? `, ${me.employee.preferredName ?? me.employee.legalName}` : ''}. Your profile for{' '}
        <strong>{me.employee?.departmentName ?? 'your department'}</strong> is awaiting verification by HR.
      </p>
      <p className="mt-3">
        Once your identity and employment details are confirmed, your account will be activated and you will receive your employment number. You can sign in again later to check
        your status.
      </p>
    </GateShell>
  );
}

export function AccountBlocked() {
  return (
    <GateShell icon={<ShieldAlert className="size-6" />} title="Account not active">
      <p>This account is not currently active. Please contact your system administrator.</p>
    </GateShell>
  );
}

export function ForcePasswordChange() {
  const { refresh } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirm) return setErrors({ confirm: 'Passwords do not match' });
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api.post('/auth/password', { currentPassword, newPassword });
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <GateShell icon={<KeyRound className="size-6" />} title="Set a new password">
      <p className="mb-5">For your security you must choose a new password before continuing.</p>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Current (temporary) password" required error={errors.currentPassword}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />}
        </Field>
        <Field label="New password" required error={errors.newPassword} hint="At least 12 characters, with upper and lower case letters and a number.">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} required />}
        </Field>
        <Field label="Confirm new password" required error={errors.confirm}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Update password
        </Button>
      </form>
    </GateShell>
  );
}

export function MfaEnrollment({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await api.post<{ qrDataUrl: string; secret: string }>('/auth/mfa/setup'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/mfa/enable', { code });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (!setup) {
    return (
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p>You will need an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
        <Button onClick={start} loading={busy} icon={<ShieldCheck className="size-4" />}>
          Begin setup
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={confirm} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <p>1. Scan this QR code with your authenticator app.</p>
      <img src={setup.qrDataUrl} alt="Authenticator QR code" className="mx-auto size-48 rounded ring-1 ring-slate-200" />
      <p className="text-xs text-slate-500">
        Can&apos;t scan? Enter this key manually: <code className="break-all rounded bg-slate-100 px-1 py-0.5 font-mono text-slate-800">{setup.secret}</code>
      </p>
      <Field label="2. Enter the 6-digit code shown in the app" required>
        {(id) => (
          <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        )}
      </Field>
      <Button type="submit" loading={busy} disabled={code.length !== 6}>
        Enable two-factor authentication
      </Button>
    </form>
  );
}

export function ForceMfaSetup() {
  const { refresh } = useAuth();
  return (
    <GateShell icon={<ShieldCheck className="size-6" />} title="Set up two-factor authentication">
      <p className="mb-4">Your role has access to sensitive information, so your organisation requires two-factor authentication.</p>
      <MfaEnrollment onDone={() => void refresh()} />
    </GateShell>
  );
}
