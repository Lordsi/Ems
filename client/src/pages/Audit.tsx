import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { download, errorMessage, qs } from '../lib/api';
import { useApi } from '../lib/hooks';
import { dateTime } from '../lib/format';
import type { Paged } from '../lib/types';
import { useToast } from '../components/toast';
import { Badge, Button, Card, EmptyState, ErrorState, FilterBar, Input, PageHeader, PageLoader, Pagination, Select, Table, Td, Th } from '../components/ui';

interface AuditRow {
  id: string;
  occurredAt: string;
  action: string;
  outcome: 'success' | 'denied' | 'failure';
  targetType: string | null;
  targetId: string | null;
  reason: string | null;
  approvalId: string | null;
  requestId: string | null;
  ip: string | null;
  oldValues: unknown;
  newValues: unknown;
  actorName: string | null;
  actorUsername: string | null;
}

const FILTER_KEYS = ['action', 'targetType', 'targetId', 'outcome', 'from', 'to'] as const;

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-slate-400">—</span>;
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(value, null, 2)}</pre>;
}

export function AuditPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? '']));
  const page = Number(params.get('page') ?? 1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const q = useApi<Paged<AuditRow>>(`/audit${qs({ ...filters, page, pageSize: 50 })}`, { keepPrevious: true });

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Append-only record of security-relevant and administrative actions. Entries cannot be edited or deleted, and viewing this log is itself audited."
        actions={
          <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download(`/audit/export.csv${qs(filters)}`, 'audit-log.csv').catch((e) => toast.error(errorMessage(e)))}>
            Export CSV
          </Button>
        }
      />
      <Card padded={false}>
        <FilterBar>
          <Input className="w-48" placeholder="Action prefix, e.g. payroll." value={filters.action} onChange={(e) => set('action', e.target.value)} aria-label="Action" />
          <Input className="w-40" placeholder="Target type" value={filters.targetType} onChange={(e) => set('targetType', e.target.value)} aria-label="Target type" />
          <Input className="w-56" placeholder="Target ID" value={filters.targetId} onChange={(e) => set('targetId', e.target.value)} aria-label="Target ID" />
          <Select className="w-auto" value={filters.outcome} onChange={(e) => set('outcome', e.target.value)} aria-label="Outcome">
            <option value="">All outcomes</option>
            <option value="success">Success</option>
            <option value="denied">Denied</option>
            <option value="failure">Failure</option>
          </Select>
          <Input type="date" className="w-auto" value={filters.from} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
          <Input type="date" className="w-auto" value={filters.to} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
        </FilterBar>
        {q.isLoading ? (
          <PageLoader />
        ) : q.error || !q.data ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data.items.length ? (
          <EmptyState title="No audit entries match these filters" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-8" />
                  <Th>When</Th>
                  <Th>Actor</Th>
                  <Th>Action</Th>
                  <Th className="hidden md:table-cell">Target</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {q.data.items.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                      <Td>
                        <button type="button" aria-label={expanded === r.id ? 'Collapse' : 'Expand'} aria-expanded={expanded === r.id} className="text-slate-400">
                          {expanded === r.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-slate-600">{dateTime(r.occurredAt)}</Td>
                      <Td>{r.actorName ? <span title={`@${r.actorUsername}`}>{r.actorName}</span> : <span className="text-slate-400">System / anonymous</span>}</Td>
                      <Td className="font-mono text-xs">{r.action}</Td>
                      <Td className="hidden text-xs text-slate-600 md:table-cell">
                        {r.targetType}
                        {r.targetId && <span className="ml-1 font-mono text-slate-400">{r.targetId.slice(0, 8)}</span>}
                      </Td>
                      <Td>
                        <Badge tone={r.outcome === 'success' ? 'green' : r.outcome === 'denied' ? 'red' : 'amber'}>{r.outcome}</Badge>
                      </Td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="bg-slate-50">
                        <Td colSpan={6}>
                          <div className="grid gap-4 py-2 text-sm lg:grid-cols-2">
                            <div className="space-y-1 text-xs text-slate-600 lg:col-span-2">
                              {r.reason && (
                                <p>
                                  <span className="font-medium text-slate-800">Reason:</span> {r.reason}
                                </p>
                              )}
                              <p>
                                Target: {r.targetType ?? '—'} <span className="font-mono">{r.targetId ?? ''}</span>
                              </p>
                              <p>
                                Request <span className="font-mono">{r.requestId ?? '—'}</span> · IP {r.ip ?? '—'}
                                {r.approvalId && (
                                  <>
                                    {' '}
                                    · Approval <span className="font-mono">{r.approvalId}</span>
                                  </>
                                )}
                              </p>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Before</p>
                              <Json value={r.oldValues} />
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">After</p>
                              <Json value={r.newValues} />
                            </div>
                          </div>
                        </Td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={q.data.page}
              pageSize={q.data.pageSize}
              total={q.data.total}
              onPage={(p) => {
                const next = new URLSearchParams(params);
                next.set('page', String(p));
                setParams(next);
              }}
            />
          </>
        )}
      </Card>
    </div>
  );
}
