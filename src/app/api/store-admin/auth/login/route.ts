import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { login, storeSessionCookie } from '@/lib/store-admin/auth';
import { writeAudit } from '@/lib/store-admin/audit';

/**
 * POST /api/store-admin/auth/login
 *
 * Public by design — the only store-admin API that does not call
 * `requireStoreRole()`. CSRF is still checked, credentials are rate-limited by
 * `login()` (5 failures / 15 minutes per email and per IP), and every attempt
 * writes an audit row with a masked email.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  let body: { email?: string; password?: string; totpCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const email = (body.email ?? '').trim();
  const password = body.password ?? '';
  const totpCode = body.totpCode;

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password are required.' },
      { status: 400 },
    );
  }
  if (email.length > 254 || password.length > 200 || (totpCode && totpCode.length > 64)) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 400 });
  }

  const result = await login(email, password, totpCode);

  if (!result.ok) {
    await writeAudit({
      action: 'store_admin.login',
      entity: 'store_admin',
      actorEmail: email,
      status: result.status === 429 ? 'locked' : 'denied',
      reason:
        result.status === 429
          ? 'rate_limited'
          : result.codeRequired
            ? 'totp_required'
            : 'invalid_credentials',
      request,
    });

    return NextResponse.json(
      { error: result.error, codeRequired: result.codeRequired ?? false },
      result.retryAfterSec
        ? { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
        : { status: 401 },
    );
  }

  const store = await cookies();
  store.set(storeSessionCookie.name, result.token, storeSessionCookie.options);

  await writeAudit({
    actorId: result.adminId,
    actorEmail: email,
    action: 'store_admin.login',
    entity: 'store_admin',
    entityId: result.adminId,
    status: 'ok',
    request,
  });

  return NextResponse.json({
    ok: true,
    role: result.role,
    mustChangePassword: result.mustChangePassword,
  });
}
