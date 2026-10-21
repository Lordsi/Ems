import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CalendarDays, CheckCircle2, MapPin, Pencil, Plus, Send, Undo2, XCircle } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
import { dateTime, label } from '../../lib/format';
import type { Paged } from '../../lib/types';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Pagination, Select, StatusBadge, Textarea, cx } from '../../components/ui';
import { AudienceBadges, Comments, TargetPicker, type Targets } from './shared';

interface EventRow extends Targets {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  venue: string | null;
  status: string;
  commentsEnabled: boolean;
  canManage?: boolean;
}

function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EventEditor({ initial, onClose }: { initial?: EventRow; onClose: (id?: string) => void }) {
  const [f, setF] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    startsAt: toLocalInput(initial?.startsAt),
    endsAt: toLocalInput(initial?.endsAt),
    venue: initial?.venue ?? '',
  });
  const [commentsEnabled, setCommentsEnabled] = useState(initial?.commentsEnabled ?? false);
  const [targets, setTargets] = useState<Targets>({ targetDepartmentIds: initial?.targetDepartmentIds ?? [], targetLocationIds: initial?.targetLocationIds ?? [] });
  const save = useAction((payload: unknown) => (initial ? api.put<{ id: string }>(`/events/${initial.id}`, payload) : api.post<{ id: string }>('/events', payload)), {
    invalidate: ['/events', '/dashboard'],
    success: initial ? 'Event updated' : 'Draft event created',
    onSuccess: (r) => onClose(r.id),
  });
  const submit = () =>
    save.mutate({
      ...f,
      startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : '',
      endsAt: f.endsAt ? new Date(f.endsAt).toISOString() : null,
      commentsEnabled,
      ...targets,
    });
  const bind = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  return (
    <Modal
      open
      onClose={() => onClose()}
      size="lg"
      title={initial ? 'Edit event' : 'New event'}
      footer={
        <>
          <Button variant="secondary" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Title" required error={save.fieldErrors.title}>
          {(id) => <Input id={id} {...bind('title')} maxLength={200} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" required error={save.fieldErrors.startsAt}>
            {(id) => <Input id={id} type="datetime-local" {...bind('startsAt')} />}
          </Field>
          <Field label="Ends" error={save.fieldErrors.endsAt}>
            {(id) => <Input id={id} type="datetime-local" {...bind('endsAt')} />}
          </Field>
        </div>
        <Field label="Venue" error={save.fieldErrors.venue}>
          {(id) => <Input id={id} {...bind('venue')} />}
        </Field>
        <Field label="Description" error={save.fieldErrors.description}>
          {(id) => <Textarea id={id} rows={5} {...bind('description')} />}
        </Field>
        <Checkbox checked={commentsEnabled} onChange={setCommentsEnabled} label="Allow comments" />
        <TargetPicker value={targets} onChange={setTargets} />
      </div>
    </Modal>
  );
}

export function EventsPage() {
  const navigate = useNavigate();
  const [when, setWhen] = useState('upcoming');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useApi<Paged<EventRow> & { canManage: boolean }>(`/events${qs({ when, status, page, pageSize: 15 })}`, { keepPrevious: true });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div>
      <PageHeader
        title="Events"
        description="Organisation events and activities."
        actions={
          <>
            <div className="flex rounded-md bg-slate-100 p-0.5 text-sm">
              {['upcoming', 'past', 'all'].map((w) => (
                <button key={w} type="button" onClick={() => (setWhen(w), setPage(1))} className={cx('rounded px-3 py-1.5 font-medium', when === w ? 'bg-white shadow-sm' : 'text-slate-600')}>
                  {w === 'all' ? 'All' : label(w)}
                </button>
              ))}
            </div>
            {q.data.canManage && (
              <>
                <Select className="w-auto" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
                  <option value="">All statuses</option>
                  {['draft', 'published', 'completed', 'cancelled'].map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </Select>
                <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  New event
                </Button>
              </>
            )}
          </>
        }
      />
      {!q.data.items.length ? (
        <Card>
          <EmptyState icon={<CalendarDays className="size-5" />} title="No events" />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-slate-100">
            {q.data.items.map((e) => (
              <li key={e.id}>
                <Link to={`/events/${e.id}`} className="flex gap-4 px-5 py-4 hover:bg-slate-50">
                  <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-brand-50 py-1.5 text-brand-800">
                    <span className="text-[11px] font-semibold uppercase">{new Date(e.startsAt).toLocaleDateString('en-GB', { month: 'short' })}</span>
                    <span className="text-xl font-semibold leading-none">{new Date(e.startsAt).getDate()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-slate-900">{e.title}</h3>
                      {(q.data.canManage || e.status !== 'published') && <StatusBadge status={e.status} />}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {dateTime(e.startsAt)}
                      {e.venue && ` · ${e.venue}`}
                    </p>
                    {q.data.canManage && (
                      <div className="mt-1.5">
                        <AudienceBadges targets={e} />
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </Card>
      )}
      {creating && <EventEditor onClose={(id) => (setCreating(false), id && navigate(`/events/${id}`))} />}
    </div>
  );
}

export function EventDetailPage() {
  const { id = '' } = useParams();
  const q = useApi<EventRow>(`/events/${id}`);
  const [editing, setEditing] = useState(false);
  const transition = useAction((status: string) => api.post(`/events/${id}/status`, { status }), {
    invalidate: ['/events', '/dashboard'],
    success: (r) => `Event ${label((r as { status: string }).status).toLowerCase()}`,
  });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const e = q.data;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        back={{ to: '/events', label: 'Events' }}
        title={e.title}
        actions={
          e.canManage && (
            <>
              {['draft', 'published'].includes(e.status) && (
                <Button variant="secondary" size="sm" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
              {e.status === 'draft' && (
                <Button size="sm" icon={<Send className="size-4" />} onClick={() => transition.mutate('published')} loading={transition.isPending}>
                  Publish
                </Button>
              )}
              {e.status === 'published' && (
                <>
                  <Button variant="secondary" size="sm" icon={<Undo2 className="size-4" />} onClick={() => transition.mutate('draft')}>
                    Unpublish
                  </Button>
                  <Button variant="success" size="sm" icon={<CheckCircle2 className="size-4" />} onClick={() => transition.mutate('completed')}>
                    Mark completed
                  </Button>
                </>
              )}
              {['draft', 'published'].includes(e.status) && (
                <Button variant="danger" size="sm" icon={<XCircle className="size-4" />} onClick={() => confirm('Cancel this event? Attendees will be notified.') && transition.mutate('cancelled')}>
                  Cancel event
                </Button>
              )}
            </>
          )
        }
      />
      <Card>
        <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
          <StatusBadge status={e.status} />
          <span className="flex items-center gap-1.5">
            <CalendarDays className="size-4 text-slate-400" />
            {dateTime(e.startsAt)}
            {e.endsAt && ` – ${dateTime(e.endsAt)}`}
          </span>
          {e.venue && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4 text-slate-400" />
              {e.venue}
            </span>
          )}
          {e.canManage && <AudienceBadges targets={e} />}
        </div>
        {e.description ? <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800">{e.description}</div> : <p className="text-sm text-slate-500">No description.</p>}
      </Card>
      <Comments type="event" id={e.id} enabled={e.commentsEnabled} open={e.status === 'published'} />
      {editing && <EventEditor initial={e} onClose={() => setEditing(false)} />}
    </div>
  );
}
