import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { systemSettings } from '../db/schema';
import type { Tx } from '../db/client';
import type { Ctx } from '../context';
import { requirePerm, requireRecentAuth } from '../authz/policy';
import { audit } from './audit';
import { parse } from '../lib/validate';

export const SETTINGS_SCHEMA = {
  'org.name': z.string().trim().min(1).max(160),
  'org.address': z.string().trim().max(300),
  'org.phone': z.string().trim().max(40),
  'org.email': z.string().trim().max(254),
  'org.currency': z.string().trim().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. MWK'),
  'registration.open': z.boolean(),
  'payroll.require_second_approval': z.boolean(),
  'security.require_mfa_for_privileged': z.boolean(),
  'notifications.contract_expiry_days': z.number().int().min(1).max(365),
  'notifications.event_reminder_hours': z.number().int().min(1).max(168),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS_SCHEMA)[K]> };

export const SETTINGS_DEFAULTS: Settings = {
  'org.name': 'Anglican Diocese of Northern Malawi',
  'org.address': 'P.O. Box 120, Mzuzu, Malawi',
  'org.phone': '+265 331 486',
  'org.email': '',
  'org.currency': 'MWK',
  'registration.open': true,
  'payroll.require_second_approval': true,
  'security.require_mfa_for_privileged': false,
  'notifications.contract_expiry_days': 30,
  'notifications.event_reminder_hours': 24,
};

/** Settings whose change weakens security or financial controls and therefore needs re-authentication. */
const SENSITIVE: SettingKey[] = ['payroll.require_second_approval', 'security.require_mfa_for_privileged', 'registration.open'];

export async function getSettings(db: Tx): Promise<Settings> {
  const rows = await db.select().from(systemSettings);
  const out = { ...SETTINGS_DEFAULTS } as Record<string, unknown>;
  for (const r of rows) if (r.key in SETTINGS_SCHEMA) out[r.key] = r.value;
  return out as Settings;
}

export async function getSetting<K extends SettingKey>(db: Tx, key: K): Promise<Settings[K]> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  return (row ? row.value : SETTINGS_DEFAULTS[key]) as Settings[K];
}

export async function updateSettings(ctx: Ctx, input: unknown) {
  requirePerm(ctx, 'settings.manage');
  const shape = Object.fromEntries(Object.entries(SETTINGS_SCHEMA).map(([k, v]) => [k, v.optional()]));
  const body = parse(z.object({ values: z.object(shape).strict(), reason: z.string().trim().max(500).optional() }), input);
  const values = body.values as Partial<Settings>;
  const keys = Object.keys(values) as SettingKey[];
  if (keys.some((k) => SENSITIVE.includes(k))) requireRecentAuth(ctx);
  return ctx.db.transaction(async (tx) => {
    const before = await getSettings(tx);
    const existing = keys.length
      ? await tx.select({ key: systemSettings.key }).from(systemSettings).where(inArray(systemSettings.key, keys))
      : [];
    const existingSet = new Set(existing.map((e) => e.key));
    for (const key of keys) {
      const value = values[key];
      if (existingSet.has(key)) {
        await tx.update(systemSettings).set({ value, updatedBy: ctx.actor.userId, updatedAt: ctx.now() }).where(eq(systemSettings.key, key));
      } else {
        await tx.insert(systemSettings).values({ key, value, updatedBy: ctx.actor.userId });
      }
    }
    const oldValues = Object.fromEntries(keys.map((k) => [k, before[k]]));
    await audit(tx, ctx, { action: 'settings.update', targetType: 'settings', oldValues, newValues: values, reason: body.reason });
    return getSettings(tx);
  });
}
