import { auditLogs } from '../db/schema';
import type { Tx } from '../db/client';
import type { Ctx } from '../context';

const REDACT = /pass(word)?|token|secret|totp|mfa_?code|hash|cookie|authorization/i;

/** Removes credentials and secrets from values before they are written to the audit log. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 5) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditEntry {
  action: string;
  outcome?: 'success' | 'denied' | 'failure';
  targetType?: string;
  targetId?: string | null;
  oldValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  reason?: string | null;
  approvalId?: string | null;
  actorUserId?: string | null;
}

export async function audit(tx: Tx, ctx: Pick<Ctx, 'actor' | 'meta'>, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: entry.actorUserId !== undefined ? entry.actorUserId : (ctx.actor?.userId ?? null),
    action: entry.action,
    outcome: entry.outcome ?? 'success',
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    oldValues: (entry.oldValues ? redact(entry.oldValues) : null) as Record<string, unknown> | null,
    newValues: (entry.newValues ? redact(entry.newValues) : null) as Record<string, unknown> | null,
    reason: entry.reason ?? null,
    approvalId: entry.approvalId ?? null,
    requestId: ctx.meta.requestId,
    ip: ctx.meta.ip ?? null,
    userAgent: ctx.meta.userAgent?.slice(0, 300) ?? null,
  });
}

/** Shallow diff returning only changed keys, for compact old/new audit values. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const a = before[key] instanceof Date ? (before[key] as Date).toISOString() : before[key];
    const b = after[key] instanceof Date ? (after[key] as Date).toISOString() : after[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      oldValues[key] = a ?? null;
      newValues[key] = b ?? null;
    }
  }
  return { oldValues, newValues, changed: Object.keys(newValues) };
}
