export interface Lookups {
  departments: { id: string; code: string; name: string; locationIds: string[] }[];
  locations: { id: string; code: string; name: string }[];
  jobTitles: { id: string; name: string; departmentId: string | null }[];
  grades: { id: string; code: string; name: string }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EmployeeSummary {
  id: string;
  legalName: string;
  preferredName: string | null;
  employmentNumber: string | null;
  employmentStatus: string;
  employmentType: string | null;
  employmentDate: string | null;
  archived: boolean;
  department: { id: string; name: string; code: string };
  location: { id: string; name: string } | null;
  workLocation: string | null;
  jobTitle: { id: string; name: string } | null;
  grade: string | null;
  gradeId: string | null;
  supervisor: { id: string; name: string } | null;
  age: number | null;
  dateOfBirth: string | null;
  phone: string | null;
}

export interface EmployeeDetail extends EmployeeSummary {
  employment: {
    employmentNumber: string | null;
    employmentType: string;
    employmentDate: string | null;
    contractEndDate: string | null;
    verifiedAt: string | null;
    archivedAt: string | null;
    archiveReason: string | null;
  } | null;
  personal: { dateOfBirth: string | null; age: number | null; phone?: string | null; personalEmail?: string | null; address?: string | null } | null;
  nextOfKin?: { fullName: string; relationship: string; phone: string; address: string | null } | null;
  account: {
    id: string;
    username: string;
    email: string;
    status: string;
    phone: string | null;
    preferredLanguage: string;
    mfaEnabled: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  } | null;
  pendingInvitation: { email: string; expiresAt: string } | null;
  access: {
    self: boolean;
    employment: boolean;
    personal: boolean;
    age: boolean;
    nextOfKin: boolean;
    account: boolean;
    payroll: boolean;
    retirement: boolean;
    approvals: boolean;
    audit: boolean;
    documents: boolean;
    manageDocuments: boolean;
    updateMode: 'override' | 'admin' | 'moderator' | 'self' | 'none';
    directFields: string[];
    proposableFields: string[];
    canEditNextOfKin: boolean;
    canRequestCorrection: boolean;
    canArchive: boolean;
    canVerify: boolean;
    canInvite: boolean;
  };
}

export interface Approval {
  id: string;
  type: string;
  status: string;
  targetType: string;
  targetId: string;
  summary: string;
  payload: Record<string, unknown> | null;
  reason: string | null;
  requiredPermission: string;
  requestedBy: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  requesterName: string | null;
  deciderName: string | null;
  canDecide: boolean;
  canCancel: boolean;
}

export const EMPLOYMENT_TYPES = ['permanent', 'contract', 'temporary', 'volunteer', 'intern'] as const;

export const FIELD_LABELS: Record<string, string> = {
  legalName: 'Legal name',
  preferredName: 'Preferred name',
  dateOfBirth: 'Date of birth',
  phone: 'Phone',
  personalEmail: 'Personal email',
  address: 'Address',
  departmentId: 'Department',
  locationId: 'Assigned location',
  workLocation: 'Work location',
  jobTitleId: 'Job title',
  gradeId: 'Grade',
  supervisorId: 'Supervisor',
  employmentDate: 'Employment date',
  employmentType: 'Employment type',
  contractEndDate: 'Contract end date',
  employmentStatus: 'Employment status',
};
