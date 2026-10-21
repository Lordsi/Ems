import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi } from '../../lib/hooks';
import { label } from '../../lib/format';
import { EMPLOYMENT_TYPES, type Lookups } from '../../lib/types';
import { ROLE_KEYS, ROLE_META, type RoleKey } from '../../../../shared/permissions';
import { EmployeePicker } from '../../components/EmployeePicker';
import { Alert, Button, Card, CardHeader, Checkbox, Field, Input, PageHeader, PageLoader, Select, Textarea } from '../../components/ui';
import { InviteLinkModal } from './InviteLinkModal';

export function NewEmployeePage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const lookups = useApi<Lookups>('/lookups');
  const [f, setF] = useState({
    legalName: '',
    preferredName: '',
    dateOfBirth: '',
    phone: '',
    personalEmail: '',
    address: '',
    departmentId: '',
    jobTitleId: '',
    gradeId: '',
    locationId: '',
    workLocation: '',
    employmentDate: '',
    employmentType: 'permanent',
    contractEndDate: '',
  });
  const [supervisor, setSupervisor] = useState<{ id: string; name: string } | null>(null);
  const [withKin, setWithKin] = useState(false);
  const [kin, setKin] = useState({ fullName: '', relationship: '', phone: '', address: '' });
  const [withInvite, setWithInvite] = useState(true);
  const [invite, setInvite] = useState<{ email: string; roleKey: RoleKey }>({ email: '', roleKey: 'employee' });
  const [created, setCreated] = useState<{ id: string; employmentNumber: string | null; status: string; invitation: { inviteUrl: string; expiresInDays: number } | null } | null>(null);

  const create = useAction((body: unknown) => api.post<NonNullable<typeof created>>('/employees', body), {
    invalidate: ['/employees', '/dashboard', '/approvals'],
    onSuccess: (r) => (r.invitation ? setCreated(r) : navigate(`/employees/${r.id}`)),
    success: (r) => (r.employmentNumber ? `Employee created with number ${r.employmentNumber}` : 'Employee created and sent for verification'),
  });
  const e = create.fieldErrors;

  if (!can('employee.create')) return <Alert tone="error">You do not have permission to create employees.</Alert>;
  if (lookups.isLoading) return <PageLoader />;

  const dept = lookups.data?.departments.find((d) => d.id === f.departmentId);
  const locs = (lookups.data?.locations ?? []).filter((l) => !dept || !dept.locationIds.length || dept.locationIds.includes(l.id));
  const titles = (lookups.data?.jobTitles ?? []).filter((t) => !t.departmentId || t.departmentId === f.departmentId);
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (ev: { target: { value: string } }) => setF((s) => ({ ...s, [k]: ev.target.value })) });
  const inviteRoles = can('role.assign') ? ROLE_KEYS : (['employee'] as const);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    create.mutate({
      ...f,
      supervisorId: supervisor?.id ?? null,
      ...(withKin ? { nextOfKin: kin } : {}),
      ...(withInvite && invite.email ? { invite } : {}),
    });
  };

  return (
    <div>
      <PageHeader
        title="Add employee"
        description={can('employee.verify') ? 'The record is verified on creation and an employment number is issued immediately.' : 'The record will be sent for verification before an employment number is issued.'}
        back={{ to: '/employees', label: 'Directory' }}
      />
      <form onSubmit={submit} className="space-y-6">
        <Card>
          <CardHeader title="Personal details" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Legal name" required error={e.legalName}>
              {(id) => <Input id={id} {...bind('legalName')} invalid={!!e.legalName} />}
            </Field>
            <Field label="Preferred name" error={e.preferredName}>
              {(id) => <Input id={id} {...bind('preferredName')} />}
            </Field>
            <Field label="Date of birth" required error={e.dateOfBirth}>
              {(id) => <Input id={id} type="date" {...bind('dateOfBirth')} invalid={!!e.dateOfBirth} />}
            </Field>
            <Field label="Phone" error={e.phone}>
              {(id) => <Input id={id} type="tel" {...bind('phone')} invalid={!!e.phone} />}
            </Field>
            <Field label="Personal email" error={e.personalEmail}>
              {(id) => <Input id={id} type="email" {...bind('personalEmail')} invalid={!!e.personalEmail} />}
            </Field>
            <Field label="Address" error={e.address}>
              {(id) => <Input id={id} {...bind('address')} />}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Employment" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Department" required error={e.departmentId}>
              {(id) => (
                <Select id={id} {...bind('departmentId')} invalid={!!e.departmentId}>
                  <option value="">Select…</option>
                  {lookups.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Work location" error={e.workLocation}>
              {(id) => <Input id={id} {...bind('workLocation')} maxLength={160} placeholder="e.g. Lilongwe head office" />}
            </Field>
            <Field label="Assigned location" error={e.locationId}>
              {(id) => (
                <Select id={id} {...bind('locationId')}>
                  <option value="">Unassigned</option>
                  {locs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Job title" error={e.jobTitleId}>
              {(id) => (
                <Select id={id} {...bind('jobTitleId')}>
                  <option value="">Unassigned</option>
                  {titles.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Grade" error={e.gradeId}>
              {(id) => (
                <Select id={id} {...bind('gradeId')}>
                  <option value="">Unassigned</option>
                  {lookups.data?.grades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Supervisor" error={e.supervisorId}>
              {(id) => <EmployeePicker id={id} value={supervisor} onChange={setSupervisor} invalid={!!e.supervisorId} />}
            </Field>
            <Field label="Employment date" required error={e.employmentDate}>
              {(id) => <Input id={id} type="date" {...bind('employmentDate')} invalid={!!e.employmentDate} />}
            </Field>
            <Field label="Employment type" required error={e.employmentType}>
              {(id) => (
                <Select id={id} {...bind('employmentType')}>
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {f.employmentType === 'contract' && (
              <Field label="Contract end date" required error={e.contractEndDate}>
                {(id) => <Input id={id} type="date" {...bind('contractEndDate')} invalid={!!e.contractEndDate} />}
              </Field>
            )}
          </div>
        </Card>

        <Card>
          <Checkbox checked={withKin} onChange={setWithKin} label="Record next of kin now" description="The employee can also add this themselves after signing in." />
          {withKin && (
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Full name" required error={e['nextOfKin.fullName']}>
                {(id) => <Input id={id} value={kin.fullName} onChange={(ev) => setKin({ ...kin, fullName: ev.target.value })} />}
              </Field>
              <Field label="Relationship" required error={e['nextOfKin.relationship']}>
                {(id) => <Input id={id} value={kin.relationship} onChange={(ev) => setKin({ ...kin, relationship: ev.target.value })} />}
              </Field>
              <Field label="Phone" required error={e['nextOfKin.phone']}>
                {(id) => <Input id={id} value={kin.phone} onChange={(ev) => setKin({ ...kin, phone: ev.target.value })} />}
              </Field>
              <Field label="Address" error={e['nextOfKin.address']}>
                {(id) => <Textarea id={id} rows={1} value={kin.address} onChange={(ev) => setKin({ ...kin, address: ev.target.value })} />}
              </Field>
            </div>
          )}
        </Card>

        <Card>
          <Checkbox checked={withInvite} onChange={setWithInvite} label="Invite the employee to create an account" description="A single-use link valid for 7 days will be generated for you to share securely." />
          {withInvite && (
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="Work email" required error={e['invite.email']}>
                {(id) => <Input id={id} type="email" value={invite.email} onChange={(ev) => setInvite({ ...invite, email: ev.target.value })} />}
              </Field>
              <Field label="Initial role" hint={can('role.assign') ? 'Privileged roles require password confirmation.' : 'Only a super admin can pre-assign privileged roles.'}>
                {(id) => (
                  <Select id={id} value={invite.roleKey} onChange={(ev) => setInvite({ ...invite, roleKey: ev.target.value as RoleKey })}>
                    {inviteRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_META[r].name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          )}
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => navigate('/employees')}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create employee
          </Button>
        </div>
      </form>
      {created?.invitation && (
        <InviteLinkModal
          open
          url={created.invitation.inviteUrl}
          days={created.invitation.expiresInDays}
          onClose={() => navigate(`/employees/${created.id}`)}
        />
      )}
    </div>
  );
}
