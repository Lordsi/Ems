import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AlertCircle, Banknote, CalendarRange, CheckCircle2, Clock, Hourglass, Plus, Users } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi } from '../../lib/hooks';
import { date, money } from '../../lib/format';
import type { Lookups } from '../../lib/types';
import { Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, StatCard, StatusBadge, Table, Td, Th } from '../../components/ui';

export interface Period {
  id: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  payDate: string;
  status: string;
  counts?: { draft: number; pending: number; approved: number };
  approvedNet?: number;
}

interface Summary {
  currency: string;
  activeEmployees: number;
  byDepartment: { id: string; name: string; n: number }[];
  byLocation: { id: string | null; name: string | null; n: number }[];
  periods: Period[];
  payroll: null | {
    period: Period;
    records: number;
    byStatus: Record<string, number>;
    paid: number;
    gross: number;
    deductions: number;
    net: number;
    approvedNet: number;
    missing: number;
  };
  retirement: null | { upcoming: number; reviewRequired: number; pendingApproval: number; verifiedLiability: number; estimatedLiability: number };
}

function NewPeriodModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ code: '', name: '', startDate: '', endDate: '', payDate: '' });
  const create = useAction((body: typeof f) => api.post<Period>('/payroll/periods', body), {
    invalidate: ['/payroll'],
    success: 'Payroll period created',
    onSuccess: (p) => navigate(`/finance/periods/${p.id}`),
  });
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Modal
      open
      onClose={onClose}
      title="New payroll period"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate(f)} loading={create.isPending}>
            Create period
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required hint="e.g. 2026-10" error={create.fieldErrors.code}>
          {(id) => <Input id={id} {...bind('code')} />}
        </Field>
        <Field label="Name" required hint="e.g. October 2026" error={create.fieldErrors.name}>
          {(id) => <Input id={id} {...bind('name')} />}
        </Field>
        <Field label="Start date" required error={create.fieldErrors.startDate}>
          {(id) => <Input id={id} type="date" {...bind('startDate')} />}
        </Field>
        <Field label="End date" required error={create.fieldErrors.endDate}>
          {(id) => <Input id={id} type="date" {...bind('endDate')} />}
        </Field>
        <Field label="Pay date" required error={create.fieldErrors.payDate}>
          {(id) => <Input id={id} type="date" {...bind('payDate')} />}
        </Field>
      </div>
    </Modal>
  );
}

