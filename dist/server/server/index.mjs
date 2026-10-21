var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/config.ts
import path from "node:path";
var env = process.env;
var isProd = env.NODE_ENV === "production";
var isTest = env.NODE_ENV === "test" || env.VITEST === "true";
function required(name, fallbackForDev) {
  const v = env[name];
  if (v && v.length > 0) return v;
  if (!isProd && fallbackForDev !== void 0) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}
var config = {
  isProd,
  isTest,
  port: Number(env.PORT ?? 3e3),
  host: env.HOST ?? "0.0.0.0",
  /** Postgres connection string. When absent outside production, an embedded PGlite database is used. */
  databaseUrl: env.DATABASE_URL,
  pgliteDir: env.PGLITE_DIR ?? path.resolve(".data/pglite"),
  /** Secret used to encrypt MFA secrets at rest. Must be >= 32 chars in production. */
  appSecret: required("APP_SECRET", "dev-only-insecure-secret-change-me-0123456789"),
  appUrl: env.APP_URL ?? env.RENDER_EXTERNAL_URL ?? "http://localhost:5173",
  corsOrigins: (env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  trustProxy: env.TRUST_PROXY ?? (isProd ? "1" : "loopback"),
  session: {
    idleMinutes: Number(env.SESSION_IDLE_MINUTES ?? 30),
    absoluteHours: Number(env.SESSION_ABSOLUTE_HOURS ?? 12),
    reauthWindowMinutes: Number(env.REAUTH_WINDOW_MINUTES ?? 10)
  },
  runJobsInProcess: (env.RUN_JOBS_IN_PROCESS ?? (isTest ? "false" : "true")) === "true",
  jobIntervalMinutes: Number(env.JOB_INTERVAL_MINUTES ?? 60),
  maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 5 * 1024 * 1024),
  bootstrap: {
    email: env.BOOTSTRAP_SUPERADMIN_EMAIL,
    username: env.BOOTSTRAP_SUPERADMIN_USERNAME,
    password: env.BOOTSTRAP_SUPERADMIN_PASSWORD,
    name: env.BOOTSTRAP_SUPERADMIN_NAME
  }
};
if (isProd && config.appSecret.length < 32) {
  throw new Error("APP_SECRET must be at least 32 characters in production");
}

// server/db/client.ts
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

// server/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  EMPLOYMENT_STATUSES: () => EMPLOYMENT_STATUSES,
  announcements: () => announcements,
  approvalRequests: () => approvalRequests,
  auditLogs: () => auditLogs,
  comments: () => comments,
  departmentLocations: () => departmentLocations,
  departments: () => departments,
  documents: () => documents,
  employees: () => employees,
  employmentGrades: () => employmentGrades,
  employmentHistory: () => employmentHistory,
  employmentNumberSequences: () => employmentNumberSequences,
  events: () => events,
  invitations: () => invitations,
  jobRuns: () => jobRuns,
  jobTitles: () => jobTitles,
  moderatorScopes: () => moderatorScopes,
  nextOfKin: () => nextOfKin,
  notifications: () => notifications,
  payrollLineItems: () => payrollLineItems,
  payrollPeriods: () => payrollPeriods,
  payrollRecords: () => payrollRecords,
  payslips: () => payslips,
  permissions: () => permissions,
  retirementPolicies: () => retirementPolicies,
  retirementReviews: () => retirementReviews,
  retirementSettlements: () => retirementSettlements,
  rolePermissions: () => rolePermissions,
  roles: () => roles,
  sessions: () => sessions,
  systemSettings: () => systemSettings,
  userPermissionGrants: () => userPermissionGrants,
  userRoles: () => userRoles,
  users: () => users,
  workLocations: () => workLocations
});
import { sql } from "drizzle-orm";
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
  check
} from "drizzle-orm/pg-core";
var bytea = customType({
  dataType: () => "bytea",
  fromDriver: (v) => Buffer.isBuffer(v) ? v : Buffer.from(v)
});
var ts = (name) => timestamp(name, { withTimezone: true, mode: "date" });
var createdAt = () => ts("created_at").notNull().defaultNow();
var updatedAt = () => ts("updated_at").notNull().defaultNow();
var money = (name) => bigint(name, { mode: "number" });
var users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 254 }).notNull(),
    username: varchar("username", { length: 40 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    // pending_verification | active | suspended | deactivated
    status: varchar("status", { length: 32 }).notNull().default("pending_verification"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    mfaSecretEnc: text("mfa_secret_enc"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    passwordChangedAt: ts("password_changed_at"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    uniqueIndex("users_username_lower_uq").on(sql`lower(${t.username})`),
    check("users_status_ck", sql`${t.status} in ('pending_verification','active','suspended','deactivated')`)
  ]
);
var sessions = pgTable(
  "sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    // sha256(token) hex
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    reauthAt: ts("reauth_at"),
    mfaPending: boolean("mfa_pending").notNull().default(false),
    revokedAt: ts("revoked_at"),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 })
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);
var roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description"),
  rank: integer("rank").notNull().default(0)
});
var permissions = pgTable("permissions", {
  key: varchar("key", { length: 80 }).primaryKey(),
  description: text("description").notNull()
});
var rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 80 }).notNull().references(() => permissions.key, { onDelete: "cascade" })
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })]
);
var userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: createdAt()
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })]
);
var userPermissionGrants = pgTable(
  "user_permission_grants",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    permissionKey: varchar("permission_key", { length: 80 }).notNull().references(() => permissions.key),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: createdAt(),
    reason: text("reason")
  },
  (t) => [primaryKey({ columns: [t.userId, t.permissionKey] })]
);
var invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    email: varchar("email", { length: 254 }).notNull(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    roleKey: varchar("role_key", { length: 40 }).notNull().default("employee"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at")
  },
  (t) => [index("invitations_employee_idx").on(t.employeeId)]
);
var departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 8 }).notNull().unique(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    headEmployeeId: uuid("head_employee_id").references(() => employees.id, { onDelete: "set null" }),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    check("departments_code_ck", sql`${t.code} ~ '^[A-Z]{2,8}$'`),
    check("departments_status_ck", sql`${t.status} in ('active','archived')`)
  ]
);
var workLocations = pgTable(
  "work_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 16 }).notNull().unique(),
    name: varchar("name", { length: 120 }).notNull(),
    address: text("address"),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [check("work_locations_status_ck", sql`${t.status} in ('active','archived')`)]
);
var departmentLocations = pgTable(
  "department_locations",
  {
    departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull().references(() => workLocations.id, { onDelete: "cascade" })
  },
  (t) => [primaryKey({ columns: [t.departmentId, t.locationId] })]
);
var jobTitles = pgTable(
  "job_titles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 120 }).notNull(),
    departmentId: uuid("department_id").references(() => departments.id),
    status: varchar("status", { length: 16 }).notNull().default("active"),
    createdAt: createdAt()
  },
  (t) => [uniqueIndex("job_titles_name_dept_uq").on(t.name, t.departmentId)]
);
var employmentGrades = pgTable("employment_grades", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 16 }).notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
  rank: integer("rank").notNull().default(0),
  status: varchar("status", { length: 16 }).notNull().default("active")
});
var employmentNumberSequences = pgTable("employment_number_sequences", {
  departmentId: uuid("department_id").primaryKey().references(() => departments.id),
  nextValue: bigint("next_value", { mode: "number" }).notNull().default(1)
});
var EMPLOYMENT_STATUSES = [
  "pending_verification",
  "active",
  "on_leave",
  "suspended",
  "retired",
  "terminated",
  "rejected"
];
var employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").unique().references(() => users.id),
    /** Immutable once issued. Never reused. */
    employmentNumber: varchar("employment_number", { length: 20 }).unique(),
    /** Department whose sequence issued the employment number (kept even after transfers). */
    numberDepartmentId: uuid("number_department_id").references(() => departments.id),
    legalName: varchar("legal_name", { length: 160 }).notNull(),
    preferredName: varchar("preferred_name", { length: 120 }),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    phone: varchar("phone", { length: 32 }),
    personalEmail: varchar("personal_email", { length: 254 }),
    address: text("address"),
    departmentId: uuid("department_id").notNull().references(() => departments.id),
    locationId: uuid("location_id").references(() => workLocations.id),
    /** Free-text place of work as written by the employee; `locationId` remains the official assignment used for scopes and targeting. */
    workLocation: varchar("work_location", { length: 160 }),
    jobTitleId: uuid("job_title_id").references(() => jobTitles.id),
    gradeId: uuid("grade_id").references(() => employmentGrades.id),
    supervisorId: uuid("supervisor_id").references(() => employees.id, { onDelete: "set null" }),
    // permanent | contract | temporary | volunteer | intern
    employmentType: varchar("employment_type", { length: 24 }).notNull().default("permanent"),
    employmentDate: date("employment_date", { mode: "string" }),
    contractEndDate: date("contract_end_date", { mode: "string" }),
    employmentStatus: varchar("employment_status", { length: 32 }).notNull().default("pending_verification"),
    verifiedAt: ts("verified_at"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    archivedAt: ts("archived_at"),
    archivedBy: uuid("archived_by").references(() => users.id),
    archiveReason: text("archive_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    index("employees_department_idx").on(t.departmentId),
    index("employees_location_idx").on(t.locationId),
    index("employees_supervisor_idx").on(t.supervisorId),
    index("employees_status_idx").on(t.employmentStatus),
    index("employees_job_title_idx").on(t.jobTitleId),
    index("employees_legal_name_idx").on(sql`lower(${t.legalName})`),
    check(
      "employees_status_ck",
      sql`${t.employmentStatus} in ('pending_verification','active','on_leave','suspended','retired','terminated','rejected')`
    ),
    check(
      "employees_type_ck",
      sql`${t.employmentType} in ('permanent','contract','temporary','volunteer','intern')`
    ),
    check("employees_number_format_ck", sql`${t.employmentNumber} is null or ${t.employmentNumber} ~ '^[A-Z]{2,8}-[0-9]{6,}$'`)
  ]
);
var nextOfKin = pgTable("next_of_kin", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().unique().references(() => employees.id, { onDelete: "cascade" }),
  fullName: varchar("full_name", { length: 160 }).notNull(),
  relationship: varchar("relationship", { length: 60 }).notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  address: text("address"),
  updatedAt: updatedAt()
});
var employmentHistory = pgTable(
  "employment_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    // hire | verification | transfer | location_change | title_change | grade_change | supervisor_change | status_change | correction | archive | restore | retirement
    changeType: varchar("change_type", { length: 32 }).notNull(),
    fromValues: jsonb("from_values").$type(),
    toValues: jsonb("to_values").$type(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    reason: text("reason"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    approvalId: uuid("approval_id").references(() => approvalRequests.id),
    createdAt: createdAt()
  },
  (t) => [index("employment_history_employee_idx").on(t.employeeId, t.createdAt)]
);
var moderatorScopes = pgTable(
  "moderator_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // org_unit | direct_reports
    scopeType: varchar("scope_type", { length: 24 }).notNull().default("org_unit"),
    departmentId: uuid("department_id").references(() => departments.id),
    locationId: uuid("location_id").references(() => workLocations.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt()
  },
  (t) => [
    index("moderator_scopes_user_idx").on(t.userId),
    check(
      "moderator_scopes_shape_ck",
      sql`(${t.scopeType} = 'direct_reports' and ${t.departmentId} is null and ${t.locationId} is null)
          or (${t.scopeType} = 'org_unit' and (${t.departmentId} is not null or ${t.locationId} is not null))`
    )
  ]
);
var documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // employee | announcement
    ownerType: varchar("owner_type", { length: 24 }).notNull(),
    ownerId: uuid("owner_id").notNull(),
    category: varchar("category", { length: 40 }).notNull().default("general"),
    filename: varchar("filename", { length: 200 }).notNull(),
    mimeType: varchar("mime_type", { length: 80 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    data: bytea("data").notNull(),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    archivedAt: ts("archived_at"),
    createdAt: createdAt()
  },
  (t) => [index("documents_owner_idx").on(t.ownerType, t.ownerId)]
);
var approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // registration | employee_change | profile_correction | payroll_record | retirement_decision
    type: varchar("type", { length: 40 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    targetType: varchar("target_type", { length: 40 }).notNull(),
    targetId: uuid("target_id").notNull(),
    /** Department of the affected employee, used for scoping queue visibility. */
    departmentId: uuid("department_id").references(() => departments.id),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type().notNull().default({}),
    reason: text("reason"),
    requiredPermission: varchar("required_permission", { length: 80 }).notNull(),
    requestedBy: uuid("requested_by").references(() => users.id),
    requestedAt: createdAt(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    decisionReason: text("decision_reason")
  },
  (t) => [
    index("approval_requests_status_idx").on(t.status, t.type),
    index("approval_requests_target_idx").on(t.targetType, t.targetId),
    check("approval_requests_status_ck", sql`${t.status} in ('pending','approved','rejected','cancelled')`)
  ]
);
var payrollPeriods = pgTable(
  "payroll_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 20 }).notNull().unique(),
    name: varchar("name", { length: 80 }).notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    payDate: date("pay_date", { mode: "string" }).notNull(),
    // open | closed
    status: varchar("status", { length: 16 }).notNull().default("open"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt()
  },
  (t) => [check("payroll_periods_dates_ck", sql`${t.endDate} >= ${t.startDate}`)]
);
var payrollRecords = pgTable(
  "payroll_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    periodId: uuid("period_id").notNull().references(() => payrollPeriods.id),
    revision: integer("revision").notNull().default(1),
    supersedesId: uuid("supersedes_id").references(() => payrollRecords.id),
    // draft | pending_approval | approved | rejected | superseded
    status: varchar("status", { length: 24 }).notNull().default("draft"),
    currency: varchar("currency", { length: 3 }).notNull(),
    basicSalary: money("basic_salary").notNull().default(0),
    grossEarnings: money("gross_earnings").notNull().default(0),
    totalDeductions: money("total_deductions").notNull().default(0),
    netPay: money("net_pay").notNull().default(0),
    // unpaid | paid
    paymentStatus: varchar("payment_status", { length: 16 }).notNull().default("unpaid"),
    paymentDate: date("payment_date", { mode: "string" }),
    notes: text("notes"),
    adjustmentReason: text("adjustment_reason"),
    discrepancyFlag: boolean("discrepancy_flag").notNull().default(false),
    discrepancyNote: text("discrepancy_note"),
    preparedBy: uuid("prepared_by").notNull().references(() => users.id),
    submittedAt: ts("submitted_at"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: ts("approved_at"),
    approvalId: uuid("approval_id").references(() => approvalRequests.id),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex("payroll_records_emp_period_rev_uq").on(t.employeeId, t.periodId, t.revision),
    uniqueIndex("payroll_records_one_open_uq").on(t.employeeId, t.periodId).where(sql`${t.status} in ('draft','pending_approval')`),
    uniqueIndex("payroll_records_one_approved_uq").on(t.employeeId, t.periodId).where(sql`${t.status} = 'approved'`),
    index("payroll_records_period_idx").on(t.periodId, t.status),
    check(
      "payroll_records_status_ck",
      sql`${t.status} in ('draft','pending_approval','approved','rejected','superseded')`
    ),
    check("payroll_records_totals_ck", sql`${t.netPay} = ${t.grossEarnings} - ${t.totalDeductions}`),
    check("payroll_records_nonneg_ck", sql`${t.basicSalary} >= 0 and ${t.grossEarnings} >= 0 and ${t.totalDeductions} >= 0`)
  ]
);
var payrollLineItems = pgTable(
  "payroll_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id").notNull().references(() => payrollRecords.id, { onDelete: "cascade" }),
    // earning | deduction
    kind: varchar("kind", { length: 16 }).notNull(),
    // allowance | bonus | overtime | other_earning | tax | pension | loan | other_deduction
    category: varchar("category", { length: 32 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    amount: money("amount").notNull(),
    sortOrder: integer("sort_order").notNull().default(0)
  },
  (t) => [
    index("payroll_line_items_record_idx").on(t.recordId),
    check("payroll_line_items_kind_ck", sql`${t.kind} in ('earning','deduction')`),
    check("payroll_line_items_amount_ck", sql`${t.amount} >= 0`)
  ]
);
var payslips = pgTable("payslips", {
  id: uuid("id").primaryKey().defaultRandom(),
  payslipNumber: varchar("payslip_number", { length: 40 }).notNull().unique(),
  payrollRecordId: uuid("payroll_record_id").notNull().unique().references(() => payrollRecords.id),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  /** Frozen copy of everything printed on the payslip. */
  snapshot: jsonb("snapshot").$type().notNull(),
  issuedBy: uuid("issued_by").notNull().references(() => users.id),
  issuedAt: createdAt()
});
var retirementPolicies = pgTable("retirement_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  retirementAge: integer("retirement_age").notNull(),
  reviewLeadMonths: integer("review_lead_months").notNull().default(6),
  upcomingWindowMonths: integer("upcoming_window_months").notNull().default(12),
  /** Null = organisation-wide; otherwise a department-specific exception. */
  departmentId: uuid("department_id").references(() => departments.id),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  /** Policy is only applied once explicitly adopted and verified by a super admin. */
  adopted: boolean("adopted").notNull().default(false),
  adoptedBy: uuid("adopted_by").references(() => users.id),
  adoptedAt: ts("adopted_at"),
  legalReference: text("legal_reference"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt()
});
var retirementReviews = pgTable(
  "retirement_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id").notNull().references(() => employees.id),
    policyId: uuid("policy_id").notNull().references(() => retirementPolicies.id),
    expectedRetirementDate: date("expected_retirement_date", { mode: "string" }).notNull(),
    // upcoming | review_required | pending_approval | approved | deferred | completed | rejected
    status: varchar("status", { length: 24 }).notNull().default("upcoming"),
    flaggedAt: ts("flagged_at"),
    deferredUntil: date("deferred_until", { mode: "string" }),
    outstandingActions: jsonb("outstanding_actions").$type().notNull().default([]),
    decisionBy: uuid("decision_by").references(() => users.id),
    decisionAt: ts("decision_at"),
    decisionReason: text("decision_reason"),
    completedAt: ts("completed_at"),
    completedBy: uuid("completed_by").references(() => users.id),
    approvalId: uuid("approval_id").references(() => approvalRequests.id),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    uniqueIndex("retirement_reviews_one_open_uq").on(t.employeeId).where(sql`${t.status} not in ('completed','rejected')`),
    check(
      "retirement_reviews_status_ck",
      sql`${t.status} in ('upcoming','review_required','pending_approval','approved','deferred','completed','rejected')`
    )
  ]
);
var retirementSettlements = pgTable("retirement_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id").notNull().references(() => retirementReviews.id),
  version: integer("version").notNull().default(1),
  currency: varchar("currency", { length: 3 }).notNull(),
  calculationMethod: text("calculation_method").notNull(),
  policyReference: text("policy_reference"),
  sourceFigures: jsonb("source_figures").$type().notNull().default({}),
  lineItems: jsonb("line_items").$type().notNull().default([]),
  totalAmount: money("total_amount").notNull().default(0),
  // draft | submitted | verified | rejected
  verificationStatus: varchar("verification_status", { length: 16 }).notNull().default("draft"),
  preparedBy: uuid("prepared_by").notNull().references(() => users.id),
  verifiedBy: uuid("verified_by").references(() => users.id),
  verifiedAt: ts("verified_at"),
  verificationNote: text("verification_note"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});
var announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    // draft | published | archived
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    commentsEnabled: boolean("comments_enabled").notNull().default(false),
    targetDepartmentIds: jsonb("target_department_ids").$type().notNull().default([]),
    targetLocationIds: jsonb("target_location_ids").$type().notNull().default([]),
    publishedAt: ts("published_at"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("announcements_status_idx").on(t.status, t.publishedAt)]
);
var events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull().default(""),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at"),
    venue: varchar("venue", { length: 200 }),
    // draft | published | completed | cancelled
    status: varchar("status", { length: 16 }).notNull().default("draft"),
    commentsEnabled: boolean("comments_enabled").notNull().default(false),
    targetDepartmentIds: jsonb("target_department_ids").$type().notNull().default([]),
    targetLocationIds: jsonb("target_location_ids").$type().notNull().default([]),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index("events_starts_idx").on(t.startsAt)]
);
var comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // announcement | event
    targetType: varchar("target_type", { length: 16 }).notNull(),
    targetId: uuid("target_id").notNull(),
    authorUserId: uuid("author_user_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    // visible | hidden
    status: varchar("status", { length: 16 }).notNull().default("visible"),
    moderatedBy: uuid("moderated_by").references(() => users.id),
    moderatedAt: ts("moderated_at"),
    createdAt: createdAt()
  },
  (t) => [index("comments_target_idx").on(t.targetType, t.targetId, t.createdAt)]
);
var notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body"),
    link: varchar("link", { length: 300 }),
    dedupeKey: varchar("dedupe_key", { length: 200 }),
    // delivered (in-app). Extend with email/sms channels later.
    deliveryStatus: varchar("delivery_status", { length: 16 }).notNull().default("delivered"),
    readAt: ts("read_at"),
    createdAt: createdAt()
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey)
  ]
);
var auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    action: varchar("action", { length: 80 }).notNull(),
    // success | denied | failure
    outcome: varchar("outcome", { length: 16 }).notNull().default("success"),
    targetType: varchar("target_type", { length: 40 }),
    targetId: varchar("target_id", { length: 64 }),
    oldValues: jsonb("old_values").$type(),
    newValues: jsonb("new_values").$type(),
    reason: text("reason"),
    approvalId: uuid("approval_id"),
    requestId: varchar("request_id", { length: 64 }),
    ip: varchar("ip", { length: 64 }),
    userAgent: varchar("user_agent", { length: 300 })
  },
  (t) => [
    index("audit_logs_occurred_idx").on(t.occurredAt),
    index("audit_logs_actor_idx").on(t.actorUserId, t.occurredAt),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    index("audit_logs_action_idx").on(t.action)
  ]
);
var systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: updatedAt()
});
var jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobName: varchar("job_name", { length: 60 }).notNull(),
    runKey: varchar("run_key", { length: 80 }).notNull(),
    startedAt: createdAt(),
    finishedAt: ts("finished_at"),
    status: varchar("status", { length: 16 }).notNull().default("running"),
    details: jsonb("details").$type()
  },
  (t) => [uniqueIndex("job_runs_name_key_uq").on(t.jobName, t.runKey)]
);

// server/db/client.ts
function migrationsFolder() {
  const candidates = [
    path2.resolve("server/db/migrations"),
    path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "migrations")
  ];
  const found = candidates.find((p2) => fs.existsSync(path2.join(p2, "meta", "_journal.json")));
  if (!found) throw new Error("Could not locate database migrations folder");
  return found;
}
async function createDb(opts = {}) {
  if (opts.url && !opts.memory) {
    const { Pool } = await import("pg");
    const { drizzle: drizzle2 } = await import("drizzle-orm/node-postgres");
    const sslDisabled = /sslmode=disable/.test(opts.url) || /localhost|127\.0\.0\.1/.test(opts.url);
    const pool = new Pool({
      connectionString: opts.url,
      max: Number(process.env.DB_POOL_MAX ?? 10),
      ssl: sslDisabled ? void 0 : { rejectUnauthorized: false }
    });
    const db2 = drizzle2(pool, { schema: schema_exports });
    return { db: db2, kind: "pg", close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  let client;
  if (opts.memory) {
    client = new PGlite();
  } else {
    const dir = opts.pgliteDir ?? path2.resolve(".data/pglite");
    fs.mkdirSync(dir, { recursive: true });
    client = new PGlite(dir);
  }
  const db = drizzle(client, { schema: schema_exports });
  return { db, kind: "pglite", close: () => client.close() };
}
async function runMigrations(handle) {
  const folder = migrationsFolder();
  if (handle.kind === "pg") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db, { migrationsFolder: folder });
  }
}

// server/db/seed.ts
import { eq as eq3, sql as sql3 } from "drizzle-orm";

// shared/permissions.ts
var PERMISSIONS = {
  // Employee records
  "employee.read.all": "View employment information for all employees",
  "employee.read.scoped": "View employment information for employees within assigned scope",
  "employee.read.personal": "View personal details (date of birth, phone, personal email, address) of viewable employees",
  "employee.read.age": "View date of birth and age of viewable employees (finance matrix)",
  "employee.read.next_of_kin": "View next-of-kin details of viewable employees",
  "employee.create": "Create employee records and invitations",
  "employee.update.all": "Update operational employee information for any employee",
  "employee.update.scoped": "Update operational employee information within assigned scope",
  "employee.verify": "Verify pending registrations and issue employment numbers",
  "employee.approve_changes": "Approve controlled employment changes and correction requests",
  "employee.override": "Apply controlled changes directly with a mandatory reason (executive override)",
  "employee.archive": "Archive and restore employee records",
  "employee.export": "Export employee data within field-level permissions",
  "document.manage": "Upload and archive employee documents for viewable employees",
  // Organisation
  "org.manage": "Manage departments, locations, job titles and grades",
  "role.assign": "Assign and revoke roles and individual permission grants",
  "scope.manage": "Assign and change moderator scopes",
  "user.manage": "Suspend, deactivate, reactivate users and reset access",
  // Finance
  "payroll.read": "View payroll records, totals and payslips for all employees",
  "payroll.prepare": "Create and edit draft payroll records and line items",
  "payroll.approve": "Approve payroll records prepared by another user",
  "payroll.export": "Export payroll reports",
  "payroll.period.manage": "Create, open and close payroll periods",
  // Retirement
  "retirement.read": "View retirement dashboard and reviews",
  "retirement.prepare": "Prepare retirement settlement statements",
  "retirement.verify": "Verify retirement settlement statements",
  "retirement.decide": "Approve, reject or defer retirement decisions and finalize retirements",
  "retirement.policy.manage": "Configure and adopt retirement policies",
  // Communications
  "announcement.manage": "Create, publish and archive announcements",
  "event.manage": "Create and manage events",
  "comment.create": "Comment on announcements and events where enabled",
  "comment.moderate": "Hide or restore comments",
  // Governance
  "approval.read": "View approval queue entries relevant to held permissions",
  "audit.read": "View and search the audit log",
  "settings.manage": "Change organisation and security settings",
  "report.org": "View organisation-wide reports",
  "report.finance": "View financial reports"
};
var ALL_PERMISSIONS = Object.keys(PERMISSIONS);
var ROLE_KEYS = ["super_admin", "admin", "moderator", "finance", "employee"];
var PRIVILEGED_ROLES = ["super_admin", "admin", "moderator", "finance"];
var ROLE_META = {
  super_admin: { name: "Super Admin", description: "Highest authority; governs roles, policies and executive approvals", rank: 100 },
  admin: { name: "Administrator", description: "Organisation-wide operations, records, announcements and events", rank: 60 },
  moderator: { name: "Moderator", description: "Manages employees within explicitly assigned scopes", rank: 40 },
  finance: { name: "Finance Officer", description: "Payroll, payslips, retirement statements and financial reports", rank: 50 },
  employee: { name: "Employee", description: "Standard self-service access", rank: 10 }
};
var ROLE_PERMISSIONS = {
  super_admin: [...ALL_PERMISSIONS],
  admin: [
    "employee.read.all",
    "employee.read.personal",
    "employee.create",
    "employee.update.all",
    "employee.verify",
    "employee.export",
    "document.manage",
    "scope.manage",
    "retirement.read",
    "retirement.verify",
    "announcement.manage",
    "event.manage",
    "comment.create",
    "comment.moderate",
    "approval.read",
    "report.org"
  ],
  moderator: [
    "employee.read.scoped",
    "employee.read.personal",
    "employee.update.scoped",
    "comment.create",
    "approval.read"
  ],
  finance: [
    "employee.read.all",
    "employee.read.age",
    "payroll.read",
    "payroll.prepare",
    "payroll.approve",
    "payroll.export",
    "payroll.period.manage",
    "retirement.read",
    "retirement.prepare",
    "comment.create",
    "approval.read",
    "report.finance"
  ],
  employee: ["comment.create"]
};

// server/services/settings.ts
import { z as z2 } from "zod";
import { eq as eq2, inArray } from "drizzle-orm";

// server/authz/policy.ts
import { and, eq, or, sql as sql2 } from "drizzle-orm";

// server/lib/errors.ts
var AppError = class extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  status;
  code;
  details;
};
var badRequest = (message, details) => new AppError(400, "BAD_REQUEST", message, details);
var unauthorized = (message = "Authentication required") => new AppError(401, "UNAUTHENTICATED", message);
var forbidden = (message = "You do not have permission to perform this action") => new AppError(403, "FORBIDDEN", message);
var notFound = (message = "Not found") => new AppError(404, "NOT_FOUND", message);
var conflict = (message, details) => new AppError(409, "CONFLICT", message, details);
var reauthRequired = () => new AppError(403, "REAUTH_REQUIRED", "Please confirm your password to continue with this sensitive action");

// server/authz/policy.ts
function has(actor, perm) {
  return !!actor && actor.status === "active" && actor.permissions.has(perm);
}
function hasAny(actor, perms) {
  return perms.some((p2) => has(actor, p2));
}
function requireActor(ctx) {
  if (!ctx.actor) throw unauthorized();
  if (ctx.actor.status !== "active") {
    throw new AppError(403, "ACCOUNT_NOT_ACTIVE", "Your account is not active yet");
  }
}
function requirePerm(ctx, ...perms) {
  requireActor(ctx);
  if (!perms.some((p2) => ctx.actor.permissions.has(p2))) {
    const err = forbidden();
    err.auditDenied = perms.join("|");
    throw err;
  }
}
function requireRecentAuth(ctx) {
  const at = ctx.actor.reauthAt?.getTime() ?? 0;
  if (ctx.now().getTime() - at > config.session.reauthWindowMinutes * 6e4) throw reauthRequired();
}
function deniedRecord(what = "Record") {
  const err = notFound(`${what} not found`);
  err.auditDenied = "record";
  return err;
}
function isSelf(actor, emp) {
  return !!actor.employeeId && actor.employeeId === emp.id;
}
function inModeratorScope(actor, emp) {
  return actor.scopes.some(
    (s) => s.scopeType === "direct_reports" ? !!actor.employeeId && emp.supervisorId === actor.employeeId : (!s.departmentId || s.departmentId === emp.departmentId) && (!s.locationId || s.locationId === emp.locationId)
  );
}
function canViewEmployee(actor, emp) {
  if (actor.status !== "active") return false;
  if (isSelf(actor, emp)) return true;
  if (has(actor, "employee.read.all")) return true;
  if (has(actor, "employee.read.scoped") && inModeratorScope(actor, emp)) return true;
  return false;
}
function employeeVisibilitySql(actor) {
  if (has(actor, "employee.read.all")) return sql2`true`;
  const clauses = [];
  if (actor.employeeId) clauses.push(eq(employees.id, actor.employeeId));
  if (has(actor, "employee.read.scoped")) {
    for (const s of actor.scopes) {
      if (s.scopeType === "direct_reports") {
        if (actor.employeeId) clauses.push(eq(employees.supervisorId, actor.employeeId));
      } else {
        const parts2 = [];
        if (s.departmentId) parts2.push(eq(employees.departmentId, s.departmentId));
        if (s.locationId) parts2.push(eq(employees.locationId, s.locationId));
        if (parts2.length) clauses.push(and(...parts2));
      }
    }
  }
  return clauses.length ? or(...clauses) : sql2`false`;
}
function canSeeOthers(actor) {
  return has(actor, "employee.read.all") || has(actor, "employee.read.scoped") && actor.scopes.length > 0;
}
function fieldAccess(actor, emp) {
  const self = isSelf(actor, emp);
  const view = canViewEmployee(actor, emp);
  const none = {
    self: false,
    employment: false,
    personal: false,
    age: false,
    nextOfKin: false,
    account: false,
    payroll: false,
    retirement: false,
    approvals: false,
    audit: false,
    documents: false,
    manageDocuments: false
  };
  if (!view) return none;
  const personal = self || has(actor, "employee.read.personal");
  return {
    self,
    employment: true,
    personal,
    age: personal || has(actor, "employee.read.age"),
    nextOfKin: self || has(actor, "employee.read.next_of_kin"),
    account: self || has(actor, "user.manage") || has(actor, "role.assign"),
    payroll: self || has(actor, "payroll.read"),
    retirement: has(actor, "retirement.read"),
    approvals: self || has(actor, "approval.read"),
    audit: has(actor, "audit.read"),
    documents: self || has(actor, "document.manage"),
    manageDocuments: has(actor, "document.manage") && (!self || has(actor, "employee.override"))
  };
}
var SELF_FIELDS = ["preferredName", "phone", "personalEmail", "address", "workLocation"];
var ADMIN_DIRECT_FIELDS = [...SELF_FIELDS, "jobTitleId", "gradeId", "supervisorId", "locationId"];
var MODERATOR_DIRECT_FIELDS = [...SELF_FIELDS, "jobTitleId", "gradeId"];
var CONTROLLED_FIELDS = [
  "legalName",
  "dateOfBirth",
  "departmentId",
  "employmentDate",
  "employmentType",
  "contractEndDate",
  "employmentStatus",
  "supervisorId",
  "locationId"
];
var EDITABLE_FIELDS = [.../* @__PURE__ */ new Set([...ADMIN_DIRECT_FIELDS, ...CONTROLLED_FIELDS])];
function updateMode(actor, emp) {
  if (actor.status !== "active") return "none";
  const self = isSelf(actor, emp);
  if (has(actor, "employee.override") && has(actor, "employee.update.all")) return "override";
  if (self) return "self";
  if (has(actor, "employee.update.all") && canViewEmployee(actor, emp)) return "admin";
  if (has(actor, "employee.update.scoped") && inModeratorScope(actor, emp)) return "moderator";
  return "none";
}
function directFieldsFor(mode) {
  switch (mode) {
    case "override":
      return EDITABLE_FIELDS;
    case "admin":
      return ADMIN_DIRECT_FIELDS;
    case "moderator":
      return MODERATOR_DIRECT_FIELDS;
    case "self":
      return SELF_FIELDS;
    default:
      return [];
  }
}
function proposableFieldsFor(mode) {
  if (mode === "admin" || mode === "moderator") {
    const direct = new Set(directFieldsFor(mode));
    return CONTROLLED_FIELDS.filter((f) => !direct.has(f));
  }
  return [];
}

