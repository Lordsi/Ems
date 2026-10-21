import { useEffect, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { Alert, Button, Card, CardHeader, Checkbox, ErrorState, Field, Input, PageHeader, PageLoader, Textarea } from '../components/ui';

interface SettingsValues {
  'org.name': string;
  'org.address': string;
  'org.phone': string;
  'org.email': string;
  'org.currency': string;
  'registration.open': boolean;
  'payroll.require_second_approval': boolean;
  'security.require_mfa_for_privileged': boolean;
  'notifications.contract_expiry_days': number;
  'notifications.event_reminder_hours': number;
}

type JobResult = { jobName: string; skipped: boolean; details?: unknown };

export function SettingsPage() {
  const q = useApi<SettingsValues>('/settings');
  const [values, setValues] = useState<SettingsValues | null>(null);
  const [reason, setReason] = useState('');
  const [jobs, setJobs] = useState<JobResult[] | null>(null);
  useEffect(() => {
    if (q.data) setValues(q.data);
  }, [q.data]);

  const save = useAction(
    (changes: Partial<SettingsValues>) => api.put<SettingsValues>('/settings', { values: changes, reason: reason || undefined }),
    { invalidate: ['/settings', '/public'], success: 'Settings saved', onSuccess: () => setReason('') },
  );
  const run = useAction(() => api.post<JobResult[]>('/jobs/run'), { invalidate: ['/notifications', '/retirement', '/dashboard'], success: 'Scheduled jobs ran', onSuccess: setJobs });

  if (q.isLoading || !values) return q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <PageLoader />;
  const original = q.data!;
  const changes = Object.fromEntries(Object.entries(values).filter(([k, v]) => original[k as keyof SettingsValues] !== v)) as Partial<SettingsValues>;
  const dirty = Object.keys(changes).length > 0;
  const set = <K extends keyof SettingsValues>(k: K, v: SettingsValues[K]) => setValues((s) => (s ? { ...s, [k]: v } : s));
  const e = save.fieldErrors;
  const err = (k: string) => e[`values.${k}`] ?? e[k];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Organisation details and security controls. Changes are audited; weakening a control requires password re-confirmation."
        actions={
          <Button onClick={() => save.mutate(changes)} loading={save.isPending} disabled={!dirty}>
            Save changes
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Organisation" description="Shown on payslips, the sign-in page and exports." />
          <div className="space-y-4">
            <Field label="Organisation name" required error={err('org.name')}>
              {(id) => <Input id={id} value={values['org.name']} onChange={(ev) => set('org.name', ev.target.value)} />}
            </Field>
            <Field label="Address" error={err('org.address')}>
              {(id) => <Textarea id={id} rows={2} value={values['org.address']} onChange={(ev) => set('org.address', ev.target.value)} />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Phone" error={err('org.phone')}>
                {(id) => <Input id={id} value={values['org.phone']} onChange={(ev) => set('org.phone', ev.target.value)} />}
              </Field>
              <Field label="Email" error={err('org.email')}>
                {(id) => <Input id={id} type="email" value={values['org.email']} onChange={(ev) => set('org.email', ev.target.value)} />}
              </Field>
            </div>
            <Field label="Currency" hint="ISO 4217 code. Changing this does not convert existing payroll amounts." error={err('org.currency')}>
              {(id) => <Input id={id} className="w-28 uppercase" maxLength={3} value={values['org.currency']} onChange={(ev) => set('org.currency', ev.target.value.toUpperCase())} />}
            </Field>
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Security & controls" />
            <div className="space-y-4">
              <Checkbox
                checked={values['registration.open']}
                onChange={(v) => set('registration.open', v)}
                label="Allow public self-registration"
                description="New registrations still require verification before activation. When off, employees join by invitation only."
              />
              <Checkbox
                checked={values['payroll.require_second_approval']}
                onChange={(v) => set('payroll.require_second_approval', v)}
                label="Require second-person payroll approval"
                description="The person who prepares a payroll record cannot approve it."
              />
              <Checkbox
                checked={values['security.require_mfa_for_privileged']}
                onChange={(v) => set('security.require_mfa_for_privileged', v)}
                label="Require MFA for privileged roles"
                description="Super Admins, Administrators, Moderators and Finance Officers must enrol an authenticator app before continuing."
              />
              {original['payroll.require_second_approval'] && !values['payroll.require_second_approval'] && (
                <Alert tone="warning">Disabling second-person approval weakens payroll controls.</Alert>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Notifications" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Contract expiry warning (days)" error={err('notifications.contract_expiry_days')}>
                {(id) => <Input id={id} type="number" min={1} max={365} value={values['notifications.contract_expiry_days']} onChange={(ev) => set('notifications.contract_expiry_days', Number(ev.target.value))} />}
              </Field>
              <Field label="Event reminder (hours before)" error={err('notifications.event_reminder_hours')}>
                {(id) => <Input id={id} type="number" min={1} max={168} value={values['notifications.event_reminder_hours']} onChange={(ev) => set('notifications.event_reminder_hours', Number(ev.target.value))} />}
              </Field>
            </div>
          </Card>
          {dirty && (
            <Card>
              <Field label="Reason for change" hint="Optional, recorded in the audit log">
                {(id) => <Input id={id} value={reason} onChange={(ev) => setReason(ev.target.value)} />}
              </Field>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Scheduled jobs"
          description="Retirement scans, contract-expiry and event reminders run automatically once a day (see deployment docs). Jobs are idempotent, so running them manually never sends duplicate notifications."
          actions={
            <Button variant="secondary" icon={<PlayCircle className="size-4" />} onClick={() => run.mutate(undefined)} loading={run.isPending}>
              Run now
            </Button>
          }
        />
        {jobs && (
          <ul className="space-y-1 text-sm">
            {jobs.map((j) => (
              <li key={j.jobName} className="flex flex-wrap gap-2">
                <span className="font-mono text-xs">{j.jobName}</span>
                <span className="text-slate-500">{j.skipped ? 'already ran for this period' : JSON.stringify(j.details)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
