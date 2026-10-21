import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { BadgeCheck, CalendarClock, CheckCircle2, FilePlus2, Gavel, Pencil, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { useAction, useApi } from '../../lib/hooks';
import { date, dateTime, minorToInput, money, parseMoney, todayIso } from '../../lib/format';
import { Alert, Badge, Button, Card, CardHeader, DescriptionList, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, StatusBadge, Textarea } from '../../components/ui';
import type { ReviewRow } from './Retirement';

interface Settlement {
  id: string;
  version: number;
  verificationStatus: 'draft' | 'submitted' | 'verified' | 'rejected';
  calculationMethod: string;
  policyReference: string | null;
  sourceFigures: Record<string, string | number>;
  lineItems: { label: string; kind: 'credit' | 'debit'; amount: number }[];
  totalAmount: number;
  currency: string;
  preparedByName: string | null;
  verificationNote: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

interface Review extends ReviewRow {
  decisionReason: string | null;
  decisionAt: string | null;
  completedAt: string | null;
  employmentDate: string | null;
  settlements: Settlement[];
  can: { prepare: boolean; editDraft: boolean; verify: boolean; decide: boolean; approve: boolean; complete: boolean };
}

type EditLine = { label: string; kind: 'credit' | 'debit'; amount: string };

function SettlementEditor({ reviewId, existing, onClose }: { reviewId: string; existing?: Settlement; onClose: () => void }) {
  const [method, setMethod] = useState(existing?.calculationMethod ?? '');
  const [reference, setReference] = useState(existing?.policyReference ?? '');
  const [figures, setFigures] = useState<{ key: string; value: string }[]>(
    existing ? Object.entries(existing.sourceFigures).map(([key, value]) => ({ key, value: String(value) })) : [{ key: 'Basic salary (monthly)', value: '' }, { key: 'Years of service', value: '' }],
  );
  const [lines, setLines] = useState<EditLine[]>(existing ? existing.lineItems.map((l) => ({ ...l, amount: minorToInput(l.amount) })) : [{ label: '', kind: 'credit', amount: '0.00' }]);
  const inv = ['/retirement', '/dashboard', '/approvals'];
  const save = useAction(
    (body: unknown) => (existing ? api.put(`/retirement/settlements/${existing.id}`, body) : api.post(`/retirement/reviews/${reviewId}/settlements`, body)),
    { invalidate: inv, success: 'Statement saved as draft', onSuccess: onClose },
  );
  const parsed = lines.map((l) => ({ ...l, value: parseMoney(l.amount) }));
  const invalid = method.trim().length < 10 || parsed.some((l) => l.value === null || !l.label.trim());
  const total = parsed.reduce((s, l) => s + (l.kind === 'credit' ? 1 : -1) * (l.value ?? 0), 0);

  const submit = () =>
    save.mutate({
      calculationMethod: method.trim(),
      policyReference: reference.trim() || null,
      sourceFigures: Object.fromEntries(figures.filter((x) => x.key.trim()).map((x) => [x.key.trim(), x.value])),
      lineItems: parsed.map((l) => ({ label: l.label.trim(), kind: l.kind, amount: l.value })),
    });

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={existing ? `Edit statement v${existing.version}` : 'Prepare retirement statement'}
      description="Record the calculation method and source figures used. The system does not apply any statutory formula — figures must come from the verified policy or contract."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={save.isPending} disabled={invalid}>
            Save draft
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Calculation method" required hint="Explain how each amount was derived (minimum 10 characters)." error={save.fieldErrors.calculationMethod}>
          {(id) => <Textarea id={id} rows={4} value={method} onChange={(e) => setMethod(e.target.value)} />}
        </Field>
        <Field label="Policy / legal reference" error={save.fieldErrors.policyReference}>
          {(id) => <Input id={id} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Pension Fund Rules s.12, employment contract clause 9" />}
        </Field>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Source figures</p>
            <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setFigures((f) => [...f, { key: '', value: '' }])}>
              Add figure
            </Button>
          </div>
          <div className="space-y-2">
            {figures.map((fig, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input value={fig.key} placeholder="Figure" aria-label="Figure name" onChange={(e) => setFigures((l) => l.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                <Input value={fig.value} placeholder="Value" aria-label="Figure value" onChange={(e) => setFigures((l) => l.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button variant="ghost" size="sm" aria-label="Remove figure" icon={<Trash2 className="size-4" />} onClick={() => setFigures((l) => l.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">Statement lines</p>
            <Button size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={() => setLines((l) => [...l, { label: '', kind: 'credit', amount: '0.00' }])}>
              Add line
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_130px_auto] gap-2">
                <Input value={l.label} placeholder="Description" aria-label="Description" invalid={!l.label.trim()} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
                <Select value={l.kind} aria-label="Type" onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, kind: e.target.value as EditLine['kind'] } : y)))}>
                  <option value="credit">Payable</option>
                  <option value="debit">Deduction</option>
                </Select>
                <Input value={l.amount} inputMode="decimal" aria-label="Amount" className="tabular-nums" invalid={parseMoney(l.amount) === null} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
                <Button variant="ghost" size="sm" aria-label="Remove line" icon={<Trash2 className="size-4" />} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
          <p className="mt-3 text-right text-sm">
            Estimated total: <span className="font-semibold tabular-nums">{money(total, 'MWK')}</span>
          </p>
        </div>
      </div>
    </Modal>
  );
}

function SettlementCard({ s, review }: { s: Settlement; review: Review }) {
  const [editing, setEditing] = useState(false);
  const [verifying, setVerifying] = useState<'verify' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const inv = ['/retirement', '/dashboard', '/approvals'];
  const submit = useAction(() => api.post(`/retirement/settlements/${s.id}/submit`), { invalidate: inv, success: 'Statement submitted for verification' });
  const verify = useAction((body: { decision: string; note: string }) => api.post(`/retirement/settlements/${s.id}/verify`, body), {
    invalidate: inv,
    success: (r) => ((r as { status: string }).status === 'verified' ? 'Statement verified and sent for executive decision' : 'Statement returned to Finance'),
    onSuccess: () => setVerifying(null),
  });
  const latest = review.settlements[0]?.id === s.id;

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            Statement v{s.version} <StatusBadge status={s.verificationStatus} />
          </span>
        }
        description={`Prepared by ${s.preparedByName ?? '—'} · ${dateTime(s.createdAt)}`}
        actions={
          latest && (
            <div className="flex flex-wrap gap-2">
              {review.can.editDraft && s.verificationStatus === 'draft' && (
                <>
                  <Button size="sm" variant="secondary" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button size="sm" icon={<Send className="size-3.5" />} loading={submit.isPending} onClick={() => submit.mutate(undefined)}>
                    Submit
                  </Button>
                </>
              )}
              {review.can.verify && s.verificationStatus === 'submitted' && (
                <>
                  <Button size="sm" variant="danger" icon={<XCircle className="size-3.5" />} onClick={() => setVerifying('reject')}>
                    Return
                  </Button>
                  <Button size="sm" variant="success" icon={<BadgeCheck className="size-3.5" />} onClick={() => setVerifying('verify')}>
                    Verify
                  </Button>
                </>
              )}
            </div>
          )
        }
      />
      <div className="space-y-4 text-sm">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Calculation method</p>
          <p className="mt-1 whitespace-pre-line">{s.calculationMethod}</p>
          {s.policyReference && <p className="mt-1 text-xs text-slate-500">Reference: {s.policyReference}</p>}
        </div>
        {Object.keys(s.sourceFigures).length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Source figures</p>
            <dl className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {Object.entries(s.sourceFigures).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-medium">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <table className="w-full">
          <tbody className="divide-y divide-slate-100">
            {s.lineItems.map((l, i) => (
              <tr key={i}>
                <td className="py-1.5">{l.label}</td>
                <td className="py-1.5 text-right tabular-nums">
                  {l.kind === 'debit' ? '−' : ''}
                  {money(l.amount, s.currency)}
                </td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2">Total {s.verificationStatus === 'verified' ? '(verified)' : '(estimate)'}</td>
              <td className="py-2 text-right tabular-nums">{money(s.totalAmount, s.currency)}</td>
            </tr>
          </tbody>
        </table>
        {s.verificationNote && (
          <Alert tone={s.verificationStatus === 'rejected' ? 'warning' : 'success'} title={s.verificationStatus === 'rejected' ? 'Returned by reviewer' : 'Verification note'}>
            {s.verificationNote}
          </Alert>
        )}
      </div>
      {editing && <SettlementEditor reviewId={review.id} existing={s} onClose={() => setEditing(false)} />}
      {verifying && (
        <Modal
          open
          onClose={() => setVerifying(null)}
          size="sm"
          title={verifying === 'verify' ? 'Verify statement' : 'Return statement'}
          description={verifying === 'verify' ? 'Confirms you have checked the figures against source records. The review then goes to the Super Admin for decision.' : 'The preparer will be asked to revise and resubmit.'}
          footer={
            <>
              <Button variant="secondary" onClick={() => setVerifying(null)}>
                Cancel
              </Button>
              <Button variant={verifying === 'verify' ? 'success' : 'danger'} disabled={note.trim().length < 3} loading={verify.isPending} onClick={() => verify.mutate({ decision: verifying, note })}>
                {verifying === 'verify' ? 'Verify' : 'Return'}
              </Button>
            </>
          }
        >
          <Field label="Note" required hint="At least 3 characters">
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </Modal>
      )}
    </Card>
  );
}

function DecisionModal({ review, onClose }: { review: Review; onClose: () => void }) {
  const [decision, setDecision] = useState<'approve' | 'reject' | 'defer'>(review.can.approve ? 'approve' : 'defer');
  const [reason, setReason] = useState('');
  const [deferredUntil, setDeferredUntil] = useState('');
  const act = useAction((body: unknown) => api.post(`/retirement/reviews/${review.id}/decision`, body), {
    invalidate: ['/retirement', '/dashboard', '/approvals'],
    success: 'Decision recorded',
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Retirement decision"
      description={`${review.legalName} · expected ${date(review.deferredUntil ?? review.expectedRetirementDate)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={decision === 'reject' ? 'danger' : 'primary'}
            disabled={reason.trim().length < 5 || (decision === 'defer' && !deferredUntil)}
            loading={act.isPending}
            onClick={() => act.mutate({ decision, reason, deferredUntil: decision === 'defer' ? deferredUntil : null })}
          >
            Record decision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Decision" required>
          {(id) => (
            <Select id={id} value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}>
              {review.can.approve && <option value="approve">Approve retirement</option>}
              <option value="defer">Defer to a later date</option>
              <option value="reject">Do not proceed</option>
            </Select>
          )}
        </Field>
        {!review.can.approve && <Alert tone="info">Approval requires a verified retirement statement.</Alert>}
        {decision === 'defer' && (
          <Field label="Deferred until" required error={act.fieldErrors.deferredUntil}>
            {(id) => <Input id={id} type="date" value={deferredUntil} onChange={(e) => setDeferredUntil(e.target.value)} />}
          </Field>
        )}
        <Field label="Reason" required hint="At least 5 characters. Recorded in the audit trail.">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

function CompleteModal({ review, onClose }: { review: Review; onClose: () => void }) {
  const [effectiveDate, setEffectiveDate] = useState(review.deferredUntil ?? review.expectedRetirementDate ?? todayIso());
  const [reason, setReason] = useState('');
  const act = useAction((body: unknown) => api.post(`/retirement/reviews/${review.id}/complete`, body), {
    invalidate: ['/retirement', '/dashboard', '/employees'],
    success: 'Retirement finalised; employee record archived',
    onSuccess: onClose,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Finalise retirement"
      description="The employee's status becomes Retired, their record is archived (never deleted) and their login is deactivated. You will be asked to confirm your password."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 5 || !effectiveDate} loading={act.isPending} onClick={() => act.mutate({ effectiveDate, reason })}>
            Finalise retirement
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Effective date" required>
          {(id) => <Input id={id} type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />}
        </Field>
        <Field label="Reason" required hint="At least 5 characters">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
    </Modal>
  );
}

export function RetirementReviewPage() {
  const { id = '' } = useParams();
  const q = useApi<Review>(`/retirement/reviews/${id}`);
  const [modal, setModal] = useState<'prepare' | 'decide' | 'complete' | null>(null);
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/retirement', label: 'Retirement' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {r.legalName} <StatusBadge status={r.status} />
          </span>
        }
        description={`${r.employmentNumber ?? ''} · ${r.departmentName}`}
        actions={
          <>
            {r.can.prepare && (
              <Button icon={<FilePlus2 className="size-4" />} onClick={() => setModal('prepare')}>
                Prepare statement
              </Button>
            )}
            {r.can.decide && (
              <Button variant={r.can.approve ? 'primary' : 'secondary'} icon={<Gavel className="size-4" />} onClick={() => setModal('decide')}>
                Record decision
              </Button>
            )}
            {r.can.complete && (
              <Button variant="danger" icon={<CheckCircle2 className="size-4" />} onClick={() => setModal('complete')}>
                Finalise retirement
              </Button>
            )}
          </>
        }
      />

      {r.outstandingActions?.length > 0 && (
        <Alert tone="info" title="Outstanding actions">
          <ul className="list-disc pl-5">
            {r.outstandingActions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {r.settlements.length === 0 ? (
            <Card>
              <EmptyState icon={<CalendarClock className="size-5" />} title="No retirement statement yet" description="Finance prepares an estimated statement, which must be verified by a different reviewer before an executive decision." />
            </Card>
          ) : (
            r.settlements.map((s) => <SettlementCard key={s.id} s={s} review={r} />)
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Review details" />
            <DescriptionList
              columns={1}
              items={[
                { label: 'Employee', value: <Link className="text-brand-700 hover:underline" to={`/employees/${r.employeeId}`}>{r.legalName}</Link> },
                { label: 'Date of birth', value: `${date(r.dateOfBirth)}${r.age !== null ? ` (age ${r.age})` : ''}` },
                { label: 'Employed since', value: date(r.employmentDate) },
                { label: 'Policy', value: `${r.policyName} · retirement at ${r.retirementAge}` },
                { label: 'Expected retirement', value: date(r.expectedRetirementDate) },
                { label: 'Deferred until', value: r.deferredUntil ? date(r.deferredUntil) : '—', hidden: !r.deferredUntil },
                { label: 'Flagged for review', value: r.flaggedAt ? dateTime(r.flaggedAt) : 'Not yet' },
              ]}
            />
          </Card>
          {r.decisionAt && (
            <Card>
              <CardHeader title="Latest decision" />
              <p className="text-sm">{r.decisionReason}</p>
              <p className="mt-2 text-xs text-slate-500">{dateTime(r.decisionAt)}</p>
              {r.completedAt && <Badge tone="green" className="mt-2">Finalised {dateTime(r.completedAt)}</Badge>}
            </Card>
          )}
        </div>
      </div>

      {modal === 'prepare' && <SettlementEditor reviewId={r.id} onClose={() => setModal(null)} />}
      {modal === 'decide' && <DecisionModal review={r} onClose={() => setModal(null)} />}
      {modal === 'complete' && <CompleteModal review={r} onClose={() => setModal(null)} />}
    </div>
  );
}
