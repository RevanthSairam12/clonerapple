import { getSql } from '@/lib/platform/db';
import { publicObjectUrl } from '@/lib/platform/storage';
import { legacyAdminGone } from '@/lib/website/legacy-gone';

function gone() {
  return legacyAdminGone('/api/admin/media/[id]');
}

export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
export const OPTIONS = gone;

/**
 * GET /api/admin/media/[id] — serves an uploaded image.
 *
 * New legacy uploads live in the shared `store_media` table, so they resolve
 * exactly like a Store Admin media row. Older uploads still live in the
 * legacy `media` table; that path is checked second so every URL an existing
 * content block already stores keeps working. Archived `store_media` rows
 * stop resolving, matching the Store Admin library.
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
    // Shared library first (new legacy uploads and every Store Admin upload).
    const shared = await sql`
      select storage_path, deleted_at from store_media where id = ${id} limit 1
    `;
    const sharedRow = shared[0];
    if (sharedRow) {
      if (sharedRow.deleted_at || !sharedRow.storage_path) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: publicObjectUrl(sharedRow.storage_path as string),
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    // Pre-convergence legacy rows.
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
