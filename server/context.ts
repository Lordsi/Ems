import type { Db } from './db/client';
import type { Permission, RoleKey } from '../shared/permissions';

export interface ScopeGrant {
  id: string;
  scopeType: 'org_unit' | 'direct_reports';
  departmentId: string | null;
  locationId: string | null;
}

export interface Actor {
  userId: string;
  sessionId: string;
  displayName: string;
  username: string;
  email: string;
  status: string;
  roles: RoleKey[];
  permissions: Set<Permission>;
  employeeId: string | null;
  scopes: ScopeGrant[];
  reauthAt: Date | null;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
}

export interface RequestMeta {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface Ctx {
  db: Db;
  actor: Actor | null;
  meta: RequestMeta;
  now: () => Date;
}

export interface AuthedCtx extends Ctx {
  actor: Actor;
}