// server/services/audit.ts
var REDACT = /pass(word)?|token|secret|totp|mfa_?code|hash|cookie|authorization/i;
function redact(value, depth = 0) {
  if (value === null || value === void 0 || depth > 5) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
async function audit(tx, ctx, entry) {
  await tx.insert(auditLogs).values({
    actorUserId: entry.actorUserId !== void 0 ? entry.actorUserId : ctx.actor?.userId ?? null,
    action: entry.action,
    outcome: entry.outcome ?? "success",
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    oldValues: entry.oldValues ? redact(entry.oldValues) : null,
    newValues: entry.newValues ? redact(entry.newValues) : null,
    reason: entry.reason ?? null,
    approvalId: entry.approvalId ?? null,
    requestId: ctx.meta.requestId,
    ip: ctx.meta.ip ?? null,
    userAgent: ctx.meta.userAgent?.slice(0, 300) ?? null
  });
}
function diff(before, after) {
  const oldValues = {};
  const newValues = {};
  for (const key of Object.keys(after)) {
    const a = before[key] instanceof Date ? before[key].toISOString() : before[key];
    const b = after[key] instanceof Date ? after[key].toISOString() : after[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      oldValues[key] = a ?? null;
      newValues[key] = b ?? null;
    }
  }
  return { oldValues, newValues, changed: Object.keys(newValues) };
}

// server/lib/validate.ts
import { z } from "zod";
function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest("Validation failed", { fields });
  }
  return result.data;
}
var zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((s) => {
  const d = /* @__PURE__ */ new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, "Invalid date");
var zUuid = z.uuid("Invalid identifier");
var zOptUuid = z.union([z.uuid("Invalid identifier"), z.literal(""), z.null()]).optional().transform((v) => v ? v : null);
var zTrim = (max, min = 1) => z.string().trim().min(min, "Required").max(max, `Max ${max} characters`);
var zOptText = (max) => z.union([z.string().trim().max(max, `Max ${max} characters`), z.null()]).optional().transform((v) => v ? v : null);
var zPhone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number");
var zOptPhone = z.union([zPhone, z.literal(""), z.null()]).optional().transform((v) => v ? v : null);
var zEmail = z.email("Enter a valid email address").trim().max(254).transform((s) => s.toLowerCase());
var zOptEmail = z.union([zEmail, z.literal(""), z.null()]).optional().transform((v) => v ? v : null);
var zOptDate = z.union([zDate, z.literal(""), z.null()]).optional().transform((v) => v ? v : null);
var zPassword = z.string().min(12, "Use at least 12 characters").max(200).refine((p2) => /[a-z]/.test(p2) && /[A-Z]/.test(p2) && /[0-9]/.test(p2), "Include upper and lower case letters and a number");
var zUsername = z.string().trim().min(3, "At least 3 characters").max(40).regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, dot, underscore and hyphen only");
var zPage = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});
var zMoney = z.number().int("Amounts must be whole minor units").min(0).max(1e13);

// server/services/settings.ts
var SETTINGS_SCHEMA = {
  "org.name": z2.string().trim().min(1).max(160),
  "org.address": z2.string().trim().max(300),
  "org.phone": z2.string().trim().max(40),
  "org.email": z2.string().trim().max(254),
  "org.currency": z2.string().trim().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. MWK"),
  "registration.open": z2.boolean(),
  "payroll.require_second_approval": z2.boolean(),
  "security.require_mfa_for_privileged": z2.boolean(),
  "notifications.contract_expiry_days": z2.number().int().min(1).max(365),
  "notifications.event_reminder_hours": z2.number().int().min(1).max(168)
};
var SETTINGS_DEFAULTS = {
  "org.name": "Employee Management System",
  "org.address": "",
  "org.phone": "",
  "org.email": "",
  "org.currency": "MWK",
  "registration.open": true,
  "payroll.require_second_approval": true,
  "security.require_mfa_for_privileged": false,
  "notifications.contract_expiry_days": 30,
  "notifications.event_reminder_hours": 24
};
var SENSITIVE = ["payroll.require_second_approval", "security.require_mfa_for_privileged", "registration.open"];
async function getSettings(db) {
  const rows = await db.select().from(systemSettings);
  const out = { ...SETTINGS_DEFAULTS };
  for (const r of rows) if (r.key in SETTINGS_SCHEMA) out[r.key] = r.value;
  return out;
}
async function getSetting(db, key) {
  const [row] = await db.select().from(systemSettings).where(eq2(systemSettings.key, key));
  return row ? row.value : SETTINGS_DEFAULTS[key];
}
async function updateSettings(ctx, input) {
  requirePerm(ctx, "settings.manage");
  const shape = Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([k, v]) => [k, v.optional()]));
  const body = parse(z2.object({ values: z2.object(shape).strict(), reason: z2.string().trim().max(500).optional() }), input);
  const values = body.values;
  const keys = Object.keys(values);
  if (keys.some((k) => SENSITIVE.includes(k))) requireRecentAuth(ctx);
  return ctx.db.transaction(async (tx) => {
    const before = await getSettings(tx);
    const existing = keys.length ? await tx.select({ key: systemSettings.key }).from(systemSettings).where(inArray(systemSettings.key, keys)) : [];
    const existingSet = new Set(existing.map((e) => e.key));
    for (const key of keys) {
      const value = values[key];
      if (existingSet.has(key)) {
        await tx.update(systemSettings).set({ value, updatedBy: ctx.actor.userId, updatedAt: ctx.now() }).where(eq2(systemSettings.key, key));
      } else {
        await tx.insert(systemSettings).values({ key, value, updatedBy: ctx.actor.userId });
      }
    }
    const oldValues = Object.fromEntries(keys.map((k) => [k, before[k]]));
    await audit(tx, ctx, { action: "settings.update", targetType: "settings", oldValues, newValues: values, reason: body.reason });
    return getSettings(tx);
  });
}

// server/db/seed.ts
var INITIAL_DEPARTMENTS = [
  { code: "ADM", name: "Administration", description: "Corporate administration and support services" },
  { code: "CLG", name: "Clergy", description: "Ministry and pastoral staff" },
  { code: "CON", name: "Construction", description: "Building projects, sites and maintenance" },
  { code: "PRT", name: "Printing", description: "Printing press and publications" },
  { code: "MED", name: "Medical", description: "Clinics and health services" }
];
async function seedBase(db) {
  await db.transaction(async (tx) => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx.insert(permissions).values({ key, description }).onConflictDoUpdate({ target: permissions.key, set: { description } });
    }
    for (const key of ROLE_KEYS) {
      const meta = ROLE_META[key];
      const [role] = await tx.insert(roles).values({ key, name: meta.name, description: meta.description, rank: meta.rank }).onConflictDoUpdate({ target: roles.key, set: { name: meta.name, description: meta.description, rank: meta.rank } }).returning();
      await tx.delete(rolePermissions).where(eq3(rolePermissions.roleId, role.id));
      await tx.insert(rolePermissions).values(ROLE_PERMISSIONS[key].map((permissionKey) => ({ roleId: role.id, permissionKey })));
    }
    for (const d of INITIAL_DEPARTMENTS) {
      await tx.insert(departments).values(d).onConflictDoNothing({ target: departments.code });
    }
    await tx.execute(sql3`insert into employment_number_sequences (department_id, next_value)
      select id, 1 from departments on conflict (department_id) do nothing`);
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
      await tx.insert(systemSettings).values({ key, value }).onConflictDoNothing({ target: systemSettings.key });
    }
    const [{ count }] = await tx.select({ count: sql3`count(*)::int` }).from(retirementPolicies);
    if (count === 0) {
      await tx.insert(retirementPolicies).values({
        name: "Proposed organisation-wide retirement policy",
        retirementAge: 60,
        reviewLeadMonths: 6,
        upcomingWindowMonths: 12,
        effectiveFrom: "2026-01-01",
        adopted: false,
        notes: "Draft proposal only. It is not applied until a super admin verifies it against the organisation's adopted policy and applicable law, then adopts it."
      });
    }
  });
}

// server/app.ts
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import crypto3 from "node:crypto";
import path3 from "node:path";
import fs2 from "node:fs";

// server/auth/sessions.ts
import { and as and2, eq as eq4, isNull, sql as sql4 } from "drizzle-orm";

// server/lib/crypto.ts
import crypto from "node:crypto";
import { promisify } from "node:util";
var scrypt = promisify(crypto.scrypt);
var SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
var KEYLEN = 64;
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const params = process.env.VITEST ? { ...SCRYPT, N: 1024 } : SCRYPT;
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}
async function verifyPassword(password, stored) {
  const [alg, n, r, p2, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p2),
    maxmem: SCRYPT.maxmem
  });
  return crypto.timingSafeEqual(key, expected);
}
var dummyHash;
async function burnPasswordCheck(password) {
  dummyHash ??= await hashPassword("timing-equaliser-Password1");
  await verifyPassword(password, dummyHash);
}
var randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
var sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
function encKey() {
  return crypto.createHash("sha256").update(`ems-enc:${config.appSecret}`).digest();
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
function decrypt(payload) {
  const [iv, tag, data] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// server/auth/sessions.ts
var SESSION_COOKIE = "ems_sid";
var CSRF_COOKIE = "ems_csrf";
function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: config.session.absoluteHours * 36e5
  };
}
async function createSession(db, userId, opts) {
  const token = randomToken(32);
  const id = sha256(token);
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + config.session.absoluteHours * 36e5);
  await db.insert(sessions).values({
    id,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    mfaPending: opts.mfaPending ?? false,
    reauthAt: opts.mfaPending ? null : now,
    ip: opts.ip?.slice(0, 64),
    userAgent: opts.userAgent?.slice(0, 300)
  });
  return { token, id, expiresAt };
}
async function revokeSession(db, id) {
  await db.update(sessions).set({ revokedAt: /* @__PURE__ */ new Date() }).where(eq4(sessions.id, id));
}
async function revokeAllSessions(db, userId, exceptId) {
  const cond = exceptId ? and2(eq4(sessions.userId, userId), isNull(sessions.revokedAt), sql4`${sessions.id} <> ${exceptId}`) : and2(eq4(sessions.userId, userId), isNull(sessions.revokedAt));
  await db.update(sessions).set({ revokedAt: /* @__PURE__ */ new Date() }).where(cond);
}
async function loadSession(db, token, now = /* @__PURE__ */ new Date()) {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const [row] = await db.select({ session: sessions, user: users }).from(sessions).innerJoin(users, eq4(users.id, sessions.userId)).where(eq4(sessions.id, id));
  if (!row) return null;
  const { session, user } = row;
  const idleMs = config.session.idleMinutes * 6e4;
  if (session.revokedAt || session.expiresAt <= now || now.getTime() - session.lastSeenAt.getTime() > idleMs) return null;
  if (user.status === "suspended" || user.status === "deactivated") return null;
  if (now.getTime() - session.lastSeenAt.getTime() > 6e4) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq4(sessions.id, id));
  }
  return row;
}
async function loadActor(db, loaded) {
  const { user, session } = loaded;
  const [roleRows, grantRows, scopeRows, empRows] = await Promise.all([
    db.select({ key: roles.key, perm: rolePermissions.permissionKey }).from(userRoles).innerJoin(roles, eq4(roles.id, userRoles.roleId)).leftJoin(rolePermissions, eq4(rolePermissions.roleId, roles.id)).where(eq4(userRoles.userId, user.id)),
    db.select({ perm: userPermissionGrants.permissionKey }).from(userPermissionGrants).where(eq4(userPermissionGrants.userId, user.id)),
    db.select().from(moderatorScopes).where(eq4(moderatorScopes.userId, user.id)),
    db.select({ id: employees.id }).from(employees).where(eq4(employees.userId, user.id))
  ]);
  const roleKeys = [...new Set(roleRows.map((r) => r.key))];
  const perms = /* @__PURE__ */ new Set();
  if (user.status === "active" && !session.mfaPending) {
    for (const r of roleRows) if (r.perm) perms.add(r.perm);
    for (const g of grantRows) perms.add(g.perm);
  }
  const scopes = roleKeys.includes("moderator") ? scopeRows.map((s) => ({
    id: s.id,
    scopeType: s.scopeType,
    departmentId: s.departmentId,
    locationId: s.locationId
  })) : [];
  return {
    userId: user.id,
    sessionId: session.id,
    displayName: user.displayName,
    username: user.username,
    email: user.email,
    status: session.mfaPending ? "mfa_pending" : user.status,
    roles: roleKeys,
    permissions: perms,
    employeeId: empRows[0]?.id ?? null,
    scopes,
    reauthAt: session.reauthAt,
    mfaEnabled: user.mfaEnabled,
    mustChangePassword: user.mustChangePassword
  };
}

// server/routes.ts
import { Router } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";

// server/services/auth.ts
import { z as z4 } from "zod";
import { and as and4, eq as eq6, isNull as isNull3, or as or2, sql as sql6 } from "drizzle-orm";

// server/lib/dates.ts
function todayIso(now = /* @__PURE__ */ new Date()) {
  return now.toISOString().slice(0, 10);
}
function parts(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function addMonths(iso, months) {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12 + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
var addYears = (iso, years) => addMonths(iso, years * 12);
function addDays(iso, days) {
  const d = /* @__PURE__ */ new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function ageOn(dob, onDate = todayIso()) {
  const [by, bm, bd] = parts(dob);
  const [y, m, d] = parts(onDate);
  let age = y - by;
  if (m < bm || m === bm && d < bd) age -= 1;
  return age;
}

// server/auth/totp.ts
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
function totp(secretBase32, label = "user", issuer = "EMS") {
  return new OTPAuth.TOTP({ issuer, label, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretBase32) });
}
function generateTotpSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}
async function totpEnrollment(secretBase32, label, issuer) {
  const uri = totp(secretBase32, label, issuer).toString();
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return { uri, qrDataUrl };
}
function verifyTotp(secretBase32, code) {
  if (!/^\d{6}$/.test(code)) return false;
  return totp(secretBase32).validate({ token: code, window: 1 }) !== null;
}

// server/services/notifications.ts
import { and as and3, desc, eq as eq5, inArray as inArray2, isNull as isNull2, sql as sql5 } from "drizzle-orm";
import { z as z3 } from "zod";
async function notify(tx, userIds, n) {
  const ids = [...new Set(userIds.filter((x) => !!x))];
  if (!ids.length) return 0;
  const rows = await tx.insert(notifications).values(ids.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null }))).onConflictDoNothing().returning({ id: notifications.id });
  return rows.length;
}
async function usersWithPermission(tx, perm) {
  const viaRole = await tx.selectDistinct({ id: users.id }).from(users).innerJoin(userRoles, eq5(userRoles.userId, users.id)).innerJoin(roles, eq5(roles.id, userRoles.roleId)).innerJoin(rolePermissions, and3(eq5(rolePermissions.roleId, roles.id), eq5(rolePermissions.permissionKey, perm))).where(eq5(users.status, "active"));
  const viaGrant = await tx.selectDistinct({ id: users.id }).from(users).innerJoin(userPermissionGrants, and3(eq5(userPermissionGrants.userId, users.id), eq5(userPermissionGrants.permissionKey, perm))).where(eq5(users.status, "active"));
  return [...new Set([...viaRole, ...viaGrant].map((r) => r.id))];
}
async function listNotifications(ctx, query) {
  requireActor(ctx);
  const q = parse(zPage.extend({ unread: z3.coerce.boolean().optional() }), query);
  const where = q.unread ? and3(eq5(notifications.userId, ctx.actor.userId), isNull2(notifications.readAt)) : eq5(notifications.userId, ctx.actor.userId);
  const [items, [{ total }], [{ unread }]] = await Promise.all([
    ctx.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql5`count(*)::int` }).from(notifications).where(where),
    ctx.db.select({ unread: sql5`count(*)::int` }).from(notifications).where(and3(eq5(notifications.userId, ctx.actor.userId), isNull2(notifications.readAt)))
  ]);
  return { items, total, unread, page: q.page, pageSize: q.pageSize };
}
async function markRead(ctx, input) {
  requireActor(ctx);
  const body = parse(z3.object({ ids: z3.array(z3.uuid()).max(200).optional(), all: z3.boolean().optional() }), input);
  const own = eq5(notifications.userId, ctx.actor.userId);
  const where = body.all ? and3(own, isNull2(notifications.readAt)) : and3(own, inArray2(notifications.id, body.ids ?? []));
  if (!body.all && !body.ids?.length) return { updated: 0 };
  const rows = await ctx.db.update(notifications).set({ readAt: ctx.now() }).where(where).returning({ id: notifications.id });
  return { updated: rows.length };
}

// server/services/auth.ts
var MAX_FAILED_LOGINS = 5;
var LOCK_MINUTES = 15;
var accountSchema = z4.object({
  displayName: zTrim(120),
  email: zEmail,
  password: zPassword
}).strict();
var employmentProfileSchema = z4.object({
  legalName: zTrim(160),
  preferredName: zOptText(120),
  dateOfBirth: zDate,
  phone: zPhone,
  personalEmail: zOptEmail,
  address: zOptText(500),
  departmentId: zUuid,
  jobTitleId: zOptUuid,
  gradeId: zOptUuid,
  workLocation: zOptText(160),
  employmentDate: zDate,
  employmentType: z4.enum(["permanent", "contract", "temporary", "volunteer", "intern"]),
  contractEndDate: zOptDate,
  supervisorName: zOptText(160)
}).strict();
var nextOfKinSchema = z4.object({
  fullName: zTrim(160),
  relationship: zTrim(60),
  phone: zPhone,
  address: zOptText(500)
}).strict();
var registrationSchema = z4.object({ account: accountSchema, profile: employmentProfileSchema, nextOfKin: nextOfKinSchema }).strict();
function validateEmploymentDates(p2, today = todayIso()) {
  const fields = {};
  if (p2.dateOfBirth) {
    if (p2.dateOfBirth >= today) fields.dateOfBirth = "Date of birth must be in the past";
    else if (addYears(p2.dateOfBirth, 16) > today) fields.dateOfBirth = "Employees must be at least 16 years old";
    else if (addYears(p2.dateOfBirth, 100) < today) fields.dateOfBirth = "Please check the date of birth";
  }
  if (p2.employmentDate && p2.dateOfBirth && p2.employmentDate < addYears(p2.dateOfBirth, 14)) {
    fields.employmentDate = "Employment date is not plausible for the date of birth";
  }
  if (p2.employmentDate && p2.employmentDate > addYears(today, 1)) fields.employmentDate = "Employment date is too far in the future";
  if (p2.employmentType === "contract" && p2.contractEndDate === null) fields.contractEndDate = "Contract end date is required for contract staff";
  if (p2.contractEndDate && p2.employmentDate && p2.contractEndDate <= p2.employmentDate) {
    fields.contractEndDate = "Contract end date must be after the employment date";
  }
  if (Object.keys(fields).length) throw badRequest("Validation failed", { fields });
}
async function validateOrgRefs(tx, p2) {
  const fields = {};
  if (p2.departmentId) {
    const [d] = await tx.select({ status: departments.status }).from(departments).where(eq6(departments.id, p2.departmentId));
    if (!d || d.status !== "active") fields.departmentId = "Select an active department";
  }
  if (p2.jobTitleId) {
    const [j] = await tx.select({ status: jobTitles.status, departmentId: jobTitles.departmentId }).from(jobTitles).where(eq6(jobTitles.id, p2.jobTitleId));
    if (!j || j.status !== "active") fields.jobTitleId = "Select an active job title";
    else if (j.departmentId && p2.departmentId && j.departmentId !== p2.departmentId) fields.jobTitleId = "Job title belongs to another department";
  }
  if (p2.gradeId) {
    const [g] = await tx.select({ status: employmentGrades.status }).from(employmentGrades).where(eq6(employmentGrades.id, p2.gradeId));
    if (!g || g.status !== "active") fields.gradeId = "Select an active grade";
  }
  if (p2.locationId) {
    const [l] = await tx.select({ status: workLocations.status }).from(workLocations).where(eq6(workLocations.id, p2.locationId));
    if (!l || l.status !== "active") fields.locationId = "Select an active work location";
  }
  if (Object.keys(fields).length) throw badRequest("Validation failed", { fields });
}
async function assertEmailFree(tx, email) {
  const [taken] = await tx.select({ id: users.id }).from(users).where(sql6`lower(${users.email}) = ${email.toLowerCase()}`);
  if (taken) throw conflict("That email address is already registered");
}
async function usernameFromEmail(tx, email) {
  const base = (email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") || "user").padEnd(3, "0").slice(0, 32);
  const rows = await tx.select({ username: users.username }).from(users).where(sql6`lower(${users.username}) like ${`${base.replace(/[%_\\]/g, "\\$&")}%`}`);
  const taken = new Set(rows.map((r) => r.username.toLowerCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}
async function register(ctx, input) {
  const body = parse(registrationSchema, input);
  if (!await getSetting(ctx.db, "registration.open")) throw forbidden("Self-registration is currently closed. Ask an administrator for an invitation.");
  validateEmploymentDates(body.profile, todayIso(ctx.now()));
  const result = await ctx.db.transaction(async (tx) => {
    await validateOrgRefs(tx, body.profile);
    await assertEmailFree(tx, body.account.email);
    const [user] = await tx.insert(users).values({
      email: body.account.email,
      username: await usernameFromEmail(tx, body.account.email),
      displayName: body.account.displayName,
      passwordHash: await hashPassword(body.account.password),
      status: "pending_verification",
      passwordChangedAt: ctx.now()
    }).returning();
    const { supervisorName, ...profile } = body.profile;
    const [emp] = await tx.insert(employees).values({
      ...profile,
      personalEmail: profile.personalEmail ?? body.account.email,
      userId: user.id,
      employmentStatus: "pending_verification",
      createdBy: user.id
    }).returning();
    await tx.insert(nextOfKin).values({ ...body.nextOfKin, employeeId: emp.id });
    const [approval] = await tx.insert(approvalRequests).values({
      type: "registration",
      targetType: "employee",
      targetId: emp.id,
      departmentId: emp.departmentId,
      summary: `New registration: ${emp.legalName}`,
      payload: { supervisorName: supervisorName ?? null, workLocation: emp.workLocation },
      requiredPermission: "employee.verify",
      requestedBy: user.id
    }).returning();
    await audit(tx, { ...ctx, actor: null }, {
      actorUserId: user.id,
      action: "auth.register",
      targetType: "employee",
      targetId: emp.id,
      newValues: { username: user.username, departmentId: emp.departmentId },
      approvalId: approval.id
    });
    await notify(tx, await usersWithPermission(tx, "employee.verify"), {
      type: "registration.pending",
      title: "Registration awaiting verification",
      body: `${emp.legalName} has registered and needs identity and employment verification.`,
      link: `/approvals?id=${approval.id}`,
      dedupeKey: `registration:${approval.id}`
    });
    const session = await createSession(tx, user.id, { ip: ctx.meta.ip, userAgent: ctx.meta.userAgent, now: ctx.now() });
    return { session, userId: user.id, employeeId: emp.id };
  });
  return result;
}
var loginSchema = z4.object({ identifier: z4.string().trim().min(1).max(254), password: z4.string().min(1).max(200) });
async function login(ctx, input) {
  const body = parse(loginSchema, input);
  const ident = body.identifier.toLowerCase();
  const [user] = await ctx.db.select().from(users).where(or2(sql6`lower(${users.email}) = ${ident}`, sql6`lower(${users.username}) = ${ident}`));
  const fail = async (userId, why) => {
    await audit(ctx.db, { ...ctx, actor: null }, {
      actorUserId: userId,
      action: "auth.login",
      outcome: "failure",
      targetType: "user",
      targetId: userId,
      newValues: { identifier: body.identifier.slice(0, 80), why }
    });
  };
  if (!user) {
    await burnPasswordCheck(body.password);
    await fail(null, "unknown_identifier");
    throw unauthorized("Invalid username/email or password");
  }
  const now = ctx.now();
  if (user.lockedUntil && user.lockedUntil > now) {
    await burnPasswordCheck(body.password);
    await fail(user.id, "locked");
    throw new AppError(429, "ACCOUNT_LOCKED", "Too many failed attempts. Try again later.");
  }
  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    const count = user.failedLoginCount + 1;
    await ctx.db.update(users).set({
      failedLoginCount: count >= MAX_FAILED_LOGINS ? 0 : count,
      lockedUntil: count >= MAX_FAILED_LOGINS ? new Date(now.getTime() + LOCK_MINUTES * 6e4) : user.lockedUntil
    }).where(eq6(users.id, user.id));
    await fail(user.id, count >= MAX_FAILED_LOGINS ? "bad_password_locked" : "bad_password");
    throw unauthorized("Invalid username/email or password");
  }
  if (user.status === "suspended" || user.status === "deactivated") {
    await fail(user.id, `status_${user.status}`);
    throw forbidden("This account is not active. Contact an administrator.");
  }
  await ctx.db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq6(users.id, user.id));
  const session = await createSession(ctx.db, user.id, {
    ip: ctx.meta.ip,
    userAgent: ctx.meta.userAgent,
    mfaPending: user.mfaEnabled,
    now
  });
  await audit(ctx.db, { ...ctx, actor: null }, {
    actorUserId: user.id,
    action: user.mfaEnabled ? "auth.login.password_ok" : "auth.login",
    targetType: "user",
    targetId: user.id
  });
  return { session, mfaRequired: user.mfaEnabled };
}
async function verifyMfaLogin(ctx, loaded, input) {
  const { code } = parse(z4.object({ code: z4.string().trim().max(10) }), input);
  if (!loaded || !loaded.session.mfaPending) throw unauthorized();
  const user = loaded.user;
  if (!user.mfaSecretEnc || !verifyTotp(decrypt(user.mfaSecretEnc), code)) {
    await audit(ctx.db, { ...ctx, actor: null }, { actorUserId: user.id, action: "auth.mfa", outcome: "failure", targetType: "user", targetId: user.id });
    throw unauthorized("Invalid verification code");
  }
  await revokeSession(ctx.db, loaded.session.id);
  const session = await createSession(ctx.db, user.id, { ip: ctx.meta.ip, userAgent: ctx.meta.userAgent, now: ctx.now() });
  await audit(ctx.db, { ...ctx, actor: null }, { actorUserId: user.id, action: "auth.login", targetType: "user", targetId: user.id, newValues: { mfa: true } });
  return { session };
}
async function logout(ctx, sessionId) {
  if (!sessionId) return;
  await revokeSession(ctx.db, sessionId);
  if (ctx.actor) await audit(ctx.db, ctx, { action: "auth.logout", targetType: "user", targetId: ctx.actor.userId });
}
async function me(ctx) {
  if (!ctx.actor) throw unauthorized();
  const a = ctx.actor;
  const settings = await getSettings(ctx.db);
  let employee = null;
  if (a.employeeId) {
    const [e] = await ctx.db.select({
      id: employees.id,
      legalName: employees.legalName,
      preferredName: employees.preferredName,
      employmentNumber: employees.employmentNumber,
      employmentStatus: employees.employmentStatus,
      departmentName: departments.name
    }).from(employees).innerJoin(departments, eq6(departments.id, employees.departmentId)).where(eq6(employees.id, a.employeeId));
    employee = e ?? null;
  }
  const privileged = a.roles.some((r) => PRIVILEGED_ROLES.includes(r));
  return {
    user: {
      id: a.userId,
      displayName: a.displayName,
      username: a.username,
      email: a.email,
      status: a.status,
      roles: a.roles,
      permissions: [...a.permissions].sort(),
      employeeId: a.employeeId,
      mfaEnabled: a.mfaEnabled,
      mustChangePassword: a.mustChangePassword,
      mfaSetupRequired: privileged && settings["security.require_mfa_for_privileged"] && !a.mfaEnabled,
      scopes: a.scopes
    },
    employee,
    org: { name: settings["org.name"], currency: settings["org.currency"] }
  };
}
async function reauthenticate(ctx, input) {
  requireActor(ctx);
  const body = parse(z4.object({ password: z4.string().min(1).max(200), code: z4.string().trim().max(10).optional() }), input);
  const [user] = await ctx.db.select().from(users).where(eq6(users.id, ctx.actor.userId));
  const passOk = await verifyPassword(body.password, user.passwordHash);
  const mfaOk = !user.mfaEnabled || !!body.code && !!user.mfaSecretEnc && verifyTotp(decrypt(user.mfaSecretEnc), body.code);
  if (!passOk || !mfaOk) {
    await audit(ctx.db, ctx, { action: "auth.reauth", outcome: "failure", targetType: "user", targetId: user.id });
    throw new AppError(401, "REAUTH_FAILED", user.mfaEnabled ? "Incorrect password or verification code" : "Incorrect password");
  }
  await ctx.db.update(sessions).set({ reauthAt: ctx.now() }).where(eq6(sessions.id, ctx.actor.sessionId));
  await audit(ctx.db, ctx, { action: "auth.reauth", targetType: "user", targetId: user.id });
  return { ok: true };
}
async function changePassword(ctx, input) {
  if (!ctx.actor) throw unauthorized();
  const body = parse(z4.object({ currentPassword: z4.string().min(1).max(200), newPassword: zPassword }), input);
  const [user] = await ctx.db.select().from(users).where(eq6(users.id, ctx.actor.userId));
  if (!await verifyPassword(body.currentPassword, user.passwordHash)) {
    await audit(ctx.db, ctx, { action: "auth.password_change", outcome: "failure", targetType: "user", targetId: user.id });
    throw badRequest("Validation failed", { fields: { currentPassword: "Current password is incorrect" } });
  }
  if (body.currentPassword === body.newPassword) throw badRequest("Validation failed", { fields: { newPassword: "Choose a different password" } });
  await ctx.db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(body.newPassword), passwordChangedAt: ctx.now(), mustChangePassword: false, updatedAt: ctx.now() }).where(eq6(users.id, user.id));
    await revokeAllSessions(tx, user.id, ctx.actor.sessionId);
    await audit(tx, ctx, { action: "auth.password_change", targetType: "user", targetId: user.id });
  });
  return { ok: true };
}
async function mfaSetup(ctx) {
  requireActor(ctx);
  const [user] = await ctx.db.select().from(users).where(eq6(users.id, ctx.actor.userId));
  if (user.mfaEnabled) throw conflict("Two-factor authentication is already enabled");
  const secret = generateTotpSecret();
  await ctx.db.update(users).set({ mfaSecretEnc: encrypt(secret) }).where(eq6(users.id, user.id));
  const orgName = await getSetting(ctx.db, "org.name");
  const enrollment = await totpEnrollment(secret, user.username, orgName);
  return { ...enrollment, secret };
}
async function mfaEnable(ctx, input) {
  requireActor(ctx);
  const { code } = parse(z4.object({ code: z4.string().trim().max(10) }), input);
  const [user] = await ctx.db.select().from(users).where(eq6(users.id, ctx.actor.userId));
  if (!user.mfaSecretEnc || !verifyTotp(decrypt(user.mfaSecretEnc), code)) throw badRequest("Invalid verification code");
  await ctx.db.update(users).set({ mfaEnabled: true }).where(eq6(users.id, user.id));
  await audit(ctx.db, ctx, { action: "auth.mfa_enabled", targetType: "user", targetId: user.id });
  return { ok: true };
}
async function mfaDisable(ctx) {
  requireActor(ctx);
  requireRecentAuth(ctx);
  await ctx.db.update(users).set({ mfaEnabled: false, mfaSecretEnc: null }).where(eq6(users.id, ctx.actor.userId));
  await audit(ctx.db, ctx, { action: "auth.mfa_disabled", targetType: "user", targetId: ctx.actor.userId });
  return { ok: true };
}
async function findInvitation(db, token, now) {
  if (!token || token.length > 100) return null;
  const [row] = await db.select({ inv: invitations, legalName: employees.legalName, employeeUserId: employees.userId, employmentStatus: employees.employmentStatus }).from(invitations).innerJoin(employees, eq6(employees.id, invitations.employeeId)).where(eq6(invitations.tokenHash, sha256(token)));
  if (!row || row.inv.acceptedAt || row.inv.revokedAt || row.inv.expiresAt <= now || row.employeeUserId) return null;
  return row;
}
async function getInvitation(ctx, token) {
  const row = await findInvitation(ctx.db, token, ctx.now());
  if (!row) throw new AppError(404, "INVITATION_INVALID", "This invitation is invalid or has expired");
  return { email: row.inv.email, legalName: row.legalName };
}
async function acceptInvitation(ctx, token, input) {
  const body = parse(z4.object({ password: zPassword, displayName: zTrim(120).optional() }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const row = await findInvitation(tx, token, ctx.now());
    if (!row) throw new AppError(404, "INVITATION_INVALID", "This invitation is invalid or has expired");
    await assertEmailFree(tx, row.inv.email);
    const active = row.employmentStatus === "active" || row.employmentStatus === "on_leave";
    const [user] = await tx.insert(users).values({
      email: row.inv.email,
      username: await usernameFromEmail(tx, row.inv.email),
      displayName: body.displayName ?? row.legalName,
      passwordHash: await hashPassword(body.password),
      status: active ? "active" : "pending_verification",
      passwordChangedAt: ctx.now()
    }).returning();
    const linked = await tx.update(employees).set({ userId: user.id, updatedAt: ctx.now() }).where(and4(eq6(employees.id, row.inv.employeeId), isNull3(employees.userId))).returning({ id: employees.id });
    if (!linked.length) throw conflict("This employee record is already linked to an account");
    const roleKey = row.inv.roleKey;
    const [role] = await tx.select().from(roles).where(eq6(roles.key, roleKey));
    await tx.insert(userRoles).values({ userId: user.id, roleId: role.id, grantedBy: row.inv.createdBy });
    await tx.update(invitations).set({ acceptedAt: ctx.now() }).where(eq6(invitations.id, row.inv.id));
    await audit(tx, { ...ctx, actor: null }, {
      actorUserId: user.id,
      action: "auth.invitation_accepted",
      targetType: "employee",
      targetId: row.inv.employeeId,
      newValues: { username: user.username, role: roleKey }
    });
    const session = await createSession(tx, user.id, { ip: ctx.meta.ip, userAgent: ctx.meta.userAgent, now: ctx.now() });
    return { session };
  });
}
async function countActiveSuperAdmins(tx) {
  const [{ n }] = await tx.select({ n: sql6`count(distinct ${users.id})::int` }).from(users).innerJoin(userRoles, eq6(userRoles.userId, users.id)).innerJoin(roles, and4(eq6(roles.id, userRoles.roleId), eq6(roles.key, "super_admin"))).where(eq6(users.status, "active"));
  return n;
}
async function provisionSuperAdmin(db, input, meta, opts = {}) {
  const email = parse(zEmail, input.email);
  const username = parse(zUsername, input.username);
  parse(zPassword, input.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(or2(sql6`lower(${users.email}) = ${email}`, sql6`lower(${users.username}) = ${username.toLowerCase()}`));
    let userId;
    if (existing) {
      await tx.update(users).set({
        passwordHash: await hashPassword(input.password),
        status: "active",
        failedLoginCount: 0,
        lockedUntil: null,
        mfaEnabled: false,
        mfaSecretEnc: null,
        mustChangePassword: opts.forceChange ?? true,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq6(users.id, existing.id));
      await revokeAllSessions(tx, existing.id);
      userId = existing.id;
    } else {
      const [u] = await tx.insert(users).values({
        email,
        username,
        displayName: input.name,
        passwordHash: await hashPassword(input.password),
        status: "active",
        mustChangePassword: opts.forceChange ?? true
      }).returning();
      userId = u.id;
    }
    const [role] = await tx.select().from(roles).where(eq6(roles.key, "super_admin"));
    await tx.insert(userRoles).values({ userId, roleId: role.id }).onConflictDoNothing();
    await audit(tx, { actor: null, meta }, {
      actorUserId: null,
      action: existing ? "security.superadmin_recovered" : "security.superadmin_provisioned",
      targetType: "user",
      targetId: userId,
      newValues: { username, email },
      reason: "Provisioned via secure setup procedure"
    });
    return { userId, created: !existing };
  });
}

