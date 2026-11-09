import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { checkSiteAddressHealth } from '@/lib/payu/config';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { requireStoreRole } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';

export const dynamic = 'force-dynamic';

/** Bounded per owner: each check issues an outbound HTTP probe to APP_BASE_URL. */
export const SITE_ADDRESS_CHECK_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 } as const;

/**
 * POST /api/store-admin/site-address-check
 *
 * Owner-only diagnostic that probes the configured `APP_BASE_URL` and reports
 * reachability, HTTPS protocol, whether the host is a tunnel host, and whether
 * it is ready for production PayU callbacks. Never echoes secrets or raw URLs
 * containing credentials.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireStoreRole('store_owner');
  if (!guard.ok) return guard.response;

  const limit = checkRateLimit(
    `site-address-check:${guard.session.adminId}`,
    SITE_ADDRESS_CHECK_LIMIT,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many checks. Try again later.', retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  const outcome = await checkSiteAddressHealth(process.env);

  await writeAudit({
    actorId: guard.session.adminId,
    actorEmail: guard.session.email,
    action: 'payments.check_site_address',
    entity: 'site_address',
    entityId: 'APP_BASE_URL',
    after: {
      code: outcome.code,
      configured: outcome.configured,
      valid: outcome.valid,
      https: outcome.https,
      isTunnel: outcome.isTunnel,
      isLocalhost: outcome.isLocalhost,
      reachable: outcome.reachable,
      statusCode: outcome.statusCode,
      productionReady: outcome.productionReady,
    },
    status: outcome.ok ? 'ok' : 'failed',
    reason: outcome.code,
    request,
  });

  return NextResponse.json(outcome, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
