import { NextRequest, NextResponse } from 'next/server';
import { processPayUCallback, PayUResponseData, logPayUEvent } from '@/lib/payu/process-response';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export const runtime = 'nodejs';

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

async function parseWebhookPayload(req: NextRequest): Promise<PayUResponseData> {
  const contentType = req.headers.get('content-type') || '';
  const data: PayUResponseData = {};

  if (contentType.includes('application/json')) {
    const json = await req.json().catch(() => ({}));
    Object.assign(data, json);
  } else {
    try {
      const formData = await req.formData();
      for (const [key, value] of formData.entries()) {
        data[key] = typeof value === 'string' ? value : value.name;
      }
    } catch {
      // Fallback: parse raw text as urlencoded
      const text = await req.text().catch(() => '');
      if (text) {
        const params = new URLSearchParams(text);
        for (const [key, value] of params.entries()) {
          data[key] = value;
        }
      }
    }
  }

  return data;
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    // Rate limit: max 100 webhook requests per minute
    const limit = checkRateLimit(`payu-webhook-ip:${ip}`, { limit: 100, windowMs: 60 * 1000 });
    if (!limit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const data = await parseWebhookPayload(req);
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
        { status: 400 }
      );
    }

    logPayUEvent('Webhook Processed Successfully', {
      txnid: result.txnid,
      status: result.status,
    });

    return NextResponse.json({ status: 'ok', txnid: result.txnid });
  } catch (err: unknown) {
    console.error('[PayU Webhook Error]:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