// server/services/employees.ts
import { z as z6 } from "zod";
import { and as and6, asc as asc2, desc as desc2, eq as eq9, ilike as ilike2, inArray as inArray4, isNotNull, isNull as isNull4, ne, or as or4, sql as sql9 } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

// server/lib/csv.ts
function cell(v) {
  if (v === null || v === void 0) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
function minorToDecimal(minor, digits = 2) {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const factor = 10 ** digits;
  return `${sign}${Math.floor(abs / factor)}.${String(abs % factor).padStart(digits, "0")}`;
}

// server/services/employmentNumbers.ts
import { eq as eq7, sql as sql7 } from "drizzle-orm";
var EMPLOYMENT_NUMBER_WIDTH = 6;
function formatEmploymentNumber(code, value) {
  return `${code}-${String(value).padStart(EMPLOYMENT_NUMBER_WIDTH, "0")}`;
}
async function issueEmploymentNumber(tx, departmentId) {
  const [dept] = await tx.select({ code: departments.code }).from(departments).where(eq7(departments.id, departmentId));
  if (!dept) throw new AppError(400, "BAD_REQUEST", "Unknown department");
  const [row] = await tx.insert(employmentNumberSequences).values({ departmentId, nextValue: 2 }).onConflictDoUpdate({
    target: employmentNumberSequences.departmentId,
    set: { nextValue: sql7`${employmentNumberSequences.nextValue} + 1` }
  }).returning({ value: sql7`${employmentNumberSequences.nextValue} - 1` });
  return formatEmploymentNumber(dept.code, Number(row.value));
}
async function sequenceHasIssued(tx, departmentId) {
  const [row] = await tx.select({ next: employmentNumberSequences.nextValue }).from(employmentNumberSequences).where(eq7(employmentNumberSequences.departmentId, departmentId));
  return !!row && Number(row.next) > 1;
}

// server/services/users.ts
import { z as z5 } from "zod";
import { and as and5, asc, eq as eq8, ilike, inArray as inArray3, or as or3, sql as sql8 } from "drizzle-orm";
async function isActiveSuperAdmin(tx, userId) {
  const [row] = await tx.select({ id: users.id }).from(users).innerJoin(userRoles, eq8(userRoles.userId, users.id)).innerJoin(roles, and5(eq8(roles.id, userRoles.roleId), eq8(roles.key, "super_admin"))).where(and5(eq8(users.id, userId), eq8(users.status, "active")));
  return !!row;
}
async function assertNotLastSuperAdmin(tx, userId) {
  if (await isActiveSuperAdmin(tx, userId) && await countActiveSuperAdmins(tx) <= 1) {
    throw conflict("This is the last active super admin account. Promote another super admin first.");
  }
}
async function rolesOf(tx, userId) {
  const rows = await tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq8(roles.id, userRoles.roleId)).where(eq8(userRoles.userId, userId));
  return rows.map((r) => r.key);
}
function requireUserAdmin(ctx) {
  requirePerm(ctx, "role.assign", "user.manage", "scope.manage");
}
async function listUsers(ctx, query) {
  requireUserAdmin(ctx);
  const q = parse(
    zPage.extend({
      q: z5.string().trim().max(100).optional(),
      role: z5.enum(ROLE_KEYS).optional(),
      status: z5.enum(["pending_verification", "active", "suspended", "deactivated"]).optional()
    }),
    query
  );
  const conds = [];
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(or3(ilike(users.displayName, like), ilike(users.username, like), ilike(users.email, like), ilike(employees.employmentNumber, like)));
  }
  if (q.status) conds.push(eq8(users.status, q.status));
  if (q.role) {
    conds.push(
      sql8`exists (select 1 from ${userRoles} ur join ${roles} r on r.id = ur.role_id where ur.user_id = ${users.id} and r.key = ${q.role})`
    );
  }
  const where = conds.length ? and5(...conds) : void 0;
  const rows = await ctx.db.select({
    id: users.id,
    displayName: users.displayName,
    username: users.username,
    email: users.email,
    status: users.status,
    mfaEnabled: users.mfaEnabled,
    lastLoginAt: users.lastLoginAt,
    createdAt: users.createdAt,
    employeeId: employees.id,
    employmentNumber: employees.employmentNumber
  }).from(users).leftJoin(employees, eq8(employees.userId, users.id)).where(where).orderBy(asc(users.displayName)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const [{ total }] = await ctx.db.select({ total: sql8`count(*)::int` }).from(users).leftJoin(employees, eq8(employees.userId, users.id)).where(where);
  const ids = rows.map((r) => r.id);
  const roleRows = ids.length ? await ctx.db.select({ userId: userRoles.userId, key: roles.key }).from(userRoles).innerJoin(roles, eq8(roles.id, userRoles.roleId)).where(inArray3(userRoles.userId, ids)) : [];
  return {
    items: rows.map((r) => ({ ...r, roles: roleRows.filter((x) => x.userId === r.id).map((x) => x.key) })),
    total,
    page: q.page,
    pageSize: q.pageSize
  };
}
async function getUser(ctx, userId) {
  requireUserAdmin(ctx);
  const [u] = await ctx.db.select({
    id: users.id,
    displayName: users.displayName,
    username: users.username,
    email: users.email,
    status: users.status,
    mfaEnabled: users.mfaEnabled,
    lastLoginAt: users.lastLoginAt,
    createdAt: users.createdAt,
    employeeId: employees.id,
    employmentNumber: employees.employmentNumber,
    legalName: employees.legalName
  }).from(users).leftJoin(employees, eq8(employees.userId, users.id)).where(eq8(users.id, userId));
  if (!u) throw notFound("User not found");
  const [userRoleKeys, grants, scopes] = await Promise.all([
    rolesOf(ctx.db, userId),
    ctx.db.select().from(userPermissionGrants).where(eq8(userPermissionGrants.userId, userId)),
    ctx.db.select({
      id: moderatorScopes.id,
      scopeType: moderatorScopes.scopeType,
      departmentId: moderatorScopes.departmentId,
      locationId: moderatorScopes.locationId,
      departmentName: departments.name,
      locationName: workLocations.name
    }).from(moderatorScopes).leftJoin(departments, eq8(departments.id, moderatorScopes.departmentId)).leftJoin(workLocations, eq8(workLocations.id, moderatorScopes.locationId)).where(eq8(moderatorScopes.userId, userId))
  ]);
  return {
    ...u,
    roles: userRoleKeys,
    grants,
    scopes,
    isSelf: userId === ctx.actor.userId,
    can: {
      assignRoles: has(ctx.actor, "role.assign"),
      manageStatus: has(ctx.actor, "user.manage") && userId !== ctx.actor.userId,
      manageScopes: has(ctx.actor, "scope.manage") && userId !== ctx.actor.userId
    }
  };
}
var rolesInput = z5.object({ roles: z5.array(z5.enum(ROLE_KEYS)).max(5), reason: zTrim(500, 5) }).strict();
async function setUserRoles(ctx, userId, input) {
  requirePerm(ctx, "role.assign");
  requireRecentAuth(ctx);
  const body = parse(rolesInput, input);
  const next = [.../* @__PURE__ */ new Set(["employee", ...body.roles])];
  return ctx.db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq8(users.id, userId));
    if (!target) throw notFound("User not found");
    if (target.status === "pending_verification" && next.some((r) => r !== "employee")) {
      throw badRequest("Verify the account before granting privileged roles");
    }
    const before = await rolesOf(tx, userId);
    if (before.includes("super_admin") && !next.includes("super_admin")) await assertNotLastSuperAdmin(tx, userId);
    const roleRows = await tx.select().from(roles).where(inArray3(roles.key, next));
    await tx.delete(userRoles).where(eq8(userRoles.userId, userId));
    await tx.insert(userRoles).values(roleRows.map((r) => ({ userId, roleId: r.id, grantedBy: ctx.actor.userId })));
    if (!next.includes("moderator")) await tx.delete(moderatorScopes).where(eq8(moderatorScopes.userId, userId));
    const removed = before.filter((r) => !next.includes(r));
    if (removed.length && userId !== ctx.actor.userId) await revokeAllSessions(tx, userId);
    await audit(tx, ctx, {
      action: "role.change",
      targetType: "user",
      targetId: userId,
      oldValues: { roles: before },
      newValues: { roles: next },
      reason: body.reason
    });
    await notify(tx, [userId], {
      type: "role.changed",
      title: "Your access roles have changed",
      body: `Your roles are now: ${next.map((r) => ROLE_META[r].name).join(", ")}.`,
      link: "/account"
    });
    return { roles: next };
  });
}
var grantInput = z5.object({ permission: z5.enum(ALL_PERMISSIONS), reason: zTrim(500, 5) }).strict();
async function addGrant(ctx, userId, input) {
  requirePerm(ctx, "role.assign");
  requireRecentAuth(ctx);
  const body = parse(grantInput, input);
  if (userId === ctx.actor.userId) throw forbidden("You cannot grant permissions to yourself");
  return ctx.db.transaction(async (tx) => {
    const [target] = await tx.select({ status: users.status }).from(users).where(eq8(users.id, userId));
    if (!target) throw notFound("User not found");
    if (target.status !== "active") throw badRequest("Grants can only be added to active accounts");
    const [perm] = await tx.select().from(permissions).where(eq8(permissions.key, body.permission));
    if (!perm) throw badRequest("Unknown permission");
    await tx.insert(userPermissionGrants).values({ userId, permissionKey: body.permission, grantedBy: ctx.actor.userId, reason: body.reason }).onConflictDoNothing();
    await audit(tx, ctx, { action: "permission.grant", targetType: "user", targetId: userId, newValues: { permission: body.permission }, reason: body.reason });
    return { ok: true };
  });
}
async function removeGrant(ctx, userId, permission, input) {
  requirePerm(ctx, "role.assign");
  requireRecentAuth(ctx);
  const body = parse(z5.object({ reason: zTrim(500, 5) }), input);
  return ctx.db.transaction(async (tx) => {
    const rows = await tx.delete(userPermissionGrants).where(and5(eq8(userPermissionGrants.userId, userId), eq8(userPermissionGrants.permissionKey, permission))).returning();
    if (!rows.length) throw notFound("Grant not found");
    await revokeAllSessions(tx, userId);
    await audit(tx, ctx, { action: "permission.revoke", targetType: "user", targetId: userId, oldValues: { permission }, reason: body.reason });
    return { ok: true };
  });
}
var scopesInput = z5.object({
  scopes: z5.array(
    z5.object({
      scopeType: z5.enum(["org_unit", "direct_reports"]),
      departmentId: z5.uuid().nullable().optional(),
      locationId: z5.uuid().nullable().optional()
    })
  ).max(50),
  reason: zTrim(500, 5)
}).strict();
async function setModeratorScopes(ctx, userId, input) {
  requirePerm(ctx, "scope.manage");
  const body = parse(scopesInput, input);
  if (userId === ctx.actor.userId) throw forbidden("You cannot change your own scope");
  return ctx.db.transaction(async (tx) => {
    const targetRoles = await rolesOf(tx, userId);
    if (!targetRoles.includes("moderator")) throw badRequest("Scopes can only be assigned to users with the moderator role");
    const normalized = body.scopes.map(
      (s) => s.scopeType === "direct_reports" ? { scopeType: "direct_reports", departmentId: null, locationId: null } : { scopeType: "org_unit", departmentId: s.departmentId ?? null, locationId: s.locationId ?? null }
    );
    for (const s of normalized) {
      if (s.scopeType === "org_unit" && !s.departmentId && !s.locationId) throw badRequest("Each scope needs a department and/or location");
      if (s.departmentId) {
        const [d] = await tx.select({ id: departments.id }).from(departments).where(eq8(departments.id, s.departmentId));
        if (!d) throw badRequest("Unknown department in scope");
      }
      if (s.locationId) {
        const [l] = await tx.select({ id: workLocations.id }).from(workLocations).where(eq8(workLocations.id, s.locationId));
        if (!l) throw badRequest("Unknown location in scope");
      }
    }
    const before = await tx.select({ scopeType: moderatorScopes.scopeType, departmentId: moderatorScopes.departmentId, locationId: moderatorScopes.locationId }).from(moderatorScopes).where(eq8(moderatorScopes.userId, userId));
    await tx.delete(moderatorScopes).where(eq8(moderatorScopes.userId, userId));
    if (normalized.length) {
      await tx.insert(moderatorScopes).values(normalized.map((s) => ({ ...s, userId, createdBy: ctx.actor.userId })));
    }
    await audit(tx, ctx, {
      action: "scope.change",
      targetType: "user",
      targetId: userId,
      oldValues: { scopes: before },
      newValues: { scopes: normalized },
      reason: body.reason
    });
    await notify(tx, [userId], { type: "scope.changed", title: "Your moderation scope has changed", link: "/account" });
    return { scopes: normalized };
  });
}
var statusInput = z5.object({ status: z5.enum(["active", "suspended", "deactivated"]), reason: zTrim(500, 5) }).strict();
async function setUserStatus(ctx, userId, input) {
  requirePerm(ctx, "user.manage");
  requireRecentAuth(ctx);
  const body = parse(statusInput, input);
  if (userId === ctx.actor.userId) throw forbidden("You cannot change the status of your own account");
  return ctx.db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq8(users.id, userId));
    if (!target) throw notFound("User not found");
    if (target.status === "pending_verification") throw badRequest("Pending accounts are activated through registration verification");
    if (body.status !== "active") {
      await assertNotLastSuperAdmin(tx, userId);
      await revokeAllSessions(tx, userId);
    }
    await tx.update(users).set({ status: body.status, updatedAt: ctx.now() }).where(eq8(users.id, userId));
    await audit(tx, ctx, {
      action: "user.status_change",
      targetType: "user",
      targetId: userId,
      oldValues: { status: target.status },
      newValues: { status: body.status },
      reason: body.reason
    });
    return { status: body.status };
  });
}
async function recoverAccess(ctx, userId, input) {
  requirePerm(ctx, "user.manage");
  requireRecentAuth(ctx);
  const body = parse(z5.object({ reason: zTrim(500, 5) }), input);
  if (userId === ctx.actor.userId) throw forbidden("Use the account page to change your own password");
  const temporaryPassword = `Tmp-${randomToken(9)}9a`;
  await ctx.db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq8(users.id, userId));
    if (!target) throw notFound("User not found");
    if (target.status === "deactivated") throw badRequest("Reactivate the account before recovering access");
    await tx.update(users).set({
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      mfaEnabled: false,
      mfaSecretEnc: null,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: ctx.now()
    }).where(eq8(users.id, userId));
    await revokeAllSessions(tx, userId);
    await audit(tx, ctx, { action: "user.access_recovery", targetType: "user", targetId: userId, reason: body.reason });
  });
  return { temporaryPassword };
}

