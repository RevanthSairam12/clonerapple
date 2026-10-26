import { getSql } from '@/lib/admin/db';
import { publicObjectUrl } from '@/lib/admin/storage';

/**
 * GET /api/media/[id] — serves a store media upload.
 *
 * Public by design: the URL appears in product <img> tags on the storefront,
 * which never sends a staff cookie. The row is metadata only; the bytes live
 * in the public Storage bucket and this route redirects there so the CDN
 * streams them. Archived files stop resolving.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const sql = getSql();
  if (!sql) return new Response('Database not configured.', { status: 503 });

  try {
    const rows = await sql`
      select storage_path from store_media
      where id = ${id} and deleted_at is null
      limit 1
    `;
    const row = rows[0];
    if (!row?.storage_path) return new Response('Not found', { status: 404 });

    return new Response(null, {
      status: 302,
      headers: {
        Location: publicObjectUrl(row.storage_path as string),
        // 302 (not 301): archived files must stop resolving promptly.
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    console.warn('[media] could not resolve an object');
    return new Response('Server error', { status: 500 });
  }
}
