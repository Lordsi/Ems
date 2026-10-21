import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  bigint,
  bigserial,
  date,
  timestamp,
  jsonb,
  customType,
  primaryKey,
  uniqueIndex,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => 'bytea',
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: 'number' });

/* ------------------------------------------------------------------ */
/* Identity & access                                                  */
/* ------------------------------------------------------------------ */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 254 }).notNull(),
    username: varchar('username', { length: 40 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    // pending_verification | active | suspended | deactivated
    status: varchar('status', { length: 32 }).notNull().default('pending_verification'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecretEnc: text('mfa_secret_enc'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    lastLoginAt: ts('last_login_at'),
    passwordChangedAt: ts('password_changed_at'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    /** Contact number the person maintains on their own account. Distinct from the HR-held employee phone. */
    phone: varchar('phone', { length: 40 }),
    /** en English, ny Chichewa, tum Chitumbuka. Used for notices; the interface stays in English. */
    preferredLanguage: varchar('preferred_language', { length: 16 }).notNull().default('en'),
    notifyAnnouncements: boolean('notify_announcements').notNull().default(true),
    notifyEvents: boolean('notify_events').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
    uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`),
    check('users_status_ck', sql`${t.status} in ('pending_verification','active','suspended','deactivated')`),
    check('users_language_ck', sql`${t.preferredLanguage} in ('en','ny','tum')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(), // sha256(token) hex
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    reauthAt: ts('reauth_at'),
    mfaPending: boolean('mfa_pending').notNull().default(false),
    revokedAt: ts('revoked_at'),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 300 }),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 40 }).notNull().unique(),
  name: varchar('name', { length: 80 }).notNull(),
  description: text('description'),
  rank: integer('rank').notNull().default(0),
});

export const permissions = pgTable('permissions', {
  key: varchar('key', { length: 80 }).primaryKey(),
  description: text('description').notNull(),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 80 })
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

/** Narrow, individually granted permissions (e.g. payroll read for one administrator). */
export const userPermissionGrants = pgTable(
  'user_permission_grants',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 80 })
      .notNull()
      .references(() => permissions.key),
    grantedBy: uuid('granted_by').references(() => users.id),
    grantedAt: createdAt(),
    reason: text('reason'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permissionKey] })],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    email: varchar('email', { length: 254 }).notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references((): AnyPgColumn => employees.id),
    roleKey: varchar('role_key', { length: 40 }).notNull().default('employee'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('invitations_employee_idx').on(t.employeeId)],
);

/* ------------------------------------------------------------------ */
/* Organisation                                                       */
/* ------------------------------------------------------------------ */

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 8 }).notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    description: text('description'),
    headEmployeeId: uuid('head_employee_id').references((): AnyPgColumn => employees.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('departments_code_ck', sql`${t.code} ~ '^[A-Z]{2,8}$'`),
    check('departments_status_ck', sql`${t.status} in ('active','archived')`),
  ],
);

export const workLocations = pgTable(
  'work_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 16 }).notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    address: text('address'),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('work_locations_status_ck', sql`${t.status} in ('active','archived')`)],
);

export const departmentLocations = pgTable(
  'department_locations',
  {
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => workLocations.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.departmentId, t.locationId] })],
);

export const jobTitles = pgTable(
  'job_titles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    departmentId: uuid('department_id').references(() => departments.id),
    status: varchar('status', { length: 16 }).notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('job_titles_name_dept_uq').on(t.name, t.departmentId)],
);

export const employmentGrades = pgTable('employment_grades', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 16 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  rank: integer('rank').notNull().default(0),
  status: varchar('status', { length: 16 }).notNull().default('active'),
});

export const employmentNumberSequences = pgTable('employment_number_sequences', {
  departmentId: uuid('department_id')
    .primaryKey()
    .references(() => departments.id),
  nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
});

/* ------------------------------------------------------------------ */
/* Employees                                                          */
/* ------------------------------------------------------------------ */

