import { Link } from 'react-router';
import { AlertTriangle, Banknote, CalendarDays, ClipboardCheck, Hourglass, Megaphone, ShieldAlert, UserPlus, Users } from 'lucide-react';
import { useAuth, useMe } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { date, dateTime, label, money, relative } from '../lib/format';
import { ROLE_META } from '../../../shared/permissions';
import { Badge, Card, CardHeader, EmptyState, ErrorState, LinkButton, PageHeader, PageLoader, StatCard, StatusBadge } from '../components/ui';

interface DashboardData {
  me?: { legalName: string; employmentNumber: string | null; status: string; departmentName: string; employmentDate: string | null } | null;
  workforce?: { current: number; pending: number; onLeave: number; byDepartment: { name: string; n: number }[]; scoped: boolean };
  approvals: { toDecide: number; mine: number; items: { id: string; type: string; summary: string; requestedAt: string }[] };
  retirement?: { reviewRequired: number; pendingApproval: number; upcoming: number; next: { id: string; status: string; expected: string; name: string }[] };
  payroll?: { period: { id: string; name: string; status: string } | null; byStatus?: Record<string, number>; net?: number; currency?: string };
  security?: { failedLogins: number; denied: number; roleChanges: number; recent: { id: number; action: string; outcome: string; occurredAt: string; actor: string | null }[] };
  announcements: { id: string; title: string; excerpt: string; publishedAt: string | null }[];
  events: { id: string; title: string; startsAt: string; venue: string | null }[];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const me = useMe();
  const { can } = useAuth();
  const { data, isLoading, error, refetch } = useApi<DashboardData>('/dashboard');
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  const topRole = me.user.roles.slice().sort((a, b) => ROLE_META[b].rank - ROLE_META[a].rank)[0];
  const firstName = (me.employee?.preferredName ?? me.user.displayName).split(' ')[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`${ROLE_META[topRole]?.name ?? 'Employee'} workspace · ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
        actions={
          <>
            {can('employee.create') && (
              <LinkButton to="/employees/new" variant="primary" icon={<UserPlus className="size-4" />}>
                Add employee
              </LinkButton>
            )}
            {can('payroll.prepare') && (
              <LinkButton to="/finance" icon={<Banknote className="size-4" />}>
                Payroll
              </LinkButton>
            )}
          </>
        }
      />

      {/* Key figures */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.workforce && (
          <>
            <StatCard label={data.workforce.scoped ? 'Employees in your scope' : 'Current employees'} value={data.workforce.current} icon={<Users className="size-5" />} to="/employees" />
            <StatCard label="Pending verification" value={data.workforce.pending} icon={<UserPlus className="size-5" />} tone="amber" to="/employees?status=pending_verification" />
          </>
        )}
        <StatCard label="Awaiting your decision" value={data.approvals.toDecide} hint={data.approvals.mine ? `${data.approvals.mine} of your own requests pending` : undefined} icon={<ClipboardCheck className="size-5" />} tone={data.approvals.toDecide ? 'amber' : 'green'} to="/approvals" />
        {data.retirement && (
          <StatCard label="Retirement reviews due" value={data.retirement.reviewRequired} hint={`${data.retirement.upcoming} upcoming · ${data.retirement.pendingApproval} awaiting decision`} icon={<Hourglass className="size-5" />} tone="violet" to="/retirement" />
        )}
        {data.payroll?.period && (
          <StatCard
            label={`Payroll · ${data.payroll.period.name}`}
            value={money(data.payroll.net ?? 0, data.payroll.currency)}
            hint={`${data.payroll.byStatus?.approved ?? 0} approved · ${data.payroll.byStatus?.pending_approval ?? 0} pending · ${data.payroll.byStatus?.draft ?? 0} draft`}
            icon={<Banknote className="size-5" />}
            tone="green"
            to={`/finance/periods/${data.payroll.period.id}`}
          />
        )}
        {!data.workforce && data.me && (
          <StatCard label="Employment number" value={<span className="font-mono text-xl">{data.me.employmentNumber ?? '—'}</span>} hint={data.me.departmentName} icon={<Users className="size-5" />} to="/profile" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {data.approvals.items.length > 0 && (
            <Card padded={false}>
              <div className="p-5 pb-0">
                <CardHeader title="Approvals waiting for you" actions={<LinkButton to="/approvals" size="sm">View all</LinkButton>} />
              </div>
              <ul className="divide-y divide-slate-100">
                {data.approvals.items.map((a) => (
                  <li key={a.id}>
                    <Link to={`/approvals?id=${a.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{a.summary}</p>
                        <p className="text-xs text-slate-500">{relative(a.requestedAt)}</p>
                      </div>
                      <Badge tone="amber">{label(a.type)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.workforce && data.workforce.byDepartment.length > 0 && (
            <Card>
              <CardHeader title="Workforce by department" description={data.workforce.scoped ? 'Limited to your assigned scope' : 'Current employees (active, on leave, suspended)'} />
              <div className="space-y-3">
                {(() => {
                  const max = Math.max(...data.workforce!.byDepartment.map((d) => d.n), 1);
                  return data.workforce!.byDepartment.map((d) => (
                    <div key={d.name} className="flex items-center gap-3 text-sm">
                      <span className="w-40 shrink-0 truncate text-slate-600">{d.name}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${(d.n / max) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right font-medium tabular-nums text-slate-900">{d.n}</span>
                    </div>
                  ));
                })()}
              </div>
            </Card>
          )}

          {data.retirement && data.retirement.next.length > 0 && (
            <Card padded={false}>
              <div className="p-5 pb-0">
                <CardHeader title="Retirement pipeline" actions={<LinkButton to="/retirement" size="sm">Open dashboard</LinkButton>} />
              </div>
              <ul className="divide-y divide-slate-100">
                {data.retirement.next.map((r) => (
                  <li key={r.id}>
                    <Link to={`/retirement/${r.id}`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{r.name}</p>
                        <p className="text-xs text-slate-500">Expected {date(r.expected)}</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {data.security && (
            <Card>
              <CardHeader title="Security overview" description="Last 7 days" actions={<LinkButton to="/audit" size="sm">Audit log</LinkButton>} />
              <div className="mb-4 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="text-xl font-semibold text-slate-900">{data.security.failedLogins}</p>
                  <p className="text-xs text-slate-500">Failed sign-ins</p>
                </div>
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="text-xl font-semibold text-slate-900">{data.security.denied}</p>
                  <p className="text-xs text-slate-500">Denied requests</p>
                </div>
                <div className="rounded-md bg-slate-50 p-3">
                  <p className="text-xl font-semibold text-slate-900">{data.security.roleChanges}</p>
                  <p className="text-xs text-slate-500">Access changes</p>
                </div>
              </div>
              {data.security.recent.length > 0 && (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.security.recent.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 items-center gap-2">
                        {r.outcome !== 'success' ? <ShieldAlert className="size-4 shrink-0 text-red-500" /> : <AlertTriangle className="size-4 shrink-0 text-amber-500" />}
                        <span className="truncate">
                          <span className="font-mono text-xs">{r.action}</span> <span className="text-slate-500">by {r.actor ?? 'anonymous'}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-500">{relative(r.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {!data.workforce && data.me && (
            <Card>
              <CardHeader title="My employment" actions={<LinkButton to="/profile" size="sm">View profile</LinkButton>} />
              <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Department</p>
                  <p className="mt-1 font-medium">{data.me.departmentName}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
                  <p className="mt-1">
                    <StatusBadge status={data.me.status} />
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Employed since</p>
                  <p className="mt-1 font-medium">{date(data.me.employmentDate)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">Payslips</p>
                  <Link to="/my-payslips" className="mt-1 block font-medium text-brand-700 hover:underline">
                    View payslips
                  </Link>
                </div>
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardHeader title="Announcements" actions={<LinkButton to="/announcements" size="sm">All</LinkButton>} />
            </div>
            {data.announcements.length ? (
              <ul className="divide-y divide-slate-100">
                {data.announcements.map((a) => (
                  <li key={a.id}>
                    <Link to={`/announcements/${a.id}`} className="block px-5 py-3 hover:bg-slate-50">
                      <p className="text-sm font-medium text-slate-900">{a.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{a.excerpt}</p>
                      <p className="mt-1 text-xs text-slate-400">{relative(a.publishedAt)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Megaphone className="size-5" />} title="No announcements" />
            )}
          </Card>
          <Card padded={false}>
            <div className="p-5 pb-0">
              <CardHeader title="Upcoming events" actions={<LinkButton to="/events" size="sm">All</LinkButton>} />
            </div>
            {data.events.length ? (
              <ul className="divide-y divide-slate-100">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <Link to={`/events/${e.id}`} className="flex gap-3 px-5 py-3 hover:bg-slate-50">
                      <div className="flex w-12 shrink-0 flex-col items-center rounded-md bg-brand-50 py-1 text-brand-800">
                        <span className="text-[10px] font-semibold uppercase">{new Date(e.startsAt).toLocaleDateString('en-GB', { month: 'short' })}</span>
                        <span className="text-lg font-semibold leading-none">{new Date(e.startsAt).getDate()}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{e.title}</p>
                        <p className="text-xs text-slate-500">
                          {dateTime(e.startsAt)}
                          {e.venue ? ` · ${e.venue}` : ''}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<CalendarDays className="size-5" />} title="No upcoming events" />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
