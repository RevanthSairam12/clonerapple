import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/payu/cron-auth';
import { reconcilePendingOrders } from '@/lib/payu/reconcile';

export const runtime = 'nodejs';

/**
 * Scheduled job endpoint for order reconciliation.
 *
 * Call every 10 minutes from the deployment's scheduler with
 * `Authorization: Bearer $CRON_SECRET`. It verifies stale pending orders and
 * expires unpaid ones after `auto_cancel_unpaid_hours`, releasing their stock
 * claim. Missing `CRON_SECRET` fails closed in production (503) because stale
 * orders now hold stock.
 */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const authorization = authorizeCronRequest({
      expectedSecret: process.env.CRON_SECRET,
      authorization: req.headers.get('authorization'),
      querySecret: url.searchParams.get('secret'),
      isProduction: process.env.NODE_ENV === 'production',
    });
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }

    const staleMinutes = parseInt(url.searchParams.get('staleMinutes') || '15', 10);
    const summary = await reconcilePendingOrders(staleMinutes);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary,
    });
  } catch (err: unknown) {
    console.error('[Reconciliation Endpoint Error]:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
