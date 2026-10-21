import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi } from '../../lib/hooks';
import { FIELD_LABELS, type Approval, type EmployeeDetail, type Lookups, type Paged } from '../../lib/types';
import { ROLE_KEYS, ROLE_META, type RoleKey } from '../../../../shared/permissions';
import { Alert, Button, Checkbox, Field, Input, Modal, Select, Textarea } from '../../components/ui';
import { changedFields, currentValues, EmployeeFieldInput, type FieldValues } from './EmployeeFields';
import { InviteLinkModal } from './InviteLinkModal';

const CONTROLLED = ['legalName', 'dateOfBirth', 'departmentId', 'employmentDate', 'employmentType', 'contractEndDate', 'employmentStatus', 'supervisorId', 'locationId'];
const ADMIN_DIRECT = ['preferredName', 'phone', 'personalEmail', 'address', 'workLocation', 'jobTitleId', 'gradeId', 'supervisorId', 'locationId'];
const FIELD_ORDER = ['legalName', 'preferredName', 'dateOfBirth', 'phone', 'personalEmail', 'address', 'departmentId', 'workLocation', 'locationId', 'jobTitleId', 'gradeId', 'supervisorId', 'employmentDate', 'employmentType', 'contractEndDate', 'employmentStatus'];

const invalidate = ['/employees', '/approvals', '/dashboard'];

/* ------------------------------------------------------------------ */
/* Edit                                                               */
/* ------------------------------------------------------------------ */

