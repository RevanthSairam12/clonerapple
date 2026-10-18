import { NextRequest, NextResponse } from 'next/server';
import { reconcilePendingOrders } from '@/lib/payu/reconcile';

export const runtime = 'nodejs';

/**
 * Scheduled job endpoint for order reconciliation.
 * Call every 10-15 minutes via cron service.
 * Protected by CRON_SECRET header or query parameter.
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const url = new URL(req.url);
    const querySecret = url.searchParams.get('secret');

    const expectedSecret = process.env.CRON_SECRET;
    if (expectedSecret) {
      const token = authHeader?.replace(/^Bearer\s+/i, '') || querySecret;
      if (token !== expectedSecret) {
        return NextResponse.json({ error: 'Unauthorized: Invalid cron secret' }, { status: 401 });
      }
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
