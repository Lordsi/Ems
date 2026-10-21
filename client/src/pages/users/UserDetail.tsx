import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Copy, KeyRound, Plus, ShieldCheck, ShieldOff, Trash2, UserCheck, UserX } from 'lucide-react';
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_KEYS, ROLE_META, ROLE_PERMISSIONS, type RoleKey } from '../../../../shared/permissions';
import { api } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
import { dateTime } from '../../lib/format';
import type { Lookups } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Alert, Avatar, Badge, Button, Card, CardHeader, Checkbox, DescriptionList, ErrorState, Field, Modal, PageHeader, PageLoader, Select, StatusBadge, Textarea } from '../../components/ui';

interface Scope {
  id?: string;
  scopeType: 'org_unit' | 'direct_reports';
  departmentId: string | null;
  locationId: string | null;
  departmentName?: string | null;
  locationName?: string | null;
}

interface UserDetail {
  id: string;
  displayName: string;
  username: string;
  email: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  employeeId: string | null;
  employmentNumber: string | null;
  legalName: string | null;
  roles: RoleKey[];
  grants: { permissionKey: string; reason: string | null; createdAt?: string }[];
  scopes: Scope[];
  isSelf: boolean;
  can: { assignRoles: boolean; manageStatus: boolean; manageScopes: boolean };
}

