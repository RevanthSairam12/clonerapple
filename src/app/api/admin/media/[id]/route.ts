import { getSql } from '@/lib/admin/db';
import { publicObjectUrl } from '@/lib/admin/storage';

/**
 * GET /api/admin/media/[id] — serves an uploaded image.
 *
 * Storage-backed rows (storage_path set) redirect to the Supabase Storage
 * public URL: the CDN streams the bytes with aggressive immutable caching and
 * they never touch the Next.js server or the DB connection. Legacy bytea rows
 * stream from the database exactly as before.
 *
 * Public (no editor session): the bytes render in <img> tags on the public
 * site, which never sends the admin cookie.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const sql = getSql();
  if (!sql) return new Response('Database not configured.', { status: 503 });

  try {
    const rows = await sql`
      select storage_path, data, mime_type from media where id = ${id}
    `;
    const row = rows[0];
    if (!row) return new Response('Not found', { status: 404 });

    if (row.storage_path) {
      // 302 (not 301): if the storage backend moves again, cached redirects
      // expire and clients pick up the new location.
      return new Response(null, {
        status: 302,
        headers: {
          Location: publicObjectUrl(row.storage_path as string),
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Legacy bytea row.
    if (!row.data) return new Response('Not found', { status: 404 });
    const body = new Uint8Array(row.data as ArrayBuffer);
    return new Response(body, {
      headers: {
        'Content-Type': row.mime_type ?? 'application/octet-stream',
        'Content-Length': String(body.byteLength),
        // Immutable per id (uuid); safe to cache hard.
        'Cache-Control': 'public, max-age=31536000, immutable',
        // Defense against stored XSS: uploaded files (notably SVG, which can
        // embed <script>) are untrusted content served from our origin. This
        // header set renders them inert — no scripts, no plugins, no framing,
        // and the browser must respect the declared MIME type. Videos stay
        // playable in <video> tags (media-src 'self'), and images in <img>.
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src 'self'",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('[admin/media] serve failed', err);
    return new Response('Server error', { status: 500 });
  }
}
