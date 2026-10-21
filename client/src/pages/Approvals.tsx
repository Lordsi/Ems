import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ClipboardCheck, ExternalLink } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { date, dateTime, label, relative } from '../lib/format';
import { FIELD_LABELS, type Approval, type Lookups, type Paged } from '../lib/types';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, FilterBar, Input, Modal, PageHeader, Pagination, Select, Spinner, StatusBadge, Textarea, cx } from '../components/ui';

const TYPES = ['registration', 'employee_change', 'profile_correction', 'payroll_record', 'retirement_decision'];

function targetLink(a: Approval) {
  if (a.targetType === 'employee') return `/employees/${a.targetId}`;
  if (a.targetType === 'payroll_record') return `/finance/records/${a.targetId}`;
  if (a.targetType === 'retirement_review') return `/retirement/${a.targetId}`;
  return null;
}

function useValueLabel() {
  const { data } = useApi<Lookups>('/lookups');
  return (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    const s = String(v);
    switch (field) {
      case 'departmentId':
        return data?.departments.find((d) => d.id === s)?.name ?? 'Department';
      case 'locationId':
        return data?.locations.find((d) => d.id === s)?.name ?? 'Location';
      case 'jobTitleId':
        return data?.jobTitles.find((d) => d.id === s)?.name ?? 'Job title';
      case 'gradeId':
        return data?.grades.find((d) => d.id === s)?.name ?? 'Grade';
      case 'supervisorId':
        return 'Selected employee';
      case 'employmentStatus':
      case 'employmentType':
        return label(s);
      case 'dateOfBirth':
      case 'employmentDate':
      case 'contractEndDate':
        return date(s);
      default:
        return s;
    }
  };
}

