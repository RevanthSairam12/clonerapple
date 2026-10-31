import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { closeCustomerAccount } from '@/lib/account/data-management';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const limited = checkRateLimit(`account-close:${auth.session.userId}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json(
      { error: 'Please enter your email and password to confirm.' },
      { status: 400 },
    );
  }

  const result = await closeCustomerAccount(auth.session.userId, email, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const response = NextResponse.json({
    success: true,
    message: 'Your account has been closed.',
  });

  // Clear session cookie
  response.cookies.delete('user_session');

  return response;
}
