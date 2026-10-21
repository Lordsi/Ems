import { useState } from 'react';
import { Link } from 'react-router';
import { Pencil, Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useAction, useApi } from '../lib/hooks';
import { EmployeePicker } from '../components/EmployeePicker';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, StatusBadge, Table, Tabs, Td, Textarea, Th } from '../components/ui';

interface Department {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  headEmployeeId: string | null;
  headName: string | null;
  activeEmployees: number;
  locations: { id: string; name: string }[];
}
interface Location {
  id: string;
  code: string;
  name: string;
  address: string | null;
  status: string;
  activeEmployees: number;
}
interface JobTitle {
  id: string;
  name: string;
  status: string;
  departmentId: string | null;
  departmentName: string | null;
}
interface Grade {
  id: string;
  code: string;
  name: string;
  rank: number;
  status: string;
}

const ORG = ['/departments', '/locations', '/job-titles', '/grades', '/lookups', '/public'];

function Footer({ onClose, onSave, loading }: { onClose: () => void; onSave: () => void; loading: boolean }) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={onSave} loading={loading}>
        Save
      </Button>
    </>
  );
}

function StatusSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Status">
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </Select>
      )}
    </Field>
  );
}

function DepartmentModal({ dept, locations, onClose }: { dept?: Department; locations: Location[]; onClose: () => void }) {
  const [f, setF] = useState({ code: dept?.code ?? '', name: dept?.name ?? '', description: dept?.description ?? '', status: dept?.status ?? 'active' });
  const [head, setHead] = useState(dept?.headEmployeeId ? { id: dept.headEmployeeId, name: dept.headName ?? '' } : null);
  const [locIds, setLocIds] = useState<string[]>(dept?.locations.map((l) => l.id) ?? []);
  const save = useAction((body: unknown) => (dept ? api.put(`/departments/${dept.id}`, body) : api.post('/departments', body)), { invalidate: ORG, success: 'Department saved', onSuccess: onClose });
  const e = save.fieldErrors;
  return (
    <Modal open onClose={onClose} size="lg" title={dept ? `Edit ${dept.name}` : 'New department'} footer={<Footer onClose={onClose} loading={save.isPending} onSave={() => save.mutate({ ...f, headEmployeeId: head?.id ?? null, locationIds: locIds })} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required hint="2–8 capital letters; prefixes employment numbers and is frozen once numbers are issued" error={e.code}>
          {(id) => <Input id={id} value={f.code} onChange={(ev) => setF({ ...f, code: ev.target.value.toUpperCase() })} maxLength={8} />}
        </Field>
        <Field label="Name" required error={e.name}>
          {(id) => <Input id={id} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" error={e.description}>
            {(id) => <Textarea id={id} value={f.description} onChange={(ev) => setF({ ...f, description: ev.target.value })} />}
          </Field>
        </div>
        <Field label="Head of department" error={e.headEmployeeId}>
          {(id) => <EmployeePicker id={id} value={head} onChange={setHead} />}
        </Field>
        <StatusSelect value={f.status} onChange={(v) => setF({ ...f, status: v })} />
        <div className="sm:col-span-2">
          <p className="mb-2 text-sm font-medium text-slate-700">Work locations</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {locations
              .filter((l) => l.status === 'active' || locIds.includes(l.id))
              .map((l) => (
                <Checkbox key={l.id} checked={locIds.includes(l.id)} onChange={(v) => setLocIds((ids) => (v ? [...ids, l.id] : ids.filter((x) => x !== l.id)))} label={l.name} />
              ))}
          </div>
          {e.locationIds && <p className="mt-1 text-xs text-red-600">{e.locationIds}</p>}
        </div>
      </div>
    </Modal>
  );
}

function LocationModal({ loc, onClose }: { loc?: Location; onClose: () => void }) {
  const [f, setF] = useState({ code: loc?.code ?? '', name: loc?.name ?? '', address: loc?.address ?? '', status: loc?.status ?? 'active' });
  const save = useAction((body: unknown) => (loc ? api.put(`/locations/${loc.id}`, body) : api.post('/locations', body)), { invalidate: ORG, success: 'Location saved', onSuccess: onClose });
  const e = save.fieldErrors;
  return (
    <Modal open onClose={onClose} title={loc ? `Edit ${loc.name}` : 'New location'} footer={<Footer onClose={onClose} loading={save.isPending} onSave={() => save.mutate(f)} />}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" required error={e.code}>
          {(id) => <Input id={id} value={f.code} onChange={(ev) => setF({ ...f, code: ev.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Name" required error={e.name}>
          {(id) => <Input id={id} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label="Address" error={e.address}>
            {(id) => <Textarea id={id} value={f.address} onChange={(ev) => setF({ ...f, address: ev.target.value })} />}
          </Field>
        </div>
        <StatusSelect value={f.status} onChange={(v) => setF({ ...f, status: v })} />
      </div>
    </Modal>
  );
}

function JobTitleModal({ title, departments, onClose }: { title?: JobTitle; departments: Department[]; onClose: () => void }) {
  const [f, setF] = useState({ name: title?.name ?? '', departmentId: title?.departmentId ?? '', status: title?.status ?? 'active' });
  const save = useAction((body: unknown) => (title ? api.put(`/job-titles/${title.id}`, body) : api.post('/job-titles', body)), { invalidate: ORG, success: 'Job title saved', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} size="sm" title={title ? 'Edit job title' : 'New job title'} footer={<Footer onClose={onClose} loading={save.isPending} onSave={() => save.mutate(f)} />}>
      <div className="space-y-4">
        <Field label="Name" required error={save.fieldErrors.name}>
          {(id) => <Input id={id} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} />}
        </Field>
        <Field label="Department" hint="Leave blank for titles used across departments">
          {(id) => (
            <Select id={id} value={f.departmentId} onChange={(ev) => setF({ ...f, departmentId: ev.target.value })}>
              <option value="">Any department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <StatusSelect value={f.status} onChange={(v) => setF({ ...f, status: v })} />
      </div>
    </Modal>
  );
}

function GradeModal({ grade, onClose }: { grade?: Grade; onClose: () => void }) {
  const [f, setF] = useState({ code: grade?.code ?? '', name: grade?.name ?? '', rank: String(grade?.rank ?? 0), status: grade?.status ?? 'active' });
  const save = useAction((body: unknown) => (grade ? api.put(`/grades/${grade.id}`, body) : api.post('/grades', body)), { invalidate: ORG, success: 'Grade saved', onSuccess: onClose });
  return (
    <Modal open onClose={onClose} size="sm" title={grade ? 'Edit grade' : 'New grade'} footer={<Footer onClose={onClose} loading={save.isPending} onSave={() => save.mutate({ ...f, rank: Number(f.rank) })} />}>
      <div className="space-y-4">
        <Field label="Code" required error={save.fieldErrors.code}>
          {(id) => <Input id={id} value={f.code} onChange={(ev) => setF({ ...f, code: ev.target.value.toUpperCase() })} />}
        </Field>
        <Field label="Name" required error={save.fieldErrors.name}>
          {(id) => <Input id={id} value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} />}
        </Field>
        <Field label="Rank" hint="Lower ranks sort first" error={save.fieldErrors.rank}>
          {(id) => <Input id={id} type="number" min={0} max={1000} value={f.rank} onChange={(ev) => setF({ ...f, rank: ev.target.value })} />}
        </Field>
        <StatusSelect value={f.status} onChange={(v) => setF({ ...f, status: v })} />
      </div>
    </Modal>
  );
}

type Tab = 'departments' | 'locations' | 'titles' | 'grades';

export function OrganisationPage() {
  const { can } = useAuth();
  const manage = can('org.manage');
  const [tab, setTab] = useState<Tab>('departments');
  const [modal, setModal] = useState<{ kind: Tab; item?: unknown } | null>(null);
  const deps = useApi<Department[]>('/departments');
  const locs = useApi<Location[]>('/locations');
  const titles = useApi<JobTitle[]>(manage ? '/job-titles' : null);
  const grades = useApi<Grade[]>(manage ? '/grades' : null);

  if (deps.isLoading || locs.isLoading) return <PageLoader />;
  if (deps.error || locs.error || !deps.data || !locs.data) return <ErrorState error={deps.error ?? locs.error} onRetry={() => (deps.refetch(), locs.refetch())} />;

  const addLabel: Record<Tab, string> = { departments: 'New department', locations: 'New location', titles: 'New job title', grades: 'New grade' };
  const editBtn = (kind: Tab, item: unknown) =>
    manage && (
      <Button size="sm" variant="ghost" aria-label="Edit" icon={<Pencil className="size-4" />} onClick={() => setModal({ kind, item })} />
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisation"
        description="Departments, work locations, job titles and grades. Archived items stay on historical records but cannot be newly assigned."
        actions={
          manage && (
            <Button icon={<Plus className="size-4" />} onClick={() => setModal({ kind: tab })}>
              {addLabel[tab]}
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'departments', label: 'Departments' },
          { key: 'locations', label: 'Locations' },
          { key: 'titles', label: 'Job titles', hidden: !manage },
          { key: 'grades', label: 'Grades', hidden: !manage },
        ]}
      />
      <Card padded={false}>
        {tab === 'departments' && (
          <Table>
            <thead>
              <tr>
                <Th>Department</Th>
                <Th className="hidden md:table-cell">Head</Th>
                <Th className="hidden lg:table-cell">Locations</Th>
                <Th align="right">Employees</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {deps.data.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <Link to={`/employees?departmentId=${d.id}`} className="font-medium text-brand-700 hover:underline">
                      {d.name}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-slate-500">{d.code}</span>
                    {d.description && <p className="text-xs text-slate-500">{d.description}</p>}
                  </Td>
                  <Td className="hidden md:table-cell">{d.headName ?? '—'}</Td>
                  <Td className="hidden text-xs text-slate-600 lg:table-cell">{d.locations.map((l) => l.name).join(', ') || '—'}</Td>
                  <Td align="right" className="tabular-nums">{d.activeEmployees}</Td>
                  <Td>
                    <StatusBadge status={d.status} />
                  </Td>
                  <Td align="right">{editBtn('departments', d)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {tab === 'locations' &&
          (!locs.data.length ? (
            <EmptyState title="No work locations" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Location</Th>
                  <Th className="hidden md:table-cell">Address</Th>
                  <Th align="right">Employees</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {locs.data.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      <span className="font-medium">{l.name}</span>
                      <span className="ml-2 font-mono text-xs text-slate-500">{l.code}</span>
                    </Td>
                    <Td className="hidden whitespace-pre-line text-xs text-slate-600 md:table-cell">{l.address ?? '—'}</Td>
                    <Td align="right" className="tabular-nums">{l.activeEmployees}</Td>
                    <Td>
                      <StatusBadge status={l.status} />
                    </Td>
                    <Td align="right">{editBtn('locations', l)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
        {tab === 'titles' &&
          (!titles.data?.length ? (
            <EmptyState title="No job titles" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Job title</Th>
                  <Th>Department</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {titles.data.map((t) => (
                  <tr key={t.id}>
                    <Td className="font-medium">{t.name}</Td>
                    <Td>{t.departmentName ?? 'Any'}</Td>
                    <Td>
                      <StatusBadge status={t.status} />
                    </Td>
                    <Td align="right">{editBtn('titles', t)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
        {tab === 'grades' &&
          (!grades.data?.length ? (
            <EmptyState title="No grades" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th align="right">Rank</Th>
                  <Th>Status</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {grades.data.map((g) => (
                  <tr key={g.id}>
                    <Td className="font-mono">{g.code}</Td>
                    <Td>{g.name}</Td>
                    <Td align="right">{g.rank}</Td>
                    <Td>
                      <StatusBadge status={g.status} />
                    </Td>
                    <Td align="right">{editBtn('grades', g)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
      </Card>
      {modal?.kind === 'departments' && <DepartmentModal dept={modal.item as Department | undefined} locations={locs.data} onClose={() => setModal(null)} />}
      {modal?.kind === 'locations' && <LocationModal loc={modal.item as Location | undefined} onClose={() => setModal(null)} />}
      {modal?.kind === 'titles' && <JobTitleModal title={modal.item as JobTitle | undefined} departments={deps.data} onClose={() => setModal(null)} />}
      {modal?.kind === 'grades' && <GradeModal grade={modal.item as Grade | undefined} onClose={() => setModal(null)} />}
    </div>
  );
}