export function EditEmployeeModal({ emp, lookups, open, onClose }: { emp: EmployeeDetail; lookups?: Lookups; open: boolean; onClose: () => void }) {
  const before = currentValues(emp);
  const [values, setValues] = useState<FieldValues>(before);
  const [supervisorLabel, setSupervisorLabel] = useState(emp.supervisor?.name ?? '');
  const [reason, setReason] = useState('');
  const [kin, setKin] = useState(emp.nextOfKin ?? { fullName: '', relationship: '', phone: '', address: '' });
  const [editKin, setEditKin] = useState(false);
  const mode = emp.access.updateMode;
  const direct = new Set(emp.access.directFields);
  const proposable = new Set(emp.access.proposableFields);
  const fields = FIELD_ORDER.filter((k) => direct.has(k) || proposable.has(k)).filter((k) => !['dateOfBirth', 'phone', 'personalEmail', 'address'].includes(k) || emp.personal);
  const changes = changedFields(before, values, fields);
  const changedKeys = Object.keys(changes);
  const needsApproval = changedKeys.filter((k) => proposable.has(k));
  const isOverride = mode === 'override' && changedKeys.some((k) => CONTROLLED.includes(k) && !ADMIN_DIRECT.includes(k));

  const save = useAction((body: unknown) => api.patch<{ applied: string[]; pendingApprovalId: string | null; pendingFields: string[] }>(`/employees/${emp.id}`, body), {
    invalidate,
    success: (r) =>
      r.pendingFields.length
        ? `${r.applied.length ? 'Changes saved. ' : ''}${r.pendingFields.length} change(s) sent for approval.`
        : 'Employee record updated',
    onSuccess: onClose,
  });

  const submit = () => {
    save.mutate({
      changes,
      ...(editKin ? { nextOfKin: { ...kin, address: kin.address || null } } : {}),
      reason: reason || null,
    });
  };

  const sections: [string, string[]][] = [
    ['Personal', ['legalName', 'preferredName', 'dateOfBirth', 'phone', 'personalEmail', 'address']],
    ['Placement', ['departmentId', 'workLocation', 'locationId', 'jobTitleId', 'gradeId', 'supervisorId']],
    ['Employment', ['employmentDate', 'employmentType', 'contractEndDate', 'employmentStatus']],
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Edit ${emp.legalName}`}
      description={
        mode === 'self'
          ? 'You can update your contact details. Use “Request correction” for other changes.'
          : mode === 'override'
            ? 'Executive override: controlled fields change immediately and require a reason.'
            : 'Operational fields save immediately; controlled fields are sent for approval.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending} disabled={!changedKeys.length && !editKin}>
            {needsApproval.length && needsApproval.length === changedKeys.length ? 'Submit for approval' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {sections.map(([title, keys]) => {
          const shown = keys.filter((k) => fields.includes(k));
          if (!shown.length) return null;
          return (
            <div key={title}>
              <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((k) => (
                  <EmployeeFieldInput
                    key={k}
                    name={k}
                    values={values}
                    setValue={(name, v) => setValues((s) => ({ ...s, [name]: v }))}
                    lookups={lookups}
                    error={save.fieldErrors[k] ?? save.fieldErrors[`changes.${k}`]}
                    supervisorLabel={supervisorLabel}
                    setSupervisorLabel={setSupervisorLabel}
                    employeeId={emp.id}
                    hint={proposable.has(k) ? 'Requires approval' : undefined}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {emp.access.canEditNextOfKin && (
          <div>
            <Checkbox checked={editKin} onChange={setEditKin} label="Update next of kin" />
            {editKin && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required error={save.fieldErrors['nextOfKin.fullName']}>
                  {(id) => <Input id={id} value={kin.fullName} onChange={(e) => setKin({ ...kin, fullName: e.target.value })} />}
                </Field>
                <Field label="Relationship" required error={save.fieldErrors['nextOfKin.relationship']}>
                  {(id) => <Input id={id} value={kin.relationship} onChange={(e) => setKin({ ...kin, relationship: e.target.value })} />}
                </Field>
                <Field label="Phone" required error={save.fieldErrors['nextOfKin.phone']}>
                  {(id) => <Input id={id} value={kin.phone} onChange={(e) => setKin({ ...kin, phone: e.target.value })} />}
                </Field>
                <Field label="Address" error={save.fieldErrors['nextOfKin.address']}>
                  {(id) => <Input id={id} value={kin.address ?? ''} onChange={(e) => setKin({ ...kin, address: e.target.value })} />}
                </Field>
              </div>
            )}
          </div>
        )}

        {needsApproval.length > 0 && (
          <Alert tone="info" title="Approval required">
            {needsApproval.map((k) => FIELD_LABELS[k]).join(', ')} will be submitted to an approver and applied only once approved.
          </Alert>
        )}
        {values.employmentStatus === 'terminated' && before.employmentStatus !== 'terminated' && (
          <Alert tone="warning">Terminating employment deactivates the employee&apos;s account and signs them out everywhere.</Alert>
        )}
        {(mode !== 'self' || editKin) && (
          <Field label={isOverride ? 'Reason for override' : 'Reason / note'} required={isOverride} error={save.fieldErrors.reason}>
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the audit trail and employment history" />}
          </Field>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Correction request (self-service)                                  */
/* ------------------------------------------------------------------ */

const CORRECTABLE = ['legalName', 'dateOfBirth', 'departmentId', 'locationId', 'jobTitleId', 'gradeId', 'supervisorId', 'employmentDate', 'employmentType', 'contractEndDate'];

export function CorrectionModal({ emp, lookups, open, onClose }: { emp: EmployeeDetail; lookups?: Lookups; open: boolean; onClose: () => void }) {
  const before = currentValues(emp);
  const [selected, setSelected] = useState<string[]>([]);
  const [values, setValues] = useState<FieldValues>(before);
  const [supervisorLabel, setSupervisorLabel] = useState(emp.supervisor?.name ?? '');
  const [reason, setReason] = useState('');
  const submit = useAction((body: unknown) => api.post(`/employees/${emp.id}/corrections`, body), {
    invalidate,
    success: 'Correction request submitted for review',
    onSuccess: onClose,
  });
  const changes = changedFields(before, values, selected);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Request a correction"
      description="Select the details that are wrong and enter the correct values. A reviewer will verify the change."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit.mutate({ changes, reason })} loading={submit.isPending} disabled={!Object.keys(changes).length || reason.trim().length < 5}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CORRECTABLE.map((k) => (
            <Checkbox key={k} checked={selected.includes(k)} onChange={(c) => setSelected((s) => (c ? [...s, k] : s.filter((x) => x !== k)))} label={FIELD_LABELS[k]} />
          ))}
        </div>
        {selected.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {CORRECTABLE.filter((k) => selected.includes(k)).map((k) => (
              <EmployeeFieldInput
                key={k}
                name={k}
                values={values}
                setValue={(name, v) => setValues((s) => ({ ...s, [name]: v }))}
                lookups={lookups}
                error={submit.fieldErrors[k]}
                supervisorLabel={supervisorLabel}
                setSupervisorLabel={setSupervisorLabel}
                employeeId={emp.id}
              />
            ))}
          </div>
        )}
        <Field label="Explanation" required hint="At least 5 characters. Mention any supporting document you can provide." error={submit.fieldErrors.reason}>
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Registration verification                                          */
/* ------------------------------------------------------------------ */

const VERIFY_FIELDS = ['departmentId', 'locationId', 'jobTitleId', 'gradeId', 'supervisorId', 'employmentDate', 'employmentType'];

export function VerifyModal({ emp, lookups, open, onClose }: { emp: EmployeeDetail; lookups?: Lookups; open: boolean; onClose: () => void }) {
  const before = currentValues(emp);
  const [values, setValues] = useState<FieldValues>(before);
  const [supervisorLabel, setSupervisorLabel] = useState(emp.supervisor?.name ?? '');
  const [reason, setReason] = useState('');
  const approvals = useApi<Paged<Approval>>(open ? `/employees/${emp.id}/approvals` : null);
  const reg = approvals.data?.items.find((a) => a.type === 'registration' && a.status === 'pending');
  const supervisorName = (reg?.payload as { supervisorName?: string } | null)?.supervisorName;
  const verify = useAction((body: { decision: 'approve' | 'reject' } & Record<string, unknown>) => api.post<{ status: string; employmentNumber: string | null }>(`/employees/${emp.id}/verify`, body), {
    invalidate,
    success: (r) => (r.employmentNumber ? `Verified. Employment number ${r.employmentNumber} issued.` : 'Registration rejected'),
    onSuccess: onClose,
  });
  const corrections = changedFields(before, values, VERIFY_FIELDS);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Verify registration"
      description="Confirm the employee's identity and employment details. Approving issues a permanent employment number."
      footer={
        <>
          <Button variant="danger" onClick={() => verify.mutate({ decision: 'reject', reason })} loading={verify.isPending && verify.variables?.decision === 'reject'} disabled={!reason.trim()}>
            Reject
          </Button>
          <Button variant="success" onClick={() => verify.mutate({ decision: 'approve', reason: reason || null, ...(Object.keys(corrections).length ? { corrections } : {}) })} loading={verify.isPending && verify.variables?.decision === 'approve'}>
            Approve & issue number
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {supervisorName && <Alert tone="info">Supervisor named by the employee: <strong>{supervisorName}</strong></Alert>}
        {emp.workLocation && <Alert tone="info">Work location written by the employee: <strong>{emp.workLocation}</strong></Alert>}
        <p className="text-sm text-slate-600">Correct any placement details before approving. The employment number prefix follows the final department.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {VERIFY_FIELDS.map((k) => (
            <EmployeeFieldInput
              key={k}
              name={k}
              values={values}
              setValue={(name, v) => setValues((s) => ({ ...s, [name]: v }))}
              lookups={lookups}
              error={verify.fieldErrors[k] ?? verify.fieldErrors[`corrections.${k}`]}
              supervisorLabel={supervisorLabel}
              setSupervisorLabel={setSupervisorLabel}
              employeeId={emp.id}
            />
          ))}
        </div>
        <Field label="Notes" hint="Required when rejecting." error={verify.fieldErrors.reason}>
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Archive / restore                                                  */
/* ------------------------------------------------------------------ */

export function ArchiveModal({ emp, open, onClose }: { emp: EmployeeDetail; open: boolean; onClose: () => void }) {
  const archived = emp.archived;
  const [reason, setReason] = useState('');
  const act = useAction((r: string) => api.post(`/employees/${emp.id}/${archived ? 'restore' : 'archive'}`, { reason: r }), {
    invalidate,
    success: archived ? 'Employee record restored' : 'Employee record archived',
    onSuccess: onClose,
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={archived ? 'Restore employee record' : 'Archive employee record'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={archived ? 'primary' : 'danger'} onClick={() => act.mutate(reason)} loading={act.isPending} disabled={reason.trim().length < 5}>
            {archived ? 'Restore' : 'Archive'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!archived && <Alert tone="warning">Archiving keeps all history, payroll and audit records but deactivates the linked account. Records are never deleted.</Alert>}
        <Field label="Reason" required error={act.fieldErrors.reason}>
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Invitation                                                         */
/* ------------------------------------------------------------------ */

export function InviteModal({ emp, open, onClose }: { emp: EmployeeDetail; open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const [email, setEmail] = useState(emp.personal?.personalEmail ?? '');
  const [roleKey, setRoleKey] = useState<RoleKey>('employee');
  const [link, setLink] = useState<{ inviteUrl: string; expiresInDays: number } | null>(null);
  const invite = useAction((body: unknown) => api.post<{ inviteUrl: string; expiresInDays: number }>(`/employees/${emp.id}/invite`, body), {
    invalidate: ['/employees'],
    onSuccess: (r) => setLink(r),
  });
  if (link) return <InviteLinkModal open={open} url={link.inviteUrl} days={link.expiresInDays} onClose={onClose} />;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Invite to create an account"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => invite.mutate({ email, roleKey })} loading={invite.isPending}>
            Generate link
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {emp.pendingInvitation && <Alert tone="info">A previous invitation to {emp.pendingInvitation.email} will be revoked.</Alert>}
        <Field label="Email" required error={invite.fieldErrors.email}>
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field label="Initial role">
          {(id) => (
            <Select id={id} value={roleKey} onChange={(e) => setRoleKey(e.target.value as RoleKey)}>
              {(can('role.assign') ? ROLE_KEYS : (['employee'] as const)).map((r) => (
                <option key={r} value={r}>
                  {ROLE_META[r].name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}
