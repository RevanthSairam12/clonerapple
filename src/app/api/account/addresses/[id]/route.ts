import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { deleteCustomerAddress, updateCustomerAddress } from '@/lib/account/addresses';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const limited = checkRateLimit(`account-address:${auth.session.userId}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) return NextResponse.json({ error: 'Too many address changes. Please try again later.' }, { status: 429 });
  const { id } = await context.params;
  try {
    const address = await updateCustomerAddress(auth.session.userId, id, await request.json());
    if (!address) return NextResponse.json({ error: 'Address not found.' }, { status: 404 });
    return NextResponse.json({ address });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update address.' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const limited = checkRateLimit(`account-address:${auth.session.userId}`, { limit: 20, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) return NextResponse.json({ error: 'Too many address changes. Please try again later.' }, { status: 429 });
  const { id } = await context.params;
  const deleted = await deleteCustomerAddress(auth.session.userId, id);
  return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Address not found.' }, { status: 404 });
}
