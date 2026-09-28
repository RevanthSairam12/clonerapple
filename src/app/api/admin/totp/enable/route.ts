import { NextResponse } from 'next/server';

import { assertSameOrigin, requireEditor } from '@/lib/admin/api-guard';
import {
  enableTotp,
  getTotpStatus,
  hashRecoveryCode,
  loadEditorTotp,
  newRecoveryCode,
  verifyTotp,
} from '@/lib/admin/totp';

/**
 * POST /api/admin/totp/enable — confirm enrollment. The editor submits a code
 * from their authenticator; on success TOTP is activated and a one-time
 * recovery code is returned (bcrypt-hashed at rest, shown exactly once).
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const status = await getTotpStatus(guard.userId);
  if (status.enabled) {
    return NextResponse.json({ error: 'Two-factor authentication is already enabled.' }, { status: 409 });
  }

  const totp = await loadEditorTotp(guard.userId);
  if (!totp.secret) {
    return NextResponse.json({ error: 'Start enrollment first (no pending secret).' }, { status: 400 });
  }

  const code = (body.code ?? '').trim();
  if (!verifyTotp(totp.secret, code)) {
    return NextResponse.json({ error: 'That code is not valid — check your authenticator and try again.' }, { status: 400 });
  }

  const recoveryCode = newRecoveryCode();
  await enableTotp(guard.userId, await hashRecoveryCode(recoveryCode));

  return NextResponse.json({ ok: true, recoveryCode });
}
