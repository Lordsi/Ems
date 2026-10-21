import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Download, FileText, History, Trash2, Upload } from 'lucide-react';
import { api, download, errorMessage } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
import { bytes, date, dateTime, label, money } from '../../lib/format';
import type { Approval, Paged } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Badge, Button, Card, DescriptionList, EmptyState, ErrorState, Select, Spinner, StatusBadge, Table, Td, Th } from '../../components/ui';

function Loading({ q }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown } }) {
  if (q.isLoading)
    return (
      <div className="flex justify-center p-10">
        <Spinner />
      </div>
    );
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return null;
}

/* ------------------------------------------------------------------ */
/* Employment history                                                 */
/* ------------------------------------------------------------------ */

interface HistoryRow {
  id: string;
  changeType: string;
  fromValues: Record<string, unknown> | null;
  toValues: Record<string, unknown> | null;
  effectiveDate: string;
  reason: string | null;
  createdAt: string;
  actorName: string | null;
  approvalId: string | null;
}

function describe(values: Record<string, unknown> | null) {
  if (!values) return null;
  const entries = Object.entries(values).filter(([k, v]) => v !== null && v !== undefined && !(k.endsWith('Id') && `${k.slice(0, -2)}Name` in values));
  return entries.map(([k, v]) => `${label(k.replace(/Name$/, ''))}: ${typeof v === 'string' && /^(pending|active|on_leave|suspended|terminated|retired)/.test(v) ? label(v) : String(v)}`).join(' · ');
}

