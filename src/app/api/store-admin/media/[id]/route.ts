import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';
import { archiveMedia, updateMediaAlt } from '@/lib/store-admin/media';

/**
 * Alt-text edits and soft deletion for a library file. Deletion is refused
 * while a product image or brand logo still points at the URL.
 */
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  if (typeof payload.alt !== 'string') {
    return NextResponse.json({ error: 'Send the alt text as a string.' }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await updateMediaAlt(id, payload.alt);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'media.alt',
      entity: 'store_media',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      request,
    });
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'media.alt',
    entity: 'store_media',
    entityId: id,
    before: { alt: result.data.before.alt ?? '' },
    after: { alt: result.data.after.alt ?? '' },
    reason: 'alt_text_updated',
    request,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { id } = await context.params;
  const result = await archiveMedia(id);
  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'media.archive',
      entity: 'store_media',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      request,
    });
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'media.archive',
    entity: 'store_media',
    entityId: id,
    before: { deleted_at: null, filename: result.data.before.filename ?? '' },
    after: { deleted_at: result.data.after.deleted_at ?? null },
    reason: 'media_archived',
    request,
  });

  return NextResponse.json({ ok: true });
}
