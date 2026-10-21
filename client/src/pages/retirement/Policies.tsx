import { useState } from 'react';
import { CalendarX2, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi } from '../../lib/hooks';
import { date, dateTime, todayIso } from '../../lib/format';
import type { Lookups } from '../../lib/types';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Textarea } from '../../components/ui';

interface Policy {
  id: string;
  name: string;
  retirementAge: number;
  reviewLeadMonths: number;
  upcomingWindowMonths: number;
  departmentId: string | null;
  departmentName: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  legalReference: string | null;
  notes: string | null;
  adopted: boolean;
  adoptedAt: string | null;
  adoptedByName: string | null;
  effectiveToday: boolean;
}

function PolicyEditor({ policy, onClose }: { policy?: Policy; onClose: () => void }) {
  const lookups = useApi<Lookups>('/lookups');
  const [f, setF] = useState({
    name: policy?.name ?? 'Organisation retirement policy',
    retirementAge: String(policy?.retirementAge ?? 60),
    reviewLeadMonths: String(policy?.reviewLeadMonths ?? 6),
    upcomingWindowMonths: String(policy?.upcomingWindowMonths ?? 12),
    departmentId: policy?.departmentId ?? '',
    effectiveFrom: policy?.effectiveFrom ?? todayIso(),
    effectiveTo: policy?.effectiveTo ?? '',
    legalReference: policy?.legalReference ?? '',
    notes: policy?.notes ?? '',
  });
  const save = useAction((body: unknown) => (policy ? api.put(`/retirement/policies/${policy.id}`, body) : api.post('/retirement/policies', body)), {
    invalidate: ['/retirement'],
    success: policy ? 'Policy updated' : 'Draft policy created',
    onSuccess: onClose,
  });
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  const e = save.fieldErrors;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={policy ? 'Edit draft policy' : 'New retirement policy'}
      description="Policies take effect only after a Super Admin verifies and adopts them."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                ...f,
                retirementAge: Number(f.retirementAge),
                reviewLeadMonths: Number(f.reviewLeadMonths),
                upcomingWindowMonths: Number(f.upcomingWindowMonths),
              })
            }
          >
            Save draft
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name" required error={e.name}>
            {(id) => <Input id={id} {...bind('name')} />}
          </Field>
        </div>
        <Field label="Retirement age" required hint="40–80" error={e.retirementAge}>
          {(id) => <Input id={id} type="number" min={40} max={80} {...bind('retirementAge')} />}
        </Field>
        <Field label="Applies to" error={e.departmentId}>
          {(id) => (
            <Select id={id} {...bind('departmentId')}>
              <option value="">Whole organisation</option>
              {lookups.data?.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Review lead time (months)" hint="When a review is flagged before the retirement date" error={e.reviewLeadMonths}>
          {(id) => <Input id={id} type="number" min={1} max={36} {...bind('reviewLeadMonths')} />}
        </Field>
        <Field label="Upcoming window (months)" hint="When the employee first appears in monitoring" error={e.upcomingWindowMonths}>
          {(id) => <Input id={id} type="number" min={1} max={60} {...bind('upcomingWindowMonths')} />}
        </Field>
        <Field label="Effective from" required error={e.effectiveFrom}>
          {(id) => <Input id={id} type="date" {...bind('effectiveFrom')} />}
        </Field>
        <Field label="Effective to" error={e.effectiveTo}>
          {(id) => <Input id={id} type="date" {...bind('effectiveTo')} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Legal / policy reference" hint="Statute, board resolution or HR policy that establishes this rule" error={e.legalReference}>
            {(id) => <Input id={id} {...bind('legalReference')} />}
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes" error={e.notes}>
            {(id) => <Textarea id={id} {...bind('notes')} />}
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function AdoptModal({ policy, onClose }: { policy: Policy; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const adopt = useAction(() => api.post(`/retirement/policies/${policy.id}/adopt`, { confirmation: true, reason }), {
    invalidate: ['/retirement', '/dashboard'],
    success: 'Policy adopted. Retirement monitoring will use it from the next scan.',
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Adopt retirement policy"
      description="Adoption is an executive act and is recorded in the audit trail. You will be asked to confirm your password."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!confirmed || reason.trim().length < 5} loading={adopt.isPending} onClick={() => adopt.mutate(undefined)}>
            Adopt policy
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning">
          {policy.name}: retirement at age <strong>{policy.retirementAge}</strong>, effective {date(policy.effectiveFrom)}, {policy.departmentName ?? 'whole organisation'}.
        </Alert>
        <Checkbox checked={confirmed} onChange={setConfirmed} label="I confirm this retirement age has been verified against applicable law, contracts and organisational policy." />
        <Field label="Reason / basis for adoption" required hint="At least 5 characters">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

function EndModal({ policy, onClose }: { policy: Policy; onClose: () => void }) {
  const [effectiveTo, setEffectiveTo] = useState(todayIso());
  const [reason, setReason] = useState('');
  const end = useAction(() => api.post(`/retirement/policies/${policy.id}/end`, { effectiveTo, reason }), { invalidate: ['/retirement'], success: 'Policy end date set', onSuccess: onClose });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="End policy"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 5} loading={end.isPending} onClick={() => end.mutate(undefined)}>
            End policy
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Last effective date" required>
          {(id) => <Input id={id} type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />}
        </Field>
        <Field label="Reason" required hint="At least 5 characters">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export function RetirementPoliciesPage() {
  const { can } = useAuth();
  const q = useApi<Policy[]>('/retirement/policies');
  const [modal, setModal] = useState<{ kind: 'edit' | 'adopt' | 'end'; policy?: Policy } | null>(null);
  const manage = can('retirement.policy.manage');
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/retirement', label: 'Retirement' }}
        title="Retirement policies"
        description="Department-specific policies take precedence over the organisation-wide policy. Adopted policies are locked; to change one, end it and adopt a new version."
        actions={
          manage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: 'edit' })}>
              New policy
            </Button>
          )
        }
      />
      {!q.data.some((p) => p.effectiveToday) && (
        <Alert tone="warning">No policy is currently in effect, so no retirement reviews are being generated. Create and adopt a policy to enable monitoring.</Alert>
      )}
      {!q.data.length ? (
        <Card>
          <EmptyState title="No retirement policies" description={manage ? 'Create a draft policy (for example, retirement at 60) and adopt it once verified.' : undefined} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data.map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900">{p.name}</h3>
                  <p className="text-sm text-slate-500">{p.departmentName ?? 'Whole organisation'}</p>
                </div>
                {p.effectiveToday ? <Badge tone="green">In effect</Badge> : p.adopted ? <Badge tone="gray">Adopted · not current</Badge> : <Badge tone="amber">Draft</Badge>}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Retirement age</dt>
                  <dd className="text-lg font-semibold">{p.retirementAge}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Review lead</dt>
                  <dd className="font-medium">{p.reviewLeadMonths} months</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Upcoming window</dt>
                  <dd className="font-medium">{p.upcomingWindowMonths} months</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-slate-600">
                Effective {date(p.effectiveFrom)}
                {p.effectiveTo ? ` – ${date(p.effectiveTo)}` : ' onwards'}
              </p>
              {p.legalReference && <p className="mt-1 text-xs text-slate-500">Reference: {p.legalReference}</p>}
              {p.adopted && (
                <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                  <ShieldCheck className="size-3.5 text-emerald-600" /> Adopted by {p.adoptedByName ?? '—'} · {dateTime(p.adoptedAt)}
                </p>
              )}
              {manage && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                  {!p.adopted && (
                    <>
                      <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setModal({ kind: 'edit', policy: p })}>
                        Edit
                      </Button>
                      <Button size="sm" icon={<ShieldCheck className="size-3.5" />} onClick={() => setModal({ kind: 'adopt', policy: p })}>
                        Verify & adopt
                      </Button>
                    </>
                  )}
                  {p.adopted && (!p.effectiveTo || p.effectiveTo >= todayIso()) && (
                    <Button size="sm" variant="secondary" icon={<CalendarX2 className="size-3.5" />} onClick={() => setModal({ kind: 'end', policy: p })}>
                      End policy
                    </Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {modal?.kind === 'edit' && <PolicyEditor policy={modal.policy} onClose={() => setModal(null)} />}
      {modal?.kind === 'adopt' && modal.policy && <AdoptModal policy={modal.policy} onClose={() => setModal(null)} />}
      {modal?.kind === 'end' && modal.policy && <EndModal policy={modal.policy} onClose={() => setModal(null)} />}
    </div>
  );
}
