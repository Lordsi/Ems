/** Date helpers operating on ISO calendar dates (YYYY-MM-DD) in UTC to avoid timezone drift. */

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m, d];
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Adds calendar months, clamping to month end (e.g. 29 Feb + 12 months = 28 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

export const addYears = (iso: string, years: number) => addMonths(iso, years * 12);

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Age in completed years on `onDate`. */
export function ageOn(dob: string, onDate: string = todayIso()): number {
  const [by, bm, bd] = parts(dob);
  const [y, m, d] = parts(onDate);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}
