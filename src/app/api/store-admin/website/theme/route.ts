import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { getThemeSettings, THEME_SETTING_KEYS } from '@/lib/content';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { archiveThemeValue, listThemeOverrides, saveThemeValue } from '@/lib/website/content-store';
import { THEME_FIELDS } from '@/lib/website/collections';

// Readers retain historical values; only fields still exposed by Website may mutate.
const EDITABLE_THEME_KEYS = new Set(THEME_FIELDS.map(field => field.path));

export const dynamic = 'force-dynamic';

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** GET /api/store-admin/website/theme — live theme values plus override metadata. */
export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  const [values, overrides] = await Promise.all([getThemeSettings(), listThemeOverrides()]);
  return noStore({
    values,
    overrides: overrides.ok ? overrides.data : [],
    available: overrides.ok,
  });
}

/**
 * PUT /api/store-admin/website/theme — save changed theme values.
 *
 * Owner only. Keys are whitelisted against the field registry, so this route
 * can never stuff arbitrary rows into site_settings.
 */
export async function PUT(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { values?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStore({ error: 'Invalid request body.' }, 400);
  }

  const values = body.values;
  if (values === null || values === undefined || typeof values !== 'object' || Array.isArray(values)) {
    return noStore({ error: 'Send the values as an object.' }, 400);
  }

  const changed: string[] = [];
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    if (!THEME_SETTING_KEYS.has(key) || !EDITABLE_THEME_KEYS.has(key) || typeof value !== 'string') {
      rejected.push(key);
      continue;
    }
    const result = await saveThemeValue(key, value, guard.session.name);
    if (!result.ok) {
      await writeAudit({
        actorId: guard.session.adminId,
        actorEmail: guard.session.email,
        action: 'website.theme_save',
        entity: 'site_setting',
        entityId: key,
        status: 'failed',
        reason: 'database_error',
        request,
      });
      return noStore({ error: result.error }, 503);
    }
    changed.push(key);
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'website.theme_save',
    entity: 'site_setting',
    entityId: changed.length === 1 ? changed[0] : null,
    // Key names only — the values are not needed to reconstruct the change.
    after: { keys: changed, rejected },
    status: 'ok',
    reason: rejected.length ? 'some_keys_rejected' : undefined,
    request,
  });

  if (changed.length === 0) {
    return noStore({ ok: false, error: 'No known theme settings were sent.', rejected }, 400);
  }

  // The theme applies to every page: invalidate the whole layout.
  revalidatePath('/', 'layout');
  return noStore({ ok: true, saved: changed, rejected });
}

/**
 * DELETE /api/store-admin/website/theme?key=... — revert one value.
 *
 * Owner only. Archive, never delete: the previous value stays in the table so
 * the change is reversible.
 */
export async function DELETE(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const key = new URL(request.url).searchParams.get('key');
  if (!key || !THEME_SETTING_KEYS.has(key) || !EDITABLE_THEME_KEYS.has(key)) {
    return noStore({ error: 'Unknown setting key.' }, 400);
  }

  const result = await archiveThemeValue(key, guard.session.name);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'website.theme_reset',
    entity: 'site_setting',
    entityId: key,
    before: { edited: result.ok ? result.data : null },
    after: { edited: false, archived: true },
    status: result.ok ? 'ok' : 'failed',
    reason: result.ok ? undefined : 'database_error',
    request,
  });

  if (!result.ok) return noStore({ error: result.error }, 503);

  revalidatePath('/', 'layout');
  return noStore({ ok: true, archived: true });
}
