import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import {
  departments,
  permissions,
  retirementPolicies,
  rolePermissions,
  roles,
  systemSettings,
  workLocations,
} from './schema';
import { PERMISSIONS, ROLE_KEYS, ROLE_META, ROLE_PERMISSIONS } from '../../shared/permissions';
import { SETTINGS_DEFAULTS } from '../services/settings';

export const INITIAL_DEPARTMENTS = [
  { code: 'ADM', name: 'Administration', description: 'Diocesan office, finance and support services in Mzuzu' },
  { code: 'CLG', name: 'Clergy', description: 'Priests, deacons and pastoral staff in the parishes' },
  { code: 'CON', name: 'Construction', description: 'Church buildings, rectories and diocesan maintenance' },
  { code: 'PRT', name: 'Printing', description: 'Liturgy books, publications and the diocesan press' },
  { code: 'MED', name: 'Medical', description: "St Peter's Mission Hospital, Likoma, and diocesan health services" },
];

/** Descriptions shipped before the diocese wording. Replaced once, so an edited description is kept. */
const PREVIOUS_DEPARTMENT_DESCRIPTIONS: Record<string, string> = {
  ADM: 'Corporate administration and support services',
  CLG: 'Ministry and pastoral staff',
  CON: 'Building projects, sites and maintenance',
  PRT: 'Printing press and publications',
  MED: 'Clinics and health services',
};

/**
 * Parishes published by the Diocese of Northern Malawi (nmalawianglican.org), plus the
 * diocesan office in Mzuzu and St Peter's Mission Hospital on Likoma. Archdeaconry is taken
 * from the diocese's own clergy notes. Newer parishes can be added under Organisation.
 */
