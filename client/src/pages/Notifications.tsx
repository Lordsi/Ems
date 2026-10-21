import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAction, useApi } from '../lib/hooks';
import { relative } from '../lib/format';
import type { Paged } from '../lib/types';
import { Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Pagination, cx } from '../components/ui';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const q = useApi<Paged<NotificationRow> & { unread: number }>(`/notifications${qs({ unread: unreadOnly || undefined, page, pageSize: 25 })}`, { keepPrevious: true });
  const markRead = useAction((body: { ids?: string[]; all?: boolean }) => api.post('/notifications/read', body), { invalidate: ['/notifications'] });

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const open = (n: NotificationRow) => {
    if (!n.readAt) markRead.mutate({ ids: [n.id] });
    if (n.link && n.link.startsWith('/')) navigate(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description={q.data.unread ? `${q.data.unread} unread` : 'You are all caught up.'}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" className="size-4 rounded border-slate-300" checked={unreadOnly} onChange={(e) => (setUnreadOnly(e.target.checked), setPage(1))} />
              Unread only
            </label>
            <Button variant="secondary" icon={<CheckCheck className="size-4" />} disabled={!q.data.unread} onClick={() => markRead.mutate({ all: true })} loading={markRead.isPending}>
              Mark all read
            </Button>
          </>
        }
      />
      <Card padded={false}>
        {!q.data.items.length ? (
          <EmptyState icon={<Bell className="size-5" />} title="No notifications" />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {q.data.items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)} className={cx('flex w-full gap-3 px-5 py-4 text-left hover:bg-slate-50', !n.readAt && 'bg-brand-50/40')}>
                    <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-sm', n.readAt ? 'text-slate-700' : 'font-semibold text-slate-900')}>{n.title}</span>
                      {n.body && <span className="mt-0.5 block text-sm text-slate-500">{n.body}</span>}
                      <span className="mt-1 block text-xs text-slate-400">{relative(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
