import { eq, sql } from 'drizzle-orm';
import { departments, employmentNumberSequences } from '../db/schema';
import type { Tx } from '../db/client';
import { AppError } from '../lib/errors';

export const EMPLOYMENT_NUMBER_WIDTH = 6;

export function formatEmploymentNumber(code: string, value: number): string {
  return `${code}-${String(value).padStart(EMPLOYMENT_NUMBER_WIDTH, '0')}`;
}

/**
 * Atomically reserves the next number in a department's sequence.
 *
 * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` takes a row lock on the sequence row, so
 * concurrent transactions serialise on it and each receives a distinct value. Values are never
 * decremented, so numbers are never reused — even if the surrounding transaction later rolls back
 * (the gap is acceptable; reuse is not). The unique constraint on employees.employment_number is
 * the final backstop. Must be called inside the transaction that assigns the number.
 */
export async function issueEmploymentNumber(tx: Tx, departmentId: string): Promise<string> {
  const [dept] = await tx.select({ code: departments.code }).from(departments).where(eq(departments.id, departmentId));
  if (!dept) throw new AppError(400, 'BAD_REQUEST', 'Unknown department');
  const [row] = await tx
    .insert(employmentNumberSequences)
    .values({ departmentId, nextValue: 2 })
    .onConflictDoUpdate({
      target: employmentNumberSequences.departmentId,
      set: { nextValue: sql`${employmentNumberSequences.nextValue} + 1` },
    })
    .returning({ value: sql<string>`${employmentNumberSequences.nextValue} - 1` });
  return formatEmploymentNumber(dept.code, Number(row.value));
}

export async function sequenceHasIssued(tx: Tx, departmentId: string): Promise<boolean> {
  const [row] = await tx
    .select({ next: employmentNumberSequences.nextValue })
    .from(employmentNumberSequences)
    .where(eq(employmentNumberSequences.departmentId, departmentId));
  return !!row && Number(row.next) > 1;
}
