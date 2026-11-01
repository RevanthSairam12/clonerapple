/**
 * Supabase Storage access for admin media uploads (server-only).
 *
 * Uploads use the service role key via the Storage REST API — the key bypasses
 * RLS, so it must never reach client code (same rule as DATABASE_URL). Objects
 * are stored with uuid filenames in the public `media` bucket and served from
 * Supabase's CDN; the DB keeps only metadata (storage_path).
 */

const PROJECT_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const BUCKET = 'media';

export function storageConfigured(): boolean {
  return Boolean(PROJECT_URL && SERVICE_ROLE_KEY);
}

/** Public CDN URL of an object in the media bucket. */
export function publicObjectUrl(path: string): string {
  return `${PROJECT_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

/**
 * Upload bytes to the media bucket via the Storage REST API.
 * Returns the object path (uuid.ext) — caller stores it in media.storage_path.
 * Throws on any failure; the caller turns it into a 500.
 */
export async function uploadToStorage(
  path: string,
  bytes: Buffer,
  mimeType: string,
): Promise<void> {
  const res = await fetch(`${PROJECT_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': mimeType,
      // Objects live at immutable uuid paths, so the CDN can and should cache
      // them forever (Storage's default is no-cache, which would put every
      // page-view image request on the origin). Storage reads this header,
      // not a query param, on simple uploads.
      'cache-control': 'public, max-age=31536000, immutable',
      // Overwrite is fine: uuid paths never collide in practice.
      'x-upsert': 'true',
    },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`storage upload failed (${res.status}): ${body.slice(0, 200)}`);
  }
}
