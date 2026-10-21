import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BadgeCheck, CircleDollarSign, FilePlus2, FileText, GitBranch, Plus, Send, Trash2, Undo2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
import { date, dateTime, label, minorToInput, money, parseMoney, todayIso } from '../../lib/format';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, DescriptionList, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, StatusBadge, Textarea } from '../../components/ui';
import type { Period } from './Finance';

const EARNING = ['allowance', 'bonus', 'overtime', 'other_earning'];
const DEDUCTION = ['tax', 'pension', 'loan', 'other_deduction'];

interface LineItem {
  id?: string;
  kind: 'earning' | 'deduction';
  category: string;
  label: string;
  amount: number;
}

interface RecordDetail {
  id: string;
  revision: number;
  status: string;
  currency: string;
  basicSalary: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  paymentStatus: string;
  paymentDate: string | null;
  discrepancyFlag: boolean;
  discrepancyNote: string | null;
  notes: string | null;
  adjustmentReason: string | null;
  supersedesId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  preparedByName: string | null;
  approvedByName: string | null;
  employeeId: string;
  legalName: string;
  employmentNumber: string | null;
  departmentName: string;
  payslipId: string | null;
  period: Period;
  lineItems: LineItem[];
  revisions: { id: string; revision: number; status: string; netPay: number; adjustmentReason: string | null }[];
  can: { edit: boolean; submit: boolean; approve: boolean; adjust: boolean; markPaid: boolean; issuePayslip: boolean; delete: boolean };
}

type EditItem = { kind: 'earning' | 'deduction'; category: string; label: string; amount: string };

