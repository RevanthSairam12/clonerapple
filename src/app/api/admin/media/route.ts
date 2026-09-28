import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { assertSameOrigin, requireEditor } from '@/lib/admin/api-guard';
import { getSql } from '@/lib/admin/db';
import { storageConfigured, uploadToStorage } from '@/lib/admin/storage';

/**
 * POST /api/admin/media — multipart image/video upload. Bytes go to the
 * public `media` bucket in Supabase Storage (CDN-served; the database keeps
 * only metadata). The returned /api/admin/media/[id] URL redirects there, so
 * stored URLs never change if the storage backend moves again.
 */

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB (video clips need more than images)
const ALLOWED = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/avif',
  'video/webm',
  'video/mp4',
]);

/** Sniffed MIME → file extension for the storage object path. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

/** Magic-byte signatures — the browser-sent Content-Type is not trusted. */
function sniffMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'AVI ') return 'image/avif';
  // EBML header — WebM/Matroska (the hero clip format on the real site).
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  // ISO BMFF: 'ftyp' brand box at offset 4 covers MP4/MOV.
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  // SVG is text; detect the XML root rather than trusting the header.
  const head = bytes.subarray(0, 512).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml';
  return null;
}

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  if (!storageConfigured()) {
    return NextResponse.json({ error: 'Storage is not configured (missing service role key).' }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds the 50 MB limit.' }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // Verify the actual content: a renamed .exe or HTML file must be rejected
  // even when the browser labels it image/png.
  const sniffed = sniffMime(bytes);
  if (!sniffed) {
    return NextResponse.json({ error: 'File content is not a recognized image or video.' }, { status: 415 });
  }
  if (!ALLOWED.has(sniffed) || sniffed !== file.type) {
    return NextResponse.json({ error: `Unsupported type ${file.type}.` }, { status: 415 });
  }
  const mimeType = sniffed;

  // uuid.ext path — unguessable, no user-controlled filename component.
  const id = randomUUID();
  const path = `${id}.${EXTENSIONS[mimeType]}`;
  const url = '/api/admin/media/' + id;

  try {
    await uploadToStorage(path, bytes, mimeType);
  } catch (err) {
    console.error('[admin/media] storage upload failed', err);
    return NextResponse.json({ error: 'Could not store the upload.' }, { status: 500 });
  }

  try {
    await sql`
      insert into media (id, filename, url, mime_type, size, storage_path)
      values (${id}, ${file.name}, ${url}, ${mimeType}, ${file.size}, ${path})
    `;
  } catch (err) {
    console.error('[admin/media] insert failed', err);
    return NextResponse.json({ error: 'Could not store the upload.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url, id });
}
