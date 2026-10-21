import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { Permission, RoleKey } from '../../../shared/permissions';

export interface Me {
  user: {
    id: string;
    displayName: string;
    username: string;
    email: string;
    status: 'active' | 'pending_verification' | 'mfa_pending' | 'suspended' | 'deactivated';
    roles: RoleKey[];
    permissions: Permission[];
    employeeId: string | null;
    mfaEnabled: boolean;
    mustChangePassword: boolean;
    mfaSetupRequired: boolean;
    scopes: { id: string; scopeType: string; departmentId: string | null; locationId: string | null }[];
    phone: string | null;
    preferredLanguage: 'en' | 'ny' | 'tum';
    notifyAnnouncements: boolean;
    notifyEvents: boolean;
    lastLoginAt: string | null;
    passwordChangedAt: string | null;
    createdAt: string | null;
  };
  employee: {
    id: string;
    legalName: string;
    preferredName: string | null;
    employmentNumber: string | null;
    employmentStatus: string;
    departmentName: string;
  } | null;
  org: { name: string; currency: string };
}

interface AuthValue {
  me: Me | null;
  loading: boolean;
  can: (...perms: Permission[]) => boolean;
  hasRole: (role: RoleKey) => boolean;
  refresh: () => Promise<unknown>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const onChange = () => void qc.invalidateQueries({ queryKey: ['me'] });
    window.addEventListener('ems:auth-changed', onChange);
    return () => window.removeEventListener('ems:auth-changed', onChange);
  }, [qc]);

  const me = data ?? null;
  const perms = new Set(me?.user.permissions ?? []);
  const value: AuthValue = {
    me,
    loading: isLoading,
    can: (...p) => p.some((x) => perms.has(x)),
    hasRole: (r) => !!me?.user.roles.includes(r),
    refresh: () => refetch(),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Signed-in, fully active user (only valid inside the authenticated layout). */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('Not signed in');
  return me;
}
