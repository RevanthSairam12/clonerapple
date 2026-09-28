import { NextResponse } from 'next/server';

import { assertSameOrigin, requireEditor } from '@/lib/admin/api-guard';
import { getTotpStatus, totpQrDataUri, totpUrl, newTotpSecret, savePendingSecret } from '@/lib/admin/totp';

/**
 * POST /api/admin/totp/setup — start enrollment for the signed-in editor.
 * Generates a pending secret (not yet active) and returns the otpauth URL +
 * QR so the editor can add it to their authenticator. Enrollment is only
 * confirmed by POST /enable with a valid code.
 */
export async function POST(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const guard = await requireEditor();
  if (!guard.ok) return guard.response;

  const status = await getTotpStatus(guard.userId);
  if (status.pending) {
    return NextResponse.json(
      { error: 'An enrollment is already in progress — submit a code to confirm, or reload the page to restart.' },
      { status: 409 },
    );
  }

  const secret = newTotpSecret();
  await savePendingSecret(guard.userId, secret);

  const url = totpUrl(guard.email, secret);
  const qr = await totpQrDataUri(url);
  return NextResponse.json({ ok: true, url, qr });
}