export function ChangeSummary({ payload }: { payload: Record<string, unknown> | null }) {
  const valueLabel = useValueLabel();
  const changes = (payload?.changes ?? null) as Record<string, unknown> | null;
  const before = (payload?.before ?? {}) as Record<string, unknown>;
  if (!changes) return null;
  return (
    <div className="overflow-hidden rounded-md ring-1 ring-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Field</th>
            <th className="px-3 py-2 text-left font-semibold">Current</th>
            <th className="px-3 py-2 text-left font-semibold">Requested</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Object.entries(changes).map(([k, v]) => (
            <tr key={k}>
              <td className="px-3 py-2 font-medium text-slate-700">{FIELD_LABELS[k] ?? k}</td>
              <td className="px-3 py-2 text-slate-500">{valueLabel(k, before[k])}</td>
              <td className="px-3 py-2 font-medium text-slate-900">{valueLabel(k, v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DecideModal({ approval, onClose }: { approval: Approval; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [deferredUntil, setDeferredUntil] = useState('');
  const decide = useAction((body: { decision: string; reason: string | null; deferredUntil?: string | null }) => api.post(`/approvals/${approval.id}/decide`, body), {
    invalidate: ['/approvals', '/dashboard', '/employees', '/payroll', '/retirement'],
    success: (r) => `Request ${(r as { status?: string })?.status ? label((r as { status: string }).status).toLowerCase() : 'decided'}`,
    onSuccess: onClose,
  });
  const cancel = useAction(() => api.post(`/approvals/${approval.id}/cancel`), { invalidate: ['/approvals', '/dashboard'], success: 'Request cancelled', onSuccess: onClose });
  const link = targetLink(approval);
  const isRetirement = approval.type === 'retirement_decision';
  const reasonRequired = isRetirement || approval.type === 'payroll_record';
  const { supervisorName, workLocation } = (approval.payload as { supervisorName?: string; workLocation?: string } | null) ?? {};

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={approval.summary}
      description={`${label(approval.type)} · requested ${dateTime(approval.requestedAt)} by ${approval.requesterName ?? 'system'}`}
      footer={
        approval.canDecide ? (
          <>
            {isRetirement && (
              <Button variant="secondary" onClick={() => decide.mutate({ decision: 'defer', reason, deferredUntil })} loading={decide.isPending && decide.variables?.decision === 'defer'} disabled={!deferredUntil || reason.trim().length < 5}>
                Defer
              </Button>
            )}
            <Button variant="danger" onClick={() => decide.mutate({ decision: 'reject', reason })} loading={decide.isPending && decide.variables?.decision === 'reject'} disabled={reason.trim().length < (isRetirement ? 5 : 3)}>
              Reject
            </Button>
            <Button
              variant="success"
              onClick={() => decide.mutate({ decision: 'approve', reason: reason || null })}
              loading={decide.isPending && decide.variables?.decision === 'approve'}
              disabled={isRetirement && reason.trim().length < 5}
            >
              Approve
            </Button>
          </>
        ) : approval.canCancel ? (
          <Button variant="secondary" onClick={() => cancel.mutate(undefined)} loading={cancel.isPending}>
            Withdraw request
          </Button>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={approval.status} />
          {link && (
            <Link to={link} className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline" onClick={onClose}>
              Open record <ExternalLink className="size-3.5" />
            </Link>
          )}
        </div>
        {approval.reason && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Requester&apos;s reason</p>
            <p className="mt-1 text-sm text-slate-800">{approval.reason}</p>
          </div>
        )}
        {supervisorName && <p className="text-sm text-slate-600">Supervisor named in registration: <strong>{supervisorName}</strong></p>}
        {workLocation && <p className="text-sm text-slate-600">Work location written in registration: <strong>{workLocation}</strong></p>}
        <ChangeSummary payload={approval.payload} />
        {approval.type === 'registration' && approval.canDecide && (
          <Alert tone="info">Approving issues the employment number using the department on file. To correct placement first, open the record and use “Verify registration”.</Alert>
        )}
        {approval.type === 'payroll_record' && approval.canDecide && <Alert tone="info">Review the record&apos;s line items before approving. Approved payroll becomes immutable.</Alert>}
        {approval.decidedAt && (
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            Decided {dateTime(approval.decidedAt)} by {approval.deciderName ?? 'system'}
            {approval.decisionReason && <p className="mt-1 text-slate-600">“{approval.decisionReason}”</p>}
          </div>
        )}
        {approval.canDecide && (
          <>
            {isRetirement && (
              <Field label="Defer until" hint="Only used when deferring.">
                {(id) => <Input id={id} type="date" value={deferredUntil} onChange={(e) => setDeferredUntil(e.target.value)} />}
              </Field>
            )}
            <Field label="Decision note" required={reasonRequired} hint={reasonRequired ? 'Required for rejection' + (isRetirement ? ' and all retirement decisions' : '') : 'Required when rejecting'} error={decide.fieldErrors.reason}>
              {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

export function ApprovalsPage() {
  const [params, setParams] = useSearchParams();
  const focusId = params.get('id');
  const status = params.get('status') ?? (focusId ? 'all' : 'pending');
  const type = params.get('type') ?? '';
  const mine = params.get('mine') === 'true';
  const page = Number(params.get('page') ?? 1);
  const { data, isLoading, error, refetch } = useApi<Paged<Approval>>(`/approvals${qs({ status, type, mine: mine || undefined, page, pageSize: 20 })}`, { keepPrevious: true });
  const [selected, setSelected] = useState<string | null>(focusId);
  const current = data?.items.find((a) => a.id === selected) ?? null;

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.delete('id');
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader title="Approvals" description="Requests that need a decision, and the requests you have submitted." />
      <Card padded={false}>
        <FilterBar>
          <div className="flex rounded-md bg-slate-100 p-0.5 text-sm">
            {['pending', 'approved', 'rejected', 'all'].map((s) => (
              <button key={s} type="button" onClick={() => update({ status: s })} className={cx('rounded px-3 py-1.5 font-medium', status === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
                {label(s)}
              </button>
            ))}
          </div>
          <Select className="w-auto" value={type} onChange={(e) => update({ type: e.target.value })} aria-label="Request type">
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" className="size-4 rounded border-slate-300" checked={mine} onChange={(e) => update({ mine: e.target.checked ? 'true' : '' })} />
            Only my requests
          </label>
        </FilterBar>
        {error ? (
          <div className="p-4">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : isLoading ? (
          <div className="flex justify-center p-12">
            <Spinner />
          </div>
        ) : !data?.items.length ? (
          <EmptyState icon={<ClipboardCheck className="size-5" />} title={status === 'pending' ? 'Nothing waiting' : 'No requests found'} description={status === 'pending' ? 'You are all caught up.' : undefined} />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.items.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setSelected(a.id)} className={cx('flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-slate-50', a.id === focusId && 'bg-brand-50/60')}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{a.summary}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {label(a.type)} · {a.requesterName ?? 'system'} · {relative(a.requestedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {a.canDecide && <Badge tone="amber">Your decision</Badge>}
                      <StatusBadge status={a.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: String(p) })} />
          </>
        )}
      </Card>
      {current && <DecideModal approval={current} onClose={() => setSelected(null)} />}
    </div>
  );
}