export function FinancePage() {
  const { can } = useAuth();
  const lookups = useApi<Lookups>('/lookups');
  const [filters, setFilters] = useState({ periodId: '', departmentId: '', locationId: '' });
  const [creating, setCreating] = useState(false);
  const summary = useApi<Summary>(`/payroll/summary${qs(filters)}`, { keepPrevious: true });
  const periods = useApi<Period[]>('/payroll/periods');

  if (summary.isLoading) return <PageLoader />;
  if (summary.error || !summary.data) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;
  const s = summary.data;
  const cur = s.currency;
  const p = s.payroll;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll & finance"
        description="Payroll preparation, approval and payslips. Amounts are stored in minor units and totals are calculated by the server."
        actions={
          can('payroll.period.manage') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New period
            </Button>
          )
        }
      />

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Select className="w-auto" value={filters.periodId} onChange={(e) => setFilters({ ...filters, periodId: e.target.value })} aria-label="Payroll period">
            <option value="">Latest period</option>
            {s.periods.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
          <Select className="w-auto" value={filters.departmentId} onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })} aria-label="Department">
            <option value="">All departments</option>
            {lookups.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select className="w-auto" value={filters.locationId} onChange={(e) => setFilters({ ...filters, locationId: e.target.value })} aria-label="Location">
            <option value="">All locations</option>
            {lookups.data?.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active employees" value={s.activeEmployees} icon={<Users className="size-5" />} />
        <StatCard label={p ? `Net payroll · ${p.period.name}` : 'Net payroll'} value={p ? money(p.net, cur) : '—'} hint={p ? `Gross ${money(p.gross, cur)} · Deductions ${money(p.deductions, cur)}` : 'No payroll period yet'} icon={<Banknote className="size-5" />} tone="green" />
        <StatCard label="Awaiting approval" value={p?.byStatus.pending_approval ?? 0} hint={`${p?.byStatus.draft ?? 0} draft · ${p?.byStatus.approved ?? 0} approved`} icon={<Clock className="size-5" />} tone="amber" />
        <StatCard label="Missing records" value={p?.missing ?? 0} hint={p ? `${p.paid} of ${p.byStatus.approved ?? 0} approved marked paid` : undefined} icon={<AlertCircle className="size-5" />} tone={p?.missing ? 'red' : 'green'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card padded={false} className="lg:col-span-2">
          <div className="p-5 pb-0">
            <CardHeader title="Payroll periods" />
          </div>
          {!periods.data?.length ? (
            <EmptyState icon={<CalendarRange className="size-5" />} title="No payroll periods" description={can('payroll.period.manage') ? 'Create a period to begin preparing payroll.' : undefined} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Period</Th>
                  <Th className="hidden md:table-cell">Pay date</Th>
                  <Th>Status</Th>
                  <Th className="hidden sm:table-cell">Records</Th>
                  <Th align="right">Approved net</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {periods.data.map((x) => (
                  <tr key={x.id} className="hover:bg-slate-50">
                    <Td>
                      <Link to={`/finance/periods/${x.id}`} className="font-medium text-brand-700 hover:underline">
                        {x.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-slate-500">{x.code}</span>
                    </Td>
                    <Td className="hidden md:table-cell">{date(x.payDate)}</Td>
                    <Td>
                      <StatusBadge status={x.status} />
                    </Td>
                    <Td className="hidden text-xs text-slate-500 sm:table-cell">
                      {x.counts?.approved ?? 0} approved · {x.counts?.pending ?? 0} pending · {x.counts?.draft ?? 0} draft
                    </Td>
                    <Td align="right" className="tabular-nums">{money(x.approvedNet ?? 0, cur)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          {s.retirement && (
            <Card>
              <CardHeader title="Retirement liabilities" actions={<Link to="/retirement" className="text-sm font-medium text-brand-700">Open</Link>} />
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Verified statements</span>
                  <span className="font-medium tabular-nums">{money(s.retirement.verifiedLiability, cur)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Estimated (unverified)</span>
                  <span className="font-medium tabular-nums">{money(s.retirement.estimatedLiability, cur)}</span>
                </div>
                <div className="flex items-center gap-2 border-t border-slate-100 pt-3 text-slate-600">
                  <Hourglass className="size-4 text-violet-600" /> {s.retirement.reviewRequired} review(s) required · {s.retirement.upcoming} upcoming
                </div>
              </div>
            </Card>
          )}
          <Card>
            <CardHeader title="Headcount by department" />
            <ul className="space-y-2 text-sm">
              {s.byDepartment.map((d) => (
                <li key={d.id} className="flex justify-between">
                  <span className="text-slate-600">{d.name}</span>
                  <span className="font-medium tabular-nums">{d.n}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Headcount by location" />
            <ul className="space-y-2 text-sm">
              {s.byLocation.map((d) => (
                <li key={d.id ?? 'none'} className="flex justify-between">
                  <span className="text-slate-600">{d.name ?? 'Unassigned'}</span>
                  <span className="font-medium tabular-nums">{d.n}</span>
                </li>
              ))}
            </ul>
          </Card>
          {p && p.byStatus.approved > 0 && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <CheckCircle2 className="size-4 text-emerald-600" /> Approved payroll is locked by the database and can only be corrected through an adjustment revision.
            </p>
          )}
        </div>
      </div>
      {creating && <NewPeriodModal onClose={() => setCreating(false)} />}
    </div>
  );
}
