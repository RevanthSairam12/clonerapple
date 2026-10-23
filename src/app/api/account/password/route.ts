import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { passwordByteLength } from '@/lib/auth/validation';
import { changeUserPassword } from '@/lib/user-auth';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export async function POST(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const limited = checkRateLimit(`account-password:${auth.session.userId}`, { limit: 5, windowMs: 15 * 60 * 1000 });
  if (!limited.allowed) return NextResponse.json({ error: 'Too many password changes. Please try again later.' }, { status: 429 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (passwordByteLength(newPassword) < 8 || passwordByteLength(newPassword) > 72) {
    return NextResponse.json({ error: 'New password must be 8 to 72 UTF-8 bytes.' }, { status: 400 });
  }
  const result = await changeUserPassword(auth.session.userId, currentPassword, newPassword);
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: 400 });
}
