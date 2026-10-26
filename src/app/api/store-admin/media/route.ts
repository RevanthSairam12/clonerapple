import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { storageConfigured, uploadToStorage } from '@/lib/admin/storage';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { createMedia, listMedia } from '@/lib/store-admin/media';
import {
  MAX_MEDIA_BYTES,
  MEDIA_EXTENSIONS,
  altError,
  cleanFilename,
  imageDimensions,
  sniffMime,
} from '@/lib/store-admin/media-rules';

/**
 * The shared media library: list for every role, multipart upload for admin.
 *
 * The bytes go to the public `media` bucket under an unguessable uuid path;
 * the row keeps only metadata. The stored URL is `/api/media/<id>`, which
 * redirects to the CDN, so the storefront never needs a staff session.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const result = await listMedia();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json({ media: result.data });
}

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  if (!storageConfigured()) {
    return NextResponse.json(
      { error: 'Storage is not configured (missing service role key).' },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing the file field.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'The file is empty.' }, { status: 400 });
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return NextResponse.json({ error: 'Files must be 25 MB or smaller.' }, { status: 413 });
  }

  const rawAlt = form.get('alt');
  if (rawAlt !== null && typeof rawAlt !== 'string') {
    return NextResponse.json({ error: 'Alt text must be text.' }, { status: 400 });
  }
  const alt = typeof rawAlt === 'string' ? rawAlt : '';
  const altProblem = altError(alt);
  if (altProblem) {
    return NextResponse.json({ error: altProblem }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // The browser-sent Content-Type is never trusted: a renamed HTML file must
  // not become a served image.
  const mimeType = sniffMime(bytes);
  if (!mimeType) {
    return NextResponse.json(
      { error: 'The file content is not a supported image or video.' },
      { status: 415 },
    );
  }
  if (file.type && file.type !== mimeType) {
    return NextResponse.json(
      { error: `The file says ${file.type} but its content is ${mimeType}.` },
      { status: 415 },
    );
  }

  const id = randomUUID();
  const storagePath = `${id}.${MEDIA_EXTENSIONS[mimeType]}`;
  const url = `/api/media/${id}`;

  try {
    await uploadToStorage(storagePath, bytes, mimeType);
  } catch {
    console.warn('[store-admin/media] storage upload failed');
    return NextResponse.json({ error: 'Could not store the upload.' }, { status: 500 });
  }

  const dimensions = imageDimensions(bytes);
  const filename = cleanFilename(file.name);
  const result = await createMedia({
    id,
    filename,
    url,
    mimeType,
    size: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    alt,
    storagePath,
    uploadedBy: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'media.upload',
      entity: 'store_media',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      request,
    });
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'media.upload',
    entity: 'store_media',
    entityId: id,
    after: { id, filename, mime_type: mimeType, size: file.size, alt: alt.trim() },
    reason: 'media_uploaded',
    request,
  });

  return NextResponse.json({ ok: true, media: result.data }, { status: 201 });
}
