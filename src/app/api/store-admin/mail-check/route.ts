import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { getSql } from '@/lib/platform/db';
import {
  checkMailConnection,
  sendTestEmail,
  sendTestSms,
  type CheckResult,
} from '@/lib/notifications/diagnostics';
import { readNotificationSettings } from '@/lib/notifications/settings';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { maskEmail, maskPhone, writeAudit } from '@/lib/store-admin/audit';

export const dynamic = 'force-dynamic';

/** A few checks per hour per owner: each one opens a real connection. */
export const MAIL_CHECK_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const;

const ACTIONS = ['verify-mail', 'test-email', 'test-sms'] as const;
type Action = (typeof ACTIONS)[number];

const AUDIT_ACTION: Record<Action, string> = {
  'verify-mail': 'mail.check_connection',
  'test-email': 'mail.send_test_email',
  'test-sms': 'sms.send_test',
};

/**
 * POST /api/store-admin/mail-check  { action, to? }
 *
 * Owner only. `verify-mail` connects and logs in to SMTP without sending;
 * `test-email` and `test-sms` send one clearly labelled message to the address
 * or number the owner typed. The response is a plain-words result, never a
 * secret and never a raw error.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  let body: { action?: unknown; to?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const action = ACTIONS.find((candidate) => candidate === body.action);
  if (!action) {
    return NextResponse.json({ error: 'Unknown check.' }, { status: 400 });
  }
  const to = typeof body.to === 'string' ? body.to.trim().slice(0, 200) : '';
  if (action !== 'verify-mail' && !to) {
    return NextResponse.json(
      { error: action === 'test-email' ? 'Type an email address.' : 'Type a phone number.' },
      { status: 400 },
    );
  }

  const limit = checkRateLimit(`mail-check:${guard.session.adminId}`, MAIL_CHECK_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many checks. Try again later.', retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json({ error: 'Settings are not available.' }, { status: 503 });
  }

  let outcome: CheckResult;
  try {
    const settings = await readNotificationSettings(sql);
    if (action === 'verify-mail') outcome = await checkMailConnection(settings);
    else if (action === 'test-email') outcome = await sendTestEmail(settings, to);
    else outcome = await sendTestSms(settings, to);
  } catch {
    outcome = { ok: false, code: 'unknown', message: 'The check could not run. Nothing was sent.' };
  }

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: AUDIT_ACTION[action],
    entity: 'notification_channel',
    entityId: action === 'test-sms' ? 'sms' : 'email',
    after: {
      outcome: outcome.code,
      ok: outcome.ok,
      ...(action === 'test-email' ? { recipient_email: maskEmail(to) } : {}),
      ...(action === 'test-sms' ? { recipient_phone: maskPhone(to) } : {}),
    },
    status: outcome.ok ? 'ok' : 'failed',
    reason: outcome.code,
    request,
  });

  return NextResponse.json(
    { ok: outcome.ok, code: outcome.code, message: outcome.message },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
