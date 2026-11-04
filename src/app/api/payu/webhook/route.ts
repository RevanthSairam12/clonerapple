import { NextRequest, NextResponse } from 'next/server';

import { readCallbackData } from '@/lib/payu/callback-route';
import { logPayUEvent, processPayUCallback } from '@/lib/payu/process-response';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

/**
 * PayU's server-to-server notification.
 *
 * This is the path that settles a payment when the customer never comes back:
 * the tab was closed, the phone lost signal, the bank app never returned. It
 * runs the same processor as the browser return, so both paths agree.
 *
 * Responses are deliberately small and payload-free:
 *   200 `{ status: 'ok' }`     — authentic and processed (including a repeat)
 *   400 `{ error: '<reason>' }` — authentic but refused, or an unusable payload
 *   429                         — rate limited
 *   500                         — transient server failure; PayU retries
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    // Rate limit: a gateway retry storm must not exhaust the pool.
    const limit = checkRateLimit(`payu-webhook-ip:${ip}`, { limit: 100, windowMs: 60 * 1000 });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const data = await readCallbackData(req);
    if (!data.txnid) {
      logPayUEvent('Webhook Bad Request', { error: 'Payload missing txnid' });
      return NextResponse.json({ error: 'Invalid payload: txnid required' }, { status: 400 });
    }

    const result = await processPayUCallback(data, 'webhook');

    if (!result.ok) {
      logPayUEvent('Webhook Verification Failed', {
        txnid: result.txnid,
        status: result.status,
        error: result.reason,
      });
      return NextResponse.json(
        { error: result.reason || 'Verification failed' },
        { status: result.retryable ? 500 : 400 },
      );
    }

    logPayUEvent('Webhook Processed Successfully', {
      txnid: result.txnid,
      status: result.status,
    });

    return NextResponse.json({ status: 'ok', txnid: result.txnid });
  } catch (err: unknown) {
    console.error('[PayU Webhook Error]:', (err as Error).message);
    // A 500 makes the gateway retry; the processor is idempotent, so a repeat
    // can never double-count.
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
