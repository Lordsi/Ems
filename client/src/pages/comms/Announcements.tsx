import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Archive, Megaphone, Pencil, Plus, Send, Undo2 } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
import { dateTime, label, relative } from '../../lib/format';
import type { Paged } from '../../lib/types';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Pagination, Select, StatusBadge, Textarea } from '../../components/ui';
import { AudienceBadges, Comments, TargetPicker, type Targets } from './shared';

interface AnnouncementItem extends Targets {
  id: string;
  title: string;
  excerpt: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  commentsEnabled: boolean;
  authorName: string | null;
  commentCount: number;
}

interface Announcement extends Targets {
  id: string;
  title: string;
  body: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  commentsEnabled: boolean;
  authorName: string | null;
  canManage: boolean;
}

function AnnouncementEditor({ initial, onClose }: { initial?: Announcement; onClose: (id?: string) => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [commentsEnabled, setCommentsEnabled] = useState(initial?.commentsEnabled ?? false);
  const [targets, setTargets] = useState<Targets>({ targetDepartmentIds: initial?.targetDepartmentIds ?? [], targetLocationIds: initial?.targetLocationIds ?? [] });
  const save = useAction(
    (payload: unknown) => (initial ? api.put<{ id: string }>(`/announcements/${initial.id}`, payload) : api.post<{ id: string }>('/announcements', payload)),
    { invalidate: ['/announcements', '/dashboard'], success: initial ? 'Announcement updated' : 'Draft created', onSuccess: (r) => onClose(r.id) },
  );
  return (
    <Modal
      open
      onClose={() => onClose()}
      size="lg"
      title={initial ? 'Edit announcement' : 'New announcement'}
      description={initial ? undefined : 'Announcements are saved as drafts. Publish when ready.'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate({ title, body, commentsEnabled, ...targets })} loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Title" required error={save.fieldErrors.title}>
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />}
        </Field>
        <Field label="Message" required error={save.fieldErrors.body}>
          {(id) => <Textarea id={id} rows={8} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <Checkbox checked={commentsEnabled} onChange={setCommentsEnabled} label="Allow comments" description="Comments are rate-limited and can be moderated." />
        <TargetPicker value={targets} onChange={setTargets} />
      </div>
    </Modal>
  );
}

export function AnnouncementsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useApi<Paged<AnnouncementItem> & { canManage: boolean }>(`/announcements${qs({ status, page, pageSize: 15 })}`, { keepPrevious: true });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Organisation news and notices."
        actions={
          q.data.canManage && (
            <>
              <Select className="w-auto" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
                {['all', 'draft', 'published', 'archived'].map((s) => (
                  <option key={s} value={s}>
                    {s === 'all' ? 'All statuses' : label(s)}
                  </option>
                ))}
              </Select>
              <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                New announcement
              </Button>
            </>
          )
        }
      />
      {!q.data.items.length ? (
        <Card>
          <EmptyState icon={<Megaphone className="size-5" />} title="No announcements" />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {q.data.items.map((a) => (
              <li key={a.id}>
                <Link to={`/announcements/${a.id}`} className="block px-5 py-4 hover:bg-slate-50">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-slate-900">{a.title}</h3>
                    {q.data.canManage && <StatusBadge status={a.status} />}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">{a.excerpt}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span>{a.authorName ?? 'Administrator'}</span>
                    <span>{relative(a.publishedAt ?? a.createdAt)}</span>
                    {a.commentsEnabled && <span>{a.commentCount} comment(s)</span>}
                    {q.data.canManage && <AudienceBadges targets={a} />}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </Card>
      )}
      {creating && <AnnouncementEditor onClose={(id) => (setCreating(false), id && navigate(`/announcements/${id}`))} />}
    </div>
  );
}

export function AnnouncementDetailPage() {
  const { id = '' } = useParams();
  const q = useApi<Announcement>(`/announcements/${id}`);
  const [editing, setEditing] = useState(false);
  const setStatus = useAction((status: string) => api.post(`/announcements/${id}/status`, { status }), {
    invalidate: ['/announcements', '/dashboard'],
    success: (r) => `Announcement ${label((r as { status: string }).status).toLowerCase()}`,
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        back={{ to: '/announcements', label: 'Announcements' }}
        title={a.title}
        description={`${a.authorName ?? 'Administrator'} · ${a.publishedAt ? `published ${dateTime(a.publishedAt)}` : `created ${dateTime(a.createdAt)}`}`}
        actions={
          a.canManage && (
            <>
              <StatusBadge status={a.status} />
              {a.status !== 'archived' && (
                <Button variant="secondary" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {a.status === 'draft' && (
                <Button size="sm" icon={<Send className="size-4" />} loading={setStatus.isPending} onClick={() => setStatus.mutate('published')}>
                  Publish
                </Button>
              )}
              {a.status === 'published' && (
                <Button variant="secondary" size="sm" icon={<Undo2 className="size-4" />} loading={setStatus.isPending} onClick={() => setStatus.mutate('draft')}>
                  Unpublish
                </Button>
              )}
              {a.status !== 'archived' && (
                <Button variant="secondary" size="sm" icon={<Archive className="size-4" />} onClick={() => confirm('Archive this announcement?') && setStatus.mutate('archived')}>
                  Archive
                </Button>
              )}
            </>
          )
        }
      />
      <Card>
        {a.canManage && (
          <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
            Audience: <AudienceBadges targets={a} />
          </div>
        )}
        <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800">{a.body}</div>
      </Card>
      <Comments type="announcement" id={a.id} enabled={a.commentsEnabled} open={a.status === 'published'} />
      {editing && <AnnouncementEditor initial={a} onClose={() => setEditing(false)} />}
    </div>
  );
}
