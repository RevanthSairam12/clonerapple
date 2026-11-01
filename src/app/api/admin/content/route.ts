import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { requireEditor } from '@/lib/admin/require-editor';
import { validateLegacyContentWrite } from '@/lib/website/boundary';
import { getCollection } from '@/lib/website/collections';
import { getSql } from '@/lib/platform/db';
import { getContentRaw } from '@/lib/content';

/** GET /api/admin/content — list all collections with current values. */
export async function GET() {
  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  const values: Record<string, unknown> = {};
  for (const collection of Object.values(
    await import('@/lib/website/collections').then((m) => m.COLLECTIONS),
  )) {
    values[collection.key] = await getContentRaw(collection.key);
  }
  return NextResponse.json({ values });
}

/** PUT /api/admin/content — upsert one collection's value. */
export async function PUT(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  let body: { key?: string; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { key, value } = body;
  if (!key || typeof key !== 'string' || !getCollection(key)) {
    return NextResponse.json({ error: 'Unknown collection key.' }, { status: 400 });
  }
  if (value === undefined || value === null || typeof value !== 'object') {
    return NextResponse.json({ error: 'Value must be an object.' }, { status: 400 });
  }

  // Design/marketing only. Products, prices, stock, orders, customers and
  // shipping live in Store Admin; a legacy save that carries them is refused
  // rather than silently stored. Education Store keys are exempt by rule.
  const boundary = validateLegacyContentWrite(key, value);
  if (!boundary.ok) {
    return NextResponse.json({ error: boundary.error }, { status: 400 });
  }

  try {
    await sql`
      insert into content_blocks (key, value, updated_at, updated_by, archived_at)
      values (${key}, ${JSON.parse(JSON.stringify(value)) as never}, now(), ${guard.email}, null)
      on conflict (key) do update
      set value = excluded.value,
          updated_at = now(),
          updated_by = excluded.updated_by,
          archived_at = null
    `;
  } catch (err) {
    console.error('[admin/content] upsert failed', err);
    return NextResponse.json({ error: 'Save failed.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/content?key=... — revert a collection to its coded
 * defaults WITHOUT destroying the row. The row is archived and ignored by
 * every reader; a later save un-archives it, so a mistaken reset is reversible.
 */
export async function DELETE(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  const key = new URL(request.url).searchParams.get('key');
  if (!key || !getCollection(key)) {
    return NextResponse.json({ error: 'Unknown collection key.' }, { status: 400 });
  }

  await sql`
    update content_blocks
    set archived_at = now(), updated_at = now(), updated_by = ${guard.email}
    where key = ${key} and archived_at is null
  `;
  return NextResponse.json({ ok: true, archived: true });
}