export const EMPLOYMENT_STATUSES = [
  'pending_verification',
  'active',
  'on_leave',
  'suspended',
  'retired',
  'terminated',
  'rejected',
] as const;

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .unique()
      .references(() => users.id),
    /** Immutable once issued. Never reused. */
    employmentNumber: varchar('employment_number', { length: 20 }).unique(),
    /** Department whose sequence issued the employment number (kept even after transfers). */
    numberDepartmentId: uuid('number_department_id').references(() => departments.id),
    legalName: varchar('legal_name', { length: 160 }).notNull(),
    preferredName: varchar('preferred_name', { length: 120 }),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    phone: varchar('phone', { length: 32 }),
    personalEmail: varchar('personal_email', { length: 254 }),
    address: text('address'),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id),
    locationId: uuid('location_id').references(() => workLocations.id),
    /** Free-text place of work as written by the employee; `locationId` remains the official assignment used for scopes and targeting. */
    workLocation: varchar('work_location', { length: 160 }),
    jobTitleId: uuid('job_title_id').references(() => jobTitles.id),
    gradeId: uuid('grade_id').references(() => employmentGrades.id),
    supervisorId: uuid('supervisor_id').references((): AnyPgColumn => employees.id, { onDelete: 'set null' }),
    // permanent | contract | temporary | volunteer | intern
    employmentType: varchar('employment_type', { length: 24 }).notNull().default('permanent'),
    employmentDate: date('employment_date', { mode: 'string' }),
    contractEndDate: date('contract_end_date', { mode: 'string' }),
    employmentStatus: varchar('employment_status', { length: 32 }).notNull().default('pending_verification'),
    verifiedAt: ts('verified_at'),
    verifiedBy: uuid('verified_by').references(() => users.id),
    archivedAt: ts('archived_at'),
    archivedBy: uuid('archived_by').references(() => users.id),
    archiveReason: text('archive_reason'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('employees_department_idx').on(t.departmentId),
    index('employees_location_idx').on(t.locationId),
    index('employees_supervisor_idx').on(t.supervisorId),
    index('employees_status_idx').on(t.employmentStatus),
    index('employees_job_title_idx').on(t.jobTitleId),
    index('employees_legal_name_idx').on(sql`lower(${t.legalName})`),
    check(
      'employees_status_ck',
      sql`${t.employmentStatus} in ('pending_verification','active','on_leave','suspended','retired','terminated','rejected')`,
    ),
    check(
      'employees_type_ck',
      sql`${t.employmentType} in ('permanent','contract','temporary','volunteer','intern')`,
    ),
    check('employees_number_format_ck', sql`${t.employmentNumber} is null or ${t.employmentNumber} ~ '^[A-Z]{2,8}-[0-9]{6,}$'`),
  ],
);

export const nextOfKin = pgTable('next_of_kin', {
  id: uuid('id').primaryKey().defaultRandom(),
  employeeId: uuid('employee_id')
    .notNull()
    .unique()
    .references(() => employees.id, { onDelete: 'cascade' }),
  fullName: varchar('full_name', { length: 160 }).notNull(),
  relationship: varchar('relationship', { length: 60 }).notNull(),
  phone: varchar('phone', { length: 32 }).notNull(),
  address: text('address'),
  updatedAt: updatedAt(),
});

export const employmentHistory = pgTable(
  'employment_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    // hire | verification | transfer | location_change | title_change | grade_change | supervisor_change | status_change | correction | archive | restore | retirement
    changeType: varchar('change_type', { length: 32 }).notNull(),
    fromValues: jsonb('from_values').$type<Record<string, unknown>>(),
    toValues: jsonb('to_values').$type<Record<string, unknown>>(),
    effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    approvalId: uuid('approval_id').references((): AnyPgColumn => approvalRequests.id),
    createdAt: createdAt(),
  },
  (t) => [index('employment_history_employee_idx').on(t.employeeId, t.createdAt)],
);