// server/services/employees.ts
var supervisor = alias(employees, "supervisor");
var CHANGEABLE_STATUSES = ["active", "on_leave", "suspended", "terminated"];
async function loadEmployee(tx, id, lock = false) {
  if (!z6.uuid().safeParse(id).success) return null;
  const q = tx.select().from(employees).where(eq9(employees.id, id));
  const [row] = lock ? await q.for("update") : await q;
  return row ?? null;
}
async function requireViewableEmployee(ctx, id, tx = ctx.db) {
  const emp = await loadEmployee(tx, id);
  if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord("Employee");
  return emp;
}
async function labelFor(tx, field, id) {
  if (!id || typeof id !== "string") return null;
  const lookups2 = {
    departmentId: () => tx.select({ label: departments.name }).from(departments).where(eq9(departments.id, id)),
    locationId: () => tx.select({ label: workLocations.name }).from(workLocations).where(eq9(workLocations.id, id)),
    jobTitleId: () => tx.select({ label: jobTitles.name }).from(jobTitles).where(eq9(jobTitles.id, id)),
    gradeId: () => tx.select({ label: employmentGrades.name }).from(employmentGrades).where(eq9(employmentGrades.id, id)),
    supervisorId: () => tx.select({ label: employees.legalName }).from(employees).where(eq9(employees.id, id))
  };
  const fn = lookups2[field];
  if (!fn) return null;
  const [row] = await fn();
  return row?.label ?? null;
}
var listQuery = zPage.extend({
  q: z6.string().trim().max(100).optional(),
  departmentId: z6.uuid().optional(),
  locationId: z6.uuid().optional(),
  jobTitleId: z6.uuid().optional(),
  supervisorId: z6.uuid().optional(),
  status: z6.enum(["pending_verification", "active", "on_leave", "suspended", "retired", "terminated", "rejected"]).optional(),
  archived: z6.enum(["exclude", "include", "only"]).default("exclude"),
  sort: z6.enum(["name", "employmentNumber", "department", "employmentDate", "status"]).default("name"),
  dir: z6.enum(["asc", "desc"]).default("asc")
});
function directoryWhere(actor, q) {
  const conds = [employeeVisibilitySql(actor)];
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(
      or4(
        ilike2(employees.legalName, like),
        ilike2(employees.preferredName, like),
        ilike2(employees.employmentNumber, like),
        ilike2(users.username, like)
      )
    );
  }
  if (q.departmentId) conds.push(eq9(employees.departmentId, q.departmentId));
  if (q.locationId) conds.push(eq9(employees.locationId, q.locationId));
  if (q.jobTitleId) conds.push(eq9(employees.jobTitleId, q.jobTitleId));
  if (q.supervisorId) conds.push(eq9(employees.supervisorId, q.supervisorId));
  if (q.status) conds.push(eq9(employees.employmentStatus, q.status));
  else conds.push(ne(employees.employmentStatus, "rejected"));
  const canArchived = has(actor, "employee.archive") || has(actor, "employee.read.all");
  if (q.archived === "only" && canArchived) conds.push(isNotNull(employees.archivedAt));
  else if (q.archived === "include" && canArchived) {
  } else conds.push(isNull4(employees.archivedAt));
  return and6(...conds);
}
function directoryQuery(tx) {
  return tx.select({
    id: employees.id,
    legalName: employees.legalName,
    preferredName: employees.preferredName,
    employmentNumber: employees.employmentNumber,
    employmentStatus: employees.employmentStatus,
    employmentType: employees.employmentType,
    employmentDate: employees.employmentDate,
    dateOfBirth: employees.dateOfBirth,
    phone: employees.phone,
    personalEmail: employees.personalEmail,
    archivedAt: employees.archivedAt,
    departmentId: employees.departmentId,
    departmentName: departments.name,
    departmentCode: departments.code,
    locationId: employees.locationId,
    locationName: workLocations.name,
    workLocation: employees.workLocation,
    jobTitleId: employees.jobTitleId,
    jobTitleName: jobTitles.name,
    gradeId: employees.gradeId,
    gradeName: employmentGrades.name,
    supervisorId: employees.supervisorId,
    supervisorName: supervisor.legalName,
    username: users.username
  }).from(employees).innerJoin(departments, eq9(departments.id, employees.departmentId)).leftJoin(workLocations, eq9(workLocations.id, employees.locationId)).leftJoin(jobTitles, eq9(jobTitles.id, employees.jobTitleId)).leftJoin(employmentGrades, eq9(employmentGrades.id, employees.gradeId)).leftJoin(supervisor, eq9(supervisor.id, employees.supervisorId)).leftJoin(users, eq9(users.id, employees.userId));
}
function serializeSummary(actor, r, today) {
  const access = fieldAccess(actor, r);
  return {
    id: r.id,
    legalName: r.legalName,
    preferredName: r.preferredName,
    employmentNumber: access.employment ? r.employmentNumber : null,
    employmentStatus: r.employmentStatus,
    employmentType: access.employment ? r.employmentType : null,
    employmentDate: access.employment ? r.employmentDate : null,
    archived: !!r.archivedAt,
    department: { id: r.departmentId, name: r.departmentName, code: r.departmentCode },
    location: r.locationId ? { id: r.locationId, name: r.locationName } : null,
    workLocation: r.workLocation,
    jobTitle: r.jobTitleId ? { id: r.jobTitleId, name: r.jobTitleName } : null,
    grade: r.gradeName,
    gradeId: r.gradeId,
    supervisor: r.supervisorId ? { id: r.supervisorId, name: r.supervisorName } : null,
    age: access.age && r.dateOfBirth ? ageOn(r.dateOfBirth, today) : null,
    dateOfBirth: access.age ? r.dateOfBirth : null,
    phone: access.personal ? r.phone : null
  };
}
var SORTS = {
  name: employees.legalName,
  employmentNumber: employees.employmentNumber,
  department: departments.name,
  employmentDate: employees.employmentDate,
  status: employees.employmentStatus
};
async function listEmployees(ctx, query) {
  requirePerm(ctx, "employee.read.all", "employee.read.scoped");
  const q = parse(listQuery, query);
  const where = directoryWhere(ctx.actor, q);
  const order = q.dir === "desc" ? desc2(SORTS[q.sort]) : asc2(SORTS[q.sort]);
  const [rows, [{ total }]] = await Promise.all([
    directoryQuery(ctx.db).where(where).orderBy(order, asc2(employees.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql9`count(*)::int` }).from(employees).innerJoin(departments, eq9(departments.id, employees.departmentId)).leftJoin(users, eq9(users.id, employees.userId)).where(where)
  ]);
  const today = todayIso(ctx.now());
  return { items: rows.map((r) => serializeSummary(ctx.actor, r, today)), total, page: q.page, pageSize: q.pageSize };
}
async function employeeOptions(ctx, query) {
  requirePerm(ctx, "employee.read.all", "employee.read.scoped", "payroll.read");
  const q = parse(z6.object({ q: z6.string().trim().max(100).optional(), departmentId: z6.uuid().optional() }), query);
  const conds = [isNull4(employees.archivedAt), inArray4(employees.employmentStatus, ["active", "on_leave"])];
  if (!has(ctx.actor, "payroll.read")) conds.push(employeeVisibilitySql(ctx.actor));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(or4(ilike2(employees.legalName, like), ilike2(employees.employmentNumber, like)));
  }
  if (q.departmentId) conds.push(eq9(employees.departmentId, q.departmentId));
  return ctx.db.select({ id: employees.id, legalName: employees.legalName, employmentNumber: employees.employmentNumber, departmentCode: departments.code }).from(employees).innerJoin(departments, eq9(departments.id, employees.departmentId)).where(and6(...conds)).orderBy(asc2(employees.legalName)).limit(25);
}
async function exportEmployeesCsv(ctx, query) {
  requirePerm(ctx, "employee.export");
  const q = parse(listQuery.omit({ page: true, pageSize: true }), query);
  const where = directoryWhere(ctx.actor, { ...q, page: 1, pageSize: 1 });
  const rows = await directoryQuery(ctx.db).where(where).orderBy(asc2(employees.legalName)).limit(1e4);
  const today = todayIso(ctx.now());
  const personal = has(ctx.actor, "employee.read.personal");
  const age = personal || has(ctx.actor, "employee.read.age");
  const header = ["Employment number", "Legal name", "Preferred name", "Department", "Location", "Work location (as written)", "Job title", "Grade", "Supervisor", "Status", "Employment type", "Employment date"];
  if (age) header.push("Date of birth", "Age");
  if (personal) header.push("Phone", "Personal email");
  const data = rows.map((r) => {
    const line = [r.employmentNumber, r.legalName, r.preferredName, r.departmentName, r.locationName, r.workLocation, r.jobTitleName, r.gradeName, r.supervisorName, r.employmentStatus, r.employmentType, r.employmentDate];
    if (age) line.push(r.dateOfBirth, r.dateOfBirth ? ageOn(r.dateOfBirth, today) : "");
    if (personal) line.push(r.phone, r.personalEmail);
    return line;
  });
  await audit(ctx.db, ctx, { action: "employee.export", targetType: "employee", newValues: { filters: q, rows: rows.length, personal, age } });
  return toCsv(header, data);
}
async function getEmployee(ctx, id) {
  requireActor(ctx);
  const emp = await requireViewableEmployee(ctx, id);
  const access = fieldAccess(ctx.actor, emp);
  const [row] = await directoryQuery(ctx.db).where(eq9(employees.id, id));
  const today = todayIso(ctx.now());
  const mode = updateMode(ctx.actor, emp);
  const [nok] = access.nextOfKin ? await ctx.db.select().from(nextOfKin).where(eq9(nextOfKin.employeeId, id)) : [];
  const [account] = access.account && emp.userId ? await ctx.db.select({ id: users.id, username: users.username, email: users.email, status: users.status }).from(users).where(eq9(users.id, emp.userId)) : [];
  const [pendingInvite] = !emp.userId && has(ctx.actor, "employee.create") ? await ctx.db.select({ email: invitations.email, expiresAt: invitations.expiresAt }).from(invitations).where(and6(eq9(invitations.employeeId, id), isNull4(invitations.acceptedAt), isNull4(invitations.revokedAt))).orderBy(desc2(invitations.createdAt)).limit(1) : [];
  const archived = !!emp.archivedAt;
  return {
    ...serializeSummary(ctx.actor, row, today),
    employment: access.employment ? {
      employmentNumber: emp.employmentNumber,
      employmentType: emp.employmentType,
      employmentDate: emp.employmentDate,
      contractEndDate: emp.contractEndDate,
      verifiedAt: emp.verifiedAt,
      archivedAt: emp.archivedAt,
      archiveReason: emp.archiveReason
    } : null,
    personal: access.personal ? {
      dateOfBirth: emp.dateOfBirth,
      age: emp.dateOfBirth ? ageOn(emp.dateOfBirth, today) : null,
      phone: emp.phone,
      personalEmail: emp.personalEmail,
      address: emp.address
    } : access.age ? { dateOfBirth: emp.dateOfBirth, age: emp.dateOfBirth ? ageOn(emp.dateOfBirth, today) : null } : null,
    nextOfKin: access.nextOfKin ? nok ? { fullName: nok.fullName, relationship: nok.relationship, phone: nok.phone, address: nok.address } : null : void 0,
    account: account ?? null,
    pendingInvitation: pendingInvite ?? null,
    access: {
      ...access,
      updateMode: archived ? "none" : mode,
      directFields: archived ? [] : directFieldsFor(mode),
      proposableFields: archived ? [] : proposableFieldsFor(mode),
      canEditNextOfKin: !archived && (access.self || mode === "override"),
      canRequestCorrection: !archived && access.self && emp.employmentStatus !== "pending_verification",
      canArchive: has(ctx.actor, "employee.archive") && !access.self,
      canVerify: emp.employmentStatus === "pending_verification" && has(ctx.actor, "employee.verify") && !access.self,
      canInvite: !emp.userId && !archived && has(ctx.actor, "employee.create")
    }
  };
}
async function getEmploymentHistory(ctx, id) {
  requireActor(ctx);
  const emp = await requireViewableEmployee(ctx, id);
  const access = fieldAccess(ctx.actor, emp);
  if (!access.employment) throw deniedRecord("Employee");
  return ctx.db.select({
    id: employmentHistory.id,
    changeType: employmentHistory.changeType,
    fromValues: employmentHistory.fromValues,
    toValues: employmentHistory.toValues,
    effectiveDate: employmentHistory.effectiveDate,
    reason: employmentHistory.reason,
    createdAt: employmentHistory.createdAt,
    actorName: users.displayName,
    approvalId: employmentHistory.approvalId
  }).from(employmentHistory).leftJoin(users, eq9(users.id, employmentHistory.actorUserId)).where(eq9(employmentHistory.employeeId, id)).orderBy(desc2(employmentHistory.createdAt));
}
var createSchema = z6.object({
  legalName: zTrim(160),
  preferredName: zOptText(120),
  dateOfBirth: zDate,
  phone: zOptPhone,
  personalEmail: zOptEmail,
  address: zOptText(500),
  departmentId: zUuid,
  jobTitleId: zOptUuid,
  gradeId: zOptUuid,
  locationId: zOptUuid,
  workLocation: zOptText(160),
  supervisorId: zOptUuid,
  employmentDate: zDate,
  employmentType: z6.enum(["permanent", "contract", "temporary", "volunteer", "intern"]),
  contractEndDate: zOptDate,
  nextOfKin: nextOfKinSchema.optional(),
  invite: z6.object({ email: zEmail, roleKey: z6.enum(ROLE_KEYS).default("employee") }).strict().optional()
}).strict();
async function validateSupervisor(tx, employeeId, supervisorId) {
  if (!supervisorId) return;
  if (supervisorId === employeeId) throw badRequest("Validation failed", { fields: { supervisorId: "An employee cannot supervise themselves" } });
  const sup = await loadEmployee(tx, supervisorId);
  if (!sup || sup.archivedAt || !["active", "on_leave"].includes(sup.employmentStatus)) {
    throw badRequest("Validation failed", { fields: { supervisorId: "Select an active supervisor" } });
  }
  let cursor = sup.supervisorId;
  for (let i = 0; cursor && i < 50; i++) {
    if (cursor === employeeId) throw badRequest("Validation failed", { fields: { supervisorId: "This would create a reporting cycle" } });
    const next = await loadEmployee(tx, cursor);
    cursor = next?.supervisorId ?? null;
  }
}
async function assertInviteRoleAllowed(ctx, roleKey) {
  if (roleKey !== "employee") {
    if (!has(ctx.actor, "role.assign")) throw forbidden("Only a super admin can pre-provision privileged roles");
    requireRecentAuth(ctx);
  }
}
async function createInvitationTx(tx, ctx, employeeId, email, roleKey) {
  const [emailTaken] = await tx.select({ id: users.id }).from(users).where(sql9`lower(${users.email}) = ${email.toLowerCase()}`);
  if (emailTaken) throw conflict("That email address already belongs to an account");
  await tx.update(invitations).set({ revokedAt: ctx.now() }).where(and6(eq9(invitations.employeeId, employeeId), isNull4(invitations.acceptedAt), isNull4(invitations.revokedAt)));
  const token = randomToken(32);
  await tx.insert(invitations).values({
    tokenHash: sha256(token),
    email,
    employeeId,
    roleKey,
    createdBy: ctx.actor.userId,
    expiresAt: new Date(ctx.now().getTime() + 7 * 24 * 36e5)
  });
  await audit(tx, ctx, { action: "employee.invitation_created", targetType: "employee", targetId: employeeId, newValues: { email, roleKey } });
  return { inviteUrl: `${config.appUrl.replace(/\/$/, "")}/invite/${token}`, expiresInDays: 7 };
}
async function createEmployee(ctx, input) {
  requirePerm(ctx, "employee.create");
  const body = parse(createSchema, input);
  validateEmploymentDates(body, todayIso(ctx.now()));
  if (body.invite) await assertInviteRoleAllowed(ctx, body.invite.roleKey);
  const verifyNow = has(ctx.actor, "employee.verify");
  return ctx.db.transaction(async (tx) => {
    await validateOrgRefs(tx, body);
    await validateSupervisor(tx, null, body.supervisorId);
    const { nextOfKin: nok, invite, ...profile } = body;
    const employmentNumber = verifyNow ? await issueEmploymentNumber(tx, profile.departmentId) : null;
    const [emp] = await tx.insert(employees).values({
      ...profile,
      employmentNumber,
      numberDepartmentId: verifyNow ? profile.departmentId : null,
      employmentStatus: verifyNow ? "active" : "pending_verification",
      verifiedAt: verifyNow ? ctx.now() : null,
      verifiedBy: verifyNow ? ctx.actor.userId : null,
      createdBy: ctx.actor.userId
    }).returning();
    if (nok) await tx.insert(nextOfKin).values({ ...nok, employeeId: emp.id });
    await tx.insert(employmentHistory).values({
      employeeId: emp.id,
      changeType: "hire",
      toValues: { departmentId: emp.departmentId, departmentName: await labelFor(tx, "departmentId", emp.departmentId), employmentNumber },
      effectiveDate: emp.employmentDate ?? todayIso(ctx.now()),
      actorUserId: ctx.actor.userId,
      reason: "Record created by administrator"
    });
    if (!verifyNow) {
      await tx.insert(approvalRequests).values({
        type: "registration",
        targetType: "employee",
        targetId: emp.id,
        departmentId: emp.departmentId,
        summary: `New employee record: ${emp.legalName}`,
        requiredPermission: "employee.verify",
        requestedBy: ctx.actor.userId
      });
    }
    await audit(tx, ctx, {
      action: "employee.create",
      targetType: "employee",
      targetId: emp.id,
      newValues: { legalName: emp.legalName, departmentId: emp.departmentId, employmentNumber, status: emp.employmentStatus }
    });
    const invitation = invite ? await createInvitationTx(tx, ctx, emp.id, invite.email, invite.roleKey) : null;
    return { id: emp.id, employmentNumber, status: emp.employmentStatus, invitation };
  });
}
async function inviteEmployee(ctx, id, input) {
  requirePerm(ctx, "employee.create");
  const body = parse(z6.object({ email: zEmail, roleKey: z6.enum(ROLE_KEYS).default("employee") }).strict(), input);
  await assertInviteRoleAllowed(ctx, body.roleKey);
  return ctx.db.transaction(async (tx) => {
    const emp = await requireViewableEmployee(ctx, id, tx);
    if (emp.userId) throw conflict("This employee already has an account");
    if (emp.archivedAt) throw badRequest("Restore the employee before inviting them");
    return createInvitationTx(tx, ctx, emp.id, body.email, body.roleKey);
  });
}
var verifySchema = z6.object({
  decision: z6.enum(["approve", "reject"]),
  reason: zOptText(500),
  corrections: z6.object({
    departmentId: zUuid.optional(),
    jobTitleId: zOptUuid,
    gradeId: zOptUuid,
    locationId: zOptUuid,
    supervisorId: zOptUuid,
    employmentDate: zDate.optional(),
    employmentType: z6.enum(["permanent", "contract", "temporary", "volunteer", "intern"]).optional()
  }).strict().optional()
}).strict();
async function verifyRegistration(ctx, id, input, approvalId) {
  requirePerm(ctx, "employee.verify");
  const raw = input ?? {};
  const body = parse(verifySchema, input);
  if (body.decision === "reject" && !body.reason) throw badRequest("Validation failed", { fields: { reason: "A reason is required when rejecting" } });
  const result = await ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord("Employee");
    if (isSelf(ctx.actor, emp)) throw forbidden("You cannot verify your own registration");
    if (emp.employmentStatus !== "pending_verification") throw conflict("This registration has already been processed");
    const [pending] = await tx.select().from(approvalRequests).where(and6(eq9(approvalRequests.type, "registration"), eq9(approvalRequests.targetId, id), eq9(approvalRequests.status, "pending")));
    const reqId = approvalId ?? pending?.id ?? null;
    if (body.decision === "reject") {
      await tx.update(employees).set({ employmentStatus: "rejected", updatedAt: ctx.now() }).where(eq9(employees.id, id));
      if (emp.userId) {
        await tx.update(users).set({ status: "deactivated", updatedAt: ctx.now() }).where(eq9(users.id, emp.userId));
        await revokeAllSessions(tx, emp.userId);
      }
      if (reqId) {
        await tx.update(approvalRequests).set({ status: "rejected", decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason }).where(eq9(approvalRequests.id, reqId));
      }
      await audit(tx, ctx, { action: "employee.registration_rejected", targetType: "employee", targetId: id, reason: body.reason, approvalId: reqId });
      return { status: "rejected", employmentNumber: null };
    }
    const provided = Object.keys(raw.corrections ?? {});
    const corrections = Object.fromEntries(
      Object.entries(body.corrections ?? {}).filter(([k]) => provided.includes(k))
    );
    const final = { ...emp, ...corrections };
    await validateOrgRefs(tx, final);
    await validateSupervisor(tx, emp.id, final.supervisorId);
    validateEmploymentDates(final, todayIso(ctx.now()));
    const employmentNumber = await issueEmploymentNumber(tx, final.departmentId);
    await tx.update(employees).set({
      ...corrections,
      employmentNumber,
      numberDepartmentId: final.departmentId,
      employmentStatus: "active",
      verifiedAt: ctx.now(),
      verifiedBy: ctx.actor.userId,
      updatedAt: ctx.now()
    }).where(eq9(employees.id, id));
    if (emp.userId) {
      await tx.update(users).set({ status: "active", updatedAt: ctx.now() }).where(eq9(users.id, emp.userId));
      const [hasRole] = await tx.select({ r: userRoles.roleId }).from(userRoles).where(eq9(userRoles.userId, emp.userId));
      if (!hasRole) {
        const [role] = await tx.select().from(roles).where(eq9(roles.key, "employee"));
        await tx.insert(userRoles).values({ userId: emp.userId, roleId: role.id, grantedBy: ctx.actor.userId });
      }
    }
    await tx.insert(employmentHistory).values({
      employeeId: id,
      changeType: "hire",
      fromValues: provided.length ? Object.fromEntries(provided.map((k) => [k, emp[k]])) : null,
      toValues: { departmentId: final.departmentId, departmentName: await labelFor(tx, "departmentId", final.departmentId), employmentNumber },
      effectiveDate: final.employmentDate ?? todayIso(ctx.now()),
      actorUserId: ctx.actor.userId,
      approvalId: reqId,
      reason: body.reason ?? "Registration verified"
    });
    if (reqId) {
      await tx.update(approvalRequests).set({ status: "approved", decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason }).where(eq9(approvalRequests.id, reqId));
    }
    await audit(tx, ctx, {
      action: "employee.verified",
      targetType: "employee",
      targetId: id,
      oldValues: { status: "pending_verification" },
      newValues: { status: "active", employmentNumber, ...corrections },
      reason: body.reason,
      approvalId: reqId
    });
    await notify(tx, [emp.userId], {
      type: "registration.approved",
      title: "Your registration has been verified",
      body: `Welcome! Your employment number is ${employmentNumber}.`,
      link: "/profile",
      dedupeKey: `registration-approved:${id}`
    });
    return { status: "active", employmentNumber };
  });
  return result;
}
var changeFields = {
  legalName: zTrim(160),
  preferredName: zOptText(120),
  dateOfBirth: zDate,
  phone: zOptPhone,
  personalEmail: zOptEmail,
  address: zOptText(500),
  workLocation: zOptText(160),
  departmentId: zUuid,
  locationId: zOptUuid,
  jobTitleId: zOptUuid,
  gradeId: zOptUuid,
  supervisorId: zOptUuid,
  employmentDate: zDate,
  employmentType: z6.enum(["permanent", "contract", "temporary", "volunteer", "intern"]),
  contractEndDate: zOptDate,
  employmentStatus: z6.enum(CHANGEABLE_STATUSES)
};
var changesSchema = z6.object(Object.fromEntries(Object.entries(changeFields).map(([k, v]) => [k, v.optional()]))).strict();
function parseChanges(raw) {
  const parsed = parse(changesSchema, raw ?? {});
  const provided = Object.keys(raw ?? {});
  return Object.fromEntries(provided.filter((k) => k in changeFields).map((k) => [k, parsed[k] ?? null]));
}
var HISTORY_TYPE = {
  departmentId: "transfer",
  locationId: "location_change",
  jobTitleId: "title_change",
  gradeId: "grade_change",
  supervisorId: "supervisor_change",
  employmentStatus: "status_change",
  legalName: "correction",
  dateOfBirth: "correction",
  employmentDate: "correction",
  employmentType: "contract_change",
  contractEndDate: "contract_change"
};
async function applyEmployeeChanges(tx, ctx, emp, changes, opts) {
  const d = diff(emp, changes);
  if (!d.changed.length) return { changed: [] };
  if (emp.archivedAt) throw conflict("Archived records cannot be changed. Restore the record first.");
  const final = { ...emp, ...changes };
  if ("employmentStatus" in d.newValues && emp.employmentStatus === "pending_verification") {
    throw badRequest("Pending registrations must be verified before their status can change");
  }
  if ("employmentStatus" in d.newValues && ["retired", "rejected"].includes(emp.employmentStatus)) {
    throw badRequest("This employment record is closed");
  }
  await validateOrgRefs(tx, {
    departmentId: "departmentId" in d.newValues ? final.departmentId : null,
    jobTitleId: "jobTitleId" in d.newValues ? final.jobTitleId : null,
    gradeId: "gradeId" in d.newValues ? final.gradeId : null,
    locationId: "locationId" in d.newValues ? final.locationId : null
  });
  if ("jobTitleId" in d.newValues || "departmentId" in d.newValues) {
    if (final.jobTitleId) await validateOrgRefs(tx, { jobTitleId: final.jobTitleId, departmentId: final.departmentId });
  }
  if ("supervisorId" in d.newValues) await validateSupervisor(tx, emp.id, final.supervisorId);
  validateEmploymentDates(final, todayIso(ctx.now()));
  await tx.update(employees).set({ ...changes, updatedAt: ctx.now() }).where(eq9(employees.id, emp.id));
  const effectiveDate = opts.effectiveDate ?? todayIso(ctx.now());
  const groups = /* @__PURE__ */ new Map();
  for (const key of d.changed) {
    const type = HISTORY_TYPE[key];
    if (!type) continue;
    const g = groups.get(type) ?? { from: {}, to: {} };
    g.from[key] = d.oldValues[key];
    g.to[key] = d.newValues[key];
    const label = key.endsWith("Id") ? key.slice(0, -2) + "Name" : null;
    if (label) {
      g.from[label] = await labelFor(tx, key, d.oldValues[key]);
      g.to[label] = await labelFor(tx, key, d.newValues[key]);
    }
    groups.set(type, g);
  }
  for (const [changeType, g] of groups) {
    await tx.insert(employmentHistory).values({
      employeeId: emp.id,
      changeType,
      fromValues: g.from,
      toValues: g.to,
      effectiveDate,
      reason: opts.reason ?? null,
      actorUserId: ctx.actor.userId,
      approvalId: opts.approvalId ?? null
    });
  }
  if (d.newValues.employmentStatus === "terminated" && emp.userId) {
    await assertNotLastSuperAdmin(tx, emp.userId);
    await tx.update(users).set({ status: "deactivated", updatedAt: ctx.now() }).where(eq9(users.id, emp.userId));
    await revokeAllSessions(tx, emp.userId);
  }
  await audit(tx, ctx, {
    action: opts.action,
    targetType: "employee",
    targetId: emp.id,
    oldValues: d.oldValues,
    newValues: d.newValues,
    reason: opts.reason,
    approvalId: opts.approvalId
  });
  if (groups.has("transfer")) {
    await notify(tx, [emp.userId], {
      type: "employee.transfer",
      title: "Your department has changed",
      body: `You have been transferred to ${groups.get("transfer").to.departmentName ?? "a new department"}. Your employment number is unchanged.`,
      link: "/profile"
    });
  }
  return { changed: d.changed };
}
var updateSchema = z6.object({ changes: z6.unknown(), nextOfKin: nextOfKinSchema.optional(), reason: zOptText(500) }).strict();
async function updateEmployee(ctx, id, input) {
  requireActor(ctx);
  const body = parse(updateSchema, input);
  const changes = parseChanges(body.changes);
  return ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord("Employee");
    const mode = updateMode(ctx.actor, emp);
    if (mode === "none") throw forbidden("You cannot edit this employee");
    if (emp.archivedAt) throw conflict("Archived records cannot be changed. Restore the record first.");
    const direct = new Set(directFieldsFor(mode));
    const proposable = new Set(proposableFieldsFor(mode));
    const effective = diff(emp, changes);
    const denied = effective.changed.filter((k) => !direct.has(k) && !proposable.has(k));
    if (denied.length) {
      throw new AppError(403, "FIELD_FORBIDDEN", mode === "self" ? "Some fields can only be changed through a correction request" : "You are not allowed to change some of these fields", { fields: Object.fromEntries(denied.map((k) => [k, "Not editable"])) });
    }
    const directChanges = Object.fromEntries(effective.changed.filter((k) => direct.has(k)).map((k) => [k, effective.newValues[k]]));
    const proposed = Object.fromEntries(effective.changed.filter((k) => proposable.has(k)).map((k) => [k, effective.newValues[k]]));
    const isOverride = mode === "override" && Object.keys(directChanges).some((k) => CONTROLLED_FIELDS.includes(k) && !ADMIN_DIRECT_FIELDS.includes(k));
    if (isOverride && (!body.reason || body.reason.length < 5)) {
      throw badRequest("Validation failed", { fields: { reason: "A reason is required for executive overrides of controlled fields" } });
    }
    if (body.nextOfKin && !(mode === "self" || mode === "override")) throw forbidden("You cannot change next-of-kin details for this employee");
    const applied = await applyEmployeeChanges(tx, ctx, emp, directChanges, {
      reason: body.reason,
      action: isOverride ? "employee.override" : mode === "self" ? "employee.self_update" : "employee.update"
    });
    if (body.nextOfKin) {
      const [old] = await tx.select().from(nextOfKin).where(eq9(nextOfKin.employeeId, id));
      if (old) await tx.update(nextOfKin).set({ ...body.nextOfKin, updatedAt: ctx.now() }).where(eq9(nextOfKin.employeeId, id));
      else await tx.insert(nextOfKin).values({ ...body.nextOfKin, employeeId: id });
      await audit(tx, ctx, { action: "employee.next_of_kin_update", targetType: "employee", targetId: id, reason: body.reason });
    }
    let approval = null;
    if (Object.keys(proposed).length) {
      const before = Object.fromEntries(Object.keys(proposed).map((k) => [k, emp[k] ?? null]));
      [approval] = await tx.insert(approvalRequests).values({
        type: "employee_change",
        targetType: "employee",
        targetId: id,
        departmentId: emp.departmentId,
        summary: `Change to ${emp.legalName}: ${Object.keys(proposed).join(", ")}`,
        payload: { changes: proposed, before },
        reason: body.reason,
        requiredPermission: "employee.approve_changes",
        requestedBy: ctx.actor.userId
      }).returning({ id: approvalRequests.id });
      await audit(tx, ctx, { action: "employee.change_requested", targetType: "employee", targetId: id, oldValues: before, newValues: proposed, reason: body.reason, approvalId: approval.id });
      await notify(tx, await usersWithPermission(tx, "employee.approve_changes"), {
        type: "approval.pending",
        title: "Employment change awaiting approval",
        body: `A change to ${emp.legalName}'s employment record needs your decision.`,
        link: `/approvals?id=${approval.id}`,
        dedupeKey: `approval:${approval.id}`
      });
    }
    return { applied: applied.changed, pendingApprovalId: approval?.id ?? null, pendingFields: Object.keys(proposed) };
  });
}
async function requestCorrection(ctx, id, input) {
  requireActor(ctx);
  const body = parse(z6.object({ changes: z6.unknown(), reason: zTrim(1e3, 5) }).strict(), input);
  const changes = parseChanges(body.changes);
  return ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id);
    if (!emp || !isSelf(ctx.actor, emp)) throw deniedRecord("Employee");
    if (emp.archivedAt || emp.employmentStatus === "pending_verification") throw badRequest("Corrections are not available for this record");
    if ("employmentStatus" in changes) throw badRequest("Employment status cannot be changed by request");
    const d = diff(emp, changes);
    if (!d.changed.length) throw badRequest("No changes were requested");
    const operationalOnly = d.changed.every((k) => ADMIN_DIRECT_FIELDS.includes(k));
    const [approval] = await tx.insert(approvalRequests).values({
      type: "profile_correction",
      targetType: "employee",
      targetId: id,
      departmentId: emp.departmentId,
      summary: `Correction request from ${emp.legalName}: ${d.changed.join(", ")}`,
      payload: { changes: d.newValues, before: d.oldValues },
      reason: body.reason,
      requiredPermission: operationalOnly ? "employee.update.all" : "employee.approve_changes",
      requestedBy: ctx.actor.userId
    }).returning({ id: approvalRequests.id, requiredPermission: approvalRequests.requiredPermission });
    await audit(tx, ctx, { action: "employee.correction_requested", targetType: "employee", targetId: id, oldValues: d.oldValues, newValues: d.newValues, reason: body.reason, approvalId: approval.id });
    await notify(tx, await usersWithPermission(tx, approval.requiredPermission), {
      type: "approval.pending",
      title: "Correction request awaiting review",
      body: `${emp.legalName} has asked for a correction to their employment record.`,
      link: `/approvals?id=${approval.id}`,
      dedupeKey: `approval:${approval.id}`
    });
    return { approvalId: approval.id };
  });
}
async function archiveEmployee(ctx, id, input) {
  requirePerm(ctx, "employee.archive");
  const body = parse(z6.object({ reason: zTrim(500, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord("Employee");
    if (isSelf(ctx.actor, emp)) throw forbidden("You cannot archive your own record");
    if (emp.archivedAt) throw conflict("Already archived");
    if (emp.userId) {
      await assertNotLastSuperAdmin(tx, emp.userId);
      await tx.update(users).set({ status: "deactivated", updatedAt: ctx.now() }).where(eq9(users.id, emp.userId));
      await revokeAllSessions(tx, emp.userId);
    }
    await tx.update(employees).set({ archivedAt: ctx.now(), archivedBy: ctx.actor.userId, archiveReason: body.reason, updatedAt: ctx.now() }).where(eq9(employees.id, id));
    await tx.insert(employmentHistory).values({ employeeId: id, changeType: "archive", effectiveDate: todayIso(ctx.now()), reason: body.reason, actorUserId: ctx.actor.userId });
    await audit(tx, ctx, { action: "employee.archive", targetType: "employee", targetId: id, reason: body.reason });
    return { archived: true };
  });
}
async function restoreEmployee(ctx, id, input) {
  requirePerm(ctx, "employee.archive");
  const body = parse(z6.object({ reason: zTrim(500, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const emp = await loadEmployee(tx, id, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord("Employee");
    if (!emp.archivedAt) throw conflict("Record is not archived");
    await tx.update(employees).set({ archivedAt: null, archivedBy: null, archiveReason: null, updatedAt: ctx.now() }).where(eq9(employees.id, id));
    if (emp.userId && ["active", "on_leave"].includes(emp.employmentStatus)) {
      await tx.update(users).set({ status: "active", updatedAt: ctx.now() }).where(eq9(users.id, emp.userId));
    }
    await tx.insert(employmentHistory).values({ employeeId: id, changeType: "restore", effectiveDate: todayIso(ctx.now()), reason: body.reason, actorUserId: ctx.actor.userId });
    await audit(tx, ctx, { action: "employee.restore", targetType: "employee", targetId: id, reason: body.reason });
    return { archived: false };
  });
}

// server/services/org.ts
import { z as z7 } from "zod";
import { and as and7, asc as asc3, eq as eq10, inArray as inArray5, isNull as isNull5, sql as sql10 } from "drizzle-orm";
async function activeLookups(tx) {
  const [deps, locs, titles, grades, links] = await Promise.all([
    tx.select({ id: departments.id, code: departments.code, name: departments.name }).from(departments).where(eq10(departments.status, "active")).orderBy(asc3(departments.name)),
    tx.select({ id: workLocations.id, code: workLocations.code, name: workLocations.name }).from(workLocations).where(eq10(workLocations.status, "active")).orderBy(asc3(workLocations.name)),
    tx.select({ id: jobTitles.id, name: jobTitles.name, departmentId: jobTitles.departmentId }).from(jobTitles).where(eq10(jobTitles.status, "active")).orderBy(asc3(jobTitles.name)),
    tx.select({ id: employmentGrades.id, code: employmentGrades.code, name: employmentGrades.name }).from(employmentGrades).where(eq10(employmentGrades.status, "active")).orderBy(asc3(employmentGrades.rank)),
    tx.select().from(departmentLocations)
  ]);
  return {
    departments: deps.map((d) => ({ ...d, locationIds: links.filter((l) => l.departmentId === d.id).map((l) => l.locationId) })),
    locations: locs,
    jobTitles: titles,
    grades
  };
}
async function publicLookups(ctx) {
  return activeLookups(ctx.db);
}
async function lookups(ctx) {
  requireActor(ctx);
  return activeLookups(ctx.db);
}
function requireOrgView(ctx) {
  requirePerm(ctx, "org.manage", "employee.read.all", "report.org", "report.finance");
}
async function listDepartments(ctx) {
  requireOrgView(ctx);
  const head = sql10`(select legal_name from employees h where h.id = departments.head_employee_id)`;
  const rows = await ctx.db.select({
    id: departments.id,
    code: departments.code,
    name: departments.name,
    description: departments.description,
    status: departments.status,
    headEmployeeId: departments.headEmployeeId,
    headName: head,
    activeEmployees: sql10`(select count(*)::int from employees e where e.department_id = departments.id and e.archived_at is null and e.employment_status in ('active','on_leave'))`
  }).from(departments).orderBy(asc3(departments.name));
  const links = await ctx.db.select({ departmentId: departmentLocations.departmentId, id: workLocations.id, name: workLocations.name }).from(departmentLocations).innerJoin(workLocations, eq10(workLocations.id, departmentLocations.locationId));
  return rows.map((r) => ({ ...r, locations: links.filter((l) => l.departmentId === r.id).map(({ id, name }) => ({ id, name })) }));
}
var deptInput = z7.object({
  code: z7.string().trim().toUpperCase().regex(/^[A-Z]{2,8}$/, "2-8 capital letters"),
  name: zTrim(120),
  description: zOptText(1e3),
  headEmployeeId: zOptUuid,
  status: z7.enum(["active", "archived"]).default("active"),
  locationIds: z7.array(z7.uuid()).max(100).default([])
}).strict();
async function setDepartmentLocations(tx, departmentId, locationIds) {
  await tx.delete(departmentLocations).where(eq10(departmentLocations.departmentId, departmentId));
  const unique = [...new Set(locationIds)];
  if (unique.length) {
    const found = await tx.select({ id: workLocations.id }).from(workLocations).where(inArray5(workLocations.id, unique));
    if (found.length !== unique.length) throw badRequest("Validation failed", { fields: { locationIds: "Unknown location" } });
    await tx.insert(departmentLocations).values(unique.map((locationId) => ({ departmentId, locationId })));
  }
}
async function validateHead(tx, headEmployeeId) {
  if (!headEmployeeId) return;
  const [e] = await tx.select().from(employees).where(eq10(employees.id, headEmployeeId));
  if (!e || e.archivedAt || !["active", "on_leave"].includes(e.employmentStatus)) {
    throw badRequest("Validation failed", { fields: { headEmployeeId: "Select an active employee" } });
  }
}
async function createDepartment(ctx, input) {
  requirePerm(ctx, "org.manage");
  const body = parse(deptInput, input);
  return ctx.db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: departments.id }).from(departments).where(eq10(departments.code, body.code));
    if (dup) throw conflict("A department with that code already exists");
    await validateHead(tx, body.headEmployeeId);
    const { locationIds, ...values } = body;
    const [d] = await tx.insert(departments).values(values).returning();
    await tx.execute(sql10`insert into employment_number_sequences (department_id, next_value) values (${d.id}, 1) on conflict do nothing`);
    await setDepartmentLocations(tx, d.id, locationIds);
    await audit(tx, ctx, { action: "org.department_create", targetType: "department", targetId: d.id, newValues: body });
    return d;
  });
}
async function updateDepartment(ctx, id, input) {
  requirePerm(ctx, "org.manage");
  const body = parse(deptInput, input);
  return ctx.db.transaction(async (tx) => {
    const [d] = await tx.select().from(departments).where(eq10(departments.id, id)).for("update");
    if (!d) throw notFound("Department not found");
    if (body.code !== d.code) {
      if (await sequenceHasIssued(tx, id)) throw conflict("The department code cannot change after employment numbers have been issued");
      const [dup] = await tx.select({ id: departments.id }).from(departments).where(eq10(departments.code, body.code));
      if (dup) throw conflict("A department with that code already exists");
    }
    if (body.status === "archived" && d.status !== "archived") {
      const [{ n }] = await tx.select({ n: sql10`count(*)::int` }).from(employees).where(and7(eq10(employees.departmentId, id), isNull5(employees.archivedAt), inArray5(employees.employmentStatus, ["active", "on_leave", "suspended", "pending_verification"])));
      if (n > 0) throw conflict(`Transfer the ${n} current employee(s) before archiving this department`);
    }
    await validateHead(tx, body.headEmployeeId);
    const { locationIds, ...values } = body;
    await tx.update(departments).set({ ...values, updatedAt: ctx.now() }).where(eq10(departments.id, id));
    await setDepartmentLocations(tx, id, locationIds);
    const d2 = diff(d, values);
    await audit(tx, ctx, { action: "org.department_update", targetType: "department", targetId: id, oldValues: d2.oldValues, newValues: { ...d2.newValues, locationIds } });
    return { id };
  });
}
async function listLocations(ctx) {
  requireOrgView(ctx);
  return ctx.db.select({
    id: workLocations.id,
    code: workLocations.code,
    name: workLocations.name,
    address: workLocations.address,
    status: workLocations.status,
    activeEmployees: sql10`(select count(*)::int from employees e where e.location_id = work_locations.id and e.archived_at is null and e.employment_status in ('active','on_leave'))`
  }).from(workLocations).orderBy(asc3(workLocations.name));
}
var locInput = z7.object({
  code: z7.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/, "2-16 letters, digits or hyphens"),
  name: zTrim(120),
  address: zOptText(500),
  status: z7.enum(["active", "archived"]).default("active")
}).strict();
async function createLocation(ctx, input) {
  requirePerm(ctx, "org.manage");
  const body = parse(locInput, input);
  return ctx.db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: workLocations.id }).from(workLocations).where(eq10(workLocations.code, body.code));
    if (dup) throw conflict("A location with that code already exists");
    const [l] = await tx.insert(workLocations).values(body).returning();
    await audit(tx, ctx, { action: "org.location_create", targetType: "location", targetId: l.id, newValues: body });
    return l;
  });
}
async function updateLocation(ctx, id, input) {
  requirePerm(ctx, "org.manage");
  const body = parse(locInput, input);
  return ctx.db.transaction(async (tx) => {
    const [l] = await tx.select().from(workLocations).where(eq10(workLocations.id, id));
    if (!l) throw notFound("Location not found");
    if (body.code !== l.code) {
      const [dup] = await tx.select({ id: workLocations.id }).from(workLocations).where(eq10(workLocations.code, body.code));
      if (dup) throw conflict("A location with that code already exists");
    }
    if (body.status === "archived" && l.status !== "archived") {
      const [{ n }] = await tx.select({ n: sql10`count(*)::int` }).from(employees).where(and7(eq10(employees.locationId, id), isNull5(employees.archivedAt), inArray5(employees.employmentStatus, ["active", "on_leave", "suspended"])));
      if (n > 0) throw conflict(`Move the ${n} current employee(s) before archiving this location`);
    }
    await tx.update(workLocations).set({ ...body, updatedAt: ctx.now() }).where(eq10(workLocations.id, id));
    const d = diff(l, body);
    await audit(tx, ctx, { action: "org.location_update", targetType: "location", targetId: id, oldValues: d.oldValues, newValues: d.newValues });
    return { id };
  });
}
async function listJobTitles(ctx) {
  requirePerm(ctx, "org.manage");
  return ctx.db.select({ id: jobTitles.id, name: jobTitles.name, status: jobTitles.status, departmentId: jobTitles.departmentId, departmentName: departments.name }).from(jobTitles).leftJoin(departments, eq10(departments.id, jobTitles.departmentId)).orderBy(asc3(jobTitles.name));
}
var titleInput = z7.object({ name: zTrim(120), departmentId: zOptUuid, status: z7.enum(["active", "archived"]).default("active") }).strict();
async function upsertJobTitle(ctx, id, input) {
  requirePerm(ctx, "org.manage");
  const body = parse(titleInput, input);
  return ctx.db.transaction(async (tx) => {
    if (id) {
      const [t2] = await tx.select().from(jobTitles).where(eq10(jobTitles.id, id));
      if (!t2) throw notFound("Job title not found");
      await tx.update(jobTitles).set(body).where(eq10(jobTitles.id, id));
      await audit(tx, ctx, { action: "org.job_title_update", targetType: "job_title", targetId: id, oldValues: t2, newValues: body });
      return { id };
    }
    const [t] = await tx.insert(jobTitles).values(body).onConflictDoNothing().returning();
    if (!t) throw conflict("That job title already exists");
    await audit(tx, ctx, { action: "org.job_title_create", targetType: "job_title", targetId: t.id, newValues: body });
    return { id: t.id };
  });
}
async function listGrades(ctx) {
  requirePerm(ctx, "org.manage");
  return ctx.db.select().from(employmentGrades).orderBy(asc3(employmentGrades.rank));
}
var gradeInput = z7.object({ code: z7.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,16}$/), name: zTrim(120), rank: z7.number().int().min(0).max(1e3), status: z7.enum(["active", "archived"]).default("active") }).strict();
async function upsertGrade(ctx, id, input) {
  requirePerm(ctx, "org.manage");
  const body = parse(gradeInput, input);
  return ctx.db.transaction(async (tx) => {
    if (id) {
      const [g2] = await tx.select().from(employmentGrades).where(eq10(employmentGrades.id, id));
      if (!g2) throw notFound("Grade not found");
      await tx.update(employmentGrades).set(body).where(eq10(employmentGrades.id, id));
      await audit(tx, ctx, { action: "org.grade_update", targetType: "grade", targetId: id, oldValues: g2, newValues: body });
      return { id };
    }
    const [g] = await tx.insert(employmentGrades).values(body).onConflictDoNothing().returning();
    if (!g) throw conflict("A grade with that code already exists");
    await audit(tx, ctx, { action: "org.grade_create", targetType: "grade", targetId: g.id, newValues: body });
    return { id: g.id };
  });
}

// server/services/approvals.ts
import { z as z10 } from "zod";
import { and as and10, desc as desc5, eq as eq13, inArray as inArray8, or as or7, sql as sql13 } from "drizzle-orm";
import { alias as alias2 } from "drizzle-orm/pg-core";

