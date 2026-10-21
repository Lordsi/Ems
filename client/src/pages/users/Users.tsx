import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Search, ShieldCheck } from 'lucide-react';
import { ROLE_KEYS, ROLE_META } from '../../../../shared/permissions';
import { qs } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { relative } from '../../lib/format';
import type { Paged } from '../../lib/types';
import { Avatar, Badge, Card, EmptyState, ErrorState, FilterBar, Input, PageHeader, PageLoader, Pagination, Select, StatusBadge, Table, Td, Th } from '../../components/ui';

interface UserRow {
  id: string;
  displayName: string;
  username: string;
  email: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  employeeId: string | null;
  employmentNumber: string | null;
  roles: string[];
}

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [f, setF] = useState({ q: '', role: '', status: '', page: 1 });
  useEffect(() => {
    const t = setTimeout(() => setF((s) => (s.q === search ? s : { ...s, q: search, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [search]);
  const q = useApi<Paged<UserRow>>(`/users${qs(f)}`, { keepPrevious: true });

  return (
    <div>
      <PageHeader title="Users & access" description="User accounts, roles, moderator scopes and account status. Privileged changes require password re-confirmation and are audited." />
      <Card padded={false}>
        <FilterBar>
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search name, username, email or employment number…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" />
          </div>
          <Select className="w-auto" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, page: 1 })} aria-label="Role">
            <option value="">All roles</option>
            {ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {ROLE_META[r].name}
              </option>
            ))}
          </Select>
          <Select className="w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value, page: 1 })} aria-label="Status">
            <option value="">All statuses</option>
            {['active', 'pending_verification', 'suspended', 'deactivated'].map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
              </option>
            ))}
          </Select>
        </FilterBar>
        {q.isLoading ? (
          <PageLoader />
        ) : q.error || !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="No users match these filters" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>User</Th>
                  <Th>Roles</Th>
                  <Th>Status</Th>
                  <Th className="hidden md:table-cell">MFA</Th>
                  <Th className="hidden lg:table-cell">Last sign-in</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {q.data.items.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={u.displayName} size="sm" />
                        <div className="min-w-0">
                          <Link to={`/users/${u.id}`} className="font-medium text-brand-700 hover:underline">
                            {u.displayName}
                          </Link>
                          <div className="truncate text-xs text-slate-500">
                            @{u.username}
                            {u.employmentNumber && <span className="ml-1 font-mono">· {u.employmentNumber}</span>}
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {u.roles
                          .filter((r) => r !== 'employee' || u.roles.length === 1)
                          .map((r) => (
                            <Badge key={r} tone={r === 'super_admin' ? 'violet' : r === 'employee' ? 'gray' : 'blue'}>
                              {ROLE_META[r as keyof typeof ROLE_META]?.name ?? r}
                            </Badge>
                          ))}
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={u.status} />
                    </Td>
                    <Td className="hidden md:table-cell">{u.mfaEnabled ? <ShieldCheck className="size-4 text-emerald-600" aria-label="MFA enabled" /> : <span className="text-xs text-slate-400">Off</span>}</Td>
                    <Td className="hidden text-slate-500 lg:table-cell">{u.lastLoginAt ? relative(u.lastLoginAt) : 'Never'}</Td>
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
