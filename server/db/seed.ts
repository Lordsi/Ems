import { eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import {
  departments,
  permissions,
  retirementPolicies,
  rolePermissions,
  roles,
  systemSettings,
} from './schema';
import { PERMISSIONS, ROLE_KEYS, ROLE_META, ROLE_PERMISSIONS } from '../../shared/permissions';
import { SETTINGS_DEFAULTS } from '../services/settings';

export const INITIAL_DEPARTMENTS = [
  { code: 'ADM', name: 'Administration', description: 'Corporate administration and support services' },
  { code: 'CLG', name: 'Clergy', description: 'Ministry and pastoral staff' },
  { code: 'CON', name: 'Construction', description: 'Building projects, sites and maintenance' },
  { code: 'PRT', name: 'Printing', description: 'Printing press and publications' },
  { code: 'MED', name: 'Medical', description: 'Clinics and health services' },
];

/**
 * Idempotent base seed run on every start. Role → permission mappings are code-managed and
 * re-synchronised here; individual grants and all business data live only in the database.
 * No user accounts are created here (see scripts/setup-superadmin.ts).
 */
export async function seedBase(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx.insert(permissions).values({ key, description }).onConflictDoUpdate({ target: permissions.key, set: { description } });
    }
    for (const key of ROLE_KEYS) {
      const meta = ROLE_META[key];
      const [role] = await tx
        .insert(roles)
        .values({ key, name: meta.name, description: meta.description, rank: meta.rank })
        .onConflictDoUpdate({ target: roles.key, set: { name: meta.name, description: meta.description, rank: meta.rank } })
        .returning();
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      await tx.insert(rolePermissions).values(ROLE_PERMISSIONS[key].map((permissionKey) => ({ roleId: role.id, permissionKey })));
    }
    for (const d of INITIAL_DEPARTMENTS) {
      await tx.insert(departments).values(d).onConflictDoNothing({ target: departments.code });
    }
    await tx.execute(sql`insert into employment_number_sequences (department_id, next_value)
      select id, 1 from departments on conflict (department_id) do nothing`);
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
      await tx.insert(systemSettings).values({ key, value }).onConflictDoNothing({ target: systemSettings.key });
    }
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(retirementPolicies);
    if (count === 0) {
      await tx.insert(retirementPolicies).values({
        name: 'Proposed organisation-wide retirement policy',
        retirementAge: 60,
        reviewLeadMonths: 6,
        upcomingWindowMonths: 12,
        effectiveFrom: '2026-01-01',
        adopted: false,
        notes:
          'Draft proposal only. It is not applied until a super admin verifies it against the organisation\'s adopted policy and applicable law, then adopts it.',
      });
    }
  });
}
