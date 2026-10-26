import { NextRequest, NextResponse } from 'next/server';
import { processNotificationOutbox, scrubOldNotifications } from '@/lib/notifications/outbox';
import { authorizeCronRequest } from '@/lib/payu/cron-auth';
import { reconcilePendingOrders } from '@/lib/payu/reconcile';

export const runtime = 'nodejs';

/**
 * Scheduled job endpoint for reservations, payment reconciliation and the
 * waiting list.
 *
 * Call every minute from the deployment's scheduler with
 * `Authorization: Bearer $CRON_SECRET`. Each tick claims due order rows with a
 * database lease, verifies them against PayU, releases reservations whose
 * window or failure grace ended, flags payments that stay unresolved, expires
 * waiting-list invitations and offers newly free units to the next customer.
 * Missing `CRON_SECRET` fails closed in production (503) because abandoned
 * checkouts hold stock and would otherwise never be released.
 *
 * This is also the notification retry tick: after reconciling it drains a
 * small batch of due outbox rows, so a message whose best-effort after()
 * delivery failed is retried even when nobody is browsing the store. The cron
 * secret is the same; no public notification route exists.
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
    const limit = parseInt(url.searchParams.get('limit') || '25', 10);
    const summary = await reconcilePendingOrders({
      staleMinutes: Number.isFinite(staleMinutes) ? staleMinutes : 15,
      limit: Number.isFinite(limit) ? limit : 25,
    });
    // Best-effort and bounded: a mail outage must not look like a failed
    // reconciliation. processNotificationOutbox() never throws.
    const notifications = await processNotificationOutbox(10);
    // Optional and off by default. When NOTIFICATION_RETENTION_ENABLED is set,
    // old finished rows lose their body and recipient but keep their history.
    const retention = await scrubOldNotifications();

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary,
      notifications,
      retention,
    });
  } catch (err: unknown) {
    console.error('[Reconciliation Endpoint Error]:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
