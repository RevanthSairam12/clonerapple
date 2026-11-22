/**
 * One-time storage + metadata backfill for SEC-005 (L-9):
 * Moves existing expense receipts from the public `media` bucket into the
 * private `expense-receipts` bucket without losing attachment references.
 *
 * Safe defaults:
 *   node scripts/migrate-receipts-to-private.mjs          (dry-run preview only)
 *   node scripts/migrate-receipts-to-private.mjs --apply  (copies, verifies signed URL,
 *                                                          updates store_media, then deletes
 *                                                          from public `media` bucket)
 *
 * Rollback note: if a specific row needs reverting before cleanup, objects are
 * copied to `expense-receipts` and verified via signed URL BEFORE the database
 * row is updated and BEFORE the public `media` object is deleted.
 *
 * Security: never logs storage URLs, signed URLs, filenames, or credentials.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import postgres from 'postgres';

const envPath = path.resolve(process.cwd(), '.env.local');
try {
  const env = await readFile(envPath, 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // Real environment variables may already be populated outside .env.local.
}

const apply = process.argv.includes('--apply');
const PUBLIC_BUCKET = 'media';
const PRIVATE_BUCKET = 'expense-receipts';

const connectionUrl = (process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || '').trim();
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();

if (!connectionUrl) {
  console.error('Neither DATABASE_MIGRATION_URL nor DATABASE_URL is set.');
  process.exit(1);
}
if (apply && (!supabaseUrl || !serviceRoleKey)) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required with --apply.');
  process.exit(1);
}

function encodeObjectPath(objectPath) {
  return String(objectPath)
    .split('/')
    .map(encodeURIComponent)
    .join('/');
}

const sql = postgres(connectionUrl, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false,
  ssl: process.env.DATABASE_SSL === 'false' ? undefined : 'require',
  onnotice: () => {},
});

try {
  const candidates = await sql`
    select distinct
      m.id,
      m.storage_path,
      m.mime_type,
      m.bucket,
      (
        exists (select 1 from product_images i where i.url = m.url and i.deleted_at is null)
        or exists (select 1 from brands b where b.logo_url = m.url and b.deleted_at is null)
      ) as shared_with_catalog
    from store_media m
    where coalesce(m.bucket, 'media') = ${PUBLIC_BUCKET}
      and m.deleted_at is null
      and exists (
        select 1 from expenses e
        where e.attachment_media_id = m.id
      )
    order by m.id asc
  `;

  console.log(
    JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      candidateCount: candidates.length,
    }),
  );

  if (!apply) {
    for (const row of candidates) {
      console.log(
        JSON.stringify({
          id: String(row.id),
          action: row.shared_with_catalog ? 'skip_shared_catalog_ref' : 'would_migrate',
        }),
      );
    }
    process.exit(0);
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of candidates) {
    const id = String(row.id);
    const storagePath = String(row.storage_path ?? '').trim();
    const mimeType = String(row.mime_type ?? 'application/octet-stream');

    if (row.shared_with_catalog === true || !storagePath) {
      skipped += 1;
      console.log(JSON.stringify({ id, status: 'skipped' }));
      continue;
    }

    const encodedPath = encodeObjectPath(storagePath);

    try {
      // 1. Download bytes from the legacy public bucket via Storage API.
      const downloadRes = await fetch(
        `${supabaseUrl}/storage/v1/object/${PUBLIC_BUCKET}/${encodedPath}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${serviceRoleKey}` },
        },
      );
      if (!downloadRes.ok) {
        failed += 1;
        console.warn(JSON.stringify({ id, status: 'download_failed', httpStatus: downloadRes.status }));
        continue;
      }
      const bytes = Buffer.from(await downloadRes.arrayBuffer());

      // 2. Upload bytes to the private bucket with private, no-store cache headers.
      const uploadRes = await fetch(
        `${supabaseUrl}/storage/v1/object/${PRIVATE_BUCKET}/${encodedPath}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': mimeType,
            'cache-control': 'private, no-store',
            'x-upsert': 'true',
          },
          body: new Uint8Array(bytes),
        },
      );
      if (!uploadRes.ok) {
        failed += 1;
        console.warn(JSON.stringify({ id, status: 'upload_failed', httpStatus: uploadRes.status }));
        continue;
      }

      // 3. Verify signed URL minting works against the private bucket before updating DB.
      const signRes = await fetch(
        `${supabaseUrl}/storage/v1/object/sign/${PRIVATE_BUCKET}/${encodedPath}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ expiresIn: 60 }),
        },
      );
      const signPayload = signRes.ok ? await signRes.json().catch(() => null) : null;
      const hasSignedUrl = Boolean(signPayload?.signedURL || signPayload?.signedUrl);
      if (!signRes.ok || !hasSignedUrl) {
        failed += 1;
        console.warn(JSON.stringify({ id, status: 'sign_verify_failed', httpStatus: signRes.status }));
        continue;
      }

      // 4. Commit database metadata update (bucket -> expense-receipts, clear public url).
      await sql`
        update store_media
        set bucket = ${PRIVATE_BUCKET},
            url = '',
            updated_at = now()
        where id = ${id}
          and coalesce(bucket, 'media') = ${PUBLIC_BUCKET}
      `;

      // 5. Remove legacy public object only after DB update succeeds.
      const deleteRes = await fetch(
        `${supabaseUrl}/storage/v1/object/${PUBLIC_BUCKET}/${encodedPath}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${serviceRoleKey}` },
        },
      );
      if (!deleteRes.ok) {
        console.warn(
          JSON.stringify({
            id,
            status: 'migrated_legacy_delete_warning',
            httpStatus: deleteRes.status,
          }),
        );
      } else {
        console.log(JSON.stringify({ id, status: 'migrated' }));
      }
      migrated += 1;
    } catch {
      failed += 1;
      console.warn(JSON.stringify({ id, status: 'error' }));
    }
  }

  console.log(
    JSON.stringify({
      mode: 'apply',
      candidateCount: candidates.length,
      migrated,
      skipped,
      failed,
    }),
  );
  if (failed > 0) process.exitCode = 1;
} finally {
  await sql.end();
}