// server/services/payroll.ts
import { z as z8 } from "zod";
import { and as and8, asc as asc4, desc as desc3, eq as eq11, ilike as ilike3, inArray as inArray6, isNull as isNull6, or as or5, sql as sql11 } from "drizzle-orm";
var EARNING_CATEGORIES = ["allowance", "bonus", "overtime", "other_earning"];
var DEDUCTION_CATEGORIES = ["tax", "pension", "loan", "other_deduction"];
var lineItemSchema = z8.object({
  kind: z8.enum(["earning", "deduction"]),
  category: z8.enum([...EARNING_CATEGORIES, ...DEDUCTION_CATEGORIES]),
  label: zTrim(120),
  amount: zMoney
}).strict().refine((li) => li.kind === "earning" ? EARNING_CATEGORIES.includes(li.category) : DEDUCTION_CATEGORIES.includes(li.category), {
  message: "Category does not match line item kind",
  path: ["category"]
});
var recordBody = {
  basicSalary: zMoney,
  lineItems: z8.array(lineItemSchema).max(50).default([]),
  notes: zOptText(1e3),
  paymentDate: zOptDate
};
function computeTotals(basicSalary, items) {
  const earnings = items.filter((i) => i.kind === "earning").reduce((s, i) => s + i.amount, 0);
  const totalDeductions = items.filter((i) => i.kind === "deduction").reduce((s, i) => s + i.amount, 0);
  const grossEarnings = basicSalary + earnings;
  const netPay = grossEarnings - totalDeductions;
  if (!Number.isSafeInteger(grossEarnings) || !Number.isSafeInteger(totalDeductions)) throw badRequest("Amounts are too large");
  if (netPay < 0) throw badRequest("Validation failed", { fields: { lineItems: "Deductions cannot exceed gross earnings" } });
  return { grossEarnings, totalDeductions, netPay };
}
function requirePayrollRead(ctx) {
  requirePerm(ctx, "payroll.read");
}
async function loadRecord(tx, id, lock = false) {
  if (!z8.uuid().safeParse(id).success) return null;
  const q = tx.select().from(payrollRecords).where(eq11(payrollRecords.id, id));
  const [row] = lock ? await q.for("update") : await q;
  return row ?? null;
}
async function loadPeriod(tx, id) {
  if (!z8.uuid().safeParse(id).success) return null;
  const [row] = await tx.select().from(payrollPeriods).where(eq11(payrollPeriods.id, id));
  return row ?? null;
}
async function listPeriods(ctx) {
  requirePerm(ctx, "payroll.read", "report.finance");
  const rows = await ctx.db.select().from(payrollPeriods).orderBy(desc3(payrollPeriods.startDate));
  const stats = await ctx.db.select({
    periodId: payrollRecords.periodId,
    status: payrollRecords.status,
    n: sql11`count(*)::int`,
    net: sql11`coalesce(sum(${payrollRecords.netPay}),0)`
  }).from(payrollRecords).groupBy(payrollRecords.periodId, payrollRecords.status);
  return rows.map((p2) => {
    const s = stats.filter((x) => x.periodId === p2.id);
    const by = (st) => s.find((x) => x.status === st)?.n ?? 0;
    return {
      ...p2,
      counts: { draft: by("draft"), pending: by("pending_approval"), approved: by("approved") },
      approvedNet: Number(s.find((x) => x.status === "approved")?.net ?? 0)
    };
  });
}
var periodInput = z8.object({
  code: z8.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/, "3-20 letters, numbers or hyphens"),
  name: zTrim(80),
  startDate: zDate,
  endDate: zDate,
  payDate: zDate
}).strict();
async function createPeriod(ctx, input) {
  requirePerm(ctx, "payroll.period.manage");
  const body = parse(periodInput, input);
  if (body.endDate < body.startDate) throw badRequest("Validation failed", { fields: { endDate: "End date must be on or after the start date" } });
  return ctx.db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: payrollPeriods.id }).from(payrollPeriods).where(eq11(payrollPeriods.code, body.code));
    if (dup) throw conflict("A payroll period with that code already exists");
    const [p2] = await tx.insert(payrollPeriods).values({ ...body, createdBy: ctx.actor.userId }).returning();
    await audit(tx, ctx, { action: "payroll.period_create", targetType: "payroll_period", targetId: p2.id, newValues: body });
    return p2;
  });
}
async function closePeriod(ctx, id, input) {
  requirePerm(ctx, "payroll.period.manage");
  const body = parse(z8.object({ reason: zOptText(500) }).strict(), input ?? {});
  return ctx.db.transaction(async (tx) => {
    const p2 = await loadPeriod(tx, id);
    if (!p2) throw notFound("Payroll period not found");
    if (p2.status === "closed") throw conflict("Period already closed");
    const [{ open }] = await tx.select({ open: sql11`count(*)::int` }).from(payrollRecords).where(and8(eq11(payrollRecords.periodId, id), inArray6(payrollRecords.status, ["draft", "pending_approval"])));
    if (open > 0) throw conflict(`${open} payroll record(s) are still draft or awaiting approval`);
    await tx.update(payrollPeriods).set({ status: "closed" }).where(eq11(payrollPeriods.id, id));
    await audit(tx, ctx, { action: "payroll.period_close", targetType: "payroll_period", targetId: id, reason: body.reason });
    return { status: "closed" };
  });
}
var recordListQuery = zPage.extend({
  q: z8.string().trim().max(100).optional(),
  departmentId: z8.uuid().optional(),
  locationId: z8.uuid().optional(),
  status: z8.enum(["draft", "pending_approval", "approved", "superseded", "all_live"]).default("all_live"),
  paymentStatus: z8.enum(["unpaid", "paid"]).optional()
});
function recordsBase(tx) {
  return tx.select({
    id: payrollRecords.id,
    revision: payrollRecords.revision,
    status: payrollRecords.status,
    currency: payrollRecords.currency,
    basicSalary: payrollRecords.basicSalary,
    grossEarnings: payrollRecords.grossEarnings,
    totalDeductions: payrollRecords.totalDeductions,
    netPay: payrollRecords.netPay,
    paymentStatus: payrollRecords.paymentStatus,
    paymentDate: payrollRecords.paymentDate,
    discrepancyFlag: payrollRecords.discrepancyFlag,
    preparedBy: payrollRecords.preparedBy,
    approvedBy: payrollRecords.approvedBy,
    updatedAt: payrollRecords.updatedAt,
    employeeId: employees.id,
    legalName: employees.legalName,
    employmentNumber: employees.employmentNumber,
    departmentName: departments.name,
    locationName: workLocations.name,
    payslipId: payslips.id
  }).from(payrollRecords).innerJoin(employees, eq11(employees.id, payrollRecords.employeeId)).innerJoin(departments, eq11(departments.id, employees.departmentId)).leftJoin(workLocations, eq11(workLocations.id, employees.locationId)).leftJoin(payslips, eq11(payslips.payrollRecordId, payrollRecords.id));
}
async function listRecords(ctx, periodId, query) {
  requirePayrollRead(ctx);
  const q = parse(recordListQuery, query);
  const period = await loadPeriod(ctx.db, periodId);
  if (!period) throw notFound("Payroll period not found");
  const conds = [eq11(payrollRecords.periodId, periodId)];
  if (q.status === "all_live") conds.push(inArray6(payrollRecords.status, ["draft", "pending_approval", "approved"]));
  else conds.push(eq11(payrollRecords.status, q.status));
  if (q.departmentId) conds.push(eq11(employees.departmentId, q.departmentId));
  if (q.locationId) conds.push(eq11(employees.locationId, q.locationId));
  if (q.paymentStatus) conds.push(eq11(payrollRecords.paymentStatus, q.paymentStatus));
  if (q.q) {
    const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
    conds.push(or5(ilike3(employees.legalName, like), ilike3(employees.employmentNumber, like)));
  }
  const where = and8(...conds);
  const [items, [{ total }], [totals]] = await Promise.all([
    recordsBase(ctx.db).where(where).orderBy(asc4(employees.legalName), desc3(payrollRecords.revision)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql11`count(*)::int` }).from(payrollRecords).innerJoin(employees, eq11(employees.id, payrollRecords.employeeId)).where(where),
    ctx.db.select({
      gross: sql11`coalesce(sum(${payrollRecords.grossEarnings}),0)`,
      deductions: sql11`coalesce(sum(${payrollRecords.totalDeductions}),0)`,
      net: sql11`coalesce(sum(${payrollRecords.netPay}),0)`
    }).from(payrollRecords).innerJoin(employees, eq11(employees.id, payrollRecords.employeeId)).where(where)
  ]);
  return {
    period,
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    totals: { gross: Number(totals.gross), deductions: Number(totals.deductions), net: Number(totals.net) }
  };
}
async function getRecord(ctx, id) {
  requireActor(ctx);
  const rec = await loadRecord(ctx.db, id);
  if (!rec) throw deniedRecord("Payroll record");
  const [emp] = await ctx.db.select({ userId: employees.userId }).from(employees).where(eq11(employees.id, rec.employeeId));
  const own = !!emp?.userId && emp.userId === ctx.actor.userId;
  const finance = has(ctx.actor, "payroll.read");
  if (!finance && !(own && ["approved", "superseded"].includes(rec.status))) throw deniedRecord("Payroll record");
  const [row] = await recordsBase(ctx.db).where(eq11(payrollRecords.id, id));
  const [items, period, revisions, people] = await Promise.all([
    ctx.db.select().from(payrollLineItems).where(eq11(payrollLineItems.recordId, id)).orderBy(asc4(payrollLineItems.sortOrder)),
    loadPeriod(ctx.db, rec.periodId),
    ctx.db.select({ id: payrollRecords.id, revision: payrollRecords.revision, status: payrollRecords.status, netPay: payrollRecords.netPay, adjustmentReason: payrollRecords.adjustmentReason }).from(payrollRecords).where(and8(eq11(payrollRecords.employeeId, rec.employeeId), eq11(payrollRecords.periodId, rec.periodId))).orderBy(asc4(payrollRecords.revision)),
    ctx.db.select({ id: users.id, name: users.displayName }).from(users).where(inArray6(users.id, [rec.preparedBy, rec.approvedBy].filter((x) => !!x)))
  ]);
  const name = (uid) => people.find((p2) => p2.id === uid)?.name ?? null;
  const requireSecond = await getSetting(ctx.db, "payroll.require_second_approval");
  const selfRecord = !!ctx.actor.employeeId && ctx.actor.employeeId === rec.employeeId;
  return {
    ...row,
    notes: finance ? rec.notes : null,
    adjustmentReason: rec.adjustmentReason,
    discrepancyNote: finance ? rec.discrepancyNote : null,
    supersedesId: rec.supersedesId,
    submittedAt: rec.submittedAt,
    approvedAt: rec.approvedAt,
    preparedByName: finance ? name(rec.preparedBy) : null,
    approvedByName: finance ? name(rec.approvedBy) : null,
    period,
    lineItems: items,
    revisions: finance ? revisions : revisions.filter((r) => ["approved", "superseded"].includes(r.status)),
    can: {
      edit: has(ctx.actor, "payroll.prepare") && rec.status === "draft" && !selfRecord,
      submit: has(ctx.actor, "payroll.prepare") && rec.status === "draft" && !selfRecord,
      approve: has(ctx.actor, "payroll.approve") && rec.status === "pending_approval" && !selfRecord && (!requireSecond || rec.preparedBy !== ctx.actor.userId),
      adjust: has(ctx.actor, "payroll.prepare") && rec.status === "approved" && !selfRecord,
      markPaid: has(ctx.actor, "payroll.prepare") && rec.status === "approved" && rec.paymentStatus === "unpaid",
      issuePayslip: has(ctx.actor, "payroll.prepare") && rec.status === "approved" && !row.payslipId,
      delete: has(ctx.actor, "payroll.prepare") && rec.status === "draft"
    }
  };
}
async function assertPreparable(tx, ctx, employeeId) {
  if (ctx.actor.employeeId === employeeId) throw forbidden("You cannot prepare your own payroll record");
  const [emp] = await tx.select().from(employees).where(eq11(employees.id, employeeId));
  if (!emp) throw badRequest("Validation failed", { fields: { employeeId: "Unknown employee" } });
  if (!emp.employmentNumber || emp.archivedAt || !["active", "on_leave", "suspended"].includes(emp.employmentStatus)) {
    throw badRequest("Validation failed", { fields: { employeeId: "Payroll can only be prepared for verified, current employees" } });
  }
  return emp;
}
async function writeItems(tx, recordId, items) {
  await tx.delete(payrollLineItems).where(eq11(payrollLineItems.recordId, recordId));
  if (items.length) {
    await tx.insert(payrollLineItems).values(items.map((li, i) => ({ ...li, recordId, sortOrder: i })));
  }
}
async function createRecord(ctx, input) {
  requirePerm(ctx, "payroll.prepare");
  const body = parse(z8.object({ employeeId: zUuid, periodId: zUuid, ...recordBody }).strict(), input);
  const totals = computeTotals(body.basicSalary, body.lineItems);
  return ctx.db.transaction(async (tx) => {
    const period = await loadPeriod(tx, body.periodId);
    if (!period) throw badRequest("Validation failed", { fields: { periodId: "Unknown payroll period" } });
    if (period.status === "closed") throw conflict("This payroll period is closed");
    await assertPreparable(tx, ctx, body.employeeId);
    const [existing] = await tx.select({ id: payrollRecords.id }).from(payrollRecords).where(and8(eq11(payrollRecords.employeeId, body.employeeId), eq11(payrollRecords.periodId, body.periodId)));
    if (existing) throw conflict("A payroll record already exists for this employee and period. Use an adjustment to correct it.");
    const currency = await getSetting(tx, "org.currency");
    const [rec] = await tx.insert(payrollRecords).values({
      employeeId: body.employeeId,
      periodId: body.periodId,
      currency,
      basicSalary: body.basicSalary,
      ...totals,
      notes: body.notes,
      paymentDate: body.paymentDate ?? period.payDate,
      preparedBy: ctx.actor.userId
    }).returning();
    await writeItems(tx, rec.id, body.lineItems);
    await audit(tx, ctx, {
      action: "payroll.record_create",
      targetType: "payroll_record",
      targetId: rec.id,
      newValues: { employeeId: body.employeeId, periodId: body.periodId, basicSalary: body.basicSalary, ...totals, items: body.lineItems.length }
    });
    return { id: rec.id };
  });
}
async function updateRecord(ctx, id, input) {
  requirePerm(ctx, "payroll.prepare");
  const body = parse(z8.object({ ...recordBody, discrepancyFlag: z8.boolean().optional(), discrepancyNote: zOptText(500) }).strict(), input);
  const totals = computeTotals(body.basicSalary, body.lineItems);
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound("Payroll record not found");
    if (rec.status !== "draft") throw conflict("Only draft records can be edited");
    await assertPreparable(tx, ctx, rec.employeeId);
    await tx.update(payrollRecords).set({
      basicSalary: body.basicSalary,
      ...totals,
      notes: body.notes,
      paymentDate: body.paymentDate ?? rec.paymentDate,
      discrepancyFlag: body.discrepancyFlag ?? rec.discrepancyFlag,
      discrepancyNote: body.discrepancyNote ?? rec.discrepancyNote,
      preparedBy: ctx.actor.userId,
      updatedAt: ctx.now()
    }).where(eq11(payrollRecords.id, id));
    await writeItems(tx, id, body.lineItems);
    await audit(tx, ctx, {
      action: "payroll.record_update",
      targetType: "payroll_record",
      targetId: id,
      oldValues: { basicSalary: rec.basicSalary, grossEarnings: rec.grossEarnings, totalDeductions: rec.totalDeductions, netPay: rec.netPay },
      newValues: { basicSalary: body.basicSalary, ...totals, discrepancyFlag: body.discrepancyFlag }
    });
    return { id };
  });
}
async function deleteDraft(ctx, id) {
  requirePerm(ctx, "payroll.prepare");
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound("Payroll record not found");
    if (rec.status !== "draft") throw conflict("Only draft records can be deleted");
    await tx.delete(payrollRecords).where(eq11(payrollRecords.id, id));
    await audit(tx, ctx, { action: "payroll.record_delete_draft", targetType: "payroll_record", targetId: id, oldValues: { employeeId: rec.employeeId, revision: rec.revision, netPay: rec.netPay } });
    return { deleted: true };
  });
}
async function submitRecord(ctx, id) {
  requirePerm(ctx, "payroll.prepare");
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound("Payroll record not found");
    if (rec.status !== "draft") throw conflict("Only draft records can be submitted");
    const emp = await assertPreparable(tx, ctx, rec.employeeId);
    const [approval] = await tx.insert(approvalRequests).values({
      type: "payroll_record",
      targetType: "payroll_record",
      targetId: id,
      departmentId: emp.departmentId,
      summary: `Payroll for ${emp.legalName}${rec.revision > 1 ? ` (revision ${rec.revision})` : ""}`,
      payload: { revision: rec.revision, periodId: rec.periodId },
      reason: rec.adjustmentReason,
      requiredPermission: "payroll.approve",
      requestedBy: ctx.actor.userId
    }).returning({ id: approvalRequests.id });
    await tx.update(payrollRecords).set({ status: "pending_approval", submittedAt: ctx.now(), approvalId: approval.id, updatedAt: ctx.now() }).where(eq11(payrollRecords.id, id));
    await audit(tx, ctx, { action: "payroll.record_submit", targetType: "payroll_record", targetId: id, approvalId: approval.id });
    const approvers = (await usersWithPermission(tx, "payroll.approve")).filter((u) => u !== ctx.actor.userId);
    await notify(tx, approvers, {
      type: "approval.pending",
      title: "Payroll record awaiting approval",
      body: `A payroll record for ${emp.legalName} was submitted for approval.`,
      link: `/finance/records/${id}`,
      dedupeKey: `approval:${approval.id}`
    });
    return { status: "pending_approval", approvalId: approval.id };
  });
}
async function approveRecord(ctx, id, input) {
  requirePerm(ctx, "payroll.approve");
  const body = parse(z8.object({ reason: zOptText(500) }).strict(), input ?? {});
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound("Payroll record not found");
    if (rec.status !== "pending_approval") throw conflict("Record is not awaiting approval");
    if (ctx.actor.employeeId === rec.employeeId) throw forbidden("You cannot approve your own payroll record");
    const requireSecond = await getSetting(tx, "payroll.require_second_approval");
    if (requireSecond && rec.preparedBy === ctx.actor.userId) {
      throw forbidden("Second-person approval is required: you prepared this record");
    }
    if (rec.supersedesId) {
      await tx.update(payrollRecords).set({ status: "superseded", updatedAt: ctx.now() }).where(eq11(payrollRecords.id, rec.supersedesId));
    }
    await tx.update(payrollRecords).set({ status: "approved", approvedBy: ctx.actor.userId, approvedAt: ctx.now(), updatedAt: ctx.now() }).where(eq11(payrollRecords.id, id));
    if (rec.approvalId) {
      await tx.update(approvalRequests).set({ status: "approved", decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason }).where(and8(eq11(approvalRequests.id, rec.approvalId), eq11(approvalRequests.status, "pending")));
    }
    await audit(tx, ctx, {
      action: rec.supersedesId ? "payroll.adjustment_approve" : "payroll.record_approve",
      targetType: "payroll_record",
      targetId: id,
      newValues: { netPay: rec.netPay, revision: rec.revision, supersedes: rec.supersedesId },
      reason: body.reason,
      approvalId: rec.approvalId
    });
    await notify(tx, [rec.preparedBy], {
      type: "payroll.approved",
      title: "Payroll record approved",
      link: `/finance/records/${id}`,
      dedupeKey: `payroll-approved:${id}`
    });
    return { status: "approved" };
  });
}
async function rejectRecord(ctx, id, input) {
  requirePerm(ctx, "payroll.approve");
  const body = parse(z8.object({ reason: zTrim(500, 3) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound("Payroll record not found");
    if (rec.status !== "pending_approval") throw conflict("Record is not awaiting approval");
    await tx.update(payrollRecords).set({ status: "draft", submittedAt: null, approvalId: null, discrepancyFlag: true, discrepancyNote: `Returned: ${body.reason}`, updatedAt: ctx.now() }).where(eq11(payrollRecords.id, id));
    if (rec.approvalId) {
      await tx.update(approvalRequests).set({ status: "rejected", decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason }).where(eq11(approvalRequests.id, rec.approvalId));
    }
    await audit(tx, ctx, { action: "payroll.record_reject", targetType: "payroll_record", targetId: id, reason: body.reason, approvalId: rec.approvalId });
    await notify(tx, [rec.preparedBy], { type: "payroll.returned", title: "Payroll record returned for correction", link: `/finance/records/${id}` });
    return { status: "draft" };
  });
}
async function adjustRecord(ctx, id, input) {
  requirePerm(ctx, "payroll.prepare");
  const body = parse(z8.object({ reason: zTrim(500, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound("Payroll record not found");
    if (rec.status !== "approved") throw conflict("Only approved records can be adjusted");
    await assertPreparable(tx, ctx, rec.employeeId);
    const [open] = await tx.select({ id: payrollRecords.id }).from(payrollRecords).where(and8(eq11(payrollRecords.employeeId, rec.employeeId), eq11(payrollRecords.periodId, rec.periodId), inArray6(payrollRecords.status, ["draft", "pending_approval"])));
    if (open) throw conflict("An adjustment for this record is already in progress");
    const [{ maxRev }] = await tx.select({ maxRev: sql11`max(${payrollRecords.revision})::int` }).from(payrollRecords).where(and8(eq11(payrollRecords.employeeId, rec.employeeId), eq11(payrollRecords.periodId, rec.periodId)));
    const items = await tx.select().from(payrollLineItems).where(eq11(payrollLineItems.recordId, id)).orderBy(asc4(payrollLineItems.sortOrder));
    const [rev] = await tx.insert(payrollRecords).values({
      employeeId: rec.employeeId,
      periodId: rec.periodId,
      revision: maxRev + 1,
      supersedesId: rec.id,
      currency: rec.currency,
      basicSalary: rec.basicSalary,
      grossEarnings: rec.grossEarnings,
      totalDeductions: rec.totalDeductions,
      netPay: rec.netPay,
      paymentDate: rec.paymentDate,
      notes: rec.notes,
      adjustmentReason: body.reason,
      preparedBy: ctx.actor.userId
    }).returning();
    await writeItems(tx, rev.id, items.map((i) => ({ kind: i.kind, category: i.category, label: i.label, amount: i.amount })));
    await audit(tx, ctx, { action: "payroll.adjustment_create", targetType: "payroll_record", targetId: rev.id, newValues: { supersedes: rec.id, revision: rev.revision }, reason: body.reason });
    return { id: rev.id };
  });
}
async function markPaid(ctx, id, input) {
  requirePerm(ctx, "payroll.prepare");
  const body = parse(z8.object({ paymentDate: zDate }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const rec = await loadRecord(tx, id, true);
    if (!rec) throw notFound("Payroll record not found");
    if (rec.status !== "approved") throw conflict("Only approved records can be marked as paid");
    if (rec.paymentStatus === "paid") throw conflict("Already marked as paid");
    await tx.update(payrollRecords).set({ paymentStatus: "paid", paymentDate: body.paymentDate, updatedAt: ctx.now() }).where(eq11(payrollRecords.id, id));
    await audit(tx, ctx, { action: "payroll.mark_paid", targetType: "payroll_record", targetId: id, newValues: { paymentDate: body.paymentDate } });
    return { paymentStatus: "paid" };
  });
}
async function generateDrafts(ctx, periodId) {
  requirePerm(ctx, "payroll.prepare");
  return ctx.db.transaction(async (tx) => {
    const period = await loadPeriod(tx, periodId);
    if (!period) throw notFound("Payroll period not found");
    if (period.status === "closed") throw conflict("This payroll period is closed");
    const currency = await getSetting(tx, "org.currency");
    const candidates = await tx.select({ id: employees.id }).from(employees).where(
      and8(
        isNull6(employees.archivedAt),
        inArray6(employees.employmentStatus, ["active", "on_leave"]),
        sql11`${employees.employmentNumber} is not null`,
        sql11`not exists (select 1 from ${payrollRecords} pr where pr.employee_id = ${employees.id} and pr.period_id = ${periodId})`
      )
    );
    let created = 0;
    let skipped = 0;
    for (const c of candidates) {
      if (c.id === ctx.actor.employeeId) {
        skipped++;
        continue;
      }
      const [prev] = await tx.select().from(payrollRecords).where(and8(eq11(payrollRecords.employeeId, c.id), eq11(payrollRecords.status, "approved"))).orderBy(desc3(payrollRecords.approvedAt)).limit(1);
      if (!prev) {
        skipped++;
        continue;
      }
      const items = await tx.select().from(payrollLineItems).where(eq11(payrollLineItems.recordId, prev.id));
      const recurring = items.filter((i) => !["bonus", "overtime"].includes(i.category));
      const li = recurring.map((i) => ({ kind: i.kind, category: i.category, label: i.label, amount: i.amount }));
      const totals = computeTotals(prev.basicSalary, li);
      const [rec] = await tx.insert(payrollRecords).values({ employeeId: c.id, periodId, currency, basicSalary: prev.basicSalary, ...totals, paymentDate: period.payDate, preparedBy: ctx.actor.userId }).returning();
      await writeItems(tx, rec.id, li);
      created++;
    }
    await audit(tx, ctx, { action: "payroll.generate_drafts", targetType: "payroll_period", targetId: periodId, newValues: { created, skipped } });
    return { created, skipped };
  });
}
async function issuePayslipTx(tx, ctx, recordId) {
  const rec = await loadRecord(tx, recordId, true);
  if (!rec) throw notFound("Payroll record not found");
  if (rec.status !== "approved") throw conflict("Payslips can only be issued for approved records");
  const [existing] = await tx.select({ id: payslips.id }).from(payslips).where(eq11(payslips.payrollRecordId, recordId));
  if (existing) return { id: existing.id, created: false };
  const [emp] = await tx.select({
    legalName: employees.legalName,
    employmentNumber: employees.employmentNumber,
    userId: employees.userId,
    departmentName: departments.name,
    jobTitleName: jobTitles.name
  }).from(employees).innerJoin(departments, eq11(departments.id, employees.departmentId)).leftJoin(jobTitles, eq11(jobTitles.id, employees.jobTitleId)).where(eq11(employees.id, rec.employeeId));
  const period = await loadPeriod(tx, rec.periodId);
  const items = await tx.select().from(payrollLineItems).where(eq11(payrollLineItems.recordId, recordId)).orderBy(asc4(payrollLineItems.sortOrder));
  const settings = await getSettings(tx);
  const payslipNumber = `PS-${period.code}-${emp.employmentNumber}-R${rec.revision}`;
  const snapshot = {
    organization: { name: settings["org.name"], address: settings["org.address"], phone: settings["org.phone"], email: settings["org.email"] },
    employee: { name: emp.legalName, employmentNumber: emp.employmentNumber, department: emp.departmentName, jobTitle: emp.jobTitleName },
    period: { code: period.code, name: period.name, startDate: period.startDate, endDate: period.endDate },
    paymentDate: rec.paymentDate ?? period.payDate,
    paymentStatus: rec.paymentStatus,
    currency: rec.currency,
    revision: rec.revision,
    basicSalary: rec.basicSalary,
    earnings: items.filter((i) => i.kind === "earning").map((i) => ({ label: i.label, category: i.category, amount: i.amount })),
    deductions: items.filter((i) => i.kind === "deduction").map((i) => ({ label: i.label, category: i.category, amount: i.amount })),
    grossEarnings: rec.grossEarnings,
    totalDeductions: rec.totalDeductions,
    netPay: rec.netPay
  };
  const [slip] = await tx.insert(payslips).values({ payslipNumber, payrollRecordId: recordId, employeeId: rec.employeeId, snapshot, issuedBy: ctx.actor.userId }).returning();
  await audit(tx, ctx, { action: "payslip.issue", targetType: "payslip", targetId: slip.id, newValues: { payslipNumber, recordId } });
  await notify(tx, [emp.userId], {
    type: "payslip.available",
    title: `Your payslip for ${period.name} is available`,
    link: `/payslips/${slip.id}`,
    dedupeKey: `payslip:${slip.id}`
  });
  return { id: slip.id, created: true };
}
async function issuePayslip(ctx, recordId) {
  requirePerm(ctx, "payroll.prepare");
  return ctx.db.transaction((tx) => issuePayslipTx(tx, ctx, recordId));
}
async function issuePayslipsForPeriod(ctx, periodId) {
  requirePerm(ctx, "payroll.prepare");
  return ctx.db.transaction(async (tx) => {
    const rows = await tx.select({ id: payrollRecords.id }).from(payrollRecords).leftJoin(payslips, eq11(payslips.payrollRecordId, payrollRecords.id)).where(and8(eq11(payrollRecords.periodId, periodId), eq11(payrollRecords.status, "approved"), isNull6(payslips.id)));
    for (const r of rows) await issuePayslipTx(tx, ctx, r.id);
    return { issued: rows.length };
  });
}
async function getPayslip(ctx, id) {
  requireActor(ctx);
  if (!z8.uuid().safeParse(id).success) throw deniedRecord("Payslip");
  const [slip] = await ctx.db.select({ slip: payslips, userId: employees.userId, recordStatus: payrollRecords.status, livePaymentStatus: payrollRecords.paymentStatus }).from(payslips).innerJoin(employees, eq11(employees.id, payslips.employeeId)).innerJoin(payrollRecords, eq11(payrollRecords.id, payslips.payrollRecordId)).where(eq11(payslips.id, id));
  if (!slip) throw deniedRecord("Payslip");
  const own = !!slip.userId && slip.userId === ctx.actor.userId;
  if (!own && !has(ctx.actor, "payroll.read")) throw deniedRecord("Payslip");
  if (!own) await audit(ctx.db, ctx, { action: "payslip.view", targetType: "payslip", targetId: id });
  return {
    id: slip.slip.id,
    payslipNumber: slip.slip.payslipNumber,
    issuedAt: slip.slip.issuedAt,
    payrollRecordId: slip.slip.payrollRecordId,
    superseded: slip.recordStatus === "superseded",
    currentPaymentStatus: slip.livePaymentStatus,
    ...slip.slip.snapshot
  };
}
async function employeePayroll(ctx, employeeId) {
  requireActor(ctx);
  const [emp] = z8.uuid().safeParse(employeeId).success ? await ctx.db.select({ id: employees.id, userId: employees.userId }).from(employees).where(eq11(employees.id, employeeId)) : [];
  if (!emp) throw deniedRecord("Employee");
  const own = !!emp.userId && emp.userId === ctx.actor.userId;
  if (!own && !has(ctx.actor, "payroll.read")) throw deniedRecord("Employee");
  const conds = [eq11(payrollRecords.employeeId, employeeId)];
  if (!has(ctx.actor, "payroll.read")) conds.push(inArray6(payrollRecords.status, ["approved", "superseded"]));
  return ctx.db.select({
    id: payrollRecords.id,
    periodName: payrollPeriods.name,
    periodCode: payrollPeriods.code,
    startDate: payrollPeriods.startDate,
    revision: payrollRecords.revision,
    status: payrollRecords.status,
    currency: payrollRecords.currency,
    grossEarnings: payrollRecords.grossEarnings,
    totalDeductions: payrollRecords.totalDeductions,
    netPay: payrollRecords.netPay,
    paymentStatus: payrollRecords.paymentStatus,
    paymentDate: payrollRecords.paymentDate,
    payslipId: payslips.id
  }).from(payrollRecords).innerJoin(payrollPeriods, eq11(payrollPeriods.id, payrollRecords.periodId)).leftJoin(payslips, eq11(payslips.payrollRecordId, payrollRecords.id)).where(and8(...conds)).orderBy(desc3(payrollPeriods.startDate), desc3(payrollRecords.revision));
}
async function financeSummary(ctx, query) {
  requirePerm(ctx, "payroll.read", "report.finance");
  const q = parse(z8.object({ periodId: z8.uuid().optional(), departmentId: z8.uuid().optional(), locationId: z8.uuid().optional() }), query);
  const empConds = [isNull6(employees.archivedAt), inArray6(employees.employmentStatus, ["active", "on_leave"])];
  if (q.departmentId) empConds.push(eq11(employees.departmentId, q.departmentId));
  if (q.locationId) empConds.push(eq11(employees.locationId, q.locationId));
  const periods = await ctx.db.select().from(payrollPeriods).orderBy(desc3(payrollPeriods.startDate)).limit(24);
  const period = q.periodId ? periods.find((p2) => p2.id === q.periodId) ?? await loadPeriod(ctx.db, q.periodId) : periods[0];
  const [[{ activeEmployees }], byDepartment, byLocation] = await Promise.all([
    ctx.db.select({ activeEmployees: sql11`count(*)::int` }).from(employees).where(and8(...empConds)),
    ctx.db.select({ id: departments.id, name: departments.name, n: sql11`count(${employees.id})::int` }).from(employees).innerJoin(departments, eq11(departments.id, employees.departmentId)).where(and8(...empConds)).groupBy(departments.id, departments.name).orderBy(departments.name),
    ctx.db.select({ id: workLocations.id, name: workLocations.name, n: sql11`count(${employees.id})::int` }).from(employees).leftJoin(workLocations, eq11(workLocations.id, employees.locationId)).where(and8(...empConds)).groupBy(workLocations.id, workLocations.name).orderBy(workLocations.name)
  ]);
  let payroll = null;
  if (period) {
    const recConds = [eq11(payrollRecords.periodId, period.id), inArray6(payrollRecords.status, ["draft", "pending_approval", "approved"])];
    if (q.departmentId) recConds.push(eq11(employees.departmentId, q.departmentId));
    if (q.locationId) recConds.push(eq11(employees.locationId, q.locationId));
    const rows = await ctx.db.select({
      status: payrollRecords.status,
      paid: sql11`count(*) filter (where ${payrollRecords.paymentStatus} = 'paid')::int`,
      n: sql11`count(*)::int`,
      gross: sql11`coalesce(sum(${payrollRecords.grossEarnings}),0)`,
      deductions: sql11`coalesce(sum(${payrollRecords.totalDeductions}),0)`,
      net: sql11`coalesce(sum(${payrollRecords.netPay}),0)`
    }).from(payrollRecords).innerJoin(employees, eq11(employees.id, payrollRecords.employeeId)).where(and8(...recConds)).groupBy(payrollRecords.status);
    const sum = (k) => rows.reduce((s, r) => s + Number(r[k]), 0);
    const approved = rows.find((r) => r.status === "approved");
    payroll = {
      period,
      records: rows.reduce((s, r) => s + r.n, 0),
      byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
      paid: approved?.paid ?? 0,
      gross: sum("gross"),
      deductions: sum("deductions"),
      net: sum("net"),
      approvedNet: Number(approved?.net ?? 0),
      missing: Math.max(0, activeEmployees - rows.reduce((s, r) => s + r.n, 0))
    };
  }
  let retirement = null;
  if (hasAny(ctx.actor, ["retirement.read"])) {
    const [counts] = await ctx.db.select({
      upcoming: sql11`count(*) filter (where ${retirementReviews.status} = 'upcoming')::int`,
      reviewRequired: sql11`count(*) filter (where ${retirementReviews.status} = 'review_required')::int`,
      pendingApproval: sql11`count(*) filter (where ${retirementReviews.status} = 'pending_approval')::int`
    }).from(retirementReviews);
    const [liability] = await ctx.db.select({
      verified: sql11`coalesce(sum(${retirementSettlements.totalAmount}) filter (where ${retirementSettlements.verificationStatus} = 'verified'),0)`,
      estimated: sql11`coalesce(sum(${retirementSettlements.totalAmount}) filter (where ${retirementSettlements.verificationStatus} in ('draft','submitted')),0)`
    }).from(retirementSettlements).innerJoin(retirementReviews, eq11(retirementReviews.id, retirementSettlements.reviewId)).where(inArray6(retirementReviews.status, ["upcoming", "review_required", "pending_approval", "approved", "deferred"]));
    retirement = { ...counts, verifiedLiability: Number(liability.verified), estimatedLiability: Number(liability.estimated) };
  }
  const currency = await getSetting(ctx.db, "org.currency");
  return { currency, activeEmployees, byDepartment, byLocation, periods, payroll, retirement };
}
async function exportPeriodCsv(ctx, periodId) {
  requirePerm(ctx, "payroll.export");
  const period = await loadPeriod(ctx.db, periodId);
  if (!period) throw notFound("Payroll period not found");
  const rows = await recordsBase(ctx.db).where(and8(eq11(payrollRecords.periodId, periodId), inArray6(payrollRecords.status, ["draft", "pending_approval", "approved"]))).orderBy(asc4(employees.legalName));
  await audit(ctx.db, ctx, { action: "payroll.export", targetType: "payroll_period", targetId: periodId, newValues: { rows: rows.length } });
  return toCsv(
    ["Employment number", "Name", "Department", "Location", "Revision", "Status", "Currency", "Basic", "Gross", "Deductions", "Net", "Payment status", "Payment date"],
    rows.map((r) => [
      r.employmentNumber,
      r.legalName,
      r.departmentName,
      r.locationName,
      r.revision,
      r.status,
      r.currency,
      minorToDecimal(r.basicSalary),
      minorToDecimal(r.grossEarnings),
      minorToDecimal(r.totalDeductions),
      minorToDecimal(r.netPay),
      r.paymentStatus,
      r.paymentDate
    ])
  );
}

// server/services/retirement.ts
import { z as z9 } from "zod";
import { and as and9, asc as asc5, desc as desc4, eq as eq12, inArray as inArray7, isNull as isNull7, lte, or as or6, gte, sql as sql12 } from "drizzle-orm";
var DEFAULT_ACTIONS = [
  "Prepare estimated retirement statement (Finance)",
  "Verify statement and employment details (Reviewer)",
  "Executive decision (Super Admin)"
];
function isPolicyEffective(p2, today) {
  return p2.adopted && p2.effectiveFrom <= today && (!p2.effectiveTo || p2.effectiveTo >= today);
}
function policyFor(policies, departmentId, today) {
  const effective = policies.filter((p2) => isPolicyEffective(p2, today));
  return effective.find((p2) => p2.departmentId === departmentId) ?? effective.find((p2) => !p2.departmentId) ?? null;
}
function expectedRetirementDate(dob, policy) {
  return addYears(dob, policy.retirementAge);
}
async function listPolicies(ctx) {
  requirePerm(ctx, "retirement.read", "retirement.policy.manage");
  return ctx.db.select({ policy: retirementPolicies, departmentName: departments.name, adoptedByName: users.displayName }).from(retirementPolicies).leftJoin(departments, eq12(departments.id, retirementPolicies.departmentId)).leftJoin(users, eq12(users.id, retirementPolicies.adoptedBy)).orderBy(desc4(retirementPolicies.createdAt)).then((rows) => rows.map((r) => ({ ...r.policy, departmentName: r.departmentName, adoptedByName: r.adoptedByName, effectiveToday: isPolicyEffective(r.policy, todayIso(ctx.now())) })));
}
var policyInput = z9.object({
  name: zTrim(120),
  retirementAge: z9.number().int().min(40).max(80),
  reviewLeadMonths: z9.number().int().min(1).max(36).default(6),
  upcomingWindowMonths: z9.number().int().min(1).max(60).default(12),
  departmentId: zOptUuid,
  effectiveFrom: zDate,
  effectiveTo: zOptDate,
  legalReference: zOptText(500),
  notes: zOptText(2e3)
}).strict();
async function createPolicy(ctx, input) {
  requirePerm(ctx, "retirement.policy.manage");
  const body = parse(policyInput, input);
  if (body.upcomingWindowMonths < body.reviewLeadMonths) throw badRequest("Validation failed", { fields: { upcomingWindowMonths: "Must be at least the review lead time" } });
  if (body.effectiveTo && body.effectiveTo < body.effectiveFrom) throw badRequest("Validation failed", { fields: { effectiveTo: "Must be after the effective date" } });
  return ctx.db.transaction(async (tx) => {
    const [p2] = await tx.insert(retirementPolicies).values({ ...body, createdBy: ctx.actor.userId, adopted: false }).returning();
    await audit(tx, ctx, { action: "retirement.policy_create", targetType: "retirement_policy", targetId: p2.id, newValues: body });
    return p2;
  });
}
async function updatePolicy(ctx, id, input) {
  requirePerm(ctx, "retirement.policy.manage");
  const body = parse(policyInput, input);
  return ctx.db.transaction(async (tx) => {
    const [p2] = await tx.select().from(retirementPolicies).where(eq12(retirementPolicies.id, id));
    if (!p2) throw notFound("Policy not found");
    if (p2.adopted) throw conflict("Adopted policies cannot be edited. End this policy and create a new version.");
    await tx.update(retirementPolicies).set(body).where(eq12(retirementPolicies.id, id));
    await audit(tx, ctx, { action: "retirement.policy_update", targetType: "retirement_policy", targetId: id, oldValues: p2, newValues: body });
    return { id };
  });
}
async function adoptPolicy(ctx, id, input) {
  requirePerm(ctx, "retirement.policy.manage");
  requireRecentAuth(ctx);
  const body = parse(z9.object({ confirmation: z9.literal(true), reason: zTrim(1e3, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [p2] = await tx.select().from(retirementPolicies).where(eq12(retirementPolicies.id, id));
    if (!p2) throw notFound("Policy not found");
    if (p2.adopted) throw conflict("Policy already adopted");
    const overlapping = await tx.select({ id: retirementPolicies.id }).from(retirementPolicies).where(
      and9(
        eq12(retirementPolicies.adopted, true),
        p2.departmentId ? eq12(retirementPolicies.departmentId, p2.departmentId) : isNull7(retirementPolicies.departmentId),
        or6(isNull7(retirementPolicies.effectiveTo), gte(retirementPolicies.effectiveTo, p2.effectiveFrom)),
        p2.effectiveTo ? lte(retirementPolicies.effectiveFrom, p2.effectiveTo) : sql12`true`
      )
    );
    if (overlapping.length) throw conflict("Another adopted policy covers the same scope and dates. End it first.");
    await tx.update(retirementPolicies).set({ adopted: true, adoptedBy: ctx.actor.userId, adoptedAt: ctx.now() }).where(eq12(retirementPolicies.id, id));
    await audit(tx, ctx, { action: "retirement.policy_adopt", targetType: "retirement_policy", targetId: id, newValues: { retirementAge: p2.retirementAge, departmentId: p2.departmentId }, reason: body.reason });
    return { adopted: true };
  });
}
async function endPolicy(ctx, id, input) {
  requirePerm(ctx, "retirement.policy.manage");
  requireRecentAuth(ctx);
  const body = parse(z9.object({ effectiveTo: zDate, reason: zTrim(1e3, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [p2] = await tx.select().from(retirementPolicies).where(eq12(retirementPolicies.id, id));
    if (!p2) throw notFound("Policy not found");
    if (body.effectiveTo < p2.effectiveFrom) throw badRequest("End date must be after the effective date");
    await tx.update(retirementPolicies).set({ effectiveTo: body.effectiveTo }).where(eq12(retirementPolicies.id, id));
    await audit(tx, ctx, { action: "retirement.policy_end", targetType: "retirement_policy", targetId: id, oldValues: { effectiveTo: p2.effectiveTo }, newValues: { effectiveTo: body.effectiveTo }, reason: body.reason });
    return { id };
  });
}
async function notifyReviewRequired(tx, review, name) {
  const recipients = [.../* @__PURE__ */ new Set([...await usersWithPermission(tx, "retirement.read")])];
  await notify(tx, recipients, {
    type: "retirement.review_required",
    title: `Retirement review required: ${name}`,
    body: `Expected retirement date ${review.expectedRetirementDate}. Prepare and verify the retirement statement.`,
    link: `/retirement/${review.id}`,
    dedupeKey: `retirement-review:${review.id}:${review.expectedRetirementDate}`
  });
}
async function runRetirementScan(db, now = /* @__PURE__ */ new Date()) {
  const today = todayIso(now);
  const systemCtx = { actor: null, meta: { requestId: `job-retirement-${today}` } };
  return db.transaction(async (tx) => {
    const policies = await tx.select().from(retirementPolicies);
    if (!policies.some((p2) => isPolicyEffective(p2, today))) return { created: 0, flagged: 0, updated: 0, skipped: "no_adopted_policy" };
    const emps = await tx.select({ id: employees.id, legalName: employees.legalName, dateOfBirth: employees.dateOfBirth, departmentId: employees.departmentId }).from(employees).where(
      and9(
        isNull7(employees.archivedAt),
        inArray7(employees.employmentStatus, ["active", "on_leave", "suspended"]),
        sql12`${employees.dateOfBirth} is not null`,
        sql12`${employees.employmentNumber} is not null`
      )
    );
    const reviews = await tx.select().from(retirementReviews);
    const open = new Map(reviews.filter((r) => !["completed", "rejected"].includes(r.status)).map((r) => [r.employeeId, r]));
    const closed = new Set(reviews.filter((r) => ["completed", "rejected"].includes(r.status)).map((r) => `${r.employeeId}|${r.expectedRetirementDate}`));
    let created = 0;
    let flagged = 0;
    let updated = 0;
    for (const emp of emps) {
      const policy = policyFor(policies, emp.departmentId, today);
      if (!policy) continue;
      const expected = expectedRetirementDate(emp.dateOfBirth, policy);
      const reviewStart = addMonths(expected, -policy.reviewLeadMonths);
      const upcomingStart = addMonths(expected, -policy.upcomingWindowMonths);
      const existing = open.get(emp.id);
      if (!existing) {
        if (today < upcomingStart || closed.has(`${emp.id}|${expected}`)) continue;
        const due = today >= reviewStart;
        const [r] = await tx.insert(retirementReviews).values({
          employeeId: emp.id,
          policyId: policy.id,
          expectedRetirementDate: expected,
          status: due ? "review_required" : "upcoming",
          flaggedAt: due ? now : null,
          outstandingActions: DEFAULT_ACTIONS
        }).onConflictDoNothing().returning();
        if (!r) continue;
        created++;
        await audit(tx, systemCtx, { actorUserId: null, action: "retirement.review_created", targetType: "retirement_review", targetId: r.id, newValues: { employeeId: emp.id, expected, status: r.status, policyId: policy.id } });
        if (due) {
          flagged++;
          await notifyReviewRequired(tx, r, emp.legalName);
        }
        continue;
      }
      if (["upcoming", "review_required"].includes(existing.status) && (existing.expectedRetirementDate !== expected || existing.policyId !== policy.id)) {
        await tx.update(retirementReviews).set({ expectedRetirementDate: expected, policyId: policy.id, updatedAt: now }).where(eq12(retirementReviews.id, existing.id));
        existing.expectedRetirementDate = expected;
        updated++;
      }
      if (existing.status === "upcoming" && today >= addMonths(existing.expectedRetirementDate, -policy.reviewLeadMonths)) {
        await tx.update(retirementReviews).set({ status: "review_required", flaggedAt: now, updatedAt: now }).where(eq12(retirementReviews.id, existing.id));
        await audit(tx, systemCtx, { actorUserId: null, action: "retirement.review_flagged", targetType: "retirement_review", targetId: existing.id, newValues: { expected: existing.expectedRetirementDate } });
        await notifyReviewRequired(tx, existing, emp.legalName);
        flagged++;
      } else if (existing.status === "deferred" && existing.deferredUntil && today >= addMonths(existing.deferredUntil, -policy.reviewLeadMonths)) {
        await tx.update(retirementReviews).set({ status: "review_required", expectedRetirementDate: existing.deferredUntil, flaggedAt: now, updatedAt: now }).where(eq12(retirementReviews.id, existing.id));
        await audit(tx, systemCtx, { actorUserId: null, action: "retirement.review_flagged", targetType: "retirement_review", targetId: existing.id, newValues: { expected: existing.deferredUntil, afterDeferral: true } });
        await notifyReviewRequired(tx, { id: existing.id, expectedRetirementDate: existing.deferredUntil }, emp.legalName);
        flagged++;
      }
    }
    return { created, flagged, updated, skipped: null };
  });
}
function reviewBase(tx) {
  return tx.select({
    id: retirementReviews.id,
    status: retirementReviews.status,
    expectedRetirementDate: retirementReviews.expectedRetirementDate,
    deferredUntil: retirementReviews.deferredUntil,
    flaggedAt: retirementReviews.flaggedAt,
    outstandingActions: retirementReviews.outstandingActions,
    decisionReason: retirementReviews.decisionReason,
    decisionAt: retirementReviews.decisionAt,
    completedAt: retirementReviews.completedAt,
    policyId: retirementReviews.policyId,
    policyName: retirementPolicies.name,
    retirementAge: retirementPolicies.retirementAge,
    employeeId: employees.id,
    legalName: employees.legalName,
    employmentNumber: employees.employmentNumber,
    dateOfBirth: employees.dateOfBirth,
    employmentDate: employees.employmentDate,
    departmentName: departments.name,
    departmentId: employees.departmentId
  }).from(retirementReviews).innerJoin(employees, eq12(employees.id, retirementReviews.employeeId)).innerJoin(departments, eq12(departments.id, employees.departmentId)).innerJoin(retirementPolicies, eq12(retirementPolicies.id, retirementReviews.policyId));
}
var reviewQuery = zPage.extend({
  status: z9.enum(["upcoming", "review_required", "pending_approval", "approved", "deferred", "completed", "rejected", "open"]).default("open"),
  departmentId: z9.uuid().optional()
});
async function listReviews(ctx, query) {
  requirePerm(ctx, "retirement.read");
  const q = parse(reviewQuery, query);
  const conds = [];
  if (q.status === "open") conds.push(inArray7(retirementReviews.status, ["upcoming", "review_required", "pending_approval", "approved", "deferred"]));
  else conds.push(eq12(retirementReviews.status, q.status));
  if (q.departmentId) conds.push(eq12(employees.departmentId, q.departmentId));
  const where = and9(...conds);
  const today = todayIso(ctx.now());
  const [rows, [{ total }], counts, policies] = await Promise.all([
    reviewBase(ctx.db).where(where).orderBy(asc5(retirementReviews.expectedRetirementDate)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql12`count(*)::int` }).from(retirementReviews).innerJoin(employees, eq12(employees.id, retirementReviews.employeeId)).where(where),
    ctx.db.select({ status: retirementReviews.status, n: sql12`count(*)::int` }).from(retirementReviews).groupBy(retirementReviews.status),
    ctx.db.select().from(retirementPolicies)
  ]);
  return {
    items: rows.map((r) => ({ ...r, age: r.dateOfBirth ? ageOn(r.dateOfBirth, today) : null })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    policyAdopted: policies.some((p2) => isPolicyEffective(p2, today))
  };
}
async function getReview(ctx, id) {
  requirePerm(ctx, "retirement.read");
  if (!z9.uuid().safeParse(id).success) throw notFound("Review not found");
  const [row] = await reviewBase(ctx.db).where(eq12(retirementReviews.id, id));
  if (!row) throw notFound("Review not found");
  const settlements = await ctx.db.select({ s: retirementSettlements, preparedByName: users.displayName }).from(retirementSettlements).leftJoin(users, eq12(users.id, retirementSettlements.preparedBy)).where(eq12(retirementSettlements.reviewId, id)).orderBy(desc4(retirementSettlements.version));
  const latest = settlements[0]?.s;
  const today = todayIso(ctx.now());
  const open = !["completed", "rejected"].includes(row.status);
  return {
    ...row,
    age: row.dateOfBirth ? ageOn(row.dateOfBirth, today) : null,
    settlements: settlements.map((x) => ({ ...x.s, preparedByName: x.preparedByName })),
    can: {
      prepare: has(ctx.actor, "retirement.prepare") && open && ["upcoming", "review_required", "deferred"].includes(row.status) && (!latest || ["rejected", "verified"].includes(latest.verificationStatus)),
      editDraft: has(ctx.actor, "retirement.prepare") && latest?.verificationStatus === "draft",
      verify: has(ctx.actor, "retirement.verify") && latest?.verificationStatus === "submitted" && latest.preparedBy !== ctx.actor.userId,
      decide: has(ctx.actor, "retirement.decide") && ["review_required", "pending_approval", "deferred"].includes(row.status),
      approve: has(ctx.actor, "retirement.decide") && row.status === "pending_approval",
      complete: has(ctx.actor, "retirement.decide") && row.status === "approved"
    }
  };
}
async function employeeRetirement(ctx, employeeId) {
  requirePerm(ctx, "retirement.read");
  const [emp] = z9.uuid().safeParse(employeeId).success ? await ctx.db.select().from(employees).where(eq12(employees.id, employeeId)) : [];
  if (!emp) throw deniedRecord("Employee");
  const today = todayIso(ctx.now());
  const policies = await ctx.db.select().from(retirementPolicies);
  const policy = policyFor(policies, emp.departmentId, today);
  const reviews = await reviewBase(ctx.db).where(eq12(retirementReviews.employeeId, employeeId)).orderBy(desc4(retirementReviews.createdAt));
  return {
    policy: policy ? { id: policy.id, name: policy.name, retirementAge: policy.retirementAge, reviewLeadMonths: policy.reviewLeadMonths } : null,
    expectedRetirementDate: policy && emp.dateOfBirth ? expectedRetirementDate(emp.dateOfBirth, policy) : null,
    reviews
  };
}
var settlementInput = z9.object({
  calculationMethod: zTrim(4e3, 10),
  policyReference: zOptText(500),
  sourceFigures: z9.record(z9.string().max(80), z9.union([z9.string().max(200), z9.number()])).default({}),
  lineItems: z9.array(z9.object({ label: zTrim(120), kind: z9.enum(["credit", "debit"]), amount: z9.number().int().min(0).max(1e13) }).strict()).max(50)
}).strict();
var settlementTotal = (items) => items.reduce((s, i) => s + (i.kind === "credit" ? i.amount : -i.amount), 0);
async function loadReviewForUpdate(tx, id) {
  if (!z9.uuid().safeParse(id).success) return null;
  const [r] = await tx.select().from(retirementReviews).where(eq12(retirementReviews.id, id)).for("update");
  return r ?? null;
}
async function createSettlement(ctx, reviewId, input) {
  requirePerm(ctx, "retirement.prepare");
  const body = parse(settlementInput, input);
  return ctx.db.transaction(async (tx) => {
    const review = await loadReviewForUpdate(tx, reviewId);
    if (!review) throw notFound("Review not found");
    if (!["upcoming", "review_required", "deferred"].includes(review.status)) throw conflict("A statement cannot be prepared at this stage");
    const [latest] = await tx.select().from(retirementSettlements).where(eq12(retirementSettlements.reviewId, reviewId)).orderBy(desc4(retirementSettlements.version)).limit(1);
    if (latest && ["draft", "submitted"].includes(latest.verificationStatus)) throw conflict("A statement is already in progress for this review");
    const currency = await getSetting(tx, "org.currency");
    const [s] = await tx.insert(retirementSettlements).values({ ...body, reviewId, version: (latest?.version ?? 0) + 1, currency, totalAmount: settlementTotal(body.lineItems), preparedBy: ctx.actor.userId }).returning();
    await audit(tx, ctx, { action: "retirement.settlement_create", targetType: "retirement_settlement", targetId: s.id, newValues: { reviewId, version: s.version, totalAmount: s.totalAmount, method: body.calculationMethod.slice(0, 200) } });
    return { id: s.id };
  });
}
async function updateSettlement(ctx, settlementId, input) {
  requirePerm(ctx, "retirement.prepare");
  const body = parse(settlementInput, input);
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(retirementSettlements).where(eq12(retirementSettlements.id, settlementId)).for("update");
    if (!s) throw notFound("Statement not found");
    if (s.verificationStatus !== "draft") throw conflict("Only draft statements can be edited");
    const total = settlementTotal(body.lineItems);
    await tx.update(retirementSettlements).set({ ...body, totalAmount: total, preparedBy: ctx.actor.userId, updatedAt: ctx.now() }).where(eq12(retirementSettlements.id, settlementId));
    await audit(tx, ctx, { action: "retirement.settlement_update", targetType: "retirement_settlement", targetId: settlementId, oldValues: { totalAmount: s.totalAmount }, newValues: { totalAmount: total } });
    return { id: settlementId };
  });
}
async function submitSettlement(ctx, settlementId) {
  requirePerm(ctx, "retirement.prepare");
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(retirementSettlements).where(eq12(retirementSettlements.id, settlementId)).for("update");
    if (!s) throw notFound("Statement not found");
    if (s.verificationStatus !== "draft") throw conflict("Only draft statements can be submitted");
    await tx.update(retirementSettlements).set({ verificationStatus: "submitted", updatedAt: ctx.now() }).where(eq12(retirementSettlements.id, settlementId));
    await audit(tx, ctx, { action: "retirement.settlement_submit", targetType: "retirement_settlement", targetId: settlementId });
    const verifiers = (await usersWithPermission(tx, "retirement.verify")).filter((u) => u !== ctx.actor.userId);
    await notify(tx, verifiers, {
      type: "retirement.statement_submitted",
      title: "Retirement statement awaiting verification",
      link: `/retirement/${s.reviewId}`,
      dedupeKey: `retirement-statement:${settlementId}`
    });
    return { status: "submitted" };
  });
}
async function verifySettlement(ctx, settlementId, input) {
  requirePerm(ctx, "retirement.verify");
  const body = parse(z9.object({ decision: z9.enum(["verify", "reject"]), note: zTrim(1e3, 3) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(retirementSettlements).where(eq12(retirementSettlements.id, settlementId)).for("update");
    if (!s) throw notFound("Statement not found");
    if (s.verificationStatus !== "submitted") throw conflict("Statement is not awaiting verification");
    if (s.preparedBy === ctx.actor.userId) throw forbidden("You cannot verify a statement you prepared");
    const review = await loadReviewForUpdate(tx, s.reviewId);
    await tx.update(retirementSettlements).set({ verificationStatus: body.decision === "verify" ? "verified" : "rejected", verifiedBy: ctx.actor.userId, verifiedAt: ctx.now(), verificationNote: body.note, updatedAt: ctx.now() }).where(eq12(retirementSettlements.id, settlementId));
    let approvalId = null;
    if (body.decision === "verify") {
      const [emp] = await tx.select({ legalName: employees.legalName, departmentId: employees.departmentId }).from(employees).where(eq12(employees.id, review.employeeId));
      const [approval] = await tx.insert(approvalRequests).values({
        type: "retirement_decision",
        targetType: "retirement_review",
        targetId: review.id,
        departmentId: emp.departmentId,
        summary: `Retirement decision for ${emp.legalName} (expected ${review.expectedRetirementDate})`,
        payload: { settlementId },
        requiredPermission: "retirement.decide",
        requestedBy: ctx.actor.userId
      }).returning({ id: approvalRequests.id });
      approvalId = approval.id;
      await tx.update(retirementReviews).set({ status: "pending_approval", approvalId, outstandingActions: ["Executive decision (Super Admin)"], updatedAt: ctx.now() }).where(eq12(retirementReviews.id, review.id));
      await notify(tx, await usersWithPermission(tx, "retirement.decide"), {
        type: "retirement.pending_approval",
        title: `Retirement decision required: ${emp.legalName}`,
        link: `/retirement/${review.id}`,
        dedupeKey: `retirement-decision:${approval.id}`
      });
    }
    await audit(tx, ctx, { action: `retirement.settlement_${body.decision}`, targetType: "retirement_settlement", targetId: settlementId, reason: body.note, approvalId });
    await notify(tx, [s.preparedBy], {
      type: "retirement.statement_reviewed",
      title: body.decision === "verify" ? "Retirement statement verified" : "Retirement statement returned",
      link: `/retirement/${s.reviewId}`
    });
    return { status: body.decision === "verify" ? "verified" : "rejected" };
  });
}
var decisionInput = z9.object({ decision: z9.enum(["approve", "reject", "defer"]), reason: zTrim(1e3, 5), deferredUntil: zOptDate }).strict();
async function decideReview(ctx, reviewId, input) {
  requirePerm(ctx, "retirement.decide");
  const body = parse(decisionInput, input);
  return ctx.db.transaction(async (tx) => {
    const review = await loadReviewForUpdate(tx, reviewId);
    if (!review) throw notFound("Review not found");
    if (body.decision === "approve" && review.status !== "pending_approval") throw conflict("A verified retirement statement is required before approval");
    if (!["review_required", "pending_approval", "deferred"].includes(review.status)) throw conflict("This review is not awaiting a decision");
    const [emp] = await tx.select().from(employees).where(eq12(employees.id, review.employeeId));
    if (emp.userId === ctx.actor.userId) throw forbidden("You cannot decide your own retirement");
    let set = { decisionBy: ctx.actor.userId, decisionAt: ctx.now(), decisionReason: body.reason, updatedAt: ctx.now() };
    if (body.decision === "defer") {
      const base = review.deferredUntil ?? review.expectedRetirementDate;
      if (!body.deferredUntil || body.deferredUntil <= base) throw badRequest("Validation failed", { fields: { deferredUntil: "Choose a date after the current retirement date" } });
      set = { ...set, status: "deferred", deferredUntil: body.deferredUntil, outstandingActions: [`Re-review before ${body.deferredUntil}`] };
    } else if (body.decision === "approve") {
      set = { ...set, status: "approved", outstandingActions: ["Finalize retirement on the effective date (Super Admin)"] };
    } else {
      set = { ...set, status: "rejected", outstandingActions: [] };
    }
    await tx.update(retirementReviews).set(set).where(eq12(retirementReviews.id, reviewId));
    if (review.approvalId) {
      await tx.update(approvalRequests).set({ status: body.decision === "approve" ? "approved" : body.decision === "reject" ? "rejected" : "cancelled", decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: `${body.decision}: ${body.reason}` }).where(and9(eq12(approvalRequests.id, review.approvalId), eq12(approvalRequests.status, "pending")));
    }
    await audit(tx, ctx, {
      action: `retirement.decision_${body.decision}`,
      targetType: "retirement_review",
      targetId: reviewId,
      oldValues: { status: review.status },
      newValues: { status: set.status, deferredUntil: set.deferredUntil },
      reason: body.reason,
      approvalId: review.approvalId
    });
    const recipients = [...await usersWithPermission(tx, "retirement.read")];
    await notify(tx, recipients, {
      type: "retirement.decision",
      title: `Retirement ${body.decision === "approve" ? "approved" : body.decision === "defer" ? "deferred" : "not approved"}: ${emp.legalName}`,
      link: `/retirement/${reviewId}`,
      dedupeKey: `retirement-decision-made:${reviewId}:${body.decision}:${ctx.now().getTime()}`
    });
    if (body.decision !== "reject") {
      await notify(tx, [emp.userId], {
        type: "retirement.decision",
        title: body.decision === "approve" ? "A decision has been recorded on your retirement" : "Your retirement date has been deferred",
        body: body.decision === "defer" ? `New review date: ${body.deferredUntil}. HR will contact you about next steps.` : "HR will contact you about next steps.",
        link: "/profile"
      });
    }
    return { status: set.status };
  });
}
async function completeRetirement(ctx, reviewId, input) {
  requirePerm(ctx, "retirement.decide");
  requireRecentAuth(ctx);
  const body = parse(z9.object({ effectiveDate: zDate, reason: zTrim(1e3, 5) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const review = await loadReviewForUpdate(tx, reviewId);
    if (!review) throw notFound("Review not found");
    if (review.status !== "approved") throw conflict("Only approved retirements can be finalized");
    const [emp] = await tx.select().from(employees).where(eq12(employees.id, review.employeeId)).for("update");
    if (emp.userId === ctx.actor.userId) throw forbidden("You cannot finalize your own retirement");
    if (emp.userId) {
      await assertNotLastSuperAdmin(tx, emp.userId);
      await tx.update(users).set({ status: "deactivated", updatedAt: ctx.now() }).where(eq12(users.id, emp.userId));
      await revokeAllSessions(tx, emp.userId);
    }
    await tx.update(employees).set({ employmentStatus: "retired", archivedAt: ctx.now(), archivedBy: ctx.actor.userId, archiveReason: `Retired: ${body.reason}`, updatedAt: ctx.now() }).where(eq12(employees.id, emp.id));
    await tx.insert(employmentHistory).values({
      employeeId: emp.id,
      changeType: "retirement",
      fromValues: { employmentStatus: emp.employmentStatus },
      toValues: { employmentStatus: "retired" },
      effectiveDate: body.effectiveDate,
      reason: body.reason,
      actorUserId: ctx.actor.userId,
      approvalId: review.approvalId
    });
    await tx.update(retirementReviews).set({ status: "completed", completedAt: ctx.now(), completedBy: ctx.actor.userId, outstandingActions: [], updatedAt: ctx.now() }).where(eq12(retirementReviews.id, reviewId));
    await audit(tx, ctx, {
      action: "retirement.complete",
      targetType: "employee",
      targetId: emp.id,
      oldValues: { employmentStatus: emp.employmentStatus },
      newValues: { employmentStatus: "retired", archived: true, effectiveDate: body.effectiveDate },
      reason: body.reason,
      approvalId: review.approvalId
    });
    await notify(tx, await usersWithPermission(tx, "retirement.read"), {
      type: "retirement.completed",
      title: `Retirement finalized: ${emp.legalName}`,
      link: `/retirement/${reviewId}`,
      dedupeKey: `retirement-completed:${reviewId}`
    });
    return { status: "completed" };
  });
}
async function exportRetirementCsv(ctx) {
  requirePerm(ctx, "retirement.read");
  const rows = await reviewBase(ctx.db).orderBy(asc5(retirementReviews.expectedRetirementDate));
  await audit(ctx.db, ctx, { action: "retirement.export", targetType: "retirement_review", newValues: { rows: rows.length } });
  return toCsv(
    ["Employment number", "Name", "Department", "Date of birth", "Expected retirement", "Deferred until", "Status", "Policy"],
    rows.map((r) => [r.employmentNumber, r.legalName, r.departmentName, r.dateOfBirth, r.expectedRetirementDate, r.deferredUntil, r.status, r.policyName])
  );
}

// server/services/approvals.ts
var decider = alias2(users, "decider");
function visibilitySql(ctx) {
  const perms = [...ctx.actor.permissions];
  const clauses = [eq13(approvalRequests.requestedBy, ctx.actor.userId)];
  if (perms.length) clauses.push(inArray8(approvalRequests.requiredPermission, perms));
  return or7(...clauses);
}
function canDecide(ctx, r) {
  return r.status === "pending" && has(ctx.actor, r.requiredPermission) && r.requestedBy !== ctx.actor.userId;
}
async function listApprovals(ctx, query) {
  requireActor(ctx);
  const q = parse(
    zPage.extend({
      status: z10.enum(["pending", "approved", "rejected", "cancelled", "all"]).default("pending"),
      type: z10.enum(["registration", "employee_change", "profile_correction", "payroll_record", "retirement_decision"]).optional(),
      mine: z10.coerce.boolean().optional(),
      targetId: z10.uuid().optional()
    }),
    query
  );
  const conds = [visibilitySql(ctx)];
  if (q.status !== "all") conds.push(eq13(approvalRequests.status, q.status));
  if (q.type) conds.push(eq13(approvalRequests.type, q.type));
  if (q.mine) conds.push(eq13(approvalRequests.requestedBy, ctx.actor.userId));
  if (q.targetId) conds.push(eq13(approvalRequests.targetId, q.targetId));
  const where = and10(...conds);
  const rows = await ctx.db.select({ a: approvalRequests, requesterName: users.displayName, deciderName: decider.displayName }).from(approvalRequests).leftJoin(users, eq13(users.id, approvalRequests.requestedBy)).leftJoin(decider, eq13(decider.id, approvalRequests.decidedBy)).where(where).orderBy(desc5(approvalRequests.requestedAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
  const [{ total }] = await ctx.db.select({ total: sql13`count(*)::int` }).from(approvalRequests).where(where);
  const empIds = rows.filter((r) => r.a.targetType === "employee").map((r) => r.a.targetId);
  const emps = empIds.length ? await ctx.db.select().from(employees).where(inArray8(employees.id, empIds)) : [];
  const items = rows.filter((r) => {
    if (r.a.targetType !== "employee" || r.a.requestedBy === ctx.actor.userId) return true;
    const e = emps.find((x) => x.id === r.a.targetId);
    return !!e && canViewEmployee(ctx.actor, e);
  }).map((r) => ({
    ...r.a,
    requesterName: r.requesterName,
    deciderName: r.deciderName,
    canDecide: canDecide(ctx, r.a),
    canCancel: r.a.status === "pending" && r.a.requestedBy === ctx.actor.userId && ["employee_change", "profile_correction"].includes(r.a.type)
  }));
  return { items, total, page: q.page, pageSize: q.pageSize };
}
var decideInput = z10.object({
  decision: z10.enum(["approve", "reject", "defer"]),
  reason: zOptText(1e3),
  deferredUntil: zOptDate,
  corrections: z10.unknown().optional()
}).strict();
async function decideApproval(ctx, id, input) {
  requireActor(ctx);
  const body = parse(decideInput, input);
  if (!z10.uuid().safeParse(id).success) throw deniedRecord("Approval request");
  const [req] = await ctx.db.select().from(approvalRequests).where(and10(eq13(approvalRequests.id, id), visibilitySql(ctx)));
  if (!req) throw deniedRecord("Approval request");
  if (req.status !== "pending") throw conflict("This request has already been decided");
  if (req.requestedBy === ctx.actor.userId) throw forbidden("You cannot decide a request you submitted");
  if (!has(ctx.actor, req.requiredPermission)) throw forbidden();
  if (body.decision === "defer" && req.type !== "retirement_decision") throw badRequest("Only retirement decisions can be deferred");
  switch (req.type) {
    case "registration":
      return verifyRegistration(
        ctx,
        req.targetId,
        { decision: body.decision === "approve" ? "approve" : "reject", reason: body.reason ?? void 0, ...body.corrections ? { corrections: body.corrections } : {} },
        req.id
      );
    case "payroll_record":
      return body.decision === "approve" ? approveRecord(ctx, req.targetId, { reason: body.reason ?? void 0 }) : rejectRecord(ctx, req.targetId, { reason: body.reason ?? "" });
    case "retirement_decision":
      return decideReview(ctx, req.targetId, { decision: body.decision, reason: body.reason ?? "", deferredUntil: body.deferredUntil });
    case "employee_change":
    case "profile_correction":
      return decideEmployeeChange(ctx, req, body);
    default:
      throw badRequest("Unsupported request type");
  }
}
async function decideEmployeeChange(ctx, req, body) {
  if (body.decision === "reject" && !body.reason) throw badRequest("Validation failed", { fields: { reason: "A reason is required when rejecting" } });
  return ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(approvalRequests).where(eq13(approvalRequests.id, req.id)).for("update");
    if (locked.status !== "pending") throw conflict("This request has already been decided");
    const emp = await loadEmployee(tx, req.targetId, true);
    if (!emp || !canViewEmployee(ctx.actor, emp)) throw deniedRecord("Employee");
    if (emp.userId === ctx.actor.userId) throw forbidden("You cannot approve changes to your own record");
    let applied = [];
    if (body.decision === "approve") {
      const changes = parseChanges(req.payload.changes ?? {});
      const result = await applyEmployeeChanges(tx, ctx, emp, changes, {
        reason: [req.reason, body.reason].filter(Boolean).join(" \u2014 ") || null,
        approvalId: req.id,
        action: req.type === "profile_correction" ? "employee.correction_approved" : "employee.change_approved"
      });
      applied = result.changed;
    }
    await tx.update(approvalRequests).set({ status: body.decision === "approve" ? "approved" : "rejected", decidedBy: ctx.actor.userId, decidedAt: ctx.now(), decisionReason: body.reason }).where(eq13(approvalRequests.id, req.id));
    if (body.decision === "reject") {
      await audit(tx, ctx, { action: `${req.type}.rejected`, targetType: "employee", targetId: emp.id, reason: body.reason, approvalId: req.id });
    }
    await notify(tx, [req.requestedBy], {
      type: "approval.decided",
      title: `Your ${req.type === "profile_correction" ? "correction request" : "change request"} was ${body.decision === "approve" ? "approved" : "rejected"}`,
      body: body.reason ?? void 0,
      link: `/approvals?id=${req.id}`
    });
    return { status: body.decision === "approve" ? "approved" : "rejected", applied };
  });
}
async function cancelApproval(ctx, id) {
  requireActor(ctx);
  if (!z10.uuid().safeParse(id).success) throw deniedRecord("Approval request");
  return ctx.db.transaction(async (tx) => {
    const [req] = await tx.select().from(approvalRequests).where(eq13(approvalRequests.id, id)).for("update");
    if (!req || req.requestedBy !== ctx.actor.userId) throw deniedRecord("Approval request");
    if (req.status !== "pending") throw conflict("Only pending requests can be cancelled");
    if (!["employee_change", "profile_correction"].includes(req.type)) throw badRequest("This request cannot be cancelled");
    await tx.update(approvalRequests).set({ status: "cancelled", decidedBy: ctx.actor.userId, decidedAt: ctx.now() }).where(eq13(approvalRequests.id, id));
    await audit(tx, ctx, { action: "approval.cancel", targetType: "approval_request", targetId: id });
    return { status: "cancelled" };
  });
}

// server/services/comms.ts
import { z as z11 } from "zod";
import { and as and11, asc as asc6, desc as desc6, eq as eq14, gte as gte2, inArray as inArray9, or as or8, sql as sql14 } from "drizzle-orm";
async function actorPlacement(ctx) {
  if (!ctx.actor.employeeId) return { departmentId: null, locationId: null };
  const [e] = await ctx.db.select({ departmentId: employees.departmentId, locationId: employees.locationId }).from(employees).where(eq14(employees.id, ctx.actor.employeeId));
  return e ?? { departmentId: null, locationId: null };
}
function isTargetedAt(item, place) {
  const noTargets = !item.targetDepartmentIds.length && !item.targetLocationIds.length;
  return noTargets || !!place.departmentId && item.targetDepartmentIds.includes(place.departmentId) || !!place.locationId && item.targetLocationIds.includes(place.locationId);
}
function targetSql(table, place) {
  const clauses = [sql14`(jsonb_array_length(${table.targetDepartmentIds}) = 0 and jsonb_array_length(${table.targetLocationIds}) = 0)`];
  if (place.departmentId) clauses.push(sql14`${table.targetDepartmentIds} @> ${JSON.stringify([place.departmentId])}::jsonb`);
  if (place.locationId) clauses.push(sql14`${table.targetLocationIds} @> ${JSON.stringify([place.locationId])}::jsonb`);
  return or8(...clauses);
}
async function audienceUserIds(tx, item) {
  const noTargets = !item.targetDepartmentIds.length && !item.targetLocationIds.length;
  if (noTargets) {
    const rows2 = await tx.select({ id: users.id }).from(users).where(eq14(users.status, "active"));
    return rows2.map((r) => r.id);
  }
  const clauses = [];
  if (item.targetDepartmentIds.length) clauses.push(inArray9(employees.departmentId, item.targetDepartmentIds));
  if (item.targetLocationIds.length) clauses.push(inArray9(employees.locationId, item.targetLocationIds));
  const rows = await tx.select({ id: users.id }).from(users).innerJoin(employees, eq14(employees.userId, users.id)).where(and11(eq14(users.status, "active"), or8(...clauses)));
  return rows.map((r) => r.id);
}
var targetsSchema = {
  targetDepartmentIds: z11.array(z11.uuid()).max(50).default([]),
  targetLocationIds: z11.array(z11.uuid()).max(100).default([]),
  commentsEnabled: z11.boolean().default(false)
};
var announcementInput = z11.object({ title: zTrim(200), body: zTrim(2e4), ...targetsSchema }).strict();
async function listAnnouncements(ctx, query) {
  requireActor(ctx);
  const q = parse(zPage.extend({ status: z11.enum(["draft", "published", "archived", "all"]).optional() }), query);
  const manage = has(ctx.actor, "announcement.manage");
  const conds = [];
  if (manage) {
    if (q.status && q.status !== "all") conds.push(eq14(announcements.status, q.status));
  } else {
    conds.push(eq14(announcements.status, "published"));
    conds.push(targetSql(announcements, await actorPlacement(ctx)));
  }
  const where = conds.length ? and11(...conds) : void 0;
  const [items, [{ total }]] = await Promise.all([
    ctx.db.select({
      id: announcements.id,
      title: announcements.title,
      excerpt: sql14`left(${announcements.body}, 280)`,
      status: announcements.status,
      publishedAt: announcements.publishedAt,
      createdAt: announcements.createdAt,
      commentsEnabled: announcements.commentsEnabled,
      targetDepartmentIds: announcements.targetDepartmentIds,
      targetLocationIds: announcements.targetLocationIds,
      authorName: users.displayName,
      commentCount: sql14`(select count(*)::int from comments c where c.target_type = 'announcement' and c.target_id = announcements.id and c.status = 'visible')`
    }).from(announcements).leftJoin(users, eq14(users.id, announcements.createdBy)).where(where).orderBy(desc6(sql14`coalesce(${announcements.publishedAt}, ${announcements.createdAt})`)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql14`count(*)::int` }).from(announcements).where(where)
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize, canManage: manage };
}
async function loadVisibleAnnouncement(ctx, id) {
  if (!z11.uuid().safeParse(id).success) throw deniedRecord("Announcement");
  const [a] = await ctx.db.select().from(announcements).where(eq14(announcements.id, id));
  if (!a) throw deniedRecord("Announcement");
  if (has(ctx.actor, "announcement.manage")) return a;
  if (a.status !== "published" || !isTargetedAt(a, await actorPlacement(ctx))) throw deniedRecord("Announcement");
  return a;
}
async function getAnnouncement(ctx, id) {
  requireActor(ctx);
  const a = await loadVisibleAnnouncement(ctx, id);
  const [author] = await ctx.db.select({ name: users.displayName }).from(users).where(eq14(users.id, a.createdBy));
  return { ...a, authorName: author?.name ?? null, canManage: has(ctx.actor, "announcement.manage") };
}
async function createAnnouncement(ctx, input) {
  requirePerm(ctx, "announcement.manage");
  const body = parse(announcementInput, input);
  const [a] = await ctx.db.insert(announcements).values({ ...body, createdBy: ctx.actor.userId }).returning();
  await audit(ctx.db, ctx, { action: "announcement.create", targetType: "announcement", targetId: a.id, newValues: { title: body.title } });
  return a;
}
async function updateAnnouncement(ctx, id, input) {
  requirePerm(ctx, "announcement.manage");
  const body = parse(announcementInput, input);
  return ctx.db.transaction(async (tx) => {
    const [a] = await tx.select().from(announcements).where(eq14(announcements.id, id));
    if (!a) throw deniedRecord("Announcement");
    if (a.status === "archived") throw conflict("Archived announcements cannot be edited");
    await tx.update(announcements).set({ ...body, updatedAt: ctx.now() }).where(eq14(announcements.id, id));
    const d = diff(a, body);
    await audit(tx, ctx, { action: "announcement.update", targetType: "announcement", targetId: id, oldValues: d.oldValues, newValues: d.newValues });
    return { id };
  });
}
async function setAnnouncementStatus(ctx, id, input) {
  requirePerm(ctx, "announcement.manage");
  const body = parse(z11.object({ status: z11.enum(["draft", "published", "archived"]) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [a] = await tx.select().from(announcements).where(eq14(announcements.id, id));
    if (!a) throw deniedRecord("Announcement");
    const publishing = body.status === "published" && a.status !== "published";
    await tx.update(announcements).set({ status: body.status, publishedAt: publishing ? ctx.now() : a.publishedAt, updatedAt: ctx.now() }).where(eq14(announcements.id, id));
    await audit(tx, ctx, { action: `announcement.${body.status}`, targetType: "announcement", targetId: id, oldValues: { status: a.status }, newValues: { status: body.status } });
    if (publishing) {
      await notify(tx, await audienceUserIds(tx, a), {
        type: "announcement.published",
        title: a.title,
        link: `/announcements/${id}`,
        dedupeKey: `announcement:${id}`
      });
    }
    return { status: body.status };
  });
}
var eventInput = z11.object({
  title: zTrim(200),
  description: z11.string().trim().max(2e4).default(""),
  startsAt: z11.coerce.date(),
  endsAt: z11.coerce.date().nullable().optional(),
  venue: zOptText(200),
  ...targetsSchema
}).strict().refine((e) => !e.endsAt || e.endsAt >= e.startsAt, { message: "End must be after start", path: ["endsAt"] });
async function listEvents(ctx, query) {
  requireActor(ctx);
  const q = parse(zPage.extend({ when: z11.enum(["upcoming", "past", "all"]).default("upcoming"), status: z11.enum(["draft", "published", "completed", "cancelled"]).optional() }), query);
  const manage = has(ctx.actor, "event.manage");
  const conds = [];
  if (manage) {
    if (q.status) conds.push(eq14(events.status, q.status));
  } else {
    conds.push(inArray9(events.status, ["published", "completed", "cancelled"]));
    conds.push(targetSql(events, await actorPlacement(ctx)));
  }
  const now = ctx.now();
  if (q.when === "upcoming") conds.push(gte2(sql14`coalesce(${events.endsAt}, ${events.startsAt})`, now));
  if (q.when === "past") conds.push(sql14`coalesce(${events.endsAt}, ${events.startsAt}) < ${now}`);
  const where = conds.length ? and11(...conds) : void 0;
  const [items, [{ total }]] = await Promise.all([
    ctx.db.select().from(events).where(where).orderBy(q.when === "past" ? desc6(events.startsAt) : asc6(events.startsAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql14`count(*)::int` }).from(events).where(where)
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize, canManage: manage };
}
async function loadVisibleEvent(ctx, id) {
  if (!z11.uuid().safeParse(id).success) throw deniedRecord("Event");
  const [e] = await ctx.db.select().from(events).where(eq14(events.id, id));
  if (!e) throw deniedRecord("Event");
  if (has(ctx.actor, "event.manage")) return e;
  if (e.status === "draft" || !isTargetedAt(e, await actorPlacement(ctx))) throw deniedRecord("Event");
  return e;
}
async function getEvent(ctx, id) {
  requireActor(ctx);
  const e = await loadVisibleEvent(ctx, id);
  return { ...e, canManage: has(ctx.actor, "event.manage") };
}
async function createEvent(ctx, input) {
  requirePerm(ctx, "event.manage");
  const body = parse(eventInput, input);
  const [e] = await ctx.db.insert(events).values({ ...body, endsAt: body.endsAt ?? null, createdBy: ctx.actor.userId }).returning();
  await audit(ctx.db, ctx, { action: "event.create", targetType: "event", targetId: e.id, newValues: { title: body.title, startsAt: body.startsAt } });
  return e;
}
async function updateEvent(ctx, id, input) {
  requirePerm(ctx, "event.manage");
  const body = parse(eventInput, input);
  return ctx.db.transaction(async (tx) => {
    const [e] = await tx.select().from(events).where(eq14(events.id, id));
    if (!e) throw deniedRecord("Event");
    if (["completed", "cancelled"].includes(e.status)) throw conflict("Completed or cancelled events cannot be edited");
    await tx.update(events).set({ ...body, endsAt: body.endsAt ?? null, updatedAt: ctx.now() }).where(eq14(events.id, id));
    const d = diff(e, body);
    await audit(tx, ctx, { action: "event.update", targetType: "event", targetId: id, oldValues: d.oldValues, newValues: d.newValues });
    if (e.status === "published" && d.changed.some((k) => ["startsAt", "endsAt", "venue"].includes(k))) {
      await notify(tx, await audienceUserIds(tx, { ...e, ...body }), {
        type: "event.updated",
        title: `Event updated: ${body.title}`,
        link: `/events/${id}`,
        dedupeKey: `event-update:${id}:${ctx.now().getTime()}`
      });
    }
    return { id };
  });
}
var EVENT_TRANSITIONS = {
  draft: ["published", "cancelled"],
  published: ["completed", "cancelled", "draft"],
  completed: [],
  cancelled: []
};
async function setEventStatus(ctx, id, input) {
  requirePerm(ctx, "event.manage");
  const body = parse(z11.object({ status: z11.enum(["draft", "published", "completed", "cancelled"]) }).strict(), input);
  return ctx.db.transaction(async (tx) => {
    const [e] = await tx.select().from(events).where(eq14(events.id, id));
    if (!e) throw deniedRecord("Event");
    if (!EVENT_TRANSITIONS[e.status].includes(body.status)) throw badRequest(`Cannot change an event from ${e.status} to ${body.status}`);
    await tx.update(events).set({ status: body.status, updatedAt: ctx.now() }).where(eq14(events.id, id));
    await audit(tx, ctx, { action: `event.${body.status}`, targetType: "event", targetId: id, oldValues: { status: e.status }, newValues: { status: body.status } });
    if (body.status === "published" || body.status === "cancelled" && e.status === "published") {
      await notify(tx, await audienceUserIds(tx, e), {
        type: body.status === "published" ? "event.published" : "event.cancelled",
        title: body.status === "published" ? `New event: ${e.title}` : `Event cancelled: ${e.title}`,
        link: `/events/${id}`,
        dedupeKey: `event-${body.status}:${id}`
      });
    }
    return { status: body.status };
  });
}
async function sendEventReminders(tx, now, hours) {
  const upcoming = await tx.select().from(events).where(and11(eq14(events.status, "published"), gte2(events.startsAt, now), sql14`${events.startsAt} <= ${new Date(now.getTime() + hours * 36e5)}`));
  let sent = 0;
  for (const e of upcoming) {
    sent += await notify(tx, await audienceUserIds(tx, e), {
      type: "event.reminder",
      title: `Upcoming event: ${e.title}`,
      body: `Starts ${e.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC${e.venue ? ` at ${e.venue}` : ""}.`,
      link: `/events/${e.id}`,
      dedupeKey: `event-reminder:${e.id}`
    });
  }
  return sent;
}
var targetType = z11.enum(["announcement", "event"]);
var COMMENT_RATE = { perMinute: 5, duplicateWindowMinutes: 10 };
async function loadCommentTarget(ctx, type, id) {
  if (type === "announcement") {
    const a = await loadVisibleAnnouncement(ctx, id);
    return { commentsEnabled: a.commentsEnabled, open: a.status === "published" };
  }
  const e = await loadVisibleEvent(ctx, id);
  return { commentsEnabled: e.commentsEnabled, open: e.status === "published" };
}
async function listComments(ctx, type, id) {
  requireActor(ctx);
  const t = parse(targetType, type);
  await loadCommentTarget(ctx, t, id);
  const moderate = has(ctx.actor, "comment.moderate");
  const rows = await ctx.db.select({ id: comments.id, body: comments.body, status: comments.status, createdAt: comments.createdAt, authorUserId: comments.authorUserId, authorName: users.displayName }).from(comments).innerJoin(users, eq14(users.id, comments.authorUserId)).where(and11(eq14(comments.targetType, t), eq14(comments.targetId, id), moderate ? void 0 : eq14(comments.status, "visible"))).orderBy(asc6(comments.createdAt)).limit(500);
  return rows.map((r) => ({ ...r, mine: r.authorUserId === ctx.actor.userId, canModerate: moderate }));
}
async function createComment(ctx, type, id, input) {
  requirePerm(ctx, "comment.create");
  const t = parse(targetType, type);
  const body = parse(z11.object({ body: zTrim(2e3) }).strict(), input);
  const target = await loadCommentTarget(ctx, t, id);
  if (!target.commentsEnabled || !target.open) throw badRequest("Comments are not enabled here");
  const since = new Date(ctx.now().getTime() - 6e4);
  const [{ recent }] = await ctx.db.select({ recent: sql14`count(*)::int` }).from(comments).where(and11(eq14(comments.authorUserId, ctx.actor.userId), gte2(comments.createdAt, since)));
  if (recent >= COMMENT_RATE.perMinute) throw new AppError(429, "RATE_LIMITED", "You are commenting too quickly. Please wait a moment.");
  const [dup] = await ctx.db.select({ id: comments.id }).from(comments).where(
    and11(
      eq14(comments.authorUserId, ctx.actor.userId),
      eq14(comments.targetId, id),
      eq14(comments.body, body.body),
      gte2(comments.createdAt, new Date(ctx.now().getTime() - COMMENT_RATE.duplicateWindowMinutes * 6e4))
    )
  );
  if (dup) throw conflict("You already posted this comment");
  const [c] = await ctx.db.insert(comments).values({ targetType: t, targetId: id, authorUserId: ctx.actor.userId, body: body.body }).returning();
  return c;
}
async function moderateComment(ctx, commentId, input) {
  requireActor(ctx);
  const body = parse(z11.object({ status: z11.enum(["visible", "hidden"]), reason: zOptText(500) }).strict(), input);
  if (!z11.uuid().safeParse(commentId).success) throw deniedRecord("Comment");
  const [c] = await ctx.db.select().from(comments).where(eq14(comments.id, commentId));
  if (!c) throw deniedRecord("Comment");
  const own = c.authorUserId === ctx.actor.userId;
  if (!has(ctx.actor, "comment.moderate") && !(own && body.status === "hidden")) throw deniedRecord("Comment");
  await loadCommentTarget(ctx, c.targetType, c.targetId);
  await ctx.db.update(comments).set({ status: body.status, moderatedBy: ctx.actor.userId, moderatedAt: ctx.now() }).where(eq14(comments.id, commentId));
  if (!own) await audit(ctx.db, ctx, { action: `comment.${body.status === "hidden" ? "hide" : "restore"}`, targetType: "comment", targetId: commentId, reason: body.reason });
  return { status: body.status };
}

// server/services/documents.ts
import { z as z12 } from "zod";
import crypto2 from "node:crypto";
import { and as and12, desc as desc7, eq as eq15, isNull as isNull8 } from "drizzle-orm";
var SIGNATURES = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 255 && b[1] === 216 && b[2] === 255 }
];
function detectFileType(buf) {
  return SIGNATURES.find((s) => s.test(buf)) ?? null;
}
function safeFilename(name, ext) {
  const base = name.replace(/\.[^.]*$/, "").replace(/[^a-zA-Z0-9 _.-]/g, "_").replace(/\s+/g, " ").trim().slice(0, 100) || "document";
  return `${base}.${ext}`;
}
async function authorizeOwner(ctx, ownerType, ownerId, write) {
  if (ownerType === "employee") {
    const emp = await requireViewableEmployee(ctx, ownerId);
    const access = fieldAccess(ctx.actor, emp);
    if (write ? !access.manageDocuments : !access.documents) throw deniedRecord("Document");
    return;
  }
  await getAnnouncement(ctx, ownerId);
  if (write && !has(ctx.actor, "announcement.manage")) throw deniedRecord("Document");
}
async function uploadDocument(ctx, ownerType, ownerId, file, fields) {
  requireActor(ctx);
  const body = parse(z12.object({ category: z12.enum(["general", "contract", "identity", "qualification", "medical", "attachment"]).default("general") }), fields ?? {});
  if (!file) throw badRequest("No file was uploaded");
  if (file.size > config.maxUploadBytes) throw badRequest(`Files must be smaller than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB`);
  await authorizeOwner(ctx, ownerType, ownerId, true);
  const type = detectFileType(file.buffer);
  if (!type) throw badRequest("Only PDF, PNG and JPEG files are accepted");
  const sha2562 = crypto2.createHash("sha256").update(file.buffer).digest("hex");
  const [doc] = await ctx.db.insert(documents).values({
    ownerType,
    ownerId,
    category: body.category,
    filename: safeFilename(file.originalname, type.ext),
    mimeType: type.mime,
    sizeBytes: file.size,
    sha256: sha2562,
    data: file.buffer,
    uploadedBy: ctx.actor.userId
  }).returning({ id: documents.id, filename: documents.filename });
  await audit(ctx.db, ctx, { action: "document.upload", targetType: ownerType, targetId: ownerId, newValues: { documentId: doc.id, filename: doc.filename, sizeBytes: file.size, sha256: sha2562 } });
  return doc;
}
async function listDocuments(ctx, ownerType, ownerId) {
  requireActor(ctx);
  await authorizeOwner(ctx, ownerType, ownerId, false);
  return ctx.db.select({
    id: documents.id,
    filename: documents.filename,
    mimeType: documents.mimeType,
    sizeBytes: documents.sizeBytes,
    category: documents.category,
    createdAt: documents.createdAt,
    uploadedByName: users.displayName
  }).from(documents).leftJoin(users, eq15(users.id, documents.uploadedBy)).where(and12(eq15(documents.ownerType, ownerType), eq15(documents.ownerId, ownerId), isNull8(documents.archivedAt))).orderBy(desc7(documents.createdAt));
}
async function downloadDocument(ctx, id) {
  requireActor(ctx);
  if (!z12.uuid().safeParse(id).success) throw deniedRecord("Document");
  const [doc] = await ctx.db.select().from(documents).where(and12(eq15(documents.id, id), isNull8(documents.archivedAt)));
  if (!doc) throw deniedRecord("Document");
  await authorizeOwner(ctx, doc.ownerType, doc.ownerId, false);
  if (doc.ownerType === "employee") {
    await audit(ctx.db, ctx, { action: "document.download", targetType: "employee", targetId: doc.ownerId, newValues: { documentId: id } });
  }
  return doc;
}
async function archiveDocument(ctx, id) {
  requireActor(ctx);
  if (!z12.uuid().safeParse(id).success) throw deniedRecord("Document");
  const [doc] = await ctx.db.select().from(documents).where(eq15(documents.id, id));
  if (!doc || doc.archivedAt) throw deniedRecord("Document");
  await authorizeOwner(ctx, doc.ownerType, doc.ownerId, true);
  await ctx.db.update(documents).set({ archivedAt: ctx.now() }).where(eq15(documents.id, id));
  await audit(ctx.db, ctx, { action: "document.archive", targetType: doc.ownerType, targetId: doc.ownerId, newValues: { documentId: id } });
  return { archived: true };
}

// server/services/auditLog.ts
import { z as z13 } from "zod";
import { and as and13, desc as desc8, eq as eq16, gte as gte3, ilike as ilike4, lte as lte2, sql as sql15 } from "drizzle-orm";
var auditQuery = zPage.extend({
  actorUserId: z13.uuid().optional(),
  action: z13.string().trim().max(80).optional(),
  targetType: z13.string().trim().max(40).optional(),
  targetId: z13.string().trim().max(64).optional(),
  outcome: z13.enum(["success", "denied", "failure"]).optional(),
  from: zDate.optional(),
  to: zDate.optional()
});
function whereFor(q) {
  const conds = [];
  if (q.actorUserId) conds.push(eq16(auditLogs.actorUserId, q.actorUserId));
  if (q.action) conds.push(ilike4(auditLogs.action, `${q.action.replace(/[%_\\]/g, "\\$&")}%`));
  if (q.targetType) conds.push(eq16(auditLogs.targetType, q.targetType));
  if (q.targetId) conds.push(eq16(auditLogs.targetId, q.targetId));
  if (q.outcome) conds.push(eq16(auditLogs.outcome, q.outcome));
  if (q.from) conds.push(gte3(auditLogs.occurredAt, /* @__PURE__ */ new Date(`${q.from}T00:00:00Z`)));
  if (q.to) conds.push(lte2(auditLogs.occurredAt, /* @__PURE__ */ new Date(`${q.to}T23:59:59.999Z`)));
  return conds.length ? and13(...conds) : void 0;
}
async function searchAudit(ctx, query) {
  requirePerm(ctx, "audit.read");
  const q = parse(auditQuery, query);
  const where = whereFor(q);
  const [items, [{ total }]] = await Promise.all([
    ctx.db.select({ log: auditLogs, actorName: users.displayName, actorUsername: users.username }).from(auditLogs).leftJoin(users, eq16(users.id, auditLogs.actorUserId)).where(where).orderBy(desc8(auditLogs.occurredAt), desc8(auditLogs.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
    ctx.db.select({ total: sql15`count(*)::int` }).from(auditLogs).where(where)
  ]);
  const { page, pageSize, ...filters } = q;
  await audit(ctx.db, ctx, { action: "audit.view", targetType: "audit_log", newValues: { filters, page } });
  return { items: items.map((r) => ({ ...r.log, actorName: r.actorName, actorUsername: r.actorUsername })), total, page, pageSize };
}
async function exportAuditCsv(ctx, query) {
  requirePerm(ctx, "audit.read");
  const q = parse(auditQuery.omit({ page: true, pageSize: true }), query);
  const where = whereFor({ ...q, page: 1, pageSize: 1 });
  const rows = await ctx.db.select({ log: auditLogs, actorUsername: users.username }).from(auditLogs).leftJoin(users, eq16(users.id, auditLogs.actorUserId)).where(where).orderBy(desc8(auditLogs.occurredAt)).limit(5e4);
  await audit(ctx.db, ctx, { action: "audit.export", targetType: "audit_log", newValues: { filters: q, rows: rows.length } });
  return toCsv(
    ["Time", "Actor", "Action", "Outcome", "Target type", "Target id", "Reason", "Approval", "Request", "IP", "Old values", "New values"],
    rows.map(({ log, actorUsername }) => [
      log.occurredAt,
      actorUsername ?? log.actorUserId ?? "system",
      log.action,
      log.outcome,
      log.targetType,
      log.targetId,
      log.reason,
      log.approvalId,
      log.requestId,
      log.ip,
      log.oldValues ? JSON.stringify(log.oldValues) : "",
      log.newValues ? JSON.stringify(log.newValues) : ""
    ])
  );
}

// server/services/reports.ts
import { z as z14 } from "zod";
import { and as and14, desc as desc9, eq as eq17, gte as gte4, inArray as inArray10, sql as sql16 } from "drizzle-orm";
var REPORTS = {
  headcount: { title: "Employee headcount by status", perm: ["report.org"] },
  departments: { title: "Department distribution", perm: ["report.org", "report.finance"] },
  locations: { title: "Location distribution", perm: ["report.org", "report.finance"] },
  onboarding: { title: "Recruitment and onboarding (last 12 months)", perm: ["report.org"] },
  movements: { title: "Transfers and promotions (last 12 months)", perm: ["report.org"] },
  retirement: { title: "Retirement schedule", perm: ["retirement.read"] },
  approvals: { title: "Pending approvals", perm: ["report.org", "approval.read"] },
  activity: { title: "Administrative activity (last 30 days)", perm: ["audit.read"] },
  payroll: { title: "Payroll summary by period", perm: ["report.finance"] }
};
var CURRENT = sql16`${employees.archivedAt} is null and ${employees.employmentStatus} in ('active','on_leave','suspended')`;
async function build(ctx, name) {
  const title = REPORTS[name].title;
  const since12 = new Date(ctx.now().getTime() - 365 * 24 * 36e5);
  switch (name) {
    case "headcount": {
      const rows = await ctx.db.select({ status: employees.employmentStatus, archived: sql16`${employees.archivedAt} is not null`, n: sql16`count(*)::int` }).from(employees).groupBy(employees.employmentStatus, sql16`${employees.archivedAt} is not null`).orderBy(employees.employmentStatus);
      return { title, columns: ["Status", "Archived", "Employees"], rows: rows.map((r) => [r.status, r.archived ? "yes" : "no", r.n]) };
    }
    case "departments": {
      const rows = await ctx.db.select({ code: departments.code, name: departments.name, n: sql16`count(${employees.id}) filter (where ${CURRENT})::int` }).from(departments).leftJoin(employees, eq17(employees.departmentId, departments.id)).groupBy(departments.id, departments.code, departments.name).orderBy(departments.name);
      return { title, columns: ["Code", "Department", "Current employees"], rows: rows.map((r) => [r.code, r.name, r.n]) };
    }
    case "locations": {
      const rows = await ctx.db.select({ name: sql16`coalesce(${workLocations.name}, 'Unassigned')`, n: sql16`count(*)::int` }).from(employees).leftJoin(workLocations, eq17(workLocations.id, employees.locationId)).where(CURRENT).groupBy(workLocations.name).orderBy(workLocations.name);
      return { title, columns: ["Location", "Current employees"], rows: rows.map((r) => [r.name, r.n]) };
    }
    case "onboarding": {
      const rows = await ctx.db.select({
        month: sql16`to_char(date_trunc('month', ${employees.createdAt}), 'YYYY-MM')`,
        registered: sql16`count(*)::int`,
        verified: sql16`count(*) filter (where ${employees.verifiedAt} is not null)::int`,
        pending: sql16`count(*) filter (where ${employees.employmentStatus} = 'pending_verification')::int`,
        rejected: sql16`count(*) filter (where ${employees.employmentStatus} = 'rejected')::int`
      }).from(employees).where(gte4(employees.createdAt, since12)).groupBy(sql16`1`).orderBy(sql16`1`);
      return { title, columns: ["Month", "New records", "Verified", "Pending", "Rejected"], rows: rows.map((r) => [r.month, r.registered, r.verified, r.pending, r.rejected]) };
    }
    case "movements": {
      const rows = await ctx.db.select({ month: sql16`to_char(date_trunc('month', ${employmentHistory.createdAt}), 'YYYY-MM')`, type: employmentHistory.changeType, n: sql16`count(*)::int` }).from(employmentHistory).where(and14(gte4(employmentHistory.createdAt, since12), inArray10(employmentHistory.changeType, ["transfer", "grade_change", "title_change", "location_change", "supervisor_change"]))).groupBy(sql16`1`, employmentHistory.changeType).orderBy(sql16`1`);
      return { title, columns: ["Month", "Change type", "Count"], rows: rows.map((r) => [r.month, r.type, r.n]) };
    }
    case "retirement": {
      const rows = await ctx.db.select({ number: employees.employmentNumber, name: employees.legalName, dept: departments.name, expected: retirementReviews.expectedRetirementDate, deferred: retirementReviews.deferredUntil, status: retirementReviews.status }).from(retirementReviews).innerJoin(employees, eq17(employees.id, retirementReviews.employeeId)).innerJoin(departments, eq17(departments.id, employees.departmentId)).orderBy(retirementReviews.expectedRetirementDate);
      return { title, columns: ["Employment number", "Name", "Department", "Expected retirement", "Deferred until", "Status"], rows: rows.map((r) => [r.number, r.name, r.dept, r.expected, r.deferred, r.status]) };
    }
    case "approvals": {
      const rows = await ctx.db.select({ type: approvalRequests.type, n: sql16`count(*)::int`, oldest: sql16`min(${approvalRequests.requestedAt})::text` }).from(approvalRequests).where(and14(eq17(approvalRequests.status, "pending"), inArray10(approvalRequests.requiredPermission, [...ctx.actor.permissions]))).groupBy(approvalRequests.type);
      return { title, columns: ["Type", "Pending", "Oldest request"], rows: rows.map((r) => [r.type, r.n, r.oldest?.slice(0, 16) ?? null]) };
    }
    case "activity": {
      const rows = await ctx.db.select({ actor: sql16`coalesce(${users.username}, 'system')`, action: auditLogs.action, n: sql16`count(*)::int` }).from(auditLogs).leftJoin(users, eq17(users.id, auditLogs.actorUserId)).where(and14(gte4(auditLogs.occurredAt, new Date(ctx.now().getTime() - 30 * 24 * 36e5)), sql16`${auditLogs.action} not like 'audit.view%'`)).groupBy(sql16`1`, auditLogs.action).orderBy(desc9(sql16`3`)).limit(500);
      return { title, columns: ["Actor", "Action", "Count"], rows: rows.map((r) => [r.actor, r.action, r.n]) };
    }
    case "payroll": {
      const rows = await ctx.db.select({
        code: payrollPeriods.code,
        name: payrollPeriods.name,
        status: payrollPeriods.status,
        records: sql16`count(${payrollRecords.id}) filter (where ${payrollRecords.status} = 'approved')::int`,
        gross: sql16`coalesce(sum(${payrollRecords.grossEarnings}) filter (where ${payrollRecords.status} = 'approved'),0)`,
        deductions: sql16`coalesce(sum(${payrollRecords.totalDeductions}) filter (where ${payrollRecords.status} = 'approved'),0)`,
        net: sql16`coalesce(sum(${payrollRecords.netPay}) filter (where ${payrollRecords.status} = 'approved'),0)`
      }).from(payrollPeriods).leftJoin(payrollRecords, eq17(payrollRecords.periodId, payrollPeriods.id)).groupBy(payrollPeriods.id, payrollPeriods.code, payrollPeriods.name, payrollPeriods.status).orderBy(desc9(payrollPeriods.startDate));
      const cur = await getSetting(ctx.db, "org.currency");
      return {
        title,
        columns: ["Period", "Name", "Status", "Approved records", `Gross (${cur})`, `Deductions (${cur})`, `Net (${cur})`],
        rows: rows.map((r) => [r.code, r.name, r.status, r.records, minorToDecimal(Number(r.gross)), minorToDecimal(Number(r.deductions)), minorToDecimal(Number(r.net))])
      };
    }
    default:
      throw badRequest("Unknown report");
  }
}
async function getReport(ctx, name, query) {
  requireActor(ctx);
  const { format } = parse(z14.object({ format: z14.enum(["json", "csv"]).default("json") }), query);
  const def = REPORTS[name];
  if (!def) throw badRequest("Unknown report");
  requirePerm(ctx, ...def.perm);
  const report = await build(ctx, name);
  if (format === "csv") {
    await audit(ctx.db, ctx, { action: "report.export", targetType: "report", targetId: name, newValues: { rows: report.rows.length } });
    return { csv: toCsv(report.columns, report.rows) };
  }
  return report;
}
function availableReports(ctx) {
  requireActor(ctx);
  return Object.entries(REPORTS).filter(([, d]) => d.perm.some((p2) => has(ctx.actor, p2))).map(([key, d]) => ({ key, title: d.title }));
}
async function dashboard(ctx) {
  requireActor(ctx);
  const a = ctx.actor;
  const out = {};
  if (a.employeeId) {
    const [me2] = await ctx.db.select({ legalName: employees.legalName, employmentNumber: employees.employmentNumber, status: employees.employmentStatus, departmentName: departments.name, employmentDate: employees.employmentDate }).from(employees).innerJoin(departments, eq17(departments.id, employees.departmentId)).where(eq17(employees.id, a.employeeId));
    out.me = me2 ?? null;
  }
  if (canSeeOthers(a)) {
    const vis = employeeVisibilitySql(a);
    const [counts] = await ctx.db.select({
      current: sql16`count(*) filter (where ${CURRENT})::int`,
      pending: sql16`count(*) filter (where ${employees.employmentStatus} = 'pending_verification')::int`,
      onLeave: sql16`count(*) filter (where ${employees.employmentStatus} = 'on_leave' and ${employees.archivedAt} is null)::int`
    }).from(employees).where(vis);
    const byDept = await ctx.db.select({ name: departments.name, n: sql16`count(*)::int` }).from(employees).innerJoin(departments, eq17(departments.id, employees.departmentId)).where(and14(vis, CURRENT)).groupBy(departments.name).orderBy(departments.name);
    out.workforce = { ...counts, byDepartment: byDept, scoped: !has(a, "employee.read.all") };
  }
  const approvals = await listApprovals(ctx, { status: "pending", pageSize: 50 });
  out.approvals = {
    toDecide: approvals.items.filter((i) => i.canDecide).length,
    mine: approvals.items.filter((i) => i.requestedBy === a.userId).length,
    items: approvals.items.filter((i) => i.canDecide).slice(0, 5).map((i) => ({ id: i.id, type: i.type, summary: i.summary, requestedAt: i.requestedAt }))
  };
  if (has(a, "retirement.read")) {
    const rows = await ctx.db.select({ id: retirementReviews.id, status: retirementReviews.status, expected: retirementReviews.expectedRetirementDate, name: employees.legalName }).from(retirementReviews).innerJoin(employees, eq17(employees.id, retirementReviews.employeeId)).where(inArray10(retirementReviews.status, ["upcoming", "review_required", "pending_approval", "approved", "deferred"])).orderBy(retirementReviews.expectedRetirementDate).limit(5);
    const [c] = await ctx.db.select({
      reviewRequired: sql16`count(*) filter (where ${retirementReviews.status} = 'review_required')::int`,
      pendingApproval: sql16`count(*) filter (where ${retirementReviews.status} = 'pending_approval')::int`,
      upcoming: sql16`count(*) filter (where ${retirementReviews.status} = 'upcoming')::int`
    }).from(retirementReviews);
    out.retirement = { ...c, next: rows };
  }
  if (has(a, "payroll.read")) {
    const [period] = await ctx.db.select().from(payrollPeriods).orderBy(desc9(payrollPeriods.startDate)).limit(1);
    if (period) {
      const rows = await ctx.db.select({ status: payrollRecords.status, n: sql16`count(*)::int`, net: sql16`coalesce(sum(${payrollRecords.netPay}),0)` }).from(payrollRecords).where(and14(eq17(payrollRecords.periodId, period.id), inArray10(payrollRecords.status, ["draft", "pending_approval", "approved"]))).groupBy(payrollRecords.status);
      out.payroll = {
        period: { id: period.id, name: period.name, status: period.status },
        byStatus: Object.fromEntries(rows.map((r) => [r.status, r.n])),
        net: rows.reduce((s, r) => s + Number(r.net), 0),
        currency: await getSetting(ctx.db, "org.currency")
      };
    } else out.payroll = { period: null };
  }
  if (has(a, "audit.read")) {
    const since = new Date(ctx.now().getTime() - 7 * 24 * 36e5);
    const [sec] = await ctx.db.select({
      failedLogins: sql16`count(*) filter (where ${auditLogs.action} in ('auth.login','auth.mfa') and ${auditLogs.outcome} = 'failure')::int`,
      denied: sql16`count(*) filter (where ${auditLogs.outcome} = 'denied')::int`,
      roleChanges: sql16`count(*) filter (where ${auditLogs.action} in ('role.change','permission.grant','permission.revoke','scope.change'))::int`
    }).from(auditLogs).where(gte4(auditLogs.occurredAt, since));
    const recent = await ctx.db.select({ id: auditLogs.id, action: auditLogs.action, outcome: auditLogs.outcome, occurredAt: auditLogs.occurredAt, actor: users.username }).from(auditLogs).leftJoin(users, eq17(users.id, auditLogs.actorUserId)).where(and14(gte4(auditLogs.occurredAt, since), sql16`(${auditLogs.outcome} <> 'success' or ${auditLogs.action} like 'role.%' or ${auditLogs.action} like 'security.%' or ${auditLogs.action} like 'user.%')`)).orderBy(desc9(auditLogs.occurredAt)).limit(8);
    out.security = { ...sec, recent };
  }
  const [ann, evs] = await Promise.all([listAnnouncements(ctx, { status: "published", pageSize: 3 }), listEvents(ctx, { when: "upcoming", status: "published", pageSize: 3 })]);
  out.announcements = ann.items;
  out.events = evs.items;
  return out;
}

// server/services/jobs.ts
import { and as and15, eq as eq18, inArray as inArray11, isNull as isNull9, isNotNull as isNotNull2, lte as lte3, gte as gte5, sql as sql17 } from "drizzle-orm";
async function once(db, jobName, runKey, fn, force = false) {
  const claimed = force ? [{ id: "forced" }] : await db.insert(jobRuns).values({ jobName, runKey }).onConflictDoNothing().returning({ id: jobRuns.id });
  if (!claimed.length) return { jobName, skipped: true };
  try {
    const details = await fn();
    if (!force) await db.update(jobRuns).set({ status: "success", finishedAt: /* @__PURE__ */ new Date(), details }).where(eq18(jobRuns.id, claimed[0].id));
    return { jobName, skipped: false, details };
  } catch (err) {
    if (!force) {
      await db.delete(jobRuns).where(eq18(jobRuns.id, claimed[0].id));
    }
    throw err;
  }
}
async function contractExpiryNotices(db, now, days) {
  const today = todayIso(now);
  const horizon = addDays(today, days);
  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: employees.id, legalName: employees.legalName, userId: employees.userId, contractEndDate: employees.contractEndDate }).from(employees).where(
      and15(
        isNull9(employees.archivedAt),
        inArray11(employees.employmentStatus, ["active", "on_leave"]),
        isNotNull2(employees.contractEndDate),
        gte5(employees.contractEndDate, today),
        lte3(employees.contractEndDate, horizon)
      )
    );
    const managers = await usersWithPermission(tx, "employee.update.all");
    let sent = 0;
    for (const r of rows) {
      sent += await notify(tx, managers, {
        type: "contract.expiring",
        title: `Contract ending soon: ${r.legalName}`,
        body: `Contract end date ${r.contractEndDate}.`,
        link: `/employees/${r.id}`,
        dedupeKey: `contract-expiry:${r.id}:${r.contractEndDate}`
      });
      sent += await notify(tx, [r.userId], {
        type: "contract.expiring",
        title: "Your contract end date is approaching",
        body: `Your contract is due to end on ${r.contractEndDate}.`,
        link: "/profile",
        dedupeKey: `contract-expiry-self:${r.id}:${r.contractEndDate}`
      });
    }
    return sent;
  });
}
async function profileCompletionNotices(db) {
  return db.transaction(async (tx) => {
    const rows = await tx.select({ id: employees.id, userId: employees.userId, phone: employees.phone, nok: nextOfKin.id }).from(employees).leftJoin(nextOfKin, eq18(nextOfKin.employeeId, employees.id)).where(and15(isNull9(employees.archivedAt), eq18(employees.employmentStatus, "active"), isNotNull2(employees.userId), sql17`(${employees.phone} is null or ${nextOfKin.id} is null)`));
    let sent = 0;
    for (const r of rows) {
      sent += await notify(tx, [r.userId], {
        type: "profile.incomplete",
        title: "Please complete your profile",
        body: !r.nok ? "Add your next-of-kin details." : "Add a contact phone number.",
        link: "/profile",
        dedupeKey: `profile-incomplete:${r.id}`
      });
    }
    return sent;
  });
}
async function runScheduledJobs(db, now = /* @__PURE__ */ new Date(), opts = {}) {
  const day = todayIso(now);
  const hour = now.toISOString().slice(0, 13);
  const settings = await getSettings(db);
  const results = [];
  results.push(await once(db, "retirement_scan", day, () => runRetirementScan(db, now), opts.force));
  results.push(
    await once(db, "event_reminders", hour, async () => ({ sent: await db.transaction((tx) => sendEventReminders(tx, now, settings["notifications.event_reminder_hours"])) }), opts.force)
  );
  results.push(await once(db, "contract_expiry", day, async () => ({ sent: await contractExpiryNotices(db, now, settings["notifications.contract_expiry_days"]) }), opts.force));
  results.push(await once(db, "profile_completion", day, async () => ({ sent: await profileCompletionNotices(db) }), opts.force));
  return results;
}

// server/routes.ts
var h = (fn) => async (req, res) => {
  const result = await fn(req.ctx, req, res);
  if (!res.headersSent) res.json(result ?? { ok: true });
};
var csv = (filename, fn) => async (req, res) => {
  const body = await fn(req.ctx, req);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(body);
};
var p = (req, name) => String(req.params[name]);
function setSession(res, session) {
  res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions());
}
function buildRouter(opts) {
  const r = Router();
  const limiter = (windowMinutes, limit) => opts.disableRateLimit ? (_req, _res, next) => next() : rateLimit({
    windowMs: windowMinutes * 6e4,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down and try again shortly." } });
    }
  });
  const authLimit = limiter(15, 20);
  const registerLimit = limiter(60, 10);
  const sensitiveLimit = limiter(15, 15);
  r.use(limiter(15, 1500));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1 } });
  r.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  r.get("/public/lookups", h((ctx) => publicLookups(ctx)));
  r.get(
    "/public/info",
    h(async (ctx) => {
      const s = await getSettings(ctx.db);
      return { orgName: s["org.name"], registrationOpen: s["registration.open"] };
    })
  );
  r.get("/health", h(() => ({ status: "ok" })));
  r.get("/auth/csrf", h(() => ({ ok: true })));
  r.post(
    "/auth/register",
    registerLimit,
    h(async (ctx, req, res) => {
      const result = await register(ctx, req.body);
      setSession(res, result.session);
      return { ok: true, employeeId: result.employeeId };
    })
  );
  r.post(
    "/auth/login",
    authLimit,
    h(async (ctx, req, res) => {
      const result = await login(ctx, req.body);
      setSession(res, result.session);
      return { ok: true, mfaRequired: result.mfaRequired };
    })
  );
  r.post(
    "/auth/mfa/verify",
    authLimit,
    h(async (ctx, req, res) => {
      const result = await verifyMfaLogin(ctx, req.loaded, req.body);
      setSession(res, result.session);
      return { ok: true };
    })
  );
  r.post(
    "/auth/logout",
    h(async (ctx, req, res) => {
      await logout(ctx, req.loaded?.session.id);
      res.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    })
  );
  r.get("/auth/me", h((ctx) => me(ctx)));
  r.post("/auth/reauth", sensitiveLimit, h((ctx, req) => reauthenticate(ctx, req.body)));
  r.post("/auth/password", sensitiveLimit, h((ctx, req) => changePassword(ctx, req.body)));
  r.post("/auth/mfa/setup", sensitiveLimit, h((ctx) => mfaSetup(ctx)));
  r.post("/auth/mfa/enable", sensitiveLimit, h((ctx, req) => mfaEnable(ctx, req.body)));
  r.post("/auth/mfa/disable", sensitiveLimit, h((ctx) => mfaDisable(ctx)));
  r.get("/auth/invitations/:token", authLimit, h((ctx, req) => getInvitation(ctx, p(req, "token"))));
  r.post(
    "/auth/invitations/:token/accept",
    registerLimit,
    h(async (ctx, req, res) => {
      const result = await acceptInvitation(ctx, p(req, "token"), req.body);
      setSession(res, result.session);
      return { ok: true };
    })
  );
  r.get("/dashboard", h((ctx) => dashboard(ctx)));
  r.get("/lookups", h((ctx) => lookups(ctx)));
  r.get("/employees", h((ctx, req) => listEmployees(ctx, req.query)));
  r.get("/employees/options", h((ctx, req) => employeeOptions(ctx, req.query)));
  r.get("/employees/export.csv", csv("employees.csv", (ctx, req) => exportEmployeesCsv(ctx, req.query)));
  r.post("/employees", h((ctx, req) => createEmployee(ctx, req.body)));
  r.get("/employees/:id", h((ctx, req) => getEmployee(ctx, p(req, "id"))));
  r.patch("/employees/:id", h((ctx, req) => updateEmployee(ctx, p(req, "id"), req.body)));
  r.post("/employees/:id/verify", h((ctx, req) => verifyRegistration(ctx, p(req, "id"), req.body)));
  r.post("/employees/:id/corrections", h((ctx, req) => requestCorrection(ctx, p(req, "id"), req.body)));
  r.post("/employees/:id/archive", h((ctx, req) => archiveEmployee(ctx, p(req, "id"), req.body)));
  r.post("/employees/:id/restore", h((ctx, req) => restoreEmployee(ctx, p(req, "id"), req.body)));
  r.post("/employees/:id/invite", h((ctx, req) => inviteEmployee(ctx, p(req, "id"), req.body)));
  r.get("/employees/:id/history", h((ctx, req) => getEmploymentHistory(ctx, p(req, "id"))));
  r.get("/employees/:id/payroll", h((ctx, req) => employeePayroll(ctx, p(req, "id"))));
  r.get("/employees/:id/retirement", h((ctx, req) => employeeRetirement(ctx, p(req, "id"))));
  r.get("/employees/:id/approvals", h((ctx, req) => listApprovals(ctx, { status: "all", targetId: p(req, "id"), pageSize: 50 })));
  r.get(
    "/employees/:id/audit",
    h(async (ctx, req) => {
      requirePerm(ctx, "audit.read");
      return searchAudit(ctx, { targetType: "employee", targetId: p(req, "id"), pageSize: 100 });
    })
  );
  r.get("/employees/:id/documents", h((ctx, req) => listDocuments(ctx, "employee", p(req, "id"))));
  r.post("/employees/:id/documents", upload.single("file"), h((ctx, req) => uploadDocument(ctx, "employee", p(req, "id"), req.file, req.body)));
  r.get("/documents/:id/download", async (req, res) => {
    const doc = await downloadDocument(req.ctx, p(req, "id"));
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Length", String(doc.sizeBytes));
    res.setHeader("Content-Disposition", `attachment; filename="${doc.filename.replace(/"/g, "")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.send(doc.data);
  });
  r.delete("/documents/:id", h((ctx, req) => archiveDocument(ctx, p(req, "id"))));
  r.get("/departments", h((ctx) => listDepartments(ctx)));
  r.post("/departments", h((ctx, req) => createDepartment(ctx, req.body)));
  r.put("/departments/:id", h((ctx, req) => updateDepartment(ctx, p(req, "id"), req.body)));
  r.get("/locations", h((ctx) => listLocations(ctx)));
  r.post("/locations", h((ctx, req) => createLocation(ctx, req.body)));
  r.put("/locations/:id", h((ctx, req) => updateLocation(ctx, p(req, "id"), req.body)));
  r.get("/job-titles", h((ctx) => listJobTitles(ctx)));
  r.post("/job-titles", h((ctx, req) => upsertJobTitle(ctx, null, req.body)));
  r.put("/job-titles/:id", h((ctx, req) => upsertJobTitle(ctx, p(req, "id"), req.body)));
  r.get("/grades", h((ctx) => listGrades(ctx)));
  r.post("/grades", h((ctx, req) => upsertGrade(ctx, null, req.body)));
  r.put("/grades/:id", h((ctx, req) => upsertGrade(ctx, p(req, "id"), req.body)));
  r.get("/users", h((ctx, req) => listUsers(ctx, req.query)));
  r.get("/users/:id", h((ctx, req) => getUser(ctx, p(req, "id"))));
  r.put("/users/:id/roles", sensitiveLimit, h((ctx, req) => setUserRoles(ctx, p(req, "id"), req.body)));
  r.post("/users/:id/grants", sensitiveLimit, h((ctx, req) => addGrant(ctx, p(req, "id"), req.body)));
  r.delete("/users/:id/grants/:perm", sensitiveLimit, h((ctx, req) => removeGrant(ctx, p(req, "id"), p(req, "perm"), req.body)));
  r.put("/users/:id/scopes", h((ctx, req) => setModeratorScopes(ctx, p(req, "id"), req.body)));
  r.post("/users/:id/status", sensitiveLimit, h((ctx, req) => setUserStatus(ctx, p(req, "id"), req.body)));
  r.post("/users/:id/recovery", sensitiveLimit, h((ctx, req) => recoverAccess(ctx, p(req, "id"), req.body)));
  r.get("/approvals", h((ctx, req) => listApprovals(ctx, req.query)));
  r.post("/approvals/:id/decide", h((ctx, req) => decideApproval(ctx, p(req, "id"), req.body)));
  r.post("/approvals/:id/cancel", h((ctx, req) => cancelApproval(ctx, p(req, "id"))));
  r.get("/payroll/summary", h((ctx, req) => financeSummary(ctx, req.query)));
  r.get("/payroll/periods", h((ctx) => listPeriods(ctx)));
  r.post("/payroll/periods", h((ctx, req) => createPeriod(ctx, req.body)));
  r.post("/payroll/periods/:id/close", h((ctx, req) => closePeriod(ctx, p(req, "id"), req.body)));
  r.get("/payroll/periods/:id/records", h((ctx, req) => listRecords(ctx, p(req, "id"), req.query)));
  r.post("/payroll/periods/:id/generate-drafts", h((ctx, req) => generateDrafts(ctx, p(req, "id"))));
  r.post("/payroll/periods/:id/payslips", h((ctx, req) => issuePayslipsForPeriod(ctx, p(req, "id"))));
  r.get("/payroll/periods/:id/export.csv", csv("payroll.csv", (ctx, req) => exportPeriodCsv(ctx, p(req, "id"))));
  r.post("/payroll/records", h((ctx, req) => createRecord(ctx, req.body)));
  r.get("/payroll/records/:id", h((ctx, req) => getRecord(ctx, p(req, "id"))));
  r.put("/payroll/records/:id", h((ctx, req) => updateRecord(ctx, p(req, "id"), req.body)));
  r.delete("/payroll/records/:id", h((ctx, req) => deleteDraft(ctx, p(req, "id"))));
  r.post("/payroll/records/:id/submit", h((ctx, req) => submitRecord(ctx, p(req, "id"))));
  r.post("/payroll/records/:id/approve", h((ctx, req) => approveRecord(ctx, p(req, "id"), req.body)));
  r.post("/payroll/records/:id/reject", h((ctx, req) => rejectRecord(ctx, p(req, "id"), req.body)));
  r.post("/payroll/records/:id/adjust", h((ctx, req) => adjustRecord(ctx, p(req, "id"), req.body)));
  r.post("/payroll/records/:id/mark-paid", h((ctx, req) => markPaid(ctx, p(req, "id"), req.body)));
  r.post("/payroll/records/:id/payslip", h((ctx, req) => issuePayslip(ctx, p(req, "id"))));
  r.get("/payslips/:id", h((ctx, req) => getPayslip(ctx, p(req, "id"))));
  r.get(
    "/me/payroll",
    h(async (ctx) => ctx.actor?.employeeId ? employeePayroll(ctx, ctx.actor.employeeId) : [])
  );
  r.get("/retirement/reviews", h((ctx, req) => listReviews(ctx, req.query)));
  r.get("/retirement/reviews/:id", h((ctx, req) => getReview(ctx, p(req, "id"))));
  r.post("/retirement/reviews/:id/settlements", h((ctx, req) => createSettlement(ctx, p(req, "id"), req.body)));
  r.post("/retirement/reviews/:id/decision", h((ctx, req) => decideReview(ctx, p(req, "id"), req.body)));
  r.post("/retirement/reviews/:id/complete", h((ctx, req) => completeRetirement(ctx, p(req, "id"), req.body)));
  r.put("/retirement/settlements/:id", h((ctx, req) => updateSettlement(ctx, p(req, "id"), req.body)));
  r.post("/retirement/settlements/:id/submit", h((ctx, req) => submitSettlement(ctx, p(req, "id"))));
  r.post("/retirement/settlements/:id/verify", h((ctx, req) => verifySettlement(ctx, p(req, "id"), req.body)));
  r.get("/retirement/policies", h((ctx) => listPolicies(ctx)));
  r.post("/retirement/policies", h((ctx, req) => createPolicy(ctx, req.body)));
  r.put("/retirement/policies/:id", h((ctx, req) => updatePolicy(ctx, p(req, "id"), req.body)));
  r.post("/retirement/policies/:id/adopt", sensitiveLimit, h((ctx, req) => adoptPolicy(ctx, p(req, "id"), req.body)));
  r.post("/retirement/policies/:id/end", sensitiveLimit, h((ctx, req) => endPolicy(ctx, p(req, "id"), req.body)));
  r.get("/retirement/export.csv", csv("retirement.csv", (ctx) => exportRetirementCsv(ctx)));
  r.get("/announcements", h((ctx, req) => listAnnouncements(ctx, req.query)));
  r.post("/announcements", h((ctx, req) => createAnnouncement(ctx, req.body)));
  r.get("/announcements/:id", h((ctx, req) => getAnnouncement(ctx, p(req, "id"))));
  r.put("/announcements/:id", h((ctx, req) => updateAnnouncement(ctx, p(req, "id"), req.body)));
  r.post("/announcements/:id/status", h((ctx, req) => setAnnouncementStatus(ctx, p(req, "id"), req.body)));
  r.get("/announcements/:id/documents", h((ctx, req) => listDocuments(ctx, "announcement", p(req, "id"))));
  r.post("/announcements/:id/documents", upload.single("file"), h((ctx, req) => uploadDocument(ctx, "announcement", p(req, "id"), req.file, { category: "attachment" })));
  r.get("/events", h((ctx, req) => listEvents(ctx, req.query)));
  r.post("/events", h((ctx, req) => createEvent(ctx, req.body)));
  r.get("/events/:id", h((ctx, req) => getEvent(ctx, p(req, "id"))));
  r.put("/events/:id", h((ctx, req) => updateEvent(ctx, p(req, "id"), req.body)));
  r.post("/events/:id/status", h((ctx, req) => setEventStatus(ctx, p(req, "id"), req.body)));
  r.get("/comments/:type/:id", h((ctx, req) => listComments(ctx, p(req, "type"), p(req, "id"))));
  r.post("/comments/:type/:id", h((ctx, req) => createComment(ctx, p(req, "type"), p(req, "id"), req.body)));
  r.patch("/comments/:id", h((ctx, req) => moderateComment(ctx, p(req, "id"), req.body)));
  r.get("/notifications", h((ctx, req) => listNotifications(ctx, req.query)));
  r.post("/notifications/read", h((ctx, req) => markRead(ctx, req.body)));
  r.get("/audit", h((ctx, req) => searchAudit(ctx, req.query)));
  r.get("/audit/export.csv", csv("audit-log.csv", (ctx, req) => exportAuditCsv(ctx, req.query)));
  r.get("/reports", h((ctx) => availableReports(ctx)));
  r.get(
    "/reports/:name",
    async (req, res) => {
      const result = await getReport(req.ctx, p(req, "name"), req.query);
      if ("csv" in result) {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${p(req, "name").replace(/[^a-z]/g, "")}-report.csv"`);
        res.send(result.csv);
      } else res.json(result);
    }
  );
  r.get(
    "/settings",
    h(async (ctx) => {
      requirePerm(ctx, "settings.manage");
      return getSettings(ctx.db);
    })
  );
  r.put("/settings", sensitiveLimit, h((ctx, req) => updateSettings(ctx, req.body)));
  r.post(
    "/jobs/run",
    h(async (ctx) => {
      requirePerm(ctx, "settings.manage");
      return runScheduledJobs(ctx.db, ctx.now(), { force: true });
    })
  );
  return r;
}

