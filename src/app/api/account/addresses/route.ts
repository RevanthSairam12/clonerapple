import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { createCustomerAddress, listCustomerAddresses } from '@/lib/account/addresses';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ addresses: await listCustomerAddresses(auth.session.userId) });
}

export async function POST(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const limited = checkRateLimit(`account-address:${auth.session.userId}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) return NextResponse.json({ error: 'Too many address changes. Please try again later.' }, { status: 429 });
  try {
    const address = await createCustomerAddress(auth.session.userId, await request.json());
    return NextResponse.json({ address }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save address.' }, { status: 400 });
  }
}
