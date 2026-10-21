/**
 * Permission catalog. Roles map to permissions; the backend policy layer is the only
 * place these are enforced. The frontend uses them purely to decide what to display.
 */
export const PERMISSIONS = {
  // Employee records
  'employee.read.all': 'View employment information for all employees',
  'employee.read.scoped': 'View employment information for employees within assigned scope',
  'employee.read.personal': 'View personal details (date of birth, phone, personal email, address) of viewable employees',
  'employee.read.age': 'View date of birth and age of viewable employees (finance matrix)',
  'employee.read.next_of_kin': 'View next-of-kin details of viewable employees',
  'employee.create': 'Create employee records and invitations',
  'employee.update.all': 'Update operational employee information for any employee',
  'employee.update.scoped': 'Update operational employee information within assigned scope',
  'employee.verify': 'Verify pending registrations and issue employment numbers',
  'employee.approve_changes': 'Approve controlled employment changes and correction requests',
  'employee.override': 'Apply controlled changes directly with a mandatory reason (executive override)',
  'employee.archive': 'Archive and restore employee records',
  'employee.export': 'Export employee data within field-level permissions',
  'document.manage': 'Upload and archive employee documents for viewable employees',

  // Organisation
  'org.manage': 'Manage departments, locations, job titles and grades',
  'role.assign': 'Assign and revoke roles and individual permission grants',
  'scope.manage': 'Assign and change moderator scopes',
  'user.manage': 'Suspend, deactivate, reactivate users and reset access',

  // Finance
  'payroll.read': 'View payroll records, totals and payslips for all employees',
  'payroll.prepare': 'Create and edit draft payroll records and line items',
  'payroll.approve': 'Approve payroll records prepared by another user',
  'payroll.export': 'Export payroll reports',
  'payroll.period.manage': 'Create, open and close payroll periods',

  // Retirement
  'retirement.read': 'View retirement dashboard and reviews',
  'retirement.prepare': 'Prepare retirement settlement statements',
  'retirement.verify': 'Verify retirement settlement statements',
  'retirement.decide': 'Approve, reject or defer retirement decisions and finalize retirements',
  'retirement.policy.manage': 'Configure and adopt retirement policies',

  // Communications
  'announcement.manage': 'Create, publish and archive announcements',
  'event.manage': 'Create and manage events',
  'comment.create': 'Comment on announcements and events where enabled',
  'comment.moderate': 'Hide or restore comments',

  // Governance
  'approval.read': 'View approval queue entries relevant to held permissions',
  'audit.read': 'View and search the audit log',
  'settings.manage': 'Change organisation and security settings',
  'report.org': 'View organisation-wide reports',
  'report.finance': 'View financial reports',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_KEYS = ['super_admin', 'admin', 'moderator', 'finance', 'employee'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Roles that can only be granted by a super admin with recent re-authentication. */
export const PRIVILEGED_ROLES: RoleKey[] = ['super_admin', 'admin', 'moderator', 'finance'];

export const ROLE_META: Record<RoleKey, { name: string; description: string; rank: number }> = {
  super_admin: { name: 'Super Admin', description: 'Highest authority; governs roles, policies and executive approvals', rank: 100 },
  admin: { name: 'Administrator', description: 'Organisation-wide operations, records, announcements and events', rank: 60 },
  moderator: { name: 'Moderator', description: 'Manages employees within explicitly assigned scopes', rank: 40 },
  finance: { name: 'Finance Officer', description: 'Payroll, payslips, retirement statements and financial reports', rank: 50 },
  employee: { name: 'Employee', description: 'Standard self-service access', rank: 10 },
};

export const ROLE_PERMISSIONS: Record<RoleKey, Permission[]> = {
  super_admin: [...ALL_PERMISSIONS],
  admin: [
    'employee.read.all',
    'employee.read.personal',
    'employee.create',
    'employee.update.all',
    'employee.verify',
    'employee.export',
    'document.manage',
    'scope.manage',
    'retirement.read',
    'retirement.verify',
    'announcement.manage',
    'event.manage',
    'comment.create',
    'comment.moderate',
    'approval.read',
    'report.org',
  ],
  moderator: [
    'employee.read.scoped',
    'employee.read.personal',
    'employee.update.scoped',
    'comment.create',
    'approval.read',
  ],
  finance: [
    'employee.read.all',
    'employee.read.age',
    'payroll.read',
    'payroll.prepare',
    'payroll.approve',
    'payroll.export',
    'payroll.period.manage',
    'retirement.read',
    'retirement.prepare',
    'comment.create',
    'approval.read',
    'report.finance',
  ],
  employee: ['comment.create'],
};