// server/app.ts
var SAFE_METHODS = /* @__PURE__ */ new Set(["GET", "HEAD", "OPTIONS"]);
var RESTRICTED_ALLOW = [/^\/api\/auth\//, /^\/api\/public\//];
function createApp(opts) {
  const app = express();
  const now = opts.now ?? (() => /* @__PURE__ */ new Date());
  app.disable("x-powered-by");
  app.set("trust proxy", /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:", "blob:"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "script-src": ["'self'"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "object-src": ["'none'"]
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );
  app.use((req, res, next) => {
    const incoming = req.get("x-request-id");
    const requestId = incoming && /^[a-zA-Z0-9-]{8,64}$/.test(incoming) ? incoming : crypto3.randomUUID();
    res.setHeader("X-Request-Id", requestId);
    req.ctx = { db: opts.db, actor: null, meta: { requestId, ip: req.ip, userAgent: req.get("user-agent") }, now };
    req.loaded = null;
    next();
  });
  app.use("/api", (req, res, next) => {
    const origin = req.get("origin");
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Request-Id");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });
  app.use("/api", express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/api", (req, res, next) => {
    let token = req.cookies?.[CSRF_COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) {
      token = crypto3.randomBytes(24).toString("base64url");
      res.cookie(CSRF_COOKIE, token, { httpOnly: false, sameSite: "lax", secure: config.isProd, path: "/" });
      req.cookies[CSRF_COOKIE] = token;
      if (!SAFE_METHODS.has(req.method)) {
        next(new AppError(403, "CSRF_FAILED", "Security token missing. Please reload the page and try again."));
        return;
      }
    }
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.get("x-csrf-token") ?? "";
      const a = Buffer.from(header);
      const b = Buffer.from(token);
      if (a.length !== b.length || !crypto3.timingSafeEqual(a, b)) {
        next(new AppError(403, "CSRF_FAILED", "Security token mismatch. Please reload the page and try again."));
        return;
      }
    }
    next();
  });
  app.use("/api", async (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const loaded = await loadSession(opts.db, token, now());
      if (loaded) {
        req.loaded = loaded;
        req.ctx.actor = await loadActor(opts.db, loaded);
      }
    }
    const actor = req.ctx.actor;
    if (actor && actor.status === "active" && !RESTRICTED_ALLOW.some((r) => r.test(req.originalUrl))) {
      if (actor.mustChangePassword) {
        next(new AppError(403, "PASSWORD_CHANGE_REQUIRED", "You must change your password before continuing"));
        return;
      }
      if (actor.roles.some((r) => PRIVILEGED_ROLES.includes(r)) && !actor.mfaEnabled && await getSetting(opts.db, "security.require_mfa_for_privileged")) {
        next(new AppError(403, "MFA_SETUP_REQUIRED", "Two-factor authentication is required for your role. Set it up on your account page."));
        return;
      }
    }
    next();
  });
  app.use("/api", buildRouter({ disableRateLimit: !!opts.disableRateLimit }));
  app.use("/api", (_req, _res, next) => next(new AppError(404, "NOT_FOUND", "Endpoint not found")));
  if (opts.serveClient) {
    const clientDir = path3.resolve("dist/client");
    if (fs2.existsSync(clientDir)) {
      app.use(express.static(clientDir, { index: false, maxAge: "1h", setHeaders: (res, file) => {
        if (file.includes(`${path3.sep}assets${path3.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } }));
      app.get("/{*splat}", (_req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.sendFile(path3.join(clientDir, "index.html"));
      });
    }
  }
  app.use(async (err, req, res, _next) => {
    const ctx = req.ctx;
    let status = 500;
    let body = { error: { code: "INTERNAL", message: "Something went wrong. Please try again.", requestId: ctx?.meta.requestId } };
    const pgCode = err?.cause?.code ?? err?.code;
    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, details: err.details, requestId: ctx?.meta.requestId } };
      const denied = err.auditDenied;
      if (denied && ctx) {
        await audit(ctx.db, ctx, {
          action: "authz.denied",
          outcome: "denied",
          targetType: "endpoint",
          targetId: null,
          newValues: { method: req.method, path: req.originalUrl.split("?")[0].slice(0, 200), required: denied }
        }).catch(() => void 0);
      }
    } else if (err?.type === "entity.parse.failed") {
      status = 400;
      body = { error: { code: "BAD_REQUEST", message: "Malformed JSON body" } };
    } else if (err?.code === "LIMIT_FILE_SIZE") {
      status = 400;
      body = { error: { code: "BAD_REQUEST", message: "File is too large" } };
    } else if (pgCode === "23505") {
      status = 409;
      body = { error: { code: "CONFLICT", message: "This conflicts with an existing record", requestId: ctx?.meta.requestId } };
    } else if (pgCode === "42501") {
      status = 409;
      body = { error: { code: "IMMUTABLE", message: "This record is locked and cannot be changed", requestId: ctx?.meta.requestId } };
    } else if (pgCode === "23503" || pgCode === "23514") {
      status = 400;
      body = { error: { code: "BAD_REQUEST", message: "The submitted data is not valid", requestId: ctx?.meta.requestId } };
    }
    if (status >= 500 && !config.isTest) {
      console.error(`[${ctx?.meta.requestId}]`, err);
    }
    res.status(status).json(body);
  });
  return app;
}

// server/index.ts
async function main() {
  if (config.isProd && !config.databaseUrl) throw new Error("DATABASE_URL is required in production");
  const handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
  console.log(`[ems] database: ${handle.kind === "pg" ? "PostgreSQL" : `PGlite (${config.pgliteDir})`}`);
  await runMigrations(handle);
  await seedBase(handle.db);
  const b = config.bootstrap;
  if (b.email && b.username && b.password) {
    if (await countActiveSuperAdmins(handle.db) === 0) {
      await provisionSuperAdmin(handle.db, { email: b.email, username: b.username, password: b.password, name: b.name ?? "Super Admin" }, { requestId: "bootstrap" });
      console.warn("[ems] Bootstrap super admin provisioned. Remove BOOTSTRAP_SUPERADMIN_* variables now; a password change is required at first login.");
    }
  } else if (await countActiveSuperAdmins(handle.db) === 0) {
    console.warn("[ems] No super admin exists yet. Run `npm run setup:superadmin` (see README).");
  }
  const app = createApp({ db: handle.db, serveClient: true });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[ems] listening on http://${config.host}:${config.port}`);
  });
  let timer;
  if (config.runJobsInProcess) {
    const tick = () => runScheduledJobs(handle.db).catch((err) => console.error("[ems] scheduled jobs failed", err));
    setTimeout(tick, 1e4);
    timer = setInterval(tick, config.jobIntervalMinutes * 6e4);
  }
  const shutdown = async (signal) => {
    console.log(`[ems] ${signal} received, shutting down`);
    if (timer) clearInterval(timer);
    server.close(async () => {
      await handle.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 1e4).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
main().catch((err) => {
  console.error("[ems] fatal startup error", err);
  process.exit(1);
});