/** Moderator scope grants. A row grants: department (∩ location if both set), a location, or direct reports. */
export const moderatorScopes = pgTable(
  'moderator_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // org_unit | direct_reports
    scopeType: varchar('scope_type', { length: 24 }).notNull().default('org_unit'),
    departmentId: uuid('department_id').references(() => departments.id),
    locationId: uuid('location_id').references(() => workLocations.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('moderator_scopes_user_idx').on(t.userId),
    check(
      'moderator_scopes_shape_ck',
      sql`(${t.scopeType} = 'direct_reports' and ${t.departmentId} is null and ${t.locationId} is null)
          or (${t.scopeType} = 'org_unit' and (${t.departmentId} is not null or ${t.locationId} is not null))`,
    ),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // employee | announcement
    ownerType: varchar('owner_type', { length: 24 }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    category: varchar('category', { length: 40 }).notNull().default('general'),
    filename: varchar('filename', { length: 200 }).notNull(),
    mimeType: varchar('mime_type', { length: 80 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    data: bytea('data').notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [index('documents_owner_idx').on(t.ownerType, t.ownerId)],
);

/* ------------------------------------------------------------------ */
/* Approvals                                                          */
/* ------------------------------------------------------------------ */

export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // registration | employee_change | profile_correction | payroll_record | retirement_decision
    type: varchar('type', { length: 40 }).notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    targetType: varchar('target_type', { length: 40 }).notNull(),
    targetId: uuid('target_id').notNull(),
    /** Department of the affected employee, used for scoping queue visibility. */
    departmentId: uuid('department_id').references(() => departments.id),
    summary: text('summary').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    reason: text('reason'),
    requiredPermission: varchar('required_permission', { length: 80 }).notNull(),
    requestedBy: uuid('requested_by').references(() => users.id),
    requestedAt: createdAt(),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
  },
  (t) => [
    index('approval_requests_status_idx').on(t.status, t.type),
    index('approval_requests_target_idx').on(t.targetType, t.targetId),
    check('approval_requests_status_ck', sql`${t.status} in ('pending','approved','rejected','cancelled')`),
  ],
);

/* ------------------------------------------------------------------ */
/* Payroll                                                            */
/* ------------------------------------------------------------------ */

export const payrollPeriods = pgTable(
  'payroll_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 20 }).notNull().unique(),
    name: varchar('name', { length: 80 }).notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    payDate: date('pay_date', { mode: 'string' }).notNull(),
    // open | closed
    status: varchar('status', { length: 16 }).notNull().default('open'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [check('payroll_periods_dates_ck', sql`${t.endDate} >= ${t.startDate}`)],
);

export const payrollRecords = pgTable(
  'payroll_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    periodId: uuid('period_id')
      .notNull()
      .references(() => payrollPeriods.id),
    revision: integer('revision').notNull().default(1),
    supersedesId: uuid('supersedes_id').references((): AnyPgColumn => payrollRecords.id),
    // draft | pending_approval | approved | rejected | superseded
    status: varchar('status', { length: 24 }).notNull().default('draft'),
    currency: varchar('currency', { length: 3 }).notNull(),
    basicSalary: money('basic_salary').notNull().default(0),
    grossEarnings: money('gross_earnings').notNull().default(0),
    totalDeductions: money('total_deductions').notNull().default(0),
    netPay: money('net_pay').notNull().default(0),
    // unpaid | paid
    paymentStatus: varchar('payment_status', { length: 16 }).notNull().default('unpaid'),
    paymentDate: date('payment_date', { mode: 'string' }),
    notes: text('notes'),
    adjustmentReason: text('adjustment_reason'),
    discrepancyFlag: boolean('discrepancy_flag').notNull().default(false),
    discrepancyNote: text('discrepancy_note'),
    preparedBy: uuid('prepared_by')
      .notNull()
      .references(() => users.id),
    submittedAt: ts('submitted_at'),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: ts('approved_at'),
    approvalId: uuid('approval_id').references(() => approvalRequests.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payroll_records_emp_period_rev_uq').on(t.employeeId, t.periodId, t.revision),
    uniqueIndex('payroll_records_one_open_uq')
      .on(t.employeeId, t.periodId)
      .where(sql`${t.status} in ('draft','pending_approval')`),
    uniqueIndex('payroll_records_one_approved_uq')
      .on(t.employeeId, t.periodId)
      .where(sql`${t.status} = 'approved'`),
    index('payroll_records_period_idx').on(t.periodId, t.status),
    check(
      'payroll_records_status_ck',
      sql`${t.status} in ('draft','pending_approval','approved','rejected','superseded')`,
    ),
    check('payroll_records_totals_ck', sql`${t.netPay} = ${t.grossEarnings} - ${t.totalDeductions}`),
    check('payroll_records_nonneg_ck', sql`${t.basicSalary} >= 0 and ${t.grossEarnings} >= 0 and ${t.totalDeductions} >= 0`),
  ],
);

export const payrollLineItems = pgTable(
  'payroll_line_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => payrollRecords.id, { onDelete: 'cascade' }),
    // earning | deduction
    kind: varchar('kind', { length: 16 }).notNull(),
    // allowance | bonus | overtime | other_earning | tax | pension | loan | other_deduction
    category: varchar('category', { length: 32 }).notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    amount: money('amount').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('payroll_line_items_record_idx').on(t.recordId),
    check('payroll_line_items_kind_ck', sql`${t.kind} in ('earning','deduction')`),
    check('payroll_line_items_amount_ck', sql`${t.amount} >= 0`),
  ],
);

export const payslips = pgTable('payslips', {
  id: uuid('id').primaryKey().defaultRandom(),
  payslipNumber: varchar('payslip_number', { length: 40 }).notNull().unique(),
  payrollRecordId: uuid('payroll_record_id')
    .notNull()
    .unique()
    .references(() => payrollRecords.id),
  employeeId: uuid('employee_id')
    .notNull()
    .references(() => employees.id),
  /** Frozen copy of everything printed on the payslip. */
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
  issuedBy: uuid('issued_by')
    .notNull()
    .references(() => users.id),
  issuedAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Retirement                                                         */
/* ------------------------------------------------------------------ */

export const retirementPolicies = pgTable('retirement_policies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  retirementAge: integer('retirement_age').notNull(),
  reviewLeadMonths: integer('review_lead_months').notNull().default(6),
  upcomingWindowMonths: integer('upcoming_window_months').notNull().default(12),
  /** Null = organisation-wide; otherwise a department-specific exception. */
  departmentId: uuid('department_id').references(() => departments.id),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  effectiveTo: date('effective_to', { mode: 'string' }),
  /** Policy is only applied once explicitly adopted and verified by a super admin. */
  adopted: boolean('adopted').notNull().default(false),
  adoptedBy: uuid('adopted_by').references(() => users.id),
  adoptedAt: ts('adopted_at'),
  legalReference: text('legal_reference'),
  notes: text('notes'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const retirementReviews = pgTable(
  'retirement_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    policyId: uuid('policy_id')
      .notNull()
      .references(() => retirementPolicies.id),
    expectedRetirementDate: date('expected_retirement_date', { mode: 'string' }).notNull(),
    // upcoming | review_required | pending_approval | approved | deferred | completed | rejected
    status: varchar('status', { length: 24 }).notNull().default('upcoming'),
    flaggedAt: ts('flagged_at'),
    deferredUntil: date('deferred_until', { mode: 'string' }),
    outstandingActions: jsonb('outstanding_actions').$type<string[]>().notNull().default([]),
    decisionBy: uuid('decision_by').references(() => users.id),
    decisionAt: ts('decision_at'),
    decisionReason: text('decision_reason'),
    completedAt: ts('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id),
    approvalId: uuid('approval_id').references(() => approvalRequests.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('retirement_reviews_one_open_uq')
      .on(t.employeeId)
      .where(sql`${t.status} not in ('completed','rejected')`),
    check(
      'retirement_reviews_status_ck',
      sql`${t.status} in ('upcoming','review_required','pending_approval','approved','deferred','completed','rejected')`,
    ),
  ],
);

export const retirementSettlements = pgTable('retirement_settlements', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => retirementReviews.id),
  version: integer('version').notNull().default(1),
  currency: varchar('currency', { length: 3 }).notNull(),
  calculationMethod: text('calculation_method').notNull(),
  policyReference: text('policy_reference'),
  sourceFigures: jsonb('source_figures').$type<Record<string, unknown>>().notNull().default({}),
  lineItems: jsonb('line_items').$type<{ label: string; kind: 'credit' | 'debit'; amount: number }[]>().notNull().default([]),
  totalAmount: money('total_amount').notNull().default(0),
  // draft | submitted | verified | rejected
  verificationStatus: varchar('verification_status', { length: 16 }).notNull().default('draft'),
  preparedBy: uuid('prepared_by')
    .notNull()
    .references(() => users.id),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: ts('verified_at'),
  verificationNote: text('verification_note'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Communications                                                     */
/* ------------------------------------------------------------------ */

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body').notNull(),
    // draft | published | archived
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    commentsEnabled: boolean('comments_enabled').notNull().default(false),
    targetDepartmentIds: jsonb('target_department_ids').$type<string[]>().notNull().default([]),
    targetLocationIds: jsonb('target_location_ids').$type<string[]>().notNull().default([]),
    publishedAt: ts('published_at'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('announcements_status_idx').on(t.status, t.publishedAt)],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description').notNull().default(''),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    venue: varchar('venue', { length: 200 }),
    // draft | published | completed | cancelled
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    commentsEnabled: boolean('comments_enabled').notNull().default(false),
    targetDepartmentIds: jsonb('target_department_ids').$type<string[]>().notNull().default([]),
    targetLocationIds: jsonb('target_location_ids').$type<string[]>().notNull().default([]),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('events_starts_idx').on(t.startsAt)],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // announcement | event
    targetType: varchar('target_type', { length: 16 }).notNull(),
    targetId: uuid('target_id').notNull(),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    // visible | hidden
    status: varchar('status', { length: 16 }).notNull().default('visible'),
    moderatedBy: uuid('moderated_by').references(() => users.id),
    moderatedAt: ts('moderated_at'),
    createdAt: createdAt(),
  },
  (t) => [index('comments_target_idx').on(t.targetType, t.targetId, t.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body'),
    link: varchar('link', { length: 300 }),
    dedupeKey: varchar('dedupe_key', { length: 200 }),
    // delivered (in-app). Extend with email/sms channels later.
    deliveryStatus: varchar('delivery_status', { length: 16 }).notNull().default('delivered'),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('notifications_dedupe_uq').on(t.userId, t.dedupeKey),
  ],
);

/* ------------------------------------------------------------------ */
/* Governance                                                         */
/* ------------------------------------------------------------------ */

/** Append-only. UPDATE/DELETE are blocked by a database trigger (see migration). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    action: varchar('action', { length: 80 }).notNull(),
    // success | denied | failure
    outcome: varchar('outcome', { length: 16 }).notNull().default('success'),
    targetType: varchar('target_type', { length: 40 }),
    targetId: varchar('target_id', { length: 64 }),
    oldValues: jsonb('old_values').$type<Record<string, unknown>>(),
    newValues: jsonb('new_values').$type<Record<string, unknown>>(),
    reason: text('reason'),
    approvalId: uuid('approval_id'),
    requestId: varchar('request_id', { length: 64 }),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 300 }),
  },
  (t) => [
    index('audit_logs_occurred_idx').on(t.occurredAt),
    index('audit_logs_actor_idx').on(t.actorUserId, t.occurredAt),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
    index('audit_logs_action_idx').on(t.action),
  ],
);

export const systemSettings = pgTable('system_settings', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});

export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobName: varchar('job_name', { length: 60 }).notNull(),
    runKey: varchar('run_key', { length: 80 }).notNull(),
    startedAt: createdAt(),
    finishedAt: ts('finished_at'),
    status: varchar('status', { length: 16 }).notNull().default('running'),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [uniqueIndex('job_runs_name_key_uq').on(t.jobName, t.runKey)],
);
