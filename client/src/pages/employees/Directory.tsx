import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowDown, ArrowUp, Download, Search, UserPlus, Users } from 'lucide-react';
import { download, errorMessage, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { date, label } from '../../lib/format';
import type { EmployeeSummary, Lookups, Paged } from '../../lib/types';
import { useToast } from '../../components/toast';
import { Avatar, Button, Card, EmptyState, ErrorState, FilterBar, Input, LinkButton, PageHeader, Pagination, Select, Spinner, StatusBadge, Table, Td, Th, cx } from '../../components/ui';

const STATUSES = ['pending_verification', 'active', 'on_leave', 'suspended', 'retired', 'terminated', 'rejected'];

export function DirectoryPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const lookups = useApi<Lookups>('/lookups');
  const filters = {
    q: params.get('q') ?? '',
    departmentId: params.get('departmentId') ?? '',
    locationId: params.get('locationId') ?? '',
    status: params.get('status') ?? '',
    archived: params.get('archived') ?? 'exclude',
    sort: params.get('sort') ?? 'name',
    dir: params.get('dir') ?? 'asc',
    page: Number(params.get('page') ?? 1),
  };
  const query = qs({ ...filters, pageSize: 25 });
  const { data, isLoading, isFetching, error, refetch } = useApi<Paged<EmployeeSummary>>(`/employees${query}`, { keepPrevious: true });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== filters.q) update({ q: search });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function update(patch: Record<string, string | number>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === undefined) next.delete(k);
      else next.set(k, String(v));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  }

  const sortBy = (key: string) => update({ sort: key, dir: filters.sort === key && filters.dir === 'asc' ? 'desc' : 'asc' });
  const sortTh = (k: string, children: string, className?: string) => (
    <Th className={className} key={k}>
      <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-1 uppercase hover:text-slate-800">
        {children}
        {filters.sort === k && (filters.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
      </button>
    </Th>
  );

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { page: _p, ...f } = filters;
      await download(`/employees/export.csv${qs(f)}`, 'employees.csv');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const showAge = data?.items.some((i) => i.age !== null);

  return (
    <div>
      <PageHeader
        title="Employee directory"
        description={can('employee.read.all') ? 'All employees across the organisation.' : 'Employees within your assigned scope.'}
        actions={
          <>
            {can('employee.export') && (
              <Button variant="secondary" onClick={exportCsv} loading={exporting} icon={<Download className="size-4" />}>
                Export CSV
              </Button>
            )}
            {can('employee.create') && (
              <LinkButton to="/employees/new" variant="primary" icon={<UserPlus className="size-4" />}>
                Add employee
              </LinkButton>
            )}
          </>
        }
      />
      <Card padded={false}>
        <FilterBar>
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search name, employment number or username…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search employees" />
          </div>
          <Select className="w-auto" value={filters.departmentId} onChange={(e) => update({ departmentId: e.target.value })} aria-label="Department">
            <option value="">All departments</option>
            {lookups.data?.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select className="w-auto" value={filters.locationId} onChange={(e) => update({ locationId: e.target.value })} aria-label="Location">
            <option value="">All locations</option>
            {lookups.data?.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Select className="w-auto" value={filters.status} onChange={(e) => update({ status: e.target.value })} aria-label="Status">
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
          {(can('employee.archive') || can('employee.read.all')) && (
            <Select className="w-auto" value={filters.archived} onChange={(e) => update({ archived: e.target.value === 'exclude' ? '' : e.target.value })} aria-label="Archived records">
              <option value="exclude">Current records</option>
              <option value="include">Include archived</option>
              <option value="only">Archived only</option>
            </Select>
          )}
          {isFetching && <Spinner className="size-4" />}
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
          <EmptyState icon={<Users className="size-5" />} title="No employees found" description="Try adjusting your search or filters." />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  {sortTh('name', 'Employee')}
                  {sortTh('employmentNumber', 'Employment no.')}
                  {sortTh('department', 'Department', 'hidden md:table-cell')}
                  <Th className="hidden lg:table-cell">Job title</Th>
                  <Th className="hidden xl:table-cell">Location</Th>
                  {showAge && <Th className="hidden lg:table-cell">Age</Th>}
                  {sortTh('employmentDate', 'Since', 'hidden xl:table-cell')}
                  {sortTh('status', 'Status')}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((e) => (
                  <tr key={e.id} className={cx('hover:bg-slate-50', e.archived && 'opacity-70')}>
                    <Td>
                      <Link to={`/employees/${e.id}`} className="flex items-center gap-3">
                        <Avatar name={e.legalName} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-900 hover:text-brand-700">{e.legalName}</span>
                          {e.preferredName && <span className="block truncate text-xs text-slate-500">“{e.preferredName}”</span>}
                        </span>
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs">{e.employmentNumber ?? <span className="font-sans text-slate-400">Not issued</span>}</Td>
                    <Td className="hidden md:table-cell">{e.department.name}</Td>
                    <Td className="hidden lg:table-cell">{e.jobTitle?.name ?? '—'}</Td>
                    <Td className="hidden xl:table-cell">{e.location?.name ?? '—'}</Td>
                    {showAge && <Td className="hidden lg:table-cell tabular-nums">{e.age ?? '—'}</Td>}
                    <Td className="hidden xl:table-cell">{date(e.employmentDate)}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={e.employmentStatus} />
                        {e.archived && <StatusBadge status="archived" />}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => update({ page: p })} />
          </>
        )}
      </Card>
    </div>
  );
}
