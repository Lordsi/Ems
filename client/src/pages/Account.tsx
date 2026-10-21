import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { ROLE_META } from '../../../shared/permissions';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction } from '../lib/hooks';
import { MfaEnrollment } from './auth/Gates';
import { Alert, Badge, Button, Card, CardHeader, DescriptionList, Field, Input, Modal, PageHeader } from '../components/ui';

function PasswordCard() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const change = useAction((body: { currentPassword: string; newPassword: string }) => api.post('/auth/password', body), {
    success: 'Password changed. Your other sessions have been signed out.',
    onSuccess: () => setF({ currentPassword: '', newPassword: '', confirm: '' }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMismatch(f.newPassword !== f.confirm);
    if (f.newPassword !== f.confirm) return;
    change.mutate({ currentPassword: f.currentPassword, newPassword: f.newPassword });
  };
  return (
    <Card>
      <CardHeader title="Change password" description="Changing your password signs out all of your other sessions." />
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password" required error={change.fieldErrors.currentPassword}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} required />}
        </Field>
        <Field label="New password" required hint="At least 12 characters, with upper and lower case letters and a number." error={change.fieldErrors.newPassword}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} required />}
        </Field>
        <Field label="Confirm new password" required error={mismatch ? 'Passwords do not match' : undefined}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />}
        </Field>
        <Button type="submit" loading={change.isPending}>
          Update password
        </Button>
      </form>
    </Card>
  );
}

function MfaCard() {
  const { me, refresh } = useAuth();
  const [enrolling, setEnrolling] = useState(false);
  const disable = useAction(() => api.post('/auth/mfa/disable'), { success: 'Two-factor authentication disabled' });
  const enabled = !!me?.user.mfaEnabled;
  const privileged = me?.user.roles.some((r) => r !== 'employee');
  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        description="Protect your account with a time-based code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, etc.)."
      />
      {enabled ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <ShieldCheck className="size-5" /> Enabled
          </p>
          <Button variant="secondary" onClick={() => confirm('Disable two-factor authentication? You will be asked for your password.') && disable.mutate(undefined)} loading={disable.isPending}>
            Disable
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <ShieldOff className="size-5 text-slate-400" /> Not enabled
          </p>
          {privileged && <Alert tone="warning">Your account has privileged access. Two-factor authentication is strongly recommended.</Alert>}
          <Button onClick={() => setEnrolling(true)}>Set up two-factor authentication</Button>
        </div>
      )}
      {enrolling && (
        <Modal open onClose={() => setEnrolling(false)} title="Set up two-factor authentication">
          <MfaEnrollment
            onDone={() => {
              setEnrolling(false);
              void refresh();
            }}
          />
        </Modal>
      )}
    </Card>
  );
}

export function AccountPage() {
  const { me } = useAuth();
  if (!me) return null;
  const u = me.user;
  return (
    <div className="space-y-6">
      <PageHeader title="Account & security" description="Your sign-in details and security settings." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Your account" />
          <DescriptionList
            columns={1}
            items={[
              { label: 'Display name', value: u.displayName },
              { label: 'Username', value: `@${u.username}` },
              { label: 'Email', value: u.email },
              {
                label: 'Roles',
                value: (
                  <span className="flex flex-wrap gap-1">
                    {u.roles.map((r) => (
                      <Badge key={r} tone={r === 'super_admin' ? 'violet' : r === 'employee' ? 'gray' : 'blue'}>
                        {ROLE_META[r]?.name ?? r}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              {
                label: 'Employee record',
                value: me.employee ? (
                  <Link to="/profile" className="text-brand-700 hover:underline">
                    {me.employee.legalName} {me.employee.employmentNumber && <span className="font-mono text-xs">({me.employee.employmentNumber})</span>}
                  </Link>
                ) : (
                  'Not linked'
                ),
              },
            ]}
          />
          <p className="mt-4 text-xs text-slate-500">To change your name or contact details, edit your profile or contact HR. Role changes can only be made by a Super Admin.</p>
        </Card>
        <MfaCard />
        <PasswordCard />
      </div>
    </div>
  );
}
