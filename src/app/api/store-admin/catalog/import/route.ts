import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { writeAudit } from '@/lib/store-admin/audit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { templateCsv } from '@/lib/store-admin/catalog-csv';
import { runCatalogueImport } from '@/lib/store-admin/catalog-transfer';
import { catalogFailureStatus } from '@/lib/store-admin/catalog-writes';
import { cleanFilename } from '@/lib/store-admin/media-rules';

/**
 * Bulk catalogue import. GET downloads the template; POST validates or applies
 * a file.
 *
 * All-or-nothing: every row is validated before anything is written, and the
 * commit runs in one transaction. A 5,000-row file either lands completely or
 * not at all, and the per-row errors stay downloadable from
 * `/api/store-admin/catalog/import/[id]/errors`.
 */
export const dynamic = 'force-dynamic';

const MAX_CSV_BYTES = 12 * 1024 * 1024;

export async function GET() {
  const guard = await requireStoreRole();
  if (!guard.ok) return guard.response;

  // A BOM makes Excel read the file as UTF-8; the importer strips it again.
  return new Response(`﻿${templateCsv()}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="catalog-import-template.csv"',
      'cache-control': 'no-store',
    },
  });
}

export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_admin');
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const payload = (body ?? {}) as Record<string, unknown>;
  if (typeof payload.csv !== 'string' || !payload.csv.trim()) {
    return NextResponse.json({ error: 'Paste or upload a CSV file.' }, { status: 400 });
  }
  if (payload.csv.length > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'The file must be 12 MB or smaller.' }, { status: 413 });
  }

  const filename = cleanFilename(
    typeof payload.filename === 'string' && payload.filename.trim()
      ? payload.filename
      : 'catalog.csv',
  );
  const dryRun = payload.dryRun !== false;

  const result = await runCatalogueImport({
    csv: payload.csv,
    filename,
    dryRun,
    staffId: guard.session.adminId,
  });

  if (!result.ok) {
    await writeAudit({
      actorId: guard.session.adminId,
      actorEmail: guard.session.email,
      action: 'catalog.import',
      entity: 'catalog_import',
      status: 'denied',
      reason: result.reason,
      after: { filename, mode: dryRun ? 'dry_run' : 'commit' },
      request,
    });
    return NextResponse.json(
      { error: result.error },
      { status: catalogFailureStatus(result.reason) },
    );
  }

  const { importId, status, total, created, updated, failed, errors, errorCount } = result.data;

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'catalog.import',
    entity: 'catalog_import',
    entityId: importId,
    after: {
      filename,
      mode: dryRun ? 'dry_run' : 'commit',
      status,
      rows_total: total,
      rows_created: created,
      rows_updated: updated,
      rows_failed: failed,
    },
    reason: dryRun ? 'import_validated' : status === 'imported' ? 'import_applied' : 'import_rejected',
    request,
  });

  return NextResponse.json({
    ok: true,
    importId,
    dryRun,
    status,
    total,
    created,
    updated,
    failed,
    errorCount,
    // The report holds every error; the page shows the first screenful.
    errors: errors.slice(0, 200),
    errorReportUrl: `/api/store-admin/catalog/import/${importId}/errors`,
  });
}
