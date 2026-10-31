import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { exportCustomerData } from '@/lib/account/data-management';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const limited = checkRateLimit(`account-export:${auth.session.userId}`, {
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many export attempts. Please try again later.' },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!password) {
    return NextResponse.json({ error: 'Please enter your password.' }, { status: 400 });
  }

  const result = await exportCustomerData(auth.session.userId, password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const jsonString = JSON.stringify(result.data, null, 2);
  return new NextResponse(jsonString, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="gadzio-customer-data.json"',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
