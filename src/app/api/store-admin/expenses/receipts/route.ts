import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import {
  PRIVATE_RECEIPT_BUCKET,
  deleteFromStorage,
  storageConfigured,
  uploadToStorage,
} from '@/lib/platform/storage';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { createMedia } from '@/lib/store-admin/media';
import {
  MAX_MEDIA_BYTES,
  RECEIPT_EXTENSIONS,
  altError,
  cleanFilename,
  imageDimensions,
  sniffReceiptMime,
} from '@/lib/store-admin/media-rules';

/**
 * Private expense receipt upload (`POST /api/store-admin/expenses/receipts`).
 *
 * Stores confidential receipts exclusively in the private `expense-receipts`
 * Supabase Storage bucket (never the public storefront `media` bucket) with
 * `url = ''` so `/api/media/[id]` never resolves them publicly.
 */
export const dynamic = 'force-dynamic';

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  if (!storageConfigured()) {
    return NextResponse.json(
      { error: 'Storage is not configured (missing service role key).' },
      { status: 503, headers: NO_STORE },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MEDIA_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return NextResponse.json(
      { error: 'Files must be 25 MB or smaller.' },
      { status: 413, headers: NO_STORE },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data.' },
      { status: 400, headers: NO_STORE },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing the file field.' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (file.size === 0) {
    return NextResponse.json(
      { error: 'The file is empty.' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (file.size > MAX_MEDIA_BYTES) {
    return NextResponse.json(
      { error: 'Files must be 25 MB or smaller.' },
      { status: 413, headers: NO_STORE },
    );
  }

  const rawAlt = form.get('alt');
  if (rawAlt !== null && typeof rawAlt !== 'string') {
    return NextResponse.json(
      { error: 'Alt text must be text.' },
      { status: 400, headers: NO_STORE },
    );
  }
  const alt = typeof rawAlt === 'string' ? rawAlt : '';
  const altProblem = altError(alt);
  if (altProblem) {
    return NextResponse.json({ error: altProblem }, { status: 400, headers: NO_STORE });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const mimeType = sniffReceiptMime(bytes);
  if (!mimeType) {
    return NextResponse.json(
      { error: 'The receipt must be a valid image, video, or PDF file.' },
      { status: 415, headers: NO_STORE },
    );
  }
  if (file.type && file.type !== mimeType) {
    return NextResponse.json(
      { error: `The file says ${file.type} but its content is ${mimeType}.` },
      { status: 415, headers: NO_STORE },
    );
  }

  const id = randomUUID();
  const storagePath = `receipts/${id}.${RECEIPT_EXTENSIONS[mimeType]}`;

  try {
    await uploadToStorage(storagePath, bytes, mimeType, { bucket: PRIVATE_RECEIPT_BUCKET });
  } catch {
    console.warn('[store-admin/expenses/receipts] storage upload failed');
    return NextResponse.json(
      { error: 'Could not store the receipt upload.' },
      { status: 500, headers: NO_STORE },
    );
  }

  const dimensions = mimeType === 'application/pdf' ? null : imageDimensions(bytes);
  const filename = cleanFilename(file.name);
  const result = await createMedia({
    id,
    filename,
    url: '',
    mimeType,
    size: file.size,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    alt,
    storagePath,
    uploadedBy: guard.session.adminId,
    bucket: PRIVATE_RECEIPT_BUCKET,
  });

  if (!result.ok) {
    await deleteFromStorage(storagePath, { bucket: PRIVATE_RECEIPT_BUCKET });
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'expense.receipt.upload',
      entity: 'store_media',
      entityId: id,
      status: 'denied',
      reason: result.reason,
      request,
    });
    return NextResponse.json({ error: result.error }, { status: 503, headers: NO_STORE });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'expense.receipt.upload',
    entity: 'store_media',
    entityId: id,
    after: {
      id,
      mime_type: mimeType,
      size: file.size,
      bucket: PRIVATE_RECEIPT_BUCKET,
    },
    reason: 'expense_receipt_uploaded',
    request,
  });

  return NextResponse.json(
    { ok: true, media: { id, mimeType, size: file.size } },
    { status: 201, headers: NO_STORE },
  );
}
