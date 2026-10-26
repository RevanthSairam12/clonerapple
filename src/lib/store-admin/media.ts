import { getSql } from '@/lib/admin/db';

import type { CatalogWrite } from './catalog-writes';
import { altError } from './media-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Media rows are written on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function fail(
  reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict',
  error: string,
): { ok: false; reason: 'unavailable' | 'invalid-input' | 'not-found' | 'conflict'; error: string } {
  return { ok: false, reason, error };
}

export interface MediaRow {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
  uploadedBy: string | null;
  createdAt: string;
  usageCount: number;
}

/** Usage counts reference URLs, so a product image or brand logo locks the row. */
const USAGE_SELECT = `
  (select count(*)::int from product_images i
    where i.url = m.url and i.deleted_at is null)
  + (select count(*)::int from brands b
    where b.logo_url = m.url and b.deleted_at is null) as usage_count
`;

function mapMedia(row: Row): MediaRow {
  return {
    id: text(row.id),
    filename: text(row.filename),
    url: text(row.url),
    mimeType: text(row.mime_type),
    size: number(row.size),
    width: nullableNumber(row.width),
    height: nullableNumber(row.height),
    alt: text(row.alt),
    uploadedBy: row.uploaded_by ? text(row.uploaded_by) : null,
    createdAt: iso(row.created_at),
    usageCount: number(row.usage_count),
  };
}

export async function listMedia(): Promise<CatalogWrite<MediaRow[]>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The media library is not available.');
  try {
    const rows = (await sql.unsafe(
      `select m.id, m.filename, m.url, m.mime_type, m.size, m.width, m.height,
              m.alt, m.uploaded_by, m.created_at, ${USAGE_SELECT}
       from store_media m
       where m.deleted_at is null
       order by m.created_at desc, m.id desc
       limit 300`,
    )) as Row[];
    return { ok: true, data: rows.map(mapMedia) };
  } catch {
    console.warn('[store-admin/media] could not read the media library');
    return fail('unavailable', 'The media library is not available.');
  }
}

export async function createMedia(input: {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  alt: string;
  storagePath: string;
  uploadedBy: string;
}): Promise<CatalogWrite<{ id: string; url: string }>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The media library is not available.');
  const problem = altError(input.alt);
  if (problem) return fail('invalid-input', problem);

  try {
    await sql`
      insert into store_media (
        id, filename, url, mime_type, size, width, height, alt, storage_path, uploaded_by
      ) values (
        ${input.id}, ${input.filename}, ${input.url}, ${input.mimeType}, ${input.size},
        ${input.width}, ${input.height}, ${input.alt.trim()}, ${input.storagePath},
        ${input.uploadedBy}
      )
    `;
    return { ok: true, data: { id: input.id, url: input.url } };
  } catch {
    console.warn('[store-admin/media] could not save a media row');
    return fail('unavailable', 'The media library is not available.');
  }
}

export async function updateMediaAlt(
  id: string,
  alt: string,
): Promise<CatalogWrite<{ before: Row; after: Row }>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The media library is not available.');
  const problem = altError(alt);
  if (problem) return fail('invalid-input', problem);

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select id, alt, deleted_at from store_media where id = ${id} for update
      `) as Row[];
      const before = rows[0];
      if (!before || before.deleted_at) return fail('not-found', 'Media not found.');

      const updated = (await tx`
        update store_media set alt = ${alt.trim()}, updated_at = now()
        where id = ${id}
        returning id, filename, url, mime_type, size, alt
      `) as Row[];
      return { ok: true as const, data: { before, after: updated[0] ?? {} } };
    });
  } catch {
    console.warn('[store-admin/media] could not update alt text');
    return fail('unavailable', 'The media library is not available.');
  }
}

/** Soft delete. Refused while a product image or brand logo still points at it. */
export async function archiveMedia(
  id: string,
): Promise<CatalogWrite<{ before: Row; after: Row }>> {
  const sql = getSql();
  if (!sql) return fail('unavailable', 'The media library is not available.');

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select * from store_media where id = ${id} and deleted_at is null for update
      `) as Row[];
      const before = rows[0];
      if (!before) return fail('not-found', 'Media not found.');

      const mediaUrl = text(before.url);
      const usageRows = (await tx`
        select (
          (select count(*)::int from product_images where url = ${mediaUrl} and deleted_at is null)
          + (select count(*)::int from brands where logo_url = ${mediaUrl} and deleted_at is null)
        ) as usage_count
      `) as Row[];
      if (number(usageRows[0]?.usage_count) > 0) {
        return fail('conflict', 'This file is still used by a product or brand.');
      }

      const updated = (await tx`
        update store_media set deleted_at = now(), updated_at = now()
        where id = ${id}
        returning *
      `) as Row[];
      return { ok: true as const, data: { before, after: updated[0] ?? {} } };
    });
  } catch {
    console.warn('[store-admin/media] could not archive media');
    return fail('unavailable', 'The media library is not available.');
  }
}
