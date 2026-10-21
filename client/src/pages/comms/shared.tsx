import { useState, type FormEvent } from 'react';
import { EyeOff, Eye, MessageSquare, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useAction, useApi } from '../../lib/hooks';
import { relative } from '../../lib/format';
import type { Lookups } from '../../lib/types';
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, EmptyState, Textarea, cx } from '../../components/ui';

export interface Targets {
  targetDepartmentIds: string[];
  targetLocationIds: string[];
}

export function TargetPicker({ value, onChange }: { value: Targets; onChange: (t: Targets) => void }) {
  const { data } = useApi<Lookups>('/lookups');
  const toggle = (key: keyof Targets, id: string) => {
    const list = value[key];
    onChange({ ...value, [key]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] });
  };
  const everyone = !value.targetDepartmentIds.length && !value.targetLocationIds.length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Audience: <strong>{everyone ? 'Everyone' : 'Selected departments and/or locations'}</strong>
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Departments</p>
          <div className="space-y-2">
            {data?.departments.map((d) => (
              <Checkbox key={d.id} checked={value.targetDepartmentIds.includes(d.id)} onChange={() => toggle('targetDepartmentIds', d.id)} label={d.name} />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Locations</p>
          <div className="space-y-2">
            {data?.locations.length ? (
              data.locations.map((l) => <Checkbox key={l.id} checked={value.targetLocationIds.includes(l.id)} onChange={() => toggle('targetLocationIds', l.id)} label={l.name} />)
            ) : (
              <p className="text-sm text-slate-500">No locations configured.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AudienceBadges({ targets }: { targets: Targets }) {
  const { data } = useApi<Lookups>('/lookups');
  if (!targets.targetDepartmentIds.length && !targets.targetLocationIds.length) return <Badge>Everyone</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {targets.targetDepartmentIds.map((id) => (
        <Badge key={id} tone="blue">
          {data?.departments.find((d) => d.id === id)?.code ?? 'Dept'}
        </Badge>
      ))}
      {targets.targetLocationIds.map((id) => (
        <Badge key={id} tone="violet">
          {data?.locations.find((l) => l.id === id)?.name ?? 'Location'}
        </Badge>
      ))}
    </span>
  );
}

interface CommentRow {
  id: string;
  body: string;
  status: string;
  createdAt: string;
  authorName: string;
  mine: boolean;
  canModerate: boolean;
}

export function Comments({ type, id, enabled, open }: { type: 'announcement' | 'event'; id: string; enabled: boolean; open: boolean }) {
  const { can } = useAuth();
  const path = `/comments/${type}/${id}`;
  const q = useApi<CommentRow[]>(path);
  const [body, setBody] = useState('');
  const post = useAction((b: string) => api.post(path, { body: b }), { invalidate: [path, `/${type}s`], onSuccess: () => setBody('') });
  const moderate = useAction(({ cid, status }: { cid: string; status: 'hidden' | 'visible' }) => api.patch(`/comments/${cid}`, { status }), {
    invalidate: [path],
    success: 'Comment updated',
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) post.mutate(body.trim());
  };
  if (!enabled && !q.data?.length) return null;
  return (
    <Card>
      <CardHeader title={`Comments${q.data ? ` (${q.data.filter((c) => c.status === 'visible').length})` : ''}`} />
      {q.data?.length ? (
        <ul className="mb-5 space-y-4">
          {q.data.map((c) => (
            <li key={c.id} className={cx('flex gap-3', c.status === 'hidden' && 'opacity-60')}>
              <Avatar name={c.authorName} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-slate-900">{c.authorName}</span>
                  <span className="text-xs text-slate-400">{relative(c.createdAt)}</span>
                  {c.status === 'hidden' && <Badge tone="red">Hidden</Badge>}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-700">{c.body}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                {c.canModerate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={c.status === 'hidden' ? 'Restore comment' : 'Hide comment'}
                    icon={c.status === 'hidden' ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    onClick={() => moderate.mutate({ cid: c.id, status: c.status === 'hidden' ? 'visible' : 'hidden' })}
                  />
                )}
                {!c.canModerate && c.mine && c.status === 'visible' && (
                  <Button variant="ghost" size="sm" aria-label="Delete my comment" icon={<Trash2 className="size-4" />} onClick={() => moderate.mutate({ cid: c.id, status: 'hidden' })} />
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<MessageSquare className="size-5" />} title="No comments yet" />
      )}
      {enabled && open && can('comment.create') && (
        <form onSubmit={submit} className="space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="Write a comment…" aria-label="Comment" />
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={post.isPending} disabled={!body.trim()}>
              Post comment
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
