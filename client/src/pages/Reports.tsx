import { useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import { download, errorMessage } from '../lib/api';
import { useApi } from '../lib/hooks';
import { useToast } from '../components/toast';
import { Button, Card, cx, EmptyState, ErrorState, PageHeader, PageLoader, Table, Td, Th } from '../components/ui';

interface Report {
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export function ReportsPage() {
  const toast = useToast();
  const list = useApi<{ key: string; title: string }[]>('/reports');
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ?? list.data?.[0]?.key ?? null;
  const report = useApi<Report>(active ? `/reports/${active}?format=json` : null);

  if (list.isLoading) return <PageLoader />;
  if (list.error || !list.data) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  if (!list.data.length) {
    return (
      <div>
        <PageHeader title="Reports" />
        <Card>
          <EmptyState icon={<BarChart3 className="size-5" />} title="No reports available for your role" />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Reports" description="Reports only include data your role is permitted to see. Exports are audited." />
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="Reports" className="flex gap-2 overflow-x-auto lg:flex-col">
          {list.data.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setSelected(r.key)}
              className={cx(
                'shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                r.key === active ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
              )}
            >
              {r.title}
            </button>
          ))}
        </nav>
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <h2 className="font-semibold text-slate-900">{report.data?.title ?? list.data.find((r) => r.key === active)?.title}</h2>
            {active && (
              <Button size="sm" variant="secondary" icon={<Download className="size-4" />} onClick={() => download(`/reports/${active}?format=csv`, `${active}-report.csv`).catch((e) => toast.error(errorMessage(e)))}>
                Export CSV
              </Button>
            )}
          </div>
          {report.isLoading ? (
            <PageLoader />
          ) : report.error || !report.data ? (
            <ErrorState error={report.error} onRetry={() => report.refetch()} />
          ) : !report.data.rows.length ? (
            <EmptyState title="No data for this report" />
          ) : (
            <Table>
              <thead>
                <tr>
                  {report.data.columns.map((c, i) => (
                    <Th key={c} align={typeof report.data!.rows[0][i] === 'number' ? 'right' : 'left'}>
                      {c}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {report.data.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <Td key={j} align={typeof cell === 'number' ? 'right' : 'left'} className={typeof cell === 'number' ? 'tabular-nums' : undefined}>
                        {cell ?? '—'}
                      </Td>
                    ))}
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
