import { useState } from 'react';
import { Link } from 'react-router';
import { Banknote, CheckCircle2, Circle, Download, Scale, Users } from 'lucide-react';
import { api, download, errorMessage, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi } from '../../lib/hooks';
import { date, label, money } from '../../lib/format';
import { useToast } from '../../components/toast';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, Modal, PageLoader, Select, StatCard, StatusBadge, Table, Td, Th } from '../../components/ui';
import type { Period } from './Finance';

const DEDUCTIONS = ['tax', 'pension', 'loan', 'other_deduction'] as const;
type Deduction = (typeof DEDUCTIONS)[number];

function CsvButton({ path, name }: { path: string; name: string }) {
  const { can } = useAuth();
  const toast = useToast();
  if (!can('payroll.export')) return null;
  return (
    <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={() => download(path, name).catch((e) => toast.error(errorMessage(e)))}>
      CSV
    </Button>
  );
}

function ApprovedOnlyNote({ count }: { count: number }) {
  return (
    <p className="text-xs text-slate-500">
      Based on {count} approved record{count === 1 ? '' : 's'}. Drafts and records awaiting approval are not included until they are approved.
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Close checklist and pay run                                        */
/* ------------------------------------------------------------------ */

interface Checklist {
  period: Period;
  currency: string;
  activeEmployees: number;
  records: {
    draft: number;
    pending: number;
    approved: number;
    superseded: number;
  };
  flagged: number;
  unpaidApproved: number;
  unpaidNet: number;
  approvedNet: number;
  payslipsMissing: number;
  missing: {
    count: number;
    items: {
      id: string;
      legalName: string;
      employmentNumber: string | null;
      departmentName: string;
    }[];
  };
  steps: {
    key: string;
    label: string;
    done: boolean;
    detail: string | null;
    blocksClose: boolean;
  }[];
  readyToClose: boolean;
}

function PayRunModal({ period, due, net, currency, onClose }: { period: Period; due: number; net: number; currency: string; onClose: () => void }) {
  const [paymentDate, setPaymentDate] = useState(period.payDate);
  const run = useAction((body: { paymentDate: string }) => api.post<{ paid: number; netPay: number }>(`/payroll/periods/${period.id}/pay-run`, body), {
    invalidate: ['/payroll'],
    success: (r) => `${r.paid} record(s) marked paid`,
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Record pay run"
      description={`Marks every approved, unpaid record in ${period.name} as paid on the date below. Payslips already issued keep their own figures.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={run.isPending} onClick={() => run.mutate({ paymentDate })}>
            Mark {due} record{due === 1 ? '' : 's'} paid
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          Total to pay: <span className="font-semibold tabular-nums">{money(net, currency)}</span>
        </p>
        <Field label="Payment date" required error={run.fieldErrors.paymentDate}>
          {(id) => <Input id={id} type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export function ChecklistTab({ periodId }: { periodId: string }) {
  const { can } = useAuth();
  const q = useApi<Checklist>(`/payroll/periods/${periodId}/checklist`);
  const [paying, setPaying] = useState(false);
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Records"
          value={d.records.approved + d.records.pending + d.records.draft}
          hint={`${d.records.approved} approved · ${d.records.pending} pending · ${d.records.draft} draft`}
          icon={<Users className="size-5" />}
        />
        <StatCard label="Without a record" value={d.missing.count} hint={`${d.activeEmployees} current employees`} tone={d.missing.count ? 'amber' : 'green'} icon={<Users className="size-5" />} />
        <StatCard label="Approved, unpaid" value={d.unpaidApproved} hint={money(d.unpaidNet, d.currency)} tone={d.unpaidApproved ? 'amber' : 'green'} icon={<Banknote className="size-5" />} />
        <StatCard
          label="Payslips to issue"
          value={d.payslipsMissing}
          hint={`${money(d.approvedNet, d.currency)} approved net`}
          tone={d.payslipsMissing ? 'amber' : 'green'}
          icon={<CheckCircle2 className="size-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Period-end checklist"
            description="Steps marked required must be complete before the period can be closed."
            actions={
              <div className="flex gap-2">
                <CsvButton path={`/payroll/periods/${periodId}/register.csv`} name={`payroll-register-${d.period.code}.csv`} />
                {can('payroll.prepare') && d.unpaidApproved > 0 && (
                  <Button size="sm" icon={<Banknote className="size-4" />} onClick={() => setPaying(true)}>
                    Record pay run
                  </Button>
                )}
              </div>
            }
          />
          <ul className="divide-y divide-slate-100">
            {d.steps.map((s) => (
              <li key={s.key} className="flex items-start gap-3 py-3 text-sm first:pt-0 last:pb-0">
                {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-label="Done" /> : <Circle className="mt-0.5 size-5 shrink-0 text-slate-300" aria-label="Not done" />}
                <div className="min-w-0 flex-1">
                  <p className={s.done ? 'text-slate-700' : 'font-medium text-slate-900'}>{s.label}</p>
                  {s.detail && <p className="text-xs text-slate-500">{s.detail}</p>}
                </div>
                {s.blocksClose && <Badge tone={s.done ? 'gray' : 'amber'}>Required to close</Badge>}
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-slate-100 pt-4">
            {d.period.status === 'closed' ? (
              <Alert tone="info">This period is closed.</Alert>
            ) : d.readyToClose ? (
              <Alert tone="success">Nothing blocks closing this period.</Alert>
            ) : (
              <Alert tone="warning">Finish the required steps before closing. The CSV register lists every record with each earning and deduction in its own column for checking.</Alert>
            )}
          </div>
        </Card>
        <Card padded={false} className="lg:col-span-2">
          <div className="p-5 pb-0">
            <CardHeader title="Employees without a record" description="Current employees with no draft, pending or approved record in this period." />
          </div>
          {!d.missing.count ? (
            <EmptyState title="Everyone is covered" />
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {d.missing.items.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <Link to={`/employees/${m.id}`} className="font-medium text-brand-700 hover:underline">
                    {m.legalName}
                  </Link>
                  <span className="text-xs text-slate-500">
                    <span className="font-mono">{m.employmentNumber}</span> · {m.departmentName}
                  </span>
                </li>
              ))}
              {d.missing.count > d.missing.items.length && <li className="px-5 py-2.5 text-xs text-slate-500">and {d.missing.count - d.missing.items.length} more</li>}
            </ul>
          )}
        </Card>
      </div>
      {paying && <PayRunModal period={d.period} due={d.unpaidApproved} net={d.unpaidNet} currency={d.currency} onClose={() => setPaying(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Remittances                                                        */
/* ------------------------------------------------------------------ */

interface Remittances {
  period: Period;
  currency: string;
  approvedRecords: number;
  totalDeductions: number;
  categories: {
    category: Deduction;
    account: string;
    total: number;
    employees: number;
    lines: { label: string; total: number; employees: number }[];
  }[];
  employees: {
    employeeId: string;
    legalName: string;
    employmentNumber: string | null;
    departmentName: string;
    byCategory: Record<Deduction, number>;
    total: number;
  }[];
}

export function RemittancesTab({ periodId }: { periodId: string }) {
  const q = useApi<Remittances>(`/payroll/periods/${periodId}/remittances`);
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ApprovedOnlyNote count={d.approvedRecords} />
        <CsvButton path={`/payroll/periods/${periodId}/remittances.csv`} name={`remittances-${d.period.code}.csv`} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {d.categories.map((c) => (
          <StatCard
            key={c.category}
            label={label(c.category)}
            value={money(c.total, d.currency)}
            hint={c.employees ? `${c.employees} employee${c.employees === 1 ? '' : 's'} · ${c.account}` : 'Nothing deducted'}
            tone={c.total ? 'brand' : 'green'}
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Amounts to remit" description="Deductions grouped by the label used on payroll records, so each payee can be paid in one amount." />
          </div>
          {!d.totalDeductions ? (
            <EmptyState title="No deductions approved yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Deduction</Th>
                  <Th>Category</Th>
                  <Th align="right">Employees</Th>
                  <Th align="right">Amount</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {d.categories.flatMap((c) =>
                  c.lines.map((l) => (
                    <tr key={`${c.category}:${l.label}`}>
                      <Td className="font-medium text-slate-900">{l.label}</Td>
                      <Td>
                        <Badge>{label(c.category)}</Badge>
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {l.employees}
                      </Td>
                      <Td align="right" className="tabular-nums">
                        {money(l.total, d.currency)}
                      </Td>
                    </tr>
                  )),
                )}
                <tr className="bg-slate-50 font-semibold">
                  <Td colSpan={3}>Total deductions</Td>
                  <Td align="right" className="tabular-nums">
                    {money(d.totalDeductions, d.currency)}
                  </Td>
                </tr>
              </tbody>
            </Table>
          )}
        </Card>
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="By employee" description="What was withheld from each approved record." />
          </div>
          {!d.employees.length ? (
            <EmptyState title="No approved records" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  {DEDUCTIONS.map((c) => (
                    <Th key={c} align="right" className="hidden md:table-cell">
                      {label(c)}
                    </Th>
                  ))}
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {d.employees.map((e) => (
                  <tr key={e.employeeId}>
                    <Td>
                      <span className="font-medium text-slate-900">{e.legalName}</span>
                      <span className="block font-mono text-xs text-slate-500">{e.employmentNumber}</span>
                    </Td>
                    {DEDUCTIONS.map((c) => (
                      <Td key={c} align="right" className="hidden tabular-nums md:table-cell">
                        {e.byCategory[c] ? money(e.byCategory[c], d.currency) : '—'}
                      </Td>
                    ))}
                    <Td align="right" className="font-medium tabular-nums">
                      {money(e.total, d.currency)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cost allocation                                                    */
/* ------------------------------------------------------------------ */

interface AllocationGroup {
  id: string | null;
  name: string;
  employees: number;
  basic: number;
  otherEarnings: number;
  gross: number;
  deductions: number;
  net: number;
}
interface Allocation {
  period: Period;
  currency: string;
  approvedRecords: number;
  byDepartment: AllocationGroup[];
  byLocation: AllocationGroup[];
  totals: Omit<AllocationGroup, 'id' | 'name' | 'employees'>;
}

function AllocationTable({
  title,
  description,
  rows,
  totals,
  count,
  currency,
}: {
  title: string;
  description: string;
  rows: AllocationGroup[];
  totals: Allocation['totals'];
  count: number;
  currency: string;
}) {
  return (
    <Card padded={false}>
      <div className="p-5 pb-0">
        <CardHeader title={title} description={description} />
      </div>
      {!rows.length ? (
        <EmptyState title="No approved records" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Cost centre</Th>
              <Th align="right">Staff</Th>
              <Th align="right" className="hidden md:table-cell">
                Basic
              </Th>
              <Th align="right" className="hidden md:table-cell">
                Other earnings
              </Th>
              <Th align="right">Gross</Th>
              <Th align="right" className="hidden sm:table-cell">
                Deductions
              </Th>
              <Th align="right">Net</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((g) => (
              <tr key={g.id ?? 'none'}>
                <Td className="font-medium text-slate-900">{g.name}</Td>
                <Td align="right" className="tabular-nums">
                  {g.employees}
                </Td>
                <Td align="right" className="hidden tabular-nums md:table-cell">
                  {money(g.basic, currency)}
                </Td>
                <Td align="right" className="hidden tabular-nums md:table-cell">
                  {money(g.otherEarnings, currency)}
                </Td>
                <Td align="right" className="tabular-nums">
                  {money(g.gross, currency)}
                </Td>
                <Td align="right" className="hidden tabular-nums sm:table-cell">
                  {money(g.deductions, currency)}
                </Td>
                <Td align="right" className="font-medium tabular-nums">
                  {money(g.net, currency)}
                </Td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-semibold">
              <Td>Total</Td>
              <Td align="right" className="tabular-nums">
                {count}
              </Td>
              <Td align="right" className="hidden tabular-nums md:table-cell">
                {money(totals.basic, currency)}
              </Td>
              <Td align="right" className="hidden tabular-nums md:table-cell">
                {money(totals.otherEarnings, currency)}
              </Td>
              <Td align="right" className="tabular-nums">
                {money(totals.gross, currency)}
              </Td>
              <Td align="right" className="hidden tabular-nums sm:table-cell">
                {money(totals.deductions, currency)}
              </Td>
              <Td align="right" className="tabular-nums">
                {money(totals.net, currency)}
              </Td>
            </tr>
          </tbody>
        </Table>
      )}
    </Card>
  );
}

export function AllocationTab({ periodId }: { periodId: string }) {
  const q = useApi<Allocation>(`/payroll/periods/${periodId}/allocation`);
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ApprovedOnlyNote count={d.approvedRecords} />
        <CsvButton path={`/payroll/periods/${periodId}/allocation.csv`} name={`cost-allocation-${d.period.code}.csv`} />
      </div>
      <AllocationTable title="By department" description="Staff cost charged to each department." rows={d.byDepartment} totals={d.totals} count={d.approvedRecords} currency={d.currency} />
      <AllocationTable
        title="By parish or station"
        description="Staff cost by the employee's assigned location."
        rows={d.byLocation}
        totals={d.totals}
        count={d.approvedRecords}
        currency={d.currency}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Salaries journal                                                   */
/* ------------------------------------------------------------------ */

interface Journal {
  period: Period;
  currency: string;
  approvedRecords: number;
  lines: {
    account: string;
    costCentre: string | null;
    debit: number;
    credit: number;
  }[];
  totals: { debit: number; credit: number };
  balanced: boolean;
}

export function JournalTab({ periodId }: { periodId: string }) {
  const q = useApi<Journal>(`/payroll/periods/${periodId}/journal`);
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ApprovedOnlyNote count={d.approvedRecords} />
        <div className="flex items-center gap-2">
          {d.lines.length > 0 && (
            <Badge tone={d.balanced ? 'green' : 'red'} className="gap-1">
              <Scale className="size-3" /> {d.balanced ? 'Balanced' : 'Out of balance'}
            </Badge>
          )}
          <CsvButton path={`/payroll/periods/${periodId}/journal.csv`} name={`salaries-journal-${d.period.code}.csv`} />
        </div>
      </div>
      <Card padded={false}>
        <div className="p-5 pb-0">
          <CardHeader
            title={`Salaries journal · ${d.period.name}`}
            description="Staff cost is debited to each department. Deductions and net pay are credited as amounts payable. Map the account names to your chart of accounts when posting."
          />
        </div>
        {!d.lines.length ? (
          <EmptyState title="Nothing to post yet" description="Journal lines appear once records in this period are approved." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th className="hidden sm:table-cell">Cost centre</Th>
                <Th align="right">Debit</Th>
                <Th align="right">Credit</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <Td className="font-medium text-slate-900">{l.account}</Td>
                  <Td className="hidden sm:table-cell">{l.costCentre ?? '—'}</Td>
                  <Td align="right" className="tabular-nums">
                    {l.debit ? money(l.debit, d.currency) : ''}
                  </Td>
                  <Td align="right" className="tabular-nums">
                    {l.credit ? money(l.credit, d.currency) : ''}
                  </Td>
                </tr>
              ))}
              <tr className="bg-slate-50 font-semibold">
                <Td colSpan={2}>Total</Td>
                <Td align="right" className="tabular-nums">
                  {money(d.totals.debit, d.currency)}
                </Td>
                <Td align="right" className="tabular-nums">
                  {money(d.totals.credit, d.currency)}
                </Td>
              </tr>
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Variance                                                           */
/* ------------------------------------------------------------------ */

type Flag = 'new' | 'missing' | 'left' | 'increase' | 'decrease' | null;
interface Variance {
  period: Period;
  previous: Period | null;
  currency: string;
  threshold: number;
  summary: {
    current: { records: number; net: number; gross: number };
    previous: { records: number; net: number; gross: number };
    deltaNet: number;
    flagged: number;
  };
  items: {
    employeeId: string;
    legalName: string;
    employmentNumber: string | null;
    departmentName: string;
    currentRecordId: string | null;
    currentStatus: string | null;
    currentNet: number | null;
    previousNet: number | null;
    deltaNet: number | null;
    pct: number | null;
    flag: Flag;
  }[];
}

const FLAGS: Record<NonNullable<Flag>, { text: string; tone: 'blue' | 'red' | 'gray' | 'amber' | 'violet' }> = {
  new: { text: 'New this period', tone: 'blue' },
  missing: { text: 'No record yet', tone: 'red' },
  left: { text: 'No longer employed', tone: 'gray' },
  increase: { text: 'Up', tone: 'amber' },
  decrease: { text: 'Down', tone: 'violet' },
};

export function VarianceTab({ periodId }: { periodId: string }) {
  const [threshold, setThreshold] = useState(10);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const q = useApi<Variance>(`/payroll/periods/${periodId}/variance${qs({ threshold })}`, { keepPrevious: true });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const rows = flaggedOnly ? d.items.filter((i) => i.flag) : d.items;
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n), d.currency)}`;
  return (
    <div className="space-y-6">
      {!d.previous && <Alert tone="info">There is no earlier period to compare with, so every record shows as new.</Alert>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`Net · ${d.period.name}`} value={money(d.summary.current.net, d.currency)} hint={`${d.summary.current.records} current record(s), including drafts`} />
        <StatCard
          label={d.previous ? `Net · ${d.previous.name}` : 'Previous period'}
          value={d.previous ? money(d.summary.previous.net, d.currency) : '—'}
          hint={d.previous ? `${d.summary.previous.records} approved record(s)` : undefined}
        />
        <StatCard label="Change in net pay" value={signed(d.summary.deltaNet)} tone={d.summary.deltaNet > 0 ? 'amber' : d.summary.deltaNet < 0 ? 'violet' : 'green'} />
        <StatCard label="To check" value={d.summary.flagged} hint={`Changes of ${d.threshold}% or more, new people and missing records`} tone={d.summary.flagged ? 'amber' : 'green'} />
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
          <Field label="Flag changes of at least">
            {(id) => (
              <Select id={id} className="w-auto" value={String(threshold)} onChange={(e) => setThreshold(Number(e.target.value))}>
                {[5, 10, 20, 50].map((t) => (
                  <option key={t} value={t}>
                    {t}%
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="pb-2">
            <Checkbox checked={flaggedOnly} onChange={setFlaggedOnly} label="Show only items to check" />
          </div>
        </div>
        {!rows.length ? (
          <EmptyState title={flaggedOnly ? 'Nothing to check' : 'No records'} description={flaggedOnly ? 'Every record is within the threshold of last period.' : undefined} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th className="hidden lg:table-cell">Department</Th>
                <Th align="right" className="hidden md:table-cell">
                  Previous net
                </Th>
                <Th align="right">Current net</Th>
                <Th align="right" className="hidden sm:table-cell">
                  Change
                </Th>
                <Th>Check</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((i) => (
                <tr key={i.employeeId} className={i.flag ? 'bg-amber-50/40' : undefined}>
                  <Td>
                    {i.currentRecordId ? (
                      <Link to={`/finance/records/${i.currentRecordId}`} className="font-medium text-brand-700 hover:underline">
                        {i.legalName}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-900">{i.legalName}</span>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <span className="font-mono">{i.employmentNumber}</span>
                      {i.currentStatus && i.currentStatus !== 'approved' && <StatusBadge status={i.currentStatus} />}
                    </div>
                  </Td>
                  <Td className="hidden lg:table-cell">{i.departmentName}</Td>
                  <Td align="right" className="hidden tabular-nums md:table-cell">
                    {i.previousNet === null ? '—' : money(i.previousNet, d.currency)}
                  </Td>
                  <Td align="right" className="font-medium tabular-nums">
                    {i.currentNet === null ? '—' : money(i.currentNet, d.currency)}
                  </Td>
                  <Td align="right" className="hidden tabular-nums sm:table-cell">
                    {i.deltaNet === null ? '—' : signed(i.deltaNet)}
                    {i.pct !== null && (
                      <span className="block text-xs text-slate-500">
                        {i.pct > 0 ? '+' : ''}
                        {i.pct}%
                      </span>
                    )}
                  </Td>
                  <Td>{i.flag ? <Badge tone={FLAGS[i.flag].tone}>{FLAGS[i.flag].text}</Badge> : <span className="text-xs text-slate-400">Within {d.threshold}%</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {d.previous && (
        <p className="text-xs text-slate-500">
          Compared with approved records for {d.previous.name} ({date(d.previous.startDate)} – {date(d.previous.endDate)}). Current figures use the latest revision of each record, including drafts.
        </p>
      )}
    </div>
  );
}
