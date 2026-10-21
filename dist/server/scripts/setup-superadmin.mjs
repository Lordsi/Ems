var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// scripts/setup-superadmin.ts
import readline from "node:readline";

// server/config.ts
import path from "node:path";
var env = process.env;
var isProd = env.NODE_ENV === "production";
var isTest = env.NODE_ENV === "test" || env.VITEST === "true";
function required(name2, fallbackForDev) {
  const v = env[name2];
  if (v && v.length > 0) return v;
  if (!isProd && fallbackForDev !== void 0) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name2}`);
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
var ts = (name2) => timestamp(name2, { withTimezone: true, mode: "date" });
var createdAt = () => ts("created_at").notNull().defaultNow();
var updatedAt = () => ts("updated_at").notNull().defaultNow();
var money = (name2) => bigint(name2, { mode: "number" });
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
  const found = candidates.find((p) => fs.existsSync(path2.join(p, "meta", "_journal.json")));
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
async function runMigrations(handle2) {
  const folder = migrationsFolder();
  if (handle2.kind === "pg") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle2.db, { migrationsFolder: folder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle2.db, { migrationsFolder: folder });
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

// server/authz/policy.ts
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
var zPassword = z.string().min(12, "Use at least 12 characters").max(200).refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p), "Include upper and lower case letters and a number");
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

// server/services/auth.ts
import { z as z4 } from "zod";
import { and as and4, eq as eq6, isNull as isNull3, or as or2, sql as sql6 } from "drizzle-orm";

// server/lib/crypto.ts
import crypto from "node:crypto";
import { promisify } from "node:util";
var scrypt = promisify(crypto.scrypt);
var SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
var KEYLEN = 64;
async function hashPassword(password2) {
  const salt = crypto.randomBytes(16);
  const params = process.env.VITEST ? { ...SCRYPT, N: 1024 } : SCRYPT;
  const key = await scrypt(password2.normalize("NFKC"), salt, KEYLEN, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

// server/auth/sessions.ts
import { and as and2, eq as eq4, isNull, sql as sql4 } from "drizzle-orm";
async function revokeAllSessions(db, userId, exceptId) {
  const cond = exceptId ? and2(eq4(sessions.userId, userId), isNull(sessions.revokedAt), sql4`${sessions.id} <> ${exceptId}`) : and2(eq4(sessions.userId, userId), isNull(sessions.revokedAt));
  await db.update(sessions).set({ revokedAt: /* @__PURE__ */ new Date() }).where(cond);
}

// server/auth/totp.ts
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

// server/services/notifications.ts
import { and as and3, desc, eq as eq5, inArray as inArray2, isNull as isNull2, sql as sql5 } from "drizzle-orm";
import { z as z3 } from "zod";

// server/services/auth.ts
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
var loginSchema = z4.object({ identifier: z4.string().trim().min(1).max(254), password: z4.string().min(1).max(200) });
async function provisionSuperAdmin(db, input, meta, opts = {}) {
  const email2 = parse(zEmail, input.email);
  const username2 = parse(zUsername, input.username);
  parse(zPassword, input.password);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(users).where(or2(sql6`lower(${users.email}) = ${email2}`, sql6`lower(${users.username}) = ${username2.toLowerCase()}`));
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
        email: email2,
        username: username2,
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
      newValues: { username: username2, email: email2 },
      reason: "Provisioned via secure setup procedure"
    });
    return { userId, created: !existing };
  });
}

// scripts/setup-superadmin.ts
function arg(name2) {
  const i = process.argv.indexOf(`--${name2}`);
  return i >= 0 ? process.argv[i + 1] : void 0;
}
async function promptHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl;
  let muted = false;
  out._writeToOutput = (s) => {
    if (!muted) out.output.write(s);
  };
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}
var email = arg("email") ?? process.env.SETUP_EMAIL;
var username = arg("username") ?? process.env.SETUP_USERNAME;
var name = arg("name") ?? process.env.SETUP_NAME ?? "Super Admin";
if (!email || !username) {
  console.error('Usage: npm run setup:superadmin -- --email <email> --username <username> [--name "Full Name"]');
  process.exit(1);
}
var password = process.env.SETUP_PASSWORD;
if (!password) {
  password = await promptHidden("Password (min 12 chars, upper/lower case and a number): ");
  const confirm = await promptHidden("Confirm password: ");
  if (password !== confirm) {
    console.error("Passwords do not match.");
    process.exit(1);
  }
}
var handle = await createDb({ url: config.databaseUrl, pgliteDir: config.pgliteDir });
try {
  await runMigrations(handle);
  await seedBase(handle.db);
  const result = await provisionSuperAdmin(handle.db, { email, username, password, name }, { requestId: "cli-setup" });
  console.log(result.created ? `Super admin "${username}" created.` : `Access restored for "${username}" (super admin role ensured).`);
  console.log("A password change will be required at first sign-in.");
} catch (err) {
  const e = err;
  console.error("Failed:", e.message, e.details ? JSON.stringify(e.details) : "");
  process.exitCode = 1;
} finally {
  await handle.close();
}
