import { getSql } from '@/lib/platform/db';
import { publicObjectUrl } from '@/lib/platform/storage';

/**
 * GET /api/media/[id] — serves a store media upload.
 *
 * Public by design: the URL appears in product <img> tags on the storefront,
 * which never sends a staff cookie. The row is metadata only; the bytes live
 * in the public Storage bucket and this route redirects there so the CDN
 * streams them. Archived files stop resolving.
 *
 * SVG is no longer accepted for upload (it is an active document). Rows that
 * were stored before that change are proxied here instead of redirected, as an
 * attachment with a locked-down CSP, so an old link cannot execute script in
 * the storefront origin or a staff panel.
 */

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/** A header-safe download name ending in .svg. */
function attachmentName(filename: unknown, id: string): string {
  const raw = typeof filename === 'string' ? filename : '';
  const base = raw.replace(/[^A-Za-z0-9._ -]/g, '').trim().slice(0, 120);
  const name = base || `media-${id}`;
  return name.toLowerCase().endsWith('.svg') ? name : `${name}.svg`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const sql = getSql();
  if (!sql) return new Response('Database not configured.', { status: 503 });

  try {
    const rows = await sql`
      select filename, mime_type, storage_path from store_media
      where id = ${id} and deleted_at is null
      limit 1
    `;
    const row = rows[0];
    if (!row?.storage_path) return new Response('Not found', { status: 404 });

    const storagePath = String(row.storage_path);
    const isSvg = row.mime_type === 'image/svg+xml' || storagePath.toLowerCase().endsWith('.svg');

    if (isSvg) {
      const object = await fetch(publicObjectUrl(storagePath), { cache: 'no-store' });
      if (!object.ok || !object.body) return new Response('Not found', { status: 404 });
      return new Response(object.body, {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Disposition': `attachment; filename="${attachmentName(row.filename, id)}"`,
          'Content-Security-Policy': SVG_CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: publicObjectUrl(storagePath),
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
