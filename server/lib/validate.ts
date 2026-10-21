import { z } from 'zod';
import { badRequest } from './errors';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest('Validation failed', { fields });
  }
  return result.data;
}

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'Invalid date');

export const zUuid = z.uuid('Invalid identifier');
export const zOptUuid = z.union([z.uuid('Invalid identifier'), z.literal(''), z.null()]).optional()
  .transform((v) => (v ? v : null));
export const zTrim = (max: number, min = 1) => z.string().trim().min(min, 'Required').max(max, `Max ${max} characters`);
export const zOptText = (max: number) =>
  z.union([z.string().trim().max(max, `Max ${max} characters`), z.null()]).optional().transform((v) => (v ? v : null));
export const zPhone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number');
export const zOptPhone = z.union([zPhone, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
export const zEmail = z.email('Enter a valid email address').trim().max(254).transform((s) => s.toLowerCase());
export const zOptEmail = z.union([zEmail, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));
export const zOptDate = z.union([zDate, z.literal(''), z.null()]).optional().transform((v) => (v ? v : null));

export const zPassword = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p), 'Include upper and lower case letters and a number');

export const zUsername = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dot, underscore and hyphen only');

export const zPage = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Integer minor units (e.g. tambala). Rejects floats to avoid rounding errors. */
export const zMoney = z.number().int('Amounts must be whole minor units').min(0).max(1e13);
