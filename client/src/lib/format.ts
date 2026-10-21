/** Formats integer minor units (e.g. tambala) as a currency amount. */
export function money(minor: number | null | undefined, currency = 'MWK'): string {
  if (minor === null || minor === undefined) return '—';
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${currency} ${whole}.${cents}`;
}

/** Parses a user-entered decimal amount into integer minor units; returns null if invalid. */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  const value = Number(w) * 100 + Number(f.padEnd(2, '0'));
  return Number.isSafeInteger(value) ? value : null;
}

export function minorToInput(minor: number): string {
  return (minor / 100).toFixed(2);
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function date(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

export function relative(value: string | Date | null | undefined): string {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return mins > 0 ? `${mins} min ago` : `in ${-mins} min`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return hours > 0 ? `${hours} h ago` : `in ${-hours} h`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return days > 0 ? `${days} d ago` : `in ${-days} d`;
  return date(value);
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Human labels for enum-like values. */
const LABELS: Record<string, string> = {
  pending_verification: 'Pending verification',
  active: 'Active',
  on_leave: 'On leave',
  suspended: 'Suspended',
  retired: 'Retired',
  terminated: 'Terminated',
  rejected: 'Rejected',
  deactivated: 'Deactivated',
  mfa_pending: 'MFA pending',
  permanent: 'Permanent',
  contract: 'Contract',
  temporary: 'Temporary',
  volunteer: 'Volunteer',
  intern: 'Intern',
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  superseded: 'Superseded',
  published: 'Published',
  archived: 'Archived',
  completed: 'Completed',
  cancelled: 'Cancelled',
  pending: 'Pending',
  upcoming: 'Upcoming',
  review_required: 'Review required',
  deferred: 'Deferred',
  submitted: 'Submitted',
  verified: 'Verified',
  paid: 'Paid',
  unpaid: 'Unpaid',
  open: 'Open',
  closed: 'Closed',
  registration: 'Registration',
  employee_change: 'Employment change',
  profile_correction: 'Correction request',
  payroll_record: 'Payroll record',
  retirement_decision: 'Retirement decision',
  success: 'Success',
  denied: 'Denied',
  failure: 'Failure',
  hire: 'Hired',
  transfer: 'Transfer',
  location_change: 'Location change',
  title_change: 'Job title change',
  grade_change: 'Grade change',
  supervisor_change: 'Supervisor change',
  status_change: 'Status change',
  correction: 'Correction',
  contract_change: 'Contract change',
  archive: 'Archived',
  restore: 'Restored',
  retirement: 'Retirement',
  org_unit: 'Department / location',
  direct_reports: 'Direct reports',
  visible: 'Visible',
  hidden: 'Hidden',
  allowance: 'Allowance',
  bonus: 'Bonus',
  overtime: 'Overtime',
  other_earning: 'Other earning',
  tax: 'Tax',
  pension: 'Pension',
  loan: 'Loan',
  other_deduction: 'Other deduction',
  general: 'General',
  identity: 'Identity',
  qualification: 'Qualification',
  medical: 'Medical',
  attachment: 'Attachment',
  en: 'English',
  ny: 'Chichewa',
  tum: 'Chitumbuka',
  'auth.login': 'Signed in',
  'auth.login.password_ok': 'Password accepted',
  'auth.logout': 'Signed out',
  'auth.password_change': 'Password changed',
  'auth.mfa': 'Verification code',
  'auth.mfa_enabled': 'Two-factor enabled',
  'auth.mfa_disabled': 'Two-factor disabled',
  'auth.reauth': 'Password confirmed',
  'auth.register': 'Registered',
  'auth.profile_update': 'Profile updated',
  'auth.session_revoke': 'Session ended',
  'auth.invitation_accepted': 'Invitation accepted',
};

export function label(value: string | null | undefined): string {
  if (!value) return '—';
  return LABELS[value] ?? value.replace(/[_.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

const TONES: Record<string, Tone> = {
  active: 'green',
  approved: 'green',
  published: 'green',
  verified: 'green',
  paid: 'green',
  completed: 'green',
  success: 'green',
  visible: 'green',
  open: 'green',
  pending_verification: 'amber',
  pending_approval: 'amber',
  pending: 'amber',
  review_required: 'amber',
  submitted: 'amber',
  on_leave: 'blue',
  upcoming: 'blue',
  draft: 'gray',
  unpaid: 'gray',
  closed: 'gray',
  archived: 'gray',
  superseded: 'gray',
  retired: 'violet',
  deferred: 'violet',
  suspended: 'red',
  terminated: 'red',
  rejected: 'red',
  cancelled: 'red',
  deactivated: 'red',
  denied: 'red',
  failure: 'red',
  hidden: 'red',
};

export function toneFor(value: string | null | undefined): Tone {
  return (value && TONES[value]) || 'gray';
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
