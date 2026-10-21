import { useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router';
import { Archive, ArchiveRestore, BadgeCheck, FilePen, Mail, Pencil } from 'lucide-react';
import { useMe } from '../../lib/auth';
import { useApi } from '../../lib/hooks';
import { date, dateTime, label } from '../../lib/format';
import type { EmployeeDetail, Lookups } from '../../lib/types';
import { Alert, Avatar, Button, Card, CardHeader, DescriptionList, EmptyState, ErrorState, PageHeader, PageLoader, StatusBadge, Tabs } from '../../components/ui';
import { ArchiveModal, CorrectionModal, EditEmployeeModal, InviteModal, VerifyModal } from './ProfileModals';
import { ApprovalsTab, AuditTab, DocumentsTab, HistoryTab, PayrollTab, RetirementTab } from './ProfileTabs';

export function MyProfileRedirect() {
  const me = useMe();
  if (!me.user.employeeId) return <EmptyState title="No employee record" description="Your account is not linked to an employee record." />;
  return <Navigate to={`/employees/${me.user.employeeId}`} replace />;
}

type TabKey = 'overview' | 'history' | 'documents' | 'payroll' | 'retirement' | 'approvals' | 'audit';
type ModalKey = 'edit' | 'correction' | 'verify' | 'archive' | 'invite' | null;

export function EmployeeProfilePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) || 'overview';
  const setTab = (t: TabKey) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
  const [modal, setModal] = useState<ModalKey>(null);
  const q = useApi<EmployeeDetail>(`/employees/${id}`);
  const lookups = useApi<Lookups>('/lookups');

  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const emp = q.data;
  const a = emp.access;
  const close = () => setModal(null);

  return (
    <div>
      <PageHeader
        back={a.self ? undefined : { to: '/employees', label: 'Directory' }}
        title={
          <span className="flex items-center gap-4">
            <Avatar name={emp.legalName} size="lg" />
            <span className="min-w-0">
              <span className="block truncate">{emp.legalName}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm font-normal text-slate-500">
                {emp.employmentNumber && <span className="font-mono text-slate-700">{emp.employmentNumber}</span>}
                <span>{emp.jobTitle?.name ?? 'No job title'}</span>
                <span aria-hidden>·</span>
                <span>{emp.department.name}</span>
                <StatusBadge status={emp.employmentStatus} />
                {emp.archived && <StatusBadge status="archived" />}
              </span>
            </span>
          </span>
        }
        actions={
          <>
            {a.canVerify && (
              <Button variant="success" icon={<BadgeCheck className="size-4" />} onClick={() => setModal('verify')}>
                Verify registration
              </Button>
            )}
            {a.updateMode !== 'none' && (
              <Button icon={<Pencil className="size-4" />} onClick={() => setModal('edit')}>
                Edit
              </Button>
            )}
            {a.canRequestCorrection && (
              <Button variant="secondary" icon={<FilePen className="size-4" />} onClick={() => setModal('correction')}>
                Request correction
              </Button>
            )}
            {a.canInvite && (
              <Button variant="secondary" icon={<Mail className="size-4" />} onClick={() => setModal('invite')}>
                Invite
              </Button>
            )}
            {a.canArchive && (
              <Button variant="secondary" icon={emp.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={() => setModal('archive')}>
                {emp.archived ? 'Restore' : 'Archive'}
              </Button>
            )}
          </>
        }
      />

      {emp.archived && emp.employment?.archiveReason && (
        <Alert tone="warning" className="mb-5" title="This record is archived">
          {emp.employment.archiveReason} · {date(emp.employment.archivedAt)}
        </Alert>
      )}
      {emp.employmentStatus === 'pending_verification' && (
        <Alert tone="info" className="mb-5">
          This record is awaiting verification. An employment number will be issued when it is approved.
        </Alert>
      )}

      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'history', label: 'Employment history', hidden: !a.employment },
          { key: 'documents', label: 'Documents', hidden: !a.documents },
          { key: 'payroll', label: 'Payroll', hidden: !a.payroll },
          { key: 'retirement', label: 'Retirement', hidden: !a.retirement },
          { key: 'approvals', label: 'Requests', hidden: !a.approvals },
          { key: 'audit', label: 'Audit trail', hidden: !a.audit },
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {emp.employment && (
              <Card>
                <CardHeader title="Employment" />
                <DescriptionList
                  items={[
                    { label: 'Employment number', value: emp.employment.employmentNumber ? <span className="font-mono">{emp.employment.employmentNumber}</span> : 'Not yet issued' },
                    { label: 'Status', value: <StatusBadge status={emp.employmentStatus} /> },
                    { label: 'Department', value: `${emp.department.name} (${emp.department.code})` },
                    { label: 'Work location', value: emp.workLocation ?? '—' },
                    { label: 'Assigned location', value: emp.location?.name ?? 'Unassigned' },
                    { label: 'Job title', value: emp.jobTitle?.name ?? 'Unassigned' },
                    { label: 'Grade', value: emp.grade ?? 'Unassigned' },
                    { label: 'Supervisor', value: emp.supervisor?.name ?? 'None' },
                    { label: 'Employment type', value: label(emp.employment.employmentType) },
                    { label: 'Employment date', value: date(emp.employment.employmentDate) },
                    { label: 'Contract end', value: date(emp.employment.contractEndDate), hidden: !emp.employment.contractEndDate },
                    { label: 'Verified', value: emp.employment.verifiedAt ? date(emp.employment.verifiedAt) : 'Pending' },
                  ]}
                />
              </Card>
            )}
            {emp.personal && (
              <Card>
                <CardHeader title="Personal details" description={a.self ? 'Visible to you and authorised HR staff only.' : undefined} />
                <DescriptionList
                  items={[
                    { label: 'Preferred name', value: emp.preferredName ?? '—', hidden: !a.personal },
                    { label: 'Date of birth', value: date(emp.personal.dateOfBirth) },
                    { label: 'Age', value: emp.personal.age ?? '—' },
                    { label: 'Phone', value: emp.personal.phone ?? '—', hidden: !a.personal },
                    { label: 'Personal email', value: emp.personal.personalEmail ?? '—', hidden: !a.personal },
                    { label: 'Address', value: emp.personal.address ?? '—', hidden: !a.personal },
                  ]}
                />
              </Card>
            )}
          </div>
          <div className="space-y-6">
            {emp.nextOfKin !== undefined && (
              <Card>
                <CardHeader title="Next of kin" />
                {emp.nextOfKin ? (
                  <DescriptionList
                    columns={1}
                    items={[
                      { label: 'Name', value: emp.nextOfKin.fullName },
                      { label: 'Relationship', value: emp.nextOfKin.relationship },
                      { label: 'Phone', value: emp.nextOfKin.phone },
                      { label: 'Address', value: emp.nextOfKin.address ?? '—' },
                    ]}
                  />
                ) : (
                  <p className="text-sm text-slate-500">Not recorded.</p>
                )}
              </Card>
            )}
            {a.account && (
              <Card>
                <CardHeader
                  title="System account"
                  actions={
                    a.self ? (
                      <Link to="/account" className="text-sm font-medium text-brand-700 hover:underline">
                        Manage
                      </Link>
                    ) : undefined
                  }
                />
                {emp.account ? (
                  <DescriptionList
                    columns={1}
                    items={[
                      { label: 'Username', value: emp.account.username },
                      { label: 'Email', value: emp.account.email },
                      { label: 'Account phone', value: emp.account.phone ?? '—' },
                      { label: 'Preferred language', value: label(emp.account.preferredLanguage) },
                      { label: 'Two-factor', value: emp.account.mfaEnabled ? 'Enabled' : 'Not enabled' },
                      { label: 'Last sign-in', value: dateTime(emp.account.lastLoginAt) },
                      { label: 'Account opened', value: date(emp.account.createdAt) },
                      { label: 'Account status', value: <StatusBadge status={emp.account.status} /> },
                    ]}
                  />
                ) : emp.pendingInvitation ? (
                  <p className="text-sm text-slate-600">
                    Invitation sent to <strong>{emp.pendingInvitation.email}</strong>, expires {date(emp.pendingInvitation.expiresAt)}.
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">No account linked.</p>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
      {tab === 'history' && <HistoryTab employeeId={emp.id} />}
      {tab === 'documents' && <DocumentsTab employeeId={emp.id} canManage={a.manageDocuments && !emp.archived} />}
      {tab === 'payroll' && <PayrollTab employeeId={emp.id} financeView={!a.self} />}
      {tab === 'retirement' && <RetirementTab employeeId={emp.id} />}
      {tab === 'approvals' && <ApprovalsTab employeeId={emp.id} />}
      {tab === 'audit' && <AuditTab employeeId={emp.id} />}

      {modal === 'edit' && <EditEmployeeModal emp={emp} lookups={lookups.data} open onClose={close} />}
      {modal === 'correction' && <CorrectionModal emp={emp} lookups={lookups.data} open onClose={close} />}
      {modal === 'verify' && <VerifyModal emp={emp} lookups={lookups.data} open onClose={close} />}
      {modal === 'archive' && <ArchiveModal emp={emp} open onClose={close} />}
      {modal === 'invite' && <InviteModal emp={emp} open onClose={close} />}
    </div>
  );
}
