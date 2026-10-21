import { useState } from 'react';
import { Link } from 'react-router';
import { Download, Hourglass, ScrollText } from 'lucide-react';
import { download, errorMessage, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { date, label } from '../../lib/format';
import type { Lookups } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Alert, Button, Card, EmptyState, ErrorState, FilterBar, LinkButton, PageHeader, PageLoader, Pagination, Select, StatCard, StatusBadge, Table, Td, Th } from '../../components/ui';

export interface ReviewRow {
  id: string;
  status: string;
  expectedRetirementDate: string;
  deferredUntil: string | null;
  flaggedAt: string | null;
  outstandingActions: string[];
  policyName: string;
  retirementAge: number;
  employeeId: string;
  legalName: string;
  employmentNumber: string | null;
  dateOfBirth: string | null;
  departmentName: string;
  age: number | null;
}

interface ReviewList {
  items: ReviewRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
  policyAdopted: boolean;
}

const STATUSES = ['open', 'upcoming', 'review_required', 'pending_approval', 'approved', 'deferred', 'completed', 'rejected'];

export function RetirementPage() {
  const { can } = useAuth();
  const toast = useToast();
  const lookups = useApi<Lookups>('/lookups');
  const [f, setF] = useState({ status: 'open', departmentId: '', page: 1 });
  const q = useApi<ReviewList>(`/retirement/reviews${qs(f)}`, { keepPrevious: true });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { items, counts } = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Retirement"
        description="Employees approaching retirement under the adopted policy. Finance prepares statements, a reviewer verifies them, and the Super Admin decides."
        actions={
          <>
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download('/retirement/export.csv', 'retirement.csv').catch((e) => toast.error(errorMessage(e)))}>
              Export CSV
            </Button>
            <LinkButton to="/retirement/policies" icon={<ScrollText className="size-4" />}>
              Policies
            </LinkButton>
          </>
        }
      />

      {!q.data.policyAdopted && (
        <Alert tone="warning" title="No retirement policy is in effect">
          Retirement monitoring is inactive until a policy is adopted. The default retirement age of 60 is only applied once a Super Admin has verified and adopted it.{' '}
          {can('retirement.policy.manage') && (
            <Link to="/retirement/policies" className="font-medium underline">
              Review policies
            </Link>
          )}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Upcoming" value={counts.upcoming ?? 0} tone="brand" />
        <StatCard label="Review required" value={counts.review_required ?? 0} tone="amber" />
        <StatCard label="Awaiting decision" value={counts.pending_approval ?? 0} tone="violet" />
        <StatCard label="Approved — to finalise" value={counts.approved ?? 0} tone="green" />
      </div>

      <Card padded={false}>
        <FilterBar>
          <Select className="w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} aria-label="Status">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'open' ? 'All open reviews' : label(s)}
              </option>
            ))}
          </Select>
          <Select className="w-auto" value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value, page: 1 })} aria-label="Department">
            <option value="">All departments</option>
            {lookups.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </FilterBar>
        {!items.length ? (
          <EmptyState icon={<Hourglass className="size-5" />} title="No retirement reviews" description="Reviews are created automatically by the daily retirement scan when employees enter the upcoming window." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th className="hidden md:table-cell">Department</Th>
                  <Th className="hidden sm:table-cell">Age</Th>
                  <Th>Retirement date</Th>
                  <Th>Status</Th>
                  <Th className="hidden lg:table-cell">Next action</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <Td>
                      <Link to={`/retirement/${r.id}`} className="font-medium text-brand-700 hover:underline">
                        {r.legalName}
                      </Link>
                      <div className="font-mono text-xs text-slate-500">{r.employmentNumber}</div>
                    </Td>
                    <Td className="hidden md:table-cell">{r.departmentName}</Td>
                    <Td className="hidden sm:table-cell">{r.age ?? '—'}</Td>
                    <Td>
                      {date(r.deferredUntil ?? r.expectedRetirementDate)}
                      {r.deferredUntil && <div className="text-xs text-slate-500">Deferred from {date(r.expectedRetirementDate)}</div>}
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td className="hidden text-xs text-slate-600 lg:table-cell">{r.outstandingActions?.[0] ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={(p) => setF({ ...f, page: p })} />
          </>
        )}
      </Card>
    </div>
  );
}
