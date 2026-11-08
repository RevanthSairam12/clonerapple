import { NextRequest, NextResponse } from 'next/server';
import { pruneOldBrowsingHistory } from '@/lib/account/browsing-history';
import { processNotificationOutbox, scrubOldNotifications } from '@/lib/notifications/outbox';
import { authorizeCronRequest } from '@/lib/payu/cron-auth';
import { reconcilePendingOrders } from '@/lib/payu/reconcile';
import { recordReconcileHeartbeat } from '@/lib/payu/reconcile-heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Scheduled job endpoint for reservations and payment reconciliation.
 *
 * Call every minute from the deployment's scheduler with
 * `Authorization: Bearer $CRON_SECRET`. Vercel Cron invokes scheduled routes
 * with `GET` and sends `Authorization: Bearer $CRON_SECRET`; external
 * schedulers and pg_net may call either `GET` or `POST`.
 *
 * Each tick claims due order rows with a database lease, verifies them against
 * PayU, releases reservations whose window or failure grace ended, flags
 * payments that stay unresolved, and updates the `payu_reconcile` heartbeat row
 * in `background_job_heartbeats`.
 *
 * `GET` always requires `CRON_SECRET` to be configured and matched in constant
 * time so an unauthenticated GET request never produces side effects.
 */
async function runReconcileJob(req: NextRequest, options: { requireSecret: boolean }) {
  try {
    const url = new URL(req.url);
    const authorization = authorizeCronRequest({
      expectedSecret: process.env.CRON_SECRET,
      authorization: req.headers.get('authorization'),
      querySecret: url.searchParams.get('secret'),
      isProduction: options.requireSecret || process.env.NODE_ENV === 'production',
    });
    if (!authorization.ok) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status, headers: { 'Cache-Control': 'no-store' } },
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
    // Prune browsing history older than 90 days. Never deletes anything else.
    const prunedHistoryCount = await pruneOldBrowsingHistory(90);

    return NextResponse.json(
      {
        success: true,
        timestamp: new Date().toISOString(),
        summary,
        notifications,
        retention,
        prunedHistoryCount,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err: unknown) {
    console.error('[Reconciliation Endpoint Error]:', (err as Error).message);
    await recordReconcileHeartbeat({
      processedCount: 0,
      lastError: 'Reconciliation endpoint error.',
      succeeded: false,
    }).catch(() => {});
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function GET(req: NextRequest) {
  return runReconcileJob(req, { requireSecret: true });
}

export async function POST(req: NextRequest) {
  return runReconcileJob(req, { requireSecret: false });
}
