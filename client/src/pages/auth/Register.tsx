import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { label } from '../../lib/format';
import { EMPLOYMENT_TYPES, type Lookups } from '../../lib/types';
import { Alert, Button, Field, Input, PageLoader, Select, Textarea, cx } from '../../components/ui';
import { AuthShell, usePublicInfo } from './AuthShell';

const STEPS = ['Account', 'Employment', 'Personal & next of kin', 'Review'] as const;

const initial = {
  account: { displayName: '', email: '', password: '', confirm: '' },
  profile: {
    legalName: '',
    preferredName: '',
    dateOfBirth: '',
    phone: '',
    personalEmail: '',
    address: '',
    departmentId: '',
    jobTitleId: '',
    gradeId: '',
    workLocation: '',
    employmentDate: '',
    employmentType: 'permanent',
    contractEndDate: '',
    supervisorName: '',
  },
  nextOfKin: { fullName: '', relationship: '', phone: '', address: '' },
};

type FormState = typeof initial;

/** Fields that belong to each step, used to send the user back to the step containing an error. */
const STEP_FIELDS: string[][] = [
  ['account.', 'displayName', 'email', 'password'],
  ['departmentId', 'jobTitleId', 'gradeId', 'workLocation', 'employmentDate', 'employmentType', 'contractEndDate', 'profile.departmentId', 'profile.employmentDate', 'profile.employmentType', 'profile.contractEndDate', 'profile.jobTitleId', 'profile.gradeId', 'profile.workLocation', 'profile.supervisorName'],
  ['profile.', 'nextOfKin.', 'dateOfBirth', 'legalName'],
];