export function HistoryTab({ employeeId }: { employeeId: string }) {
  const q = useApi<HistoryRow[]>(`/employees/${employeeId}/history`);
  if (!q.data) return <Loading q={q} />;
  if (!q.data.length) return <EmptyState icon={<History className="size-5" />} title="No employment history yet" />;
  return (
    <Card>
      <ol className="relative space-y-6 border-l border-slate-200 pl-6">
        {q.data.map((h) => (
          <li key={h.id} className="relative">
            <span className="absolute -left-[31px] top-1 size-3 rounded-full bg-brand-500 ring-4 ring-white" aria-hidden />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{label(h.changeType)}</span>
              <span className="text-xs text-slate-500">effective {date(h.effectiveDate)}</span>
              {h.approvalId && <Badge tone="green">Approved request</Badge>}
            </div>
            {(h.fromValues || h.toValues) && (
              <p className="mt-1 text-sm text-slate-600">
                {h.fromValues && <span className="text-slate-400 line-through">{describe(h.fromValues)}</span>}
                {h.fromValues && h.toValues && <span className="mx-1.5">→</span>}
                {h.toValues && <span>{describe(h.toValues)}</span>}
              </p>
            )}
            {h.reason && <p className="mt-1 text-sm italic text-slate-500">“{h.reason}”</p>}
            <p className="mt-1 text-xs text-slate-400">
              Recorded {dateTime(h.createdAt)} by {h.actorName ?? 'system'}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Documents                                                          */
/* ------------------------------------------------------------------ */

interface DocRow {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  createdAt: string;
  uploadedByName: string | null;
}

const DOC_CATEGORIES = ['general', 'contract', 'identity', 'qualification', 'medical'];

export function DocumentsTab({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const toast = useToast();
  const q = useApi<DocRow[]>(`/employees/${employeeId}/documents`);
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState('general');
  const upload = useAction(
    (file: File) => {
      const form = new FormData();
      form.append('category', category);
      form.append('file', file);
      return api.upload(`/employees/${employeeId}/documents`, form);
    },
    { invalidate: [`/employees/${employeeId}/documents`], success: 'Document uploaded' },
  );
  const archive = useAction((id: string) => api.del(`/documents/${id}`), { invalidate: [`/employees/${employeeId}/documents`], success: 'Document removed' });

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error('Files must be smaller than 5 MB');
    upload.mutate(f);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <Card padded={false}>
      {canManage && (
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <Select className="w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Document category">
            {DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </Select>
          <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          <Button onClick={() => fileRef.current?.click()} loading={upload.isPending} icon={<Upload className="size-4" />}>
            Upload document
          </Button>
          <span className="text-xs text-slate-500">PDF, PNG or JPEG · max 5 MB</span>
        </div>
      )}
      {!q.data ? (
        <div className="p-4">
          <Loading q={q} />
        </div>
      ) : !q.data.length ? (
        <EmptyState icon={<FileText className="size-5" />} title="No documents" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {q.data.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="size-5 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{d.filename}</p>
                  <p className="text-xs text-slate-500">
                    {label(d.category)} · {bytes(d.sizeBytes)} · {date(d.createdAt)}
                    {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" aria-label={`Download ${d.filename}`} icon={<Download className="size-4" />} onClick={() => download(`/documents/${d.id}/download`, d.filename).catch((e) => toast.error(errorMessage(e)))} />
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${d.filename}`}
                    icon={<Trash2 className="size-4 text-red-600" />}
                    onClick={() => confirm(`Remove ${d.filename}? It will be archived, not permanently deleted.`) && archive.mutate(d.id)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Payroll                                                            */
/* ------------------------------------------------------------------ */

export interface PayrollRow {
  id: string;
  periodName: string;
  periodCode: string;
  startDate: string;
  revision: number;
  status: string;
  currency: string;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  paymentStatus: string;
  paymentDate: string | null;
  payslipId: string | null;
}

export function PayrollTable({ rows, financeView }: { rows: PayrollRow[]; financeView: boolean }) {
  if (!rows.length) return <EmptyState icon={<FileText className="size-5" />} title="No payroll records yet" description="Payslips appear here once payroll is approved and issued." />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Period</Th>
          <Th className="hidden sm:table-cell">Status</Th>
          <Th align="right" className="hidden md:table-cell">Gross</Th>
          <Th align="right" className="hidden md:table-cell">Deductions</Th>
          <Th align="right">Net pay</Th>
          <Th className="hidden sm:table-cell">Payment</Th>
          <Th align="right">Payslip</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {rows.map((r) => (
          <tr key={r.id} className={r.status === 'superseded' ? 'text-slate-400' : ''}>
            <Td>
              {financeView ? (
                <Link to={`/finance/records/${r.id}`} className="font-medium text-brand-700 hover:underline">
                  {r.periodName}
                </Link>
              ) : (
                <span className="font-medium text-slate-900">{r.periodName}</span>
              )}
              {r.revision > 1 && <span className="ml-1.5 text-xs text-slate-500">rev {r.revision}</span>}
            </Td>
            <Td className="hidden sm:table-cell">
              <StatusBadge status={r.status} />
            </Td>
            <Td align="right" className="hidden md:table-cell tabular-nums">{money(r.grossEarnings, r.currency)}</Td>
            <Td align="right" className="hidden md:table-cell tabular-nums">{money(r.totalDeductions, r.currency)}</Td>
            <Td align="right" className="font-medium tabular-nums">{money(r.netPay, r.currency)}</Td>
            <Td className="hidden sm:table-cell">
              <StatusBadge status={r.paymentStatus} /> {r.paymentDate && <span className="ml-1 text-xs text-slate-500">{date(r.paymentDate)}</span>}
            </Td>
            <Td align="right">
              {r.payslipId ? (
                <Link to={`/payslips/${r.payslipId}`} className="text-sm font-medium text-brand-700 hover:underline">
                  View
                </Link>
              ) : (
                <span className="text-xs text-slate-400">Not issued</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function PayrollTab({ employeeId, financeView }: { employeeId: string; financeView: boolean }) {
  const q = useApi<PayrollRow[]>(`/employees/${employeeId}/payroll`);
  if (!q.data) return <Loading q={q} />;
  return (
    <Card padded={false}>
      <PayrollTable rows={q.data} financeView={financeView} />
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Retirement                                                         */
/* ------------------------------------------------------------------ */

export function RetirementTab({ employeeId }: { employeeId: string }) {
  const q = useApi<{
    policy: { id: string; name: string; retirementAge: number; reviewLeadMonths: number } | null;
    expectedRetirementDate: string | null;
    reviews: { id: string; status: string; expectedRetirementDate: string; deferredUntil: string | null; policyName: string }[];
  }>(`/employees/${employeeId}/retirement`);
  if (!q.data) return <Loading q={q} />;
  return (
    <div className="space-y-4">
      <Card>
        <DescriptionList
          columns={3}
          items={[
            { label: 'Applicable policy', value: q.data.policy ? `${q.data.policy.name} (age ${q.data.policy.retirementAge})` : 'No adopted policy applies' },
            { label: 'Expected retirement date', value: date(q.data.expectedRetirementDate) },
            { label: 'Review lead time', value: q.data.policy ? `${q.data.policy.reviewLeadMonths} months` : '—' },
          ]}
        />
      </Card>
      <Card padded={false}>
        {q.data.reviews.length ? (
          <ul className="divide-y divide-slate-100">
            {q.data.reviews.map((r) => (
              <li key={r.id}>
                <Link to={`/retirement/${r.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="text-sm">
                    Review for {date(r.deferredUntil ?? r.expectedRetirementDate)} <span className="text-slate-500">· {r.policyName}</span>
                  </span>
                  <StatusBadge status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No retirement reviews" description="Reviews are created automatically by the scheduled retirement scan." />
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Approvals & audit                                                  */
/* ------------------------------------------------------------------ */

export function ApprovalsTab({ employeeId }: { employeeId: string }) {
  const q = useApi<Paged<Approval>>(`/employees/${employeeId}/approvals`);
  if (!q.data) return <Loading q={q} />;
  if (!q.data.items.length) return <EmptyState title="No requests" />;
  return (
    <Card padded={false}>
      <ul className="divide-y divide-slate-100">
        {q.data.items.map((a) => (
          <li key={a.id}>
            <Link to={`/approvals?id=${a.id}&status=all`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{a.summary}</p>
                <p className="text-xs text-slate-500">
                  {label(a.type)} · requested {dateTime(a.requestedAt)} by {a.requesterName ?? 'system'}
                  {a.decidedAt ? ` · decided ${dateTime(a.decidedAt)}${a.deciderName ? ` by ${a.deciderName}` : ''}` : ''}
                </p>
              </div>
              <StatusBadge status={a.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function AuditTab({ employeeId }: { employeeId: string }) {
  const q = useApi<Paged<{ id: number; action: string; outcome: string; occurredAt: string; actorName: string | null; reason: string | null }>>(`/employees/${employeeId}/audit`);
  if (!q.data) return <Loading q={q} />;
  if (!q.data.items.length) return <EmptyState title="No audit entries" />;
  return (
    <Card padded={false}>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Action</Th>
            <Th>Actor</Th>
            <Th className="hidden md:table-cell">Reason</Th>
            <Th>Outcome</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {q.data.items.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-xs">{dateTime(r.occurredAt)}</Td>
              <Td className="font-mono text-xs">{r.action}</Td>
              <Td>{r.actorName ?? 'system'}</Td>
              <Td className="hidden max-w-xs truncate md:table-cell">{r.reason ?? '—'}</Td>
              <Td>
                <StatusBadge status={r.outcome} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
