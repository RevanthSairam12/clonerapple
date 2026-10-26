import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';
import {
  LIST_KINDS,
  isListKind,
  listSettingRows,
  saveSettingRow,
  type ListRow,
} from '@/lib/store-admin/setting-lists';

export const dynamic = 'force-dynamic';

interface Context {
  params: Promise<{ kind: string }>;
}

/**
 * Webhook URLs sometimes carry a token in the query string. The audit log
 * records the host and path only, never the query.
 */
function auditSafe(values: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === 'webhook_url' && value) {
      const [withoutQuery] = value.split('?');
      safe[key] = withoutQuery;
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

function findRow(rows: ListRow[], id: string): ListRow | undefined {
  return rows.find((row) => row.id === id);
}

/** Read one configuration list. */
export async function GET(_request: Request, context: Context) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const { kind } = await context.params;
  if (!isListKind(kind)) {
    return NextResponse.json({ error: 'Unknown list.' }, { status: 404 });
  }

  const result = await listSettingRows(kind);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json(
    { kind, rows: result.data },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

/**
 * Create or update one row. Rows are never deleted: `is_active` hides them so
 * historical records keep their label.
 */
export async function POST(request: Request, context: Context) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  const { kind } = await context.params;
  if (!isListKind(kind)) {
    return NextResponse.json({ error: 'Unknown list.' }, { status: 404 });
  }

  let body: { id?: unknown; values?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const existingId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null;
  let before: ListRow | undefined;
  if (existingId) {
    const current = await listSettingRows(kind);
    before = current.ok ? findRow(current.data, existingId) : undefined;
  }

  const result = await saveSettingRow(kind, { id: existingId ?? undefined, values: body.values });
  if (!result.ok) {
    const status =
      result.reason === 'invalid-input'
        ? 400
        : result.reason === 'conflict'
          ? 409
          : result.reason === 'not-found'
            ? 404
            : 503;
    return NextResponse.json({ error: result.error }, { status });
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: `settings.${kind.replace(/-/g, '_')}.save`,
    entity: LIST_KINDS[kind].table,
    entityId: result.data.id,
    reason: result.data.created ? 'created' : 'updated',
    before: before ? auditSafe(before.values) : undefined,
    after:
      body.values && typeof body.values === 'object'
        ? auditSafe(body.values as Record<string, string>)
        : undefined,
    request,
  });

  return NextResponse.json(
    { id: result.data.id, created: result.data.created },
    { status: result.data.created ? 201 : 200 },
  );
}
