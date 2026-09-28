import { NextResponse } from 'next/server';

import { assertSameOrigin, requireEditor } from '@/lib/admin/api-guard';
import { disableTotp, getTotpStatus, loadEditorTotp, verifyTotp } from '@/lib/admin/totp';
import bcrypt from 'bcryptjs';

/**
 * POST /api/admin/totp/disable — turn 2FA off. Requires BOTH a valid current
 * TOTP code and the account password, so a stolen session cookie alone
 * cannot silently remove the second factor.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  let body: { code?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const status = await getTotpStatus(guard.userId);
  if (!status.enabled) {
    return NextResponse.json({ error: 'Two-factor authentication is not enabled.' }, { status: 400 });
  }

  const totp = await loadEditorTotp(guard.userId);
  if (!totp.secret || !verifyTotp(totp.secret, (body.code ?? '').trim())) {
    return NextResponse.json({ error: 'Invalid verification code.' }, { status: 400 });
  }

  // Password re-check: the session alone must not be enough to weaken login.
  const { getSql } = await import('@/lib/admin/db');
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  const rows = await sql`select password_hash from admin_users where id = ${guard.userId}`;
  if (!rows[0] || !(await bcrypt.compare(body.password ?? '', rows[0].password_hash))) {
    return NextResponse.json({ error: 'Password is incorrect.' }, { status: 400 });
  }

  await disableTotp(guard.userId);
  return NextResponse.json({ ok: true });
}