const INV = ['/users', '/audit', '/dashboard'];

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Reason" required hint="At least 5 characters. Recorded in the audit log.">
      {(id) => <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function RolesModal({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const [selected, setSelected] = useState<RoleKey[]>(user.roles.filter((r) => r !== 'employee'));
  const [reason, setReason] = useState('');
  const save = useAction(() => api.put(`/users/${user.id}/roles`, { roles: selected, reason }), { invalidate: INV, success: 'Roles updated', onSuccess: onClose });
  const removingSelfSuper = user.isSelf && user.roles.includes('super_admin') && !selected.includes('super_admin');
  return (
    <Modal
      open
      onClose={onClose}
      title="Change roles"
      description="Every account keeps the Employee role. You will be asked to confirm your password."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={reason.trim().length < 5}>
            Save roles
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {user.status === 'pending_verification' && <Alert tone="warning">This account is pending verification. Privileged roles can only be granted after verification.</Alert>}
        <div className="space-y-3">
          {ROLE_KEYS.filter((r) => r !== 'employee').map((r) => (
            <Checkbox
              key={r}
              checked={selected.includes(r)}
              onChange={(v) => setSelected((s) => (v ? [...s, r] : s.filter((x) => x !== r)))}
              label={ROLE_META[r].name}
              description={ROLE_META[r].description}
            />
          ))}
        </div>
        {removingSelfSuper && <Alert tone="warning">You are removing your own Super Admin role. This is blocked if you are the last active Super Admin.</Alert>}
        <ReasonField value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}

function GrantModal({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const fromRoles = new Set(user.roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
  const available = ALL_PERMISSIONS.filter((p) => !fromRoles.has(p) && !user.grants.some((g) => g.permissionKey === p));
  const [permission, setPermission] = useState<string>(available[0] ?? '');
  const [reason, setReason] = useState('');
  const save = useAction(() => api.post(`/users/${user.id}/grants`, { permission, reason }), { invalidate: INV, success: 'Permission granted', onSuccess: onClose });
  return (
    <Modal
      open
      onClose={onClose}
      title="Grant individual permission"
      description="Use sparingly for exceptions. Prefer roles for standard access."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={!permission || reason.trim().length < 5}>
            Grant
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {available.length === 0 ? (
          <Alert tone="info">This user already holds every permission through roles or grants.</Alert>
        ) : (
          <Field label="Permission" required hint={permission ? PERMISSIONS[permission as keyof typeof PERMISSIONS] : undefined}>
            {(id) => (
              <Select id={id} value={permission} onChange={(e) => setPermission(e.target.value)}>
                {available.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <ReasonField value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}

function RevokeGrantModal({ user, permission, onClose }: { user: UserDetail; permission: string; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useAction(() => api.del(`/users/${user.id}/grants/${encodeURIComponent(permission)}`, { reason }), { invalidate: INV, success: 'Permission revoked', onSuccess: onClose });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Revoke ${permission}`}
      description="The user's sessions are signed out so the change applies immediately."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={reason.trim().length < 5}>
            Revoke
          </Button>
        </>
      }
    >
      <ReasonField value={reason} onChange={setReason} />
    </Modal>
  );
}

function ScopesModal({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const lookups = useApi<Lookups>('/lookups');
  const [scopes, setScopes] = useState<Scope[]>(user.scopes.map(({ scopeType, departmentId, locationId }) => ({ scopeType, departmentId, locationId })));
  const [reason, setReason] = useState('');
  const save = useAction(() => api.put(`/users/${user.id}/scopes`, { scopes, reason }), { invalidate: INV, success: 'Moderator scope updated', onSuccess: onClose });
  const update = (i: number, patch: Partial<Scope>) => setScopes((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const invalid = scopes.some((s) => s.scopeType === 'org_unit' && !s.departmentId && !s.locationId);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Moderator scope"
      description="A moderator can only see and manage employees inside these scopes. An organisational unit can be a department, a location, or a department at a specific location."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={invalid || reason.trim().length < 5}>
            Save scope
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {scopes.length === 0 && <Alert tone="warning">No scopes assigned. This moderator cannot see any employee records except their own.</Alert>}
        {scopes.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-md bg-slate-50 p-3 sm:grid-cols-[170px_1fr_1fr_auto]">
            <Select value={s.scopeType} onChange={(e) => update(i, { scopeType: e.target.value as Scope['scopeType'], departmentId: null, locationId: null })} aria-label="Scope type">
              <option value="org_unit">Organisational unit</option>
              <option value="direct_reports">Direct reports</option>
            </Select>
            {s.scopeType === 'org_unit' ? (
              <>
                <Select value={s.departmentId ?? ''} onChange={(e) => update(i, { departmentId: e.target.value || null })} aria-label="Department">
                  <option value="">Any department</option>
                  {lookups.data?.departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                <Select value={s.locationId ?? ''} onChange={(e) => update(i, { locationId: e.target.value || null })} aria-label="Location">
                  <option value="">Any location</option>
                  {lookups.data?.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </>
            ) : (
              <p className="self-center text-sm text-slate-600 sm:col-span-2">Employees whose supervisor is this moderator.</p>
            )}
            <Button variant="ghost" size="sm" aria-label="Remove scope" icon={<Trash2 className="size-4" />} onClick={() => setScopes((x) => x.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setScopes((s) => [...s, { scopeType: 'org_unit', departmentId: null, locationId: null }])}>
          Add scope
        </Button>
        <ReasonField value={reason} onChange={setReason} />
      </div>
    </Modal>
  );
}

function StatusModal({ user, target, onClose }: { user: UserDetail; target: 'active' | 'suspended' | 'deactivated'; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const save = useAction(() => api.post(`/users/${user.id}/status`, { status: target, reason }), { invalidate: INV, success: 'Account status updated', onSuccess: onClose });
  const text = {
    active: { title: 'Reactivate account', body: 'The user will be able to sign in again.' },
    suspended: { title: 'Suspend account', body: 'The user is signed out immediately and cannot sign in until reactivated.' },
    deactivated: { title: 'Deactivate account', body: 'Use when the person has left. The account and its history are preserved but sign-in is disabled.' },
  }[target];
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={text.title}
      description={text.body}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={target === 'active' ? 'primary' : 'danger'} onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={reason.trim().length < 5}>
            {text.title}
          </Button>
        </>
      }
    >
      <ReasonField value={reason} onChange={setReason} />
    </Modal>
  );
}

function RecoveryModal({ user, onClose }: { user: UserDetail; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState<string | null>(null);
  const save = useAction(() => api.post<{ temporaryPassword: string }>(`/users/${user.id}/recovery`, { reason }), { invalidate: INV, onSuccess: (r) => setPassword(r.temporaryPassword) });
  return (
    <Modal
      open
      onClose={onClose}
      title="Recover access"
      description="Issues a one-time temporary password, disables MFA, clears lockouts and signs the user out everywhere. The user must set a new password at next sign-in."
      footer={
        password ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={reason.trim().length < 5}>
              Issue temporary password
            </Button>
          </>
        )
      }
    >
      {password ? (
        <div className="space-y-3">
          <Alert tone="warning">This password is shown only once. Deliver it to the user through a verified, out-of-band channel.</Alert>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-md bg-slate-100 px-3 py-2 font-mono text-sm">{password}</code>
            <Button
              variant="secondary"
              icon={<Copy className="size-4" />}
              onClick={() => navigator.clipboard.writeText(password).then(() => toast.success('Copied'), () => toast.error('Copy failed — select and copy manually'))}
            >
              Copy
            </Button>
          </div>
        </div>
      ) : (
        <ReasonField value={reason} onChange={setReason} />
      )}
    </Modal>
  );
}

type ModalKind = 'roles' | 'grant' | 'scopes' | 'recovery' | { revoke: string } | { status: 'active' | 'suspended' | 'deactivated' } | null;

export function UserDetailPage() {
  const { id = '' } = useParams();
  const q = useApi<UserDetail>(`/users/${id}`);
  const [modal, setModal] = useState<ModalKind>(null);
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const u = q.data;
  const close = () => setModal(null);
  const isModerator = u.roles.includes('moderator');

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/users', label: 'Users & access' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Avatar name={u.displayName} />
            {u.displayName}
            <StatusBadge status={u.status} />
            {u.isSelf && <Badge tone="blue">You</Badge>}
          </span>
        }
        description={`@${u.username} · ${u.email}`}
        actions={
          u.can.manageStatus && (
            <>
              {u.status === 'active' && (
                <>
                  <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setModal('recovery')}>
                    Recover access
                  </Button>
                  <Button variant="secondary" icon={<UserX className="size-4" />} onClick={() => setModal({ status: 'suspended' })}>
                    Suspend
                  </Button>
                  <Button variant="danger" onClick={() => setModal({ status: 'deactivated' })}>
                    Deactivate
                  </Button>
                </>
              )}
              {u.status === 'suspended' && (
                <>
                  <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setModal('recovery')}>
                    Recover access
                  </Button>
                  <Button icon={<UserCheck className="size-4" />} onClick={() => setModal({ status: 'active' })}>
                    Reactivate
                  </Button>
                </>
              )}
              {u.status === 'deactivated' && (
                <Button icon={<UserCheck className="size-4" />} onClick={() => setModal({ status: 'active' })}>
                  Reactivate
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Roles"
              description="Roles determine baseline permissions. Removing a role signs the user out of all sessions."
              actions={
                u.can.assignRoles && (
                  <Button size="sm" variant="secondary" onClick={() => setModal('roles')}>
                    Change roles
                  </Button>
                )
              }
            />
            <ul className="space-y-3">
              {u.roles.map((r) => (
                <li key={r} className="flex items-start gap-3">
                  <Badge tone={r === 'super_admin' ? 'violet' : r === 'employee' ? 'gray' : 'blue'}>{ROLE_META[r]?.name ?? r}</Badge>
                  <span className="text-sm text-slate-600">{ROLE_META[r]?.description}</span>
                </li>
              ))}
            </ul>
          </Card>

          {isModerator && (
            <Card>
              <CardHeader
                title="Moderator scope"
                actions={
                  u.can.manageScopes && (
                    <Button size="sm" variant="secondary" onClick={() => setModal('scopes')}>
                      Edit scope
                    </Button>
                  )
                }
              />
              {u.scopes.length === 0 ? (
                <p className="text-sm text-slate-500">No scopes assigned — this moderator cannot access other employees' records.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {u.scopes.map((s) => (
                    <li key={s.id} className="rounded-md bg-slate-50 px-3 py-2">
                      {s.scopeType === 'direct_reports' ? 'Direct reports' : [s.departmentName ?? 'Any department', s.locationName ?? 'any location'].join(' · ')}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader
              title="Individual permission grants"
              description="Exceptions granted on top of roles."
              actions={
                u.can.assignRoles &&
                !u.isSelf &&
                u.status === 'active' && (
                  <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setModal('grant')}>
                    Grant
                  </Button>
                )
              }
            />
            {u.grants.length === 0 ? (
              <p className="text-sm text-slate-500">No individual grants.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {u.grants.map((g) => (
                  <li key={g.permissionKey} className="flex items-start justify-between gap-3 py-2">
                    <div>
                      <p className="font-mono text-xs font-medium">{g.permissionKey}</p>
                      <p className="text-xs text-slate-500">{PERMISSIONS[g.permissionKey as keyof typeof PERMISSIONS]}</p>
                      {g.reason && <p className="mt-0.5 text-xs text-slate-500">Reason: {g.reason}</p>}
                    </div>
                    {u.can.assignRoles && (
                      <Button size="sm" variant="ghost" aria-label="Revoke" icon={<Trash2 className="size-4 text-red-600" />} onClick={() => setModal({ revoke: g.permissionKey })} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Account" />
          <DescriptionList
            columns={1}
            items={[
              {
                label: 'Employee record',
                value: u.employeeId ? (
                  <Link className="text-brand-700 hover:underline" to={`/employees/${u.employeeId}`}>
                    {u.legalName} {u.employmentNumber && <span className="font-mono text-xs">({u.employmentNumber})</span>}
                  </Link>
                ) : (
                  'Not linked'
                ),
              },
              {
                label: 'Multi-factor authentication',
                value: u.mfaEnabled ? (
                  <span className="flex items-center gap-1 text-emerald-700">
                    <ShieldCheck className="size-4" /> Enabled
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-slate-500">
                    <ShieldOff className="size-4" /> Not enabled
                  </span>
                ),
              },
              { label: 'Last sign-in', value: u.lastLoginAt ? dateTime(u.lastLoginAt) : 'Never' },
              { label: 'Created', value: dateTime(u.createdAt) },
            ]}
          />
          <Link to={`/audit?targetId=${u.id}`} className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">
            View audit history →
          </Link>
        </Card>
      </div>

      {modal === 'roles' && <RolesModal user={u} onClose={close} />}
      {modal === 'grant' && <GrantModal user={u} onClose={close} />}
      {modal === 'scopes' && <ScopesModal user={u} onClose={close} />}
      {modal === 'recovery' && <RecoveryModal user={u} onClose={close} />}
      {modal && typeof modal === 'object' && 'revoke' in modal && <RevokeGrantModal user={u} permission={modal.revoke} onClose={close} />}
      {modal && typeof modal === 'object' && 'status' in modal && <StatusModal user={u} target={modal.status} onClose={close} />}
    </div>
  );
}