export function RegisterPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const info = usePublicInfo();
  const lookups = useQuery({ queryKey: ['public-lookups'], queryFn: () => api.get<Lookups>('/public/lookups') });
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (info.isLoading || lookups.isLoading) return <PageLoader />;
  if (info.data && !info.data.registrationOpen) {
    return (
      <AuthShell title="Registration is closed">
        <Alert tone="info">Self-registration is currently disabled. Please ask your administrator for an invitation link.</Alert>
        <Link to="/login" className="mt-6 inline-block text-sm font-medium text-brand-700">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  const set = <S extends keyof FormState>(section: S, key: keyof FormState[S]) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [section]: { ...f[section], [key]: e.target.value } }));
  const err = (section: string, key: string) => errors[`${section}.${key}`] ?? errors[key];
  const p = form.profile;
  const deps = lookups.data?.departments ?? [];
  const dept = deps.find((d) => d.id === p.departmentId);
  const titles = (lookups.data?.jobTitles ?? []).filter((t) => !t.departmentId || t.departmentId === p.departmentId);

  const validateStep = (s: number): Record<string, string> => {
    const e: Record<string, string> = {};
    const a = form.account;
    if (s === 0) {
      if (!a.displayName.trim()) e['account.displayName'] = 'Required';
      if (!/^\S+@\S+\.\S+$/.test(a.email)) e['account.email'] = 'Enter a valid email address';
      if (a.password.length < 12 || !/[a-z]/.test(a.password) || !/[A-Z]/.test(a.password) || !/\d/.test(a.password))
        e['account.password'] = 'At least 12 characters with upper and lower case letters and a number';
      if (a.password !== a.confirm) e['account.confirm'] = 'Passwords do not match';
    }
    if (s === 1) {
      if (!p.departmentId) e['profile.departmentId'] = 'Select your department';
      if (!p.employmentDate) e['profile.employmentDate'] = 'Required';
      if (p.employmentType === 'contract' && !p.contractEndDate) e['profile.contractEndDate'] = 'Required for contract staff';
    }
    if (s === 2) {
      if (!p.legalName.trim()) e['profile.legalName'] = 'Required';
      if (!p.dateOfBirth) e['profile.dateOfBirth'] = 'Required';
      if (!/^\+?[0-9 ()-]{7,20}$/.test(p.phone)) e['profile.phone'] = 'Enter a valid phone number';
      const k = form.nextOfKin;
      if (!k.fullName.trim()) e['nextOfKin.fullName'] = 'Required';
      if (!k.relationship.trim()) e['nextOfKin.relationship'] = 'Required';
      if (!/^\+?[0-9 ()-]{7,20}$/.test(k.phone)) e['nextOfKin.phone'] = 'Enter a valid phone number';
    }
    return e;
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    const v = validateStep(step);
    setErrors(v);
    if (Object.keys(v).length) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const { confirm: _c, ...account } = form.account;
      await api.post('/auth/register', { account, profile: form.profile, nextOfKin: form.nextOfKin });
      await refresh();
      navigate('/', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErrors(e.fields);
        const keys = Object.keys(e.fields);
        const target = STEP_FIELDS.findIndex((prefixes) => keys.some((k) => prefixes.some((pre) => k === pre || k.startsWith(pre))));
        setStep(target >= 0 ? target : 0);
        setFormError('Please correct the highlighted fields.');
      } else setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell wide title="Employee registration" subtitle="Your profile will be reviewed by HR before your account is activated and an employment number is issued.">
      <ol className="mb-8 grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-col gap-2">
            <span className={cx('h-1 rounded-full', i <= step ? 'bg-brand-600' : 'bg-slate-200')} />
            <span className={cx('flex items-center gap-1 text-xs font-medium', i === step ? 'text-brand-700' : 'text-slate-500')}>
              {i < step && <Check className="size-3" />} <span className="hidden sm:inline">{s}</span>
              <span className="sm:hidden">{i + 1}</span>
            </span>
          </li>
        ))}
      </ol>

      {formError && <Alert tone="error" className="mb-5">{formError}</Alert>}

      <form onSubmit={step === 3 ? (e) => (e.preventDefault(), void submit()) : next} className="space-y-5" noValidate>
        {step === 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Name" required error={err('account', 'displayName')} className="sm:col-span-2">
              {(id) => <Input id={id} value={form.account.displayName} onChange={set('account', 'displayName')} autoComplete="name" />}
            </Field>
            <Field label="Email address" required error={err('account', 'email')} hint="You will use this email address to sign in." className="sm:col-span-2">
              {(id) => <Input id={id} type="email" value={form.account.email} onChange={set('account', 'email')} autoComplete="email" />}
            </Field>
            <Field label="Password" required error={err('account', 'password')} hint="At least 12 characters, with upper and lower case letters and a number.">
              {(id) => <Input id={id} type="password" value={form.account.password} onChange={set('account', 'password')} autoComplete="new-password" />}
            </Field>
            <Field label="Confirm password" required error={err('account', 'confirm')}>
              {(id) => <Input id={id} type="password" value={form.account.confirm} onChange={set('account', 'confirm')} autoComplete="new-password" />}
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Department" required error={err('profile', 'departmentId')}>
              {(id) => (
                <Select id={id} value={p.departmentId} onChange={set('profile', 'departmentId')}>
                  <option value="">Select department…</option>
                  {deps.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Work location" hint="Where you usually work, e.g. Lilongwe head office." error={err('profile', 'workLocation')}>
              {(id) => <Input id={id} value={p.workLocation} onChange={set('profile', 'workLocation')} maxLength={160} />}
            </Field>
            <Field label="Job title" error={err('profile', 'jobTitleId')}>
              {(id) => (
                <Select id={id} value={p.jobTitleId} onChange={set('profile', 'jobTitleId')}>
                  <option value="">Not listed / to be assigned</option>
                  {titles.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Grade" error={err('profile', 'gradeId')}>
              {(id) => (
                <Select id={id} value={p.gradeId} onChange={set('profile', 'gradeId')}>
                  <option value="">Not sure / to be assigned</option>
                  {(lookups.data?.grades ?? []).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Employment date" required error={err('profile', 'employmentDate')}>
              {(id) => <Input id={id} type="date" value={p.employmentDate} onChange={set('profile', 'employmentDate')} />}
            </Field>
            <Field label="Employment type" required error={err('profile', 'employmentType')}>
              {(id) => (
                <Select id={id} value={p.employmentType} onChange={set('profile', 'employmentType')}>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {p.employmentType === 'contract' && (
              <Field label="Contract end date" required error={err('profile', 'contractEndDate')}>
                {(id) => <Input id={id} type="date" value={p.contractEndDate} onChange={set('profile', 'contractEndDate')} />}
              </Field>
            )}
            <Field label="Supervisor's name" hint="HR will link your supervisor during verification." error={err('profile', 'supervisorName')}>
              {(id) => <Input id={id} value={p.supervisorName} onChange={set('profile', 'supervisorName')} />}
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Legal name (as on ID)" required error={err('profile', 'legalName')}>
                {(id) => <Input id={id} value={p.legalName} onChange={set('profile', 'legalName')} />}
              </Field>
              <Field label="Preferred name" error={err('profile', 'preferredName')}>
                {(id) => <Input id={id} value={p.preferredName} onChange={set('profile', 'preferredName')} />}
              </Field>
              <Field label="Date of birth" required error={err('profile', 'dateOfBirth')}>
                {(id) => <Input id={id} type="date" value={p.dateOfBirth} onChange={set('profile', 'dateOfBirth')} />}
              </Field>
              <Field label="Phone" required error={err('profile', 'phone')}>
                {(id) => <Input id={id} type="tel" value={p.phone} onChange={set('profile', 'phone')} autoComplete="tel" placeholder="+265 …" />}
              </Field>
              <Field label="Personal email" hint="Defaults to your account email." error={err('profile', 'personalEmail')}>
                {(id) => <Input id={id} type="email" value={p.personalEmail} onChange={set('profile', 'personalEmail')} />}
              </Field>
              <Field label="Residential address" error={err('profile', 'address')} className="sm:col-span-2">
                {(id) => <Textarea id={id} value={p.address} onChange={set('profile', 'address')} rows={2} />}
              </Field>
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Next of kin</h3>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Full name" required error={err('nextOfKin', 'fullName')}>
                  {(id) => <Input id={id} value={form.nextOfKin.fullName} onChange={set('nextOfKin', 'fullName')} />}
                </Field>
                <Field label="Relationship" required error={err('nextOfKin', 'relationship')}>
                  {(id) => <Input id={id} value={form.nextOfKin.relationship} onChange={set('nextOfKin', 'relationship')} placeholder="e.g. Spouse" />}
                </Field>
                <Field label="Phone" required error={err('nextOfKin', 'phone')}>
                  {(id) => <Input id={id} type="tel" value={form.nextOfKin.phone} onChange={set('nextOfKin', 'phone')} />}
                </Field>
                <Field label="Address" error={err('nextOfKin', 'address')}>
                  {(id) => <Input id={id} value={form.nextOfKin.address} onChange={set('nextOfKin', 'address')} />}
                </Field>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 text-sm">
            <ReviewBlock
              title="Account"
              rows={[
                ['Name', form.account.displayName],
                ['Email', form.account.email],
              ]}
            />
            <ReviewBlock
              title="Employment"
              rows={[
                ['Department', dept ? `${dept.name} (${dept.code})` : '—'],
                ['Work location', p.workLocation.trim() || 'Not provided'],
                ['Job title', lookups.data?.jobTitles.find((t) => t.id === p.jobTitleId)?.name ?? 'To be assigned'],
                ['Employment date', p.employmentDate],
                ['Employment type', label(p.employmentType)],
                ...(p.employmentType === 'contract' ? ([['Contract end', p.contractEndDate]] as [string, string][]) : []),
              ]}
            />
            <ReviewBlock
              title="Personal"
              rows={[
                ['Legal name', p.legalName],
                ['Date of birth', p.dateOfBirth],
                ['Phone', p.phone],
                ['Next of kin', `${form.nextOfKin.fullName} (${form.nextOfKin.relationship})`],
              ]}
            />
            <Alert tone="info">By submitting, you confirm these details are accurate. HR will verify your identity and employment before activating your account.</Alert>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-200 pt-5">
          {step > 0 ? (
            <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : (
            <Link to="/login" className="text-sm text-slate-500 hover:text-slate-800">
              Already registered? Sign in
            </Link>
          )}
          <Button type="submit" loading={busy}>
            {step === 3 ? 'Submit registration' : 'Continue'}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}

function ReviewBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg ring-1 ring-slate-200">
      <p className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <dl className="divide-y divide-slate-100">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-right font-medium text-slate-900">{v || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
