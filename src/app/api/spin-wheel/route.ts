import { NextResponse } from 'next/server';

import { getCustomerSpinState } from '@/lib/spin-wheel/store';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';
import { getUserSession } from '@/lib/user-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET() {
  const closed = await requireStorefrontOpen();
  if (closed) return closed;

  const session = await getUserSession();
  const state = await getCustomerSpinState(session?.userId ?? null);

  return NextResponse.json(state, { headers: NO_STORE });
}

