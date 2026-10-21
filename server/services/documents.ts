import { z } from 'zod';
import crypto from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { documents, users } from '../db/schema';
import type { AuthedCtx, Ctx } from '../context';
import { deniedRecord, fieldAccess, has, requireActor } from '../authz/policy';
import { badRequest } from '../lib/errors';
import { parse } from '../lib/validate';
import { config } from '../config';
import { audit } from './audit';
import { requireViewableEmployee } from './employees';
import { getAnnouncement } from './comms';

/**
 * Files are stored in Postgres (bytea) because the hosting filesystem is ephemeral. Type is
 * determined from file content (magic bytes), never from the client-supplied MIME type or name.
 */
const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

export function detectFileType(buf: Buffer) {
  return SIGNATURES.find((s) => s.test(buf)) ?? null;
}

function safeFilename(name: string, ext: string) {
  const base = name.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9 _.-]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'document';
  return `${base}.${ext}`;
}

type OwnerType = 'employee' | 'announcement';

async function authorizeOwner(ctx: AuthedCtx, ownerType: OwnerType, ownerId: string, write: boolean) {
  if (ownerType === 'employee') {
    const emp = await requireViewableEmployee(ctx, ownerId);
    const access = fieldAccess(ctx.actor, emp);
    if (write ? !access.manageDocuments : !access.documents) throw deniedRecord('Document');
    return;
  }
  await getAnnouncement(ctx, ownerId);
  if (write && !has(ctx.actor, 'announcement.manage')) throw deniedRecord('Document');
}

export async function uploadDocument(ctx: Ctx, ownerType: OwnerType, ownerId: string, file: { originalname: string; buffer: Buffer; size: number } | undefined, fields: unknown) {
  requireActor(ctx);
  const body = parse(z.object({ category: z.enum(['general', 'contract', 'identity', 'qualification', 'medical', 'attachment']).default('general') }), fields ?? {});
  if (!file) throw badRequest('No file was uploaded');
  if (file.size > config.maxUploadBytes) throw badRequest(`Files must be smaller than ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB`);
  await authorizeOwner(ctx, ownerType, ownerId, true);
  const type = detectFileType(file.buffer);
  if (!type) throw badRequest('Only PDF, PNG and JPEG files are accepted');
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const [doc] = await ctx.db
    .insert(documents)
    .values({
      ownerType,
      ownerId,
      category: body.category,
      filename: safeFilename(file.originalname, type.ext),
      mimeType: type.mime,
      sizeBytes: file.size,
      sha256,
      data: file.buffer,
      uploadedBy: ctx.actor.userId,
    })
    .returning({ id: documents.id, filename: documents.filename });
  await audit(ctx.db, ctx, { action: 'document.upload', targetType: ownerType, targetId: ownerId, newValues: { documentId: doc.id, filename: doc.filename, sizeBytes: file.size, sha256 } });
  return doc;
}

export async function listDocuments(ctx: Ctx, ownerType: OwnerType, ownerId: string) {
  requireActor(ctx);
  await authorizeOwner(ctx, ownerType, ownerId, false);
  return ctx.db
    .select({
      id: documents.id,
      filename: documents.filename,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      category: documents.category,
      createdAt: documents.createdAt,
      uploadedByName: users.displayName,
    })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.uploadedBy))
    .where(and(eq(documents.ownerType, ownerType), eq(documents.ownerId, ownerId), isNull(documents.archivedAt)))
    .orderBy(desc(documents.createdAt));
}

export async function downloadDocument(ctx: Ctx, id: string) {
  requireActor(ctx);
  if (!z.uuid().safeParse(id).success) throw deniedRecord('Document');
  const [doc] = await ctx.db.select().from(documents).where(and(eq(documents.id, id), isNull(documents.archivedAt)));
  if (!doc) throw deniedRecord('Document');
  await authorizeOwner(ctx, doc.ownerType as OwnerType, doc.ownerId, false);
  if (doc.ownerType === 'employee') {
    await audit(ctx.db, ctx, { action: 'document.download', targetType: 'employee', targetId: doc.ownerId, newValues: { documentId: id } });
  }
  return doc;
}

export async function archiveDocument(ctx: Ctx, id: string) {
  requireActor(ctx);
  if (!z.uuid().safeParse(id).success) throw deniedRecord('Document');
  const [doc] = await ctx.db.select().from(documents).where(eq(documents.id, id));
  if (!doc || doc.archivedAt) throw deniedRecord('Document');
  await authorizeOwner(ctx, doc.ownerType as OwnerType, doc.ownerId, true);
  await ctx.db.update(documents).set({ archivedAt: ctx.now() }).where(eq(documents.id, id));
  await audit(ctx.db, ctx, { action: 'document.archive', targetType: doc.ownerType, targetId: doc.ownerId, newValues: { documentId: id } });
  return { archived: true };
}