function ReasonModal({ title, description, confirmLabel, variant = 'primary', minLength = 3, extra, onSubmit, onClose, loading }: {
  title: string;
  description?: string;
  confirmLabel: string;
  variant?: 'primary' | 'danger';
  minLength?: number;
  extra?: ReactNode;
  onSubmit: (reason: string) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={variant} onClick={() => onSubmit(reason)} loading={loading} disabled={reason.trim().length < minLength}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {extra}
        <Field label="Reason" required hint={`At least ${minLength} characters`}>
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export function PayrollRecordPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useApi<RecordDetail>(`/payroll/records/${id}`);
  const [basic, setBasic] = useState('0.00');
  const [items, setItems] = useState<EditItem[]>([]);
  const [notes, setNotes] = useState('');
  const [flag, setFlag] = useState(false);
  const [flagNote, setFlagNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [modal, setModal] = useState<'reject' | 'adjust' | 'paid' | null>(null);
  const [paidOn, setPaidOn] = useState(todayIso());

  useEffect(() => {
    if (!q.data) return;
    setBasic(minorToInput(q.data.basicSalary));
    setItems(q.data.lineItems.map((li) => ({ kind: li.kind, category: li.category, label: li.label, amount: minorToInput(li.amount) })));
    setNotes(q.data.notes ?? '');
    setFlag(q.data.discrepancyFlag);
    setFlagNote(q.data.discrepancyNote ?? '');
    setDirty(false);
  }, [q.data]);

  const inv = ['/payroll', '/approvals', '/dashboard', '/employees'];
  const save = useAction((body: unknown) => api.put(`/payroll/records/${id}`, body), { invalidate: inv, success: 'Draft saved', onSuccess: () => setDirty(false) });
  const submit = useAction(() => api.post(`/payroll/records/${id}/submit`), { invalidate: inv, success: 'Submitted for approval' });
  const approve = useAction(() => api.post(`/payroll/records/${id}/approve`, {}), { invalidate: inv, success: 'Payroll record approved' });
  const reject = useAction((reason: string) => api.post(`/payroll/records/${id}/reject`, { reason }), { invalidate: inv, success: 'Returned to preparer', onSuccess: () => setModal(null) });
  const adjust = useAction((reason: string) => api.post<{ id: string }>(`/payroll/records/${id}/adjust`, { reason }), {
    invalidate: inv,
    success: 'Adjustment revision created',
    onSuccess: (r) => (setModal(null), navigate(`/finance/records/${r.id}`)),
  });
  const markPaid = useAction((paymentDate: string) => api.post(`/payroll/records/${id}/mark-paid`, { paymentDate }), { invalidate: inv, success: 'Marked as paid', onSuccess: () => setModal(null) });
  const issue = useAction(() => api.post<{ id: string }>(`/payroll/records/${id}/payslip`), { invalidate: inv, success: 'Payslip issued' });
  const remove = useAction(() => api.del(`/payroll/records/${id}`), { invalidate: inv, success: 'Draft deleted', onSuccess: () => navigate(`/finance/periods/${q.data?.period.id}`) });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  const cur = r.currency;
  const editable = r.can.edit;

  const parsedBasic = parseMoney(basic);
  const parsedItems = items.map((i) => ({ ...i, value: parseMoney(i.amount) }));
  const invalid = parsedBasic === null || parsedItems.some((i) => i.value === null || !i.label.trim());
  const earnings = parsedItems.filter((i) => i.kind === 'earning').reduce((s, i) => s + (i.value ?? 0), 0);
  const deductions = parsedItems.filter((i) => i.kind === 'deduction').reduce((s, i) => s + (i.value ?? 0), 0);
  const gross = (parsedBasic ?? 0) + earnings;
  const net = gross - deductions;

  const updateItem = (idx: number, patch: Partial<EditItem>) => {
    setItems((list) => list.map((it, i) => (i === idx ? { ...it, ...patch, ...(patch.kind ? { category: patch.kind === 'earning' ? EARNING[0] : DEDUCTION[0] } : {}) } : it)));
    setDirty(true);
  };

  const doSave = () =>
    save.mutate({
      basicSalary: parsedBasic,
      lineItems: parsedItems.map((i) => ({ kind: i.kind, category: i.category, label: i.label.trim(), amount: i.value })),
      notes: notes || null,
      discrepancyFlag: flag,
      discrepancyNote: flagNote || null,
    });

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: `/finance/periods/${r.period.id}`, label: r.period.name }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.legalName}
            <StatusBadge status={r.status} />
            {r.revision > 1 && <Badge tone="violet">Revision {r.revision}</Badge>}
          </span>
        }
        description={`${r.employmentNumber ?? ''} · ${r.departmentName} · ${r.period.name}`}
        actions={
          <>
            {r.can.delete && (
              <Button variant="ghost" icon={<Trash2 className="size-4 text-red-600" />} onClick={() => confirm('Delete this draft record?') && remove.mutate(undefined)}>
                Delete draft
              </Button>
            )}
            {editable && (
              <Button variant="secondary" onClick={doSave} loading={save.isPending} disabled={invalid || !dirty}>
                Save draft
              </Button>
            )}
            {r.can.submit && (
              <Button icon={<Send className="size-4" />} onClick={() => submit.mutate(undefined)} loading={submit.isPending} disabled={dirty}>
                Submit for approval
              </Button>
            )}
            {r.status === 'pending_approval' && r.can.approve && (
              <>
                <Button variant="danger" icon={<Undo2 className="size-4" />} onClick={() => setModal('reject')}>
                  Return
                </Button>
                <Button variant="success" icon={<BadgeCheck className="size-4" />} onClick={() => confirm('Approve this payroll record? It will become immutable.') && approve.mutate(undefined)} loading={approve.isPending}>
                  Approve
                </Button>
              </>
            )}
            {r.can.markPaid && (
              <Button variant="secondary" icon={<CircleDollarSign className="size-4" />} onClick={() => setModal('paid')}>
                Mark paid
              </Button>
            )}
            {r.can.issuePayslip && (
              <Button variant="secondary" icon={<FilePlus2 className="size-4" />} onClick={() => issue.mutate(undefined)} loading={issue.isPending}>
                Issue payslip
              </Button>
            )}
            {r.payslipId && (
              <Button variant="secondary" icon={<FileText className="size-4" />} onClick={() => navigate(`/payslips/${r.payslipId}`)}>
                View payslip
              </Button>
            )}
            {r.can.adjust && (
              <Button variant="secondary" icon={<GitBranch className="size-4" />} onClick={() => setModal('adjust')}>
                Adjust
              </Button>
            )}
          </>
        }
      />

      {r.status === 'pending_approval' && !r.can.approve && (
        <Alert tone="info">Awaiting approval by a second finance officer. The preparer cannot approve their own work.</Alert>
      )}
      {r.status === 'approved' && <Alert tone="success">This record is approved and locked. Corrections are made by creating an adjustment revision.</Alert>}
      {r.status === 'superseded' && <Alert tone="warning">This record has been superseded by a later approved revision.</Alert>}
      {r.adjustmentReason && <Alert tone="info" title="Adjustment reason">{r.adjustmentReason}</Alert>}
      {r.discrepancyFlag && r.discrepancyNote && <Alert tone="warning" title="Flagged for review">{r.discrepancyNote}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Pay components" description={editable ? 'Enter amounts in ' + cur + '. Totals are recalculated by the server when you save.' : undefined} />
          <div className="space-y-5">
            <Field label="Basic salary">
              {(fid) => <Input id={fid} inputMode="decimal" value={basic} disabled={!editable} onChange={(e) => (setBasic(e.target.value), setDirty(true))} invalid={parsedBasic === null} className="max-w-xs tabular-nums" />}
            </Field>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Earnings & deductions</p>
                {editable && (
                  <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => (setItems((l) => [...l, { kind: 'earning', category: 'allowance', label: '', amount: '0.00' }]), setDirty(true))}>
                    Add line
                  </Button>
                )}
              </div>
              {items.length === 0 ? (
                <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No additional line items.</p>
              ) : (
                <div className="space-y-2">
                  {items.map((it, idx) => (
                    <div key={idx} className="grid grid-cols-2 gap-2 rounded-md bg-slate-50 p-2 sm:grid-cols-[110px_150px_1fr_130px_auto]">
                      <Select value={it.kind} disabled={!editable} onChange={(e) => updateItem(idx, { kind: e.target.value as EditItem['kind'] })} aria-label="Type">
                        <option value="earning">Earning</option>
                        <option value="deduction">Deduction</option>
                      </Select>
                      <Select value={it.category} disabled={!editable} onChange={(e) => updateItem(idx, { category: e.target.value })} aria-label="Category">
                        {(it.kind === 'earning' ? EARNING : DEDUCTION).map((c) => (
                          <option key={c} value={c}>
                            {label(c)}
                          </option>
                        ))}
                      </Select>
                      <Input value={it.label} disabled={!editable} placeholder="Description" onChange={(e) => updateItem(idx, { label: e.target.value })} invalid={!it.label.trim()} aria-label="Description" />
                      <Input value={it.amount} disabled={!editable} inputMode="decimal" onChange={(e) => updateItem(idx, { amount: e.target.value })} invalid={parseMoney(it.amount) === null} className="tabular-nums" aria-label="Amount" />
                      {editable && (
                        <Button variant="ghost" size="sm" aria-label="Remove line" icon={<Trash2 className="size-4" />} onClick={() => (setItems((l) => l.filter((_, i) => i !== idx)), setDirty(true))} />
                      )}
                    </div>
                  ))}
                </div>
              )}
              {save.fieldErrors.lineItems && <p className="mt-1 text-xs text-red-600">{save.fieldErrors.lineItems}</p>}
            </div>
            {editable && (
              <>
                <Field label="Internal notes">
                  {(fid) => <Textarea id={fid} rows={2} value={notes} onChange={(e) => (setNotes(e.target.value), setDirty(true))} />}
                </Field>
                <Checkbox checked={flag} onChange={(v) => (setFlag(v), setDirty(true))} label="Flag a discrepancy for review" />
                {flag && (
                  <Field label="Discrepancy note">
                    {(fid) => <Input id={fid} value={flagNote} onChange={(e) => (setFlagNote(e.target.value), setDirty(true))} />}
                  </Field>
                )}
              </>
            )}
            {!editable && r.notes && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes</p>
                <p className="mt-1 text-sm">{r.notes}</p>
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Totals" description={editable && dirty ? 'Preview — save to confirm' : undefined} />
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Basic salary</dt>
                <dd className="tabular-nums">{money(editable ? parsedBasic ?? 0 : r.basicSalary, cur)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Gross earnings</dt>
                <dd className="tabular-nums">{money(editable ? gross : r.grossEarnings, cur)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Total deductions</dt>
                <dd className="tabular-nums">−{money(editable ? deductions : r.totalDeductions, cur)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2.5 text-base font-semibold">
                <dt>Net pay</dt>
                <dd className={(editable ? net : r.netPay) < 0 ? 'text-red-600 tabular-nums' : 'text-emerald-700 tabular-nums'}>{money(editable ? net : r.netPay, cur)}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Workflow" />
            <DescriptionList
              columns={1}
              items={[
                { label: 'Prepared by', value: r.preparedByName ?? '—' },
                { label: 'Submitted', value: r.submittedAt ? dateTime(r.submittedAt) : '—' },
                { label: 'Approved by', value: r.approvedByName ? `${r.approvedByName} · ${dateTime(r.approvedAt)}` : '—' },
                { label: 'Payment', value: <span className="flex items-center gap-2"><StatusBadge status={r.paymentStatus} /> {date(r.paymentDate)}</span> },
              ]}
            />
          </Card>
          {r.revisions.length > 1 && (
            <Card>
              <CardHeader title="Revisions" />
              <ul className="space-y-2 text-sm">
                {r.revisions.map((rv) => (
                  <li key={rv.id} className="flex items-center justify-between gap-2">
                    <Link to={`/finance/records/${rv.id}`} className={rv.id === r.id ? 'font-semibold' : 'text-brand-700 hover:underline'}>
                      Revision {rv.revision}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums text-slate-600">{money(rv.netPay, cur)}</span>
                      <StatusBadge status={rv.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {modal === 'reject' && <ReasonModal title="Return for correction" confirmLabel="Return record" variant="danger" onSubmit={(x) => reject.mutate(x)} onClose={() => setModal(null)} loading={reject.isPending} />}
      {modal === 'adjust' && (
        <ReasonModal
          title="Create adjustment revision"
          description="A new draft revision is created from this record. The approved original stays in force until the revision is approved."
          confirmLabel="Create revision"
          minLength={5}
          onSubmit={(x) => adjust.mutate(x)}
          onClose={() => setModal(null)}
          loading={adjust.isPending}
        />
      )}
      {modal === 'paid' && (
        <Modal
          open
          onClose={() => setModal(null)}
          size="sm"
          title="Mark as paid"
          footer={
            <>
              <Button variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button onClick={() => markPaid.mutate(paidOn)} loading={markPaid.isPending}>
                Confirm payment
              </Button>
            </>
          }
        >
          <Field label="Payment date" required>
            {(fid) => <Input id={fid} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
          </Field>
        </Modal>
      )}
    </div>
  );
}
