import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Download, FileStack, Lock, Plus, Search, Wand2 } from 'lucide-react';
import { api, download, errorMessage, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi } from '../../lib/hooks';
import { date, label, money } from '../../lib/format';
import type { Lookups } from '../../lib/types';
import { EmployeePicker } from '../../components/EmployeePicker';
import { useToast } from '../../components/toast';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, FilterBar, Input, Modal, PageHeader, PageLoader, Pagination, Select, StatusBadge, Table, Td, Th } from '../../components/ui';
import type { Period } from './Finance';

interface RecordRow {
  id: string;
  revision: number;
  status: string;
  currency: string;
  basicSalary: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  paymentStatus: string;
  discrepancyFlag: boolean;
  employeeId: string;
  legalName: string;
  employmentNumber: string | null;
  departmentName: string;
  locationName: string | null;
  payslipId: string | null;
}

interface RecordList {
  period: Period;
  items: RecordRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: { gross: number; deductions: number; net: number };
}

function NewRecordModal({ period, onClose }: { period: Period; onClose: () => void }) {
  const navigate = useNavigate();
  const [emp, setEmp] = useState<{ id: string; name: string } | null>(null);
  const create = useAction((employeeId: string) => api.post<{ id: string }>('/payroll/records', { employeeId, periodId: period.id, basicSalary: 0, lineItems: [] }), {
    invalidate: ['/payroll'],
    success: 'Draft record created',
    onSuccess: (r) => navigate(`/finance/records/${r.id}`),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New payroll record"
      description={`Creates a draft for ${period.name}. You cannot prepare your own payroll.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!emp} loading={create.isPending} onClick={() => emp && create.mutate(emp.id)}>
            Create draft
          </Button>
        </>
      }
    >
      <Field label="Employee" required error={create.fieldErrors.employeeId}>
        {(id) => <EmployeePicker id={id} value={emp} onChange={setEmp} />}
      </Field>
    </Modal>
  );
}

export function PayrollPeriodPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const lookups = useApi<Lookups>('/lookups');
  const [f, setF] = useState({ q: '', departmentId: '', status: 'all_live', paymentStatus: '', page: 1 });
  const q = useApi<RecordList>(`/payroll/periods/${id}/records${qs({ ...f, pageSize: 50 })}`, { keepPrevious: true });
  const [creating, setCreating] = useState(false);
  const generate = useAction(() => api.post<{ created: number; skipped: number }>(`/payroll/periods/${id}/generate-drafts`), {
    invalidate: ['/payroll'],
    success: (r) => `${r.created} draft(s) generated from previous approved pay. ${r.skipped} skipped (no prior pay or your own record).`,
  });
  const issue = useAction(() => api.post<{ issued: number }>(`/payroll/periods/${id}/payslips`), { invalidate: ['/payroll'], success: (r) => `${r.issued} payslip(s) issued` });
  const close = useAction(() => api.post(`/payroll/periods/${id}/close`, {}), { invalidate: ['/payroll'], success: 'Period closed' });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { period, items, totals } = q.data;
  const cur = items[0]?.currency ?? 'MWK';
  const open = period.status !== 'closed';
  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, page: 1, ...patch }));

  return (
    <div>
      <PageHeader
        back={{ to: '/finance', label: 'Payroll' }}
        title={period.name}
        description={`${period.code} · ${date(period.startDate)} – ${date(period.endDate)} · pay date ${date(period.payDate)}`}
        actions={
          <>
            <StatusBadge status={period.status} />
            {can('payroll.export') && (
              <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download(`/payroll/periods/${id}/export.csv`, `payroll-${period.code}.csv`).catch((e) => toast.error(errorMessage(e)))}>
                Export CSV
              </Button>
            )}
            {open && can('payroll.prepare') && (
              <>
                <Button variant="secondary" icon={<Wand2 className="size-4" />} loading={generate.isPending} onClick={() => generate.mutate(undefined)}>
                  Generate drafts
                </Button>
                <Button variant="secondary" icon={<FileStack className="size-4" />} loading={issue.isPending} onClick={() => issue.mutate(undefined)}>
                  Issue payslips
                </Button>
                <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  New record
                </Button>
              </>
            )}
            {open && can('payroll.period.manage') && (
              <Button variant="secondary" icon={<Lock className="size-4" />} loading={close.isPending} onClick={() => confirm('Close this period? No further records can be added.') && close.mutate(undefined)}>
                Close period
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">Gross earnings</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{money(totals.gross, cur)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Deductions</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{money(totals.deductions, cur)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Net pay</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-700">{money(totals.net, cur)}</p>
        </Card>
      </div>

      <Card padded={false}>
        <FilterBar>
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search employee…" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Search" />
          </div>
          <Select className="w-auto" value={f.departmentId} onChange={(e) => set({ departmentId: e.target.value })} aria-label="Department">
            <option value="">All departments</option>
            {lookups.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select className="w-auto" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
            <option value="all_live">Current records</option>
            {['draft', 'pending_approval', 'approved', 'superseded'].map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
          <Select className="w-auto" value={f.paymentStatus} onChange={(e) => set({ paymentStatus: e.target.value })} aria-label="Payment status">
            <option value="">Paid & unpaid</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </Select>
        </FilterBar>
        {!items.length ? (
          <EmptyState title="No payroll records" description={open && can('payroll.prepare') ? 'Generate drafts from the previous period or create records individually.' : undefined} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th className="hidden lg:table-cell">Department</Th>
                  <Th>Status</Th>
                  <Th align="right" className="hidden md:table-cell">Gross</Th>
                  <Th align="right" className="hidden md:table-cell">Deductions</Th>
                  <Th align="right">Net</Th>
                  <Th className="hidden sm:table-cell">Payment</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td>
                      <Link to={`/finance/records/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.legalName}
                      </Link>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-mono">{r.employmentNumber}</span>
                        {r.revision > 1 && <span>· rev {r.revision}</span>}
                        {r.discrepancyFlag && <Badge tone="red">Flagged</Badge>}
                      </div>
                    </Td>
                    <Td className="hidden lg:table-cell">{r.departmentName}</Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td align="right" className="hidden tabular-nums md:table-cell">{money(r.grossEarnings, r.currency)}</Td>
                    <Td align="right" className="hidden tabular-nums md:table-cell">{money(r.totalDeductions, r.currency)}</Td>
                    <Td align="right" className="font-medium tabular-nums">{money(r.netPay, r.currency)}</Td>
                    <Td className="hidden sm:table-cell">
                      <StatusBadge status={r.paymentStatus} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setF((s) => ({ ...s, page: p }))} />
          </>
        )}
      </Card>
      {!open && <Alert tone="info" className="mt-4">This period is closed. Corrections to approved records are made through adjustment revisions.</Alert>}
      {creating && <NewRecordModal period={period} onClose={() => setCreating(false)} />}
    </div>
  );
}
