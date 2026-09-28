import { NextResponse } from 'next/server';

import { assertSameOrigin, requireEditor } from '@/lib/admin/api-guard';
import { getSql } from '@/lib/admin/db';
import { getThemeSettings, THEME_SETTING_KEYS } from '@/lib/content';

/** GET /api/admin/settings — all theme settings. */
export async function GET() {
  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  return NextResponse.json({ values: await getThemeSettings() });
}

/** PUT /api/admin/settings — upsert multiple settings rows. */
export async function PUT(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  let body: { values?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const values = body.values ?? {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string') continue;
    // Whitelist: only known theme keys may be written, so the editor can
    // never stuff arbitrary rows into site_settings.
    if (!THEME_SETTING_KEYS.has(key)) continue;
    await sql`
      insert into site_settings (key, value, updated_at, updated_by)
      values (${key}, ${value}, now(), ${guard.email})
      on conflict (key) do update
      set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by
    `;
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/settings?key=... — revert one setting. */
export async function DELETE(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });

  const key = new URL(request.url).searchParams.get('key');
  if (!key || !THEME_SETTING_KEYS.has(key)) {
    return NextResponse.json({ error: 'Unknown setting key.' }, { status: 400 });
  }

  await sql`delete from site_settings where key = ${key}`;
  return NextResponse.json({ ok: true });
}
