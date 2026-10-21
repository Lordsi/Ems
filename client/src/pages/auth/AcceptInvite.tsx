import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Alert, Button, Field, Input, PageLoader } from '../../components/ui';
import { AuthShell } from './AuthShell';

export function AcceptInvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const invite = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ email: string; legalName: string }>(`/auth/invitations/${encodeURIComponent(token)}`), retry: false });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (invite.isLoading) return <PageLoader />;
  if (invite.isError) {
    return (
      <AuthShell title="Invitation unavailable">
        <Alert tone="error">{errorMessage(invite.error)}</Alert>
        <p className="mt-4 text-sm text-slate-600">Ask your administrator to send a new invitation.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-medium text-brand-700">
          Go to sign in
        </Link>
      </AuthShell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await api.post(`/auth/invitations/${encodeURIComponent(token)}/accept`, { password });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={`Welcome, ${invite.data!.legalName}`}
      subtitle={`Choose a password for ${invite.data!.email}. You will use this email address to sign in.`}
    >
      <form onSubmit={submit} className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        <input type="email" name="username" autoComplete="username" value={invite.data!.email} readOnly hidden />
        <Field label="Password" required error={errors.password} hint="At least 12 characters, with upper and lower case letters and a number.">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <Field label="Confirm password" required error={errors.confirm}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