export const INITIAL_LOCATIONS: { code: string; name: string; address: string }[] = [
  { code: 'DIO-OFFICE', name: 'Diocesan Office, Mzuzu', address: 'P.O. Box 120, Mzuzu, beside St Mark\'s' },
  { code: 'STP-HOSP', name: "St Peter's Mission Hospital, Likoma", address: 'Likoma Island — diocesan hospital under CHAM' },

  { code: 'STP-CATH', name: "St Peter's Cathedral, Likoma", address: 'Likoma Archdeaconry, Likoma Island' },
  { code: 'SMK-NKWAZI', name: "St Mark's, Nkwazi", address: 'Likoma Archdeaconry, southern Likoma Island' },
  { code: 'SMI-MAKULA', name: "St Michael's, Makulawe", address: 'Likoma Archdeaconry, northern Likoma Island' },
  { code: 'SJB-CHITEKO', name: 'St John the Baptist, Chiteko', address: 'Likoma Archdeaconry, Chizumulu Island' },
  { code: 'SMY-SAME', name: "St Mary's, Samé", address: 'Likoma Archdeaconry, Chizumulu Island' },

  { code: 'SGE-NKBAY', name: "St George's, Nkhata Bay", address: 'Nkhata Bay Archdeaconry, Nkhata Bay' },
  { code: 'SJA-USISYA', name: "St Jacob's, Usisya", address: 'Nkhata Bay Archdeaconry, Usisya' },
  { code: 'SJN-CHILAM', name: "St John's, Chilambwe", address: 'Nkhata Bay Archdeaconry, Chilambwe' },
  { code: 'SJB-MPAMBA', name: 'St John the Baptist, Mpamba', address: 'Nkhata Bay Archdeaconry, Mpamba' },
  { code: 'SMT-KAVUZI', name: "St Martin's, Kavuzi", address: 'Nkhata Bay Archdeaconry, Kavuzi' },
  { code: 'STP-CHOMBE', name: "St Peter's, Chombe", address: 'Nkhata Bay Archdeaconry, Chombe' },
  { code: 'ALS-KABUWA', name: 'All Saints, Kabuwa', address: 'Nkhata Bay Archdeaconry, Kabuwa' },
  { code: 'SJO-CHINTH', name: "St Joseph's, Chintheche", address: 'Nkhata Bay Archdeaconry, Chintheche' },
  { code: 'SLU-MSULI', name: "St Luke's, Msuli", address: 'Nkhata Bay Archdeaconry, Msuli' },
  { code: 'SMK-TUKOMB', name: "St Mark's, Tukombo", address: 'Nkhata Bay Archdeaconry, Tukombo' },
  { code: 'SMY-KANDE', name: "St Mary's, Kande", address: 'Nkhata Bay Archdeaconry, Kande' },

  { code: 'SMK-MZUZU', name: "St Mark's, Mzuzu", address: 'Mzuzu Archdeaconry, beside the diocesan office' },
  { code: 'HTR-LUWING', name: 'Holy Trinity, Luwinga', address: 'Mzuzu Archdeaconry, Luwinga' },
  { code: 'SMK-CHIGWE', name: "St Mark's, Chigwere", address: 'Mzuzu Archdeaconry, Chigwere' },
  { code: 'SMO-KABWAF', name: "St Monica's, Kabwafu", address: 'Mzuzu Archdeaconry, Kabwafu' },
  { code: 'SPA-MCHENG', name: "St Paul's, Mchengawutuwa", address: 'Mzuzu Archdeaconry, Mchengawutuwa' },
  { code: 'STH-RUMPHI', name: "St Thomas's, Rumphi", address: 'Mzuzu Archdeaconry, Rumphi' },
  { code: 'SGE-NTCHEN', name: "St George's, Ntchenachena", address: 'Mzuzu Archdeaconry, Ntchenachena, Rumphi' },

  { code: 'SAM-KARONG', name: "St Ambrose's, Karonga", address: 'Karonga Archdeaconry, Karonga' },
  { code: 'SPA-CHILUM', name: "St Paul's, Chilumba", address: 'Karonga Archdeaconry, Chilumba' },
  { code: 'SPA-KAPOLO', name: "St Paul's, Kapolo", address: 'Karonga Archdeaconry, Kapolo' },
  { code: 'STI-CHITIP', name: "St Timothy's, Chitipa", address: 'Karonga Archdeaconry, Chitipa' },
  { code: 'SMY-NYUNGW', name: "St Mary's, Nyungwe", address: 'Karonga Archdeaconry, Nyungwe' },

  { code: 'SDU-MZIMBA', name: "St Dunstan's, Mzimba", address: 'Mzimba Archdeaconry, Mzimba' },
  { code: 'SMY-MGOZA', name: "St Mary's, Mgoza", address: 'Mzimba Archdeaconry, Mgoza' },
  { code: 'SPA-JENDA', name: "St Paul's, Jenda", address: 'Mzimba Archdeaconry, Jenda' },
  { code: 'SMA-EMBANG', name: "St Matthew's, Embangweni", address: 'Mzimba Archdeaconry, Embangweni' },
];

const GENERIC_ORG_NAME = 'Employee Management System';

/**
 * Idempotent base seed run on every start. Role → permission mappings are code-managed and
 * re-synchronised here. Departments and the diocese's parishes are inserted if missing.
 * Individual grants and all business data live only in the database.
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
      await tx
        .update(departments)
        .set({ description: d.description })
        .where(and(eq(departments.code, d.code), eq(departments.description, PREVIOUS_DEPARTMENT_DESCRIPTIONS[d.code])));
    }
    await tx.execute(sql`insert into employment_number_sequences (department_id, next_value)
      select id, 1 from departments on conflict (department_id) do nothing`);
    for (const location of INITIAL_LOCATIONS) {
      await tx.insert(workLocations).values(location).onConflictDoNothing({ target: workLocations.code });
    }
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
      await tx.insert(systemSettings).values({ key, value }).onConflictDoNothing({ target: systemSettings.key });
    }
    const [orgName] = await tx.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, 'org.name'));
    if (orgName?.value === GENERIC_ORG_NAME) {
      for (const key of ['org.name', 'org.address', 'org.phone'] as const) {
        await tx
          .update(systemSettings)
          .set({ value: SETTINGS_DEFAULTS[key] })
          .where(eq(systemSettings.key, key));
      }
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
