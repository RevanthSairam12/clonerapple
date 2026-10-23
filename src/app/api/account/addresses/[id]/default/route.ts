import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { setDefaultCustomerAddress } from '@/lib/account/addresses';
import { checkRateLimit } from '@/lib/payu/rate-limit';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const limited = checkRateLimit(`account-address:${auth.session.userId}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) return NextResponse.json({ error: 'Too many address changes. Please try again later.' }, { status: 429 });
  const { id } = await context.params;
  const updated = await setDefaultCustomerAddress(auth.session.userId, id);
  return updated ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Address not found.' }, { status: 404 });
}
