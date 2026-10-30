import { NextResponse } from 'next/server';

import {
  MAINTENANCE_RETRY_AFTER_SECONDS,
  getMaintenanceState,
  maintenanceMessage,
} from './maintenance';

/**
 * In-route maintenance guard for the customer APIs that start or change a
 * purchase.
 *
 * The proxy already answers these with 503 before the route runs. This is the
 * second layer: a direct server-to-server call that somehow skips the proxy,
 * or a future route the matcher misses, still cannot create an order while the
 * storefront is closed. Fails open, like every other maintenance read.
 */
export async function requireStorefrontOpen(): Promise<NextResponse | null> {
  const state = await getMaintenanceState();
  if (!state.active) return null;

  return NextResponse.json(
    {
      error: maintenanceMessage(state),
      code: 'maintenance',
      endsAt: state.endsAt,
    },
    {
      status: 503,
      headers: {
        'Retry-After': String(MAINTENANCE_RETRY_AFTER_SECONDS),
        'Cache-Control': 'no-store',
      },
    },
  );
}
