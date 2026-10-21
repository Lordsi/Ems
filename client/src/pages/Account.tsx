import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Monitor, ShieldCheck, ShieldOff } from 'lucide-react';
import { ROLE_META } from '../../../shared/permissions';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useApi } from '../lib/hooks';
import { date, dateTime, label, relative } from '../lib/format';
import { MfaEnrollment } from './auth/Gates';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DescriptionList, Field, Input, Modal, PageHeader, Select } from '../components/ui';

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ny', name: 'Chichewa' },
  { code: 'tum', name: 'Chitumbuka' },
] as const;

function PasswordCard() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [mismatch, setMismatch] = useState(false);
  const change = useAction((body: { currentPassword: string; newPassword: string }) => api.post('/auth/password', body), {
    success: 'Password changed. Your other sessions have been signed out.',
    invalidate: ['/auth/sessions', '/auth/activity'],
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
  const qc = useQueryClient();
  const [enrolling, setEnrolling] = useState(false);
  const disable = useAction(() => api.post('/auth/mfa/disable'), { success: 'Two-factor authentication disabled', invalidate: ['/auth/activity'] });
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
              void qc.invalidateQueries({ queryKey: ['/auth/activity'] });
            }}
          />
        </Modal>
      )}
    </Card>
  );
}

function ProfileCard() {
  const { me } = useAuth();
  const u = me!.user;
  const [f, setF] = useState({
    displayName: u.displayName,
    phone: u.phone ?? '',
    preferredLanguage: u.preferredLanguage,
    notifyAnnouncements: u.notifyAnnouncements,
    notifyEvents: u.notifyEvents,
  });
  useEffect(() => {
    setF({
      displayName: u.displayName,
      phone: u.phone ?? '',
      preferredLanguage: u.preferredLanguage,
      notifyAnnouncements: u.notifyAnnouncements,
      notifyEvents: u.notifyEvents,
    });
  }, [u.displayName, u.phone, u.preferredLanguage, u.notifyAnnouncements, u.notifyEvents]);
  const save = useAction(() => api.patch('/auth/profile', { ...f, phone: f.phone.trim() }), {
    success: 'Profile saved',
    invalidate: ['/auth/activity'],
  });
  const dirty =
    f.displayName.trim() !== u.displayName ||
    f.phone.trim() !== (u.phone ?? '') ||
    f.preferredLanguage !== u.preferredLanguage ||
    f.notifyAnnouncements !== u.notifyAnnouncements ||
    f.notifyEvents !== u.notifyEvents;
  return (
    <Card>
      <CardHeader title="Profile" description="Your display name, contact number and the language used for notices. The screens stay in English." />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) save.mutate(undefined);
        }}
      >
        <Field label="Display name" required error={save.fieldErrors.displayName}>
          {(id) => <Input id={id} value={f.displayName} maxLength={120} onChange={(e) => setF({ ...f, displayName: e.target.value })} required />}
        </Field>
        <Field label="Account phone" hint="A number where the diocese can reach you. Your employee record keeps its own phone." error={save.fieldErrors.phone}>
          {(id) => <Input id={id} value={f.phone} inputMode="tel" autoComplete="tel" maxLength={40} placeholder="+265 991 234 567" onChange={(e) => setF({ ...f, phone: e.target.value })} />}
        </Field>
        <Field label="Preferred language" error={save.fieldErrors.preferredLanguage}>
          {(id) => (
            <Select id={id} value={f.preferredLanguage} onChange={(e) => setF({ ...f, preferredLanguage: e.target.value as typeof f.preferredLanguage })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-800">Notifications</p>
          <Checkbox checked={f.notifyAnnouncements} onChange={(v) => setF({ ...f, notifyAnnouncements: v })} label="Announcements" description="New notices published to you." />
          <Checkbox checked={f.notifyEvents} onChange={(v) => setF({ ...f, notifyEvents: v })} label="Events and reminders" description="Published events, changes, cancellations and reminders." />
          <p className="text-xs text-slate-500">Payslips, approvals, employment changes and security alerts are always delivered.</p>
        </div>
        <Button type="submit" loading={save.isPending} disabled={!dirty || !f.displayName.trim()}>
          Save profile
        </Button>
      </form>
    </Card>
  );
}

interface SessionRow {
  id: string;
  current: boolean;
  device: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
}

function SessionsCard() {
  const q = useApi<{ items: SessionRow[] }>('/auth/sessions');
  const revoke = useAction((id: string) => api.post(`/auth/sessions/${id}/revoke`), { invalidate: ['/auth/sessions', '/auth/activity'], success: 'Session signed out' });
  const revokeOthers = useAction(() => api.post('/auth/sessions/revoke-others'), { invalidate: ['/auth/sessions', '/auth/activity'], success: 'Other sessions signed out' });
  const items = q.data?.items ?? [];
  const others = items.some((s) => !s.current);
  return (
    <Card>
      <CardHeader
        title="Signed-in sessions"
        description="Browsers that are currently signed in to your account."
        actions={
          others ? (
            <Button size="sm" variant="secondary" onClick={() => revokeOthers.mutate(undefined)} loading={revokeOthers.isPending}>
              Sign out others
            </Button>
          ) : undefined
        }
      />
      {q.error && <Alert tone="error">{q.error.message}</Alert>}
      <ul className="divide-y divide-slate-100">
        {items.map((s) => (
          <li key={s.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <Monitor className="mt-0.5 size-5 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                <span title={s.userAgent ?? undefined}>{s.device}</span>
                {s.current && <Badge tone="green">This device</Badge>}
              </p>
              <p className="text-xs text-slate-500">
                {s.ip ?? 'Unknown address'} · last active {relative(s.lastSeenAt) || dateTime(s.lastSeenAt)} · started {dateTime(s.createdAt)}
              </p>
            </div>
            {!s.current && (
              <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)} loading={revoke.isPending && revoke.variables === s.id}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!q.isLoading && items.length === 0 && <p className="text-sm text-slate-500">No active sessions.</p>}
    </Card>
  );
}

interface ActivityRow {
  id: number;
  occurredAt: string;
  action: string;
  outcome: string;
  ip: string | null;
}

function ActivityCard() {
  const q = useApi<{ items: ActivityRow[] }>('/auth/activity');
  const items = q.data?.items ?? [];
  return (
    <Card>
      <CardHeader title="Security activity" description="Recent sign-in and security events on your account." />
      {q.error && <Alert tone="error">{q.error.message}</Alert>}
      {items.length === 0 && !q.isLoading ? (
        <p className="text-sm text-slate-500">No security activity recorded yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
              <span>
                <span className="font-medium text-slate-900">{label(item.action)}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {dateTime(item.occurredAt)}
                  {item.ip ? ` · ${item.ip}` : ''}
                </span>
              </span>
              <Badge tone={item.outcome === 'success' ? 'green' : 'red'}>{label(item.outcome)}</Badge>
            </li>
          ))}
        </ul>
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
      <PageHeader title="Account & security" description="Your profile, notification choices and sign-in security." />
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfileCard />
        <Card>
          <CardHeader title="Your account" />
          <DescriptionList
            columns={1}
            items={[
              { label: 'Username', value: `@${u.username}` },
              { label: 'Email', value: u.email },
              { label: 'Preferred language', value: label(u.preferredLanguage) },
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
              { label: 'Account opened', value: date(u.createdAt) },
              { label: 'Last sign-in', value: dateTime(u.lastLoginAt) },
              { label: 'Password changed', value: u.passwordChangedAt ? dateTime(u.passwordChangedAt) : 'Not since the account was created' },
            ]}
          />
          <p className="mt-4 text-xs text-slate-500">Email, username and roles are changed by a Super Admin. Employment details are edited on your employee profile.</p>
        </Card>
        <SessionsCard />
        <ActivityCard />
        <MfaCard />
        <PasswordCard />
      </div>
    </div>
  );
}
