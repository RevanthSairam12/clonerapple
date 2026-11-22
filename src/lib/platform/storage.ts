/**
 * Supabase Storage access for public store media and private expense receipts (server-only).
 *
 * Uploads use the service role key via the Storage REST API — the key bypasses
 * RLS, so it must never reach client code (same rule as DATABASE_URL).
 * - Public product images live in the public `media` bucket (long-lived CDN cache).
 * - Confidential expense receipts live in the private `expense-receipts` bucket
 *   with `Cache-Control: private, no-store` and are streamed/redirected only
 *   via short-lived signed URLs issued after `requireStoreRole('store_admin')`.
 */

export const PUBLIC_MEDIA_BUCKET = 'media' as const;
export const PRIVATE_RECEIPT_BUCKET = 'expense-receipts' as const;
export type StorageBucket = typeof PUBLIC_MEDIA_BUCKET | typeof PRIVATE_RECEIPT_BUCKET;

const DEFAULT_SIGNED_URL_TTL_SEC = 60;
const MIN_SIGNED_URL_TTL_SEC = 10;
const MAX_SIGNED_URL_TTL_SEC = 300;

function projectUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
}

function serviceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
}

function encodeObjectPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function storageConfigured(): boolean {
  return Boolean(projectUrl() && serviceRoleKey());
}

/** Public CDN URL of an object in the public `media` bucket. */
export function publicObjectUrl(path: string): string {
  return `${projectUrl()}/storage/v1/object/public/${PUBLIC_MEDIA_BUCKET}/${path}`;
}

/**
 * Upload bytes to Supabase Storage via the Storage REST API.
 * Throws on any failure; the caller turns it into a safe 500/503.
 */
export async function uploadToStorage(
  path: string,
  bytes: Buffer,
  mimeType: string,
  options: { bucket?: StorageBucket } = {},
): Promise<void> {
  const bucket = options.bucket ?? PUBLIC_MEDIA_BUCKET;
  const cacheControl =
    bucket === PRIVATE_RECEIPT_BUCKET
      ? 'private, no-store'
      : 'public, max-age=31536000, immutable';

  const res = await fetch(`${projectUrl()}/storage/v1/object/${bucket}/${encodeObjectPath(path)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceRoleKey()}`,
      'content-type': mimeType,
      'cache-control': cacheControl,
      'x-upsert': 'true',
    },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`storage upload failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

/**
 * Generate a short-lived signed download URL for an object in Storage.
 * Returns null when Storage is unconfigured or signing fails; never logs URLs.
 */
export async function createSignedStorageUrl(
  path: string,
  options: { bucket?: StorageBucket; expiresInSec?: number } = {},
): Promise<string | null> {
  const key = (path || '').trim();
  const baseUrl = projectUrl();
  const srk = serviceRoleKey();
  if (!baseUrl || !srk || !key) return null;

  const bucket = options.bucket ?? PRIVATE_RECEIPT_BUCKET;
  const rawTtl = Math.trunc(options.expiresInSec ?? DEFAULT_SIGNED_URL_TTL_SEC);
  const expiresIn = Math.min(MAX_SIGNED_URL_TTL_SEC, Math.max(MIN_SIGNED_URL_TTL_SEC, rawTtl));

  try {
    const res = await fetch(
      `${baseUrl}/storage/v1/object/sign/${bucket}/${encodeObjectPath(key)}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${srk}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ expiresIn }),
        cache: 'no-store',
      },
    );
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as
      | { signedURL?: unknown; signedUrl?: unknown }
      | null;
    const rawSigned =
      typeof payload?.signedURL === 'string'
        ? payload.signedURL
        : typeof payload?.signedUrl === 'string'
          ? payload.signedUrl
          : '';
    if (!rawSigned) return null;

    if (/^https?:\/\//i.test(rawSigned)) return rawSigned;
    if (rawSigned.startsWith('/storage/v1/')) return `${baseUrl}${rawSigned}`;
    if (rawSigned.startsWith('/')) return `${baseUrl}/storage/v1${rawSigned}`;
    return `${baseUrl}/storage/v1/${rawSigned}`;
  } catch {
    return null;
  }
}

/**
 * Remove an object from Supabase Storage. Returns false when Storage is not
 * configured, the path is empty or the request failed — never throws.
 */
export async function deleteFromStorage(
  path: string,
  options: { bucket?: StorageBucket } = {},
): Promise<boolean> {
  const key = (path || '').trim();
  const baseUrl = projectUrl();
  const srk = serviceRoleKey();
  if (!baseUrl || !srk || !key) return false;
  const bucket = options.bucket ?? PUBLIC_MEDIA_BUCKET;

  try {
    const res = await fetch(`${baseUrl}/storage/v1/object/${bucket}/${encodeObjectPath(key)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${srk}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
