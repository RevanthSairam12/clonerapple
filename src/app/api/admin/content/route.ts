import { NextResponse } from 'next/server';

import { assertSameOrigin, requireEditor } from '@/lib/admin/api-guard';
import { getCollection } from '@/lib/admin/collections';
import { getSql } from '@/lib/admin/db';
import { getContentRaw } from '@/lib/content';

/** GET /api/admin/content — list all collections with current values. */
export async function GET() {
  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  const values: Record<string, unknown> = {};
  for (const collection of Object.values(
    await import('@/lib/admin/collections').then((m) => m.COLLECTIONS),
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

  try {
    await sql`
      insert into content_blocks (key, value, updated_at, updated_by)
      values (${key}, ${JSON.parse(JSON.stringify(value)) as never}, now(), ${guard.email})
      on conflict (key) do update
      set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
    `;
  } catch (err) {
    console.error('[admin/content] upsert failed', err);
    return NextResponse.json({ error: 'Save failed.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/content?key=... — revert a collection to defaults. */
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

  await sql`delete from content_blocks where key = ${key}`;
  return NextResponse.json({ ok: true });
}
