import { NextResponse } from 'next/server';

import { requireStoreRole } from '@/lib/store-admin/auth';
import { exportFreeGiftsCsv } from '@/lib/store-admin/free-gifts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const guard = await requireStoreRole('store_viewer');
  if (!guard.ok) return guard.response;

  const result = await exportFreeGiftsCsv({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    request,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  return new NextResponse(`\uFEFF${result.csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

