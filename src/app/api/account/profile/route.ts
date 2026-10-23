import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { requireAccountSessionApi } from '@/lib/account/auth';
import { normalizeName } from '@/lib/auth/validation';
import { updateUserProfile } from '@/lib/user-auth';
import { checkRateLimit } from '@/lib/payu/rate-limit';

export async function PATCH(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;
  const limited = checkRateLimit(`account-profile:${auth.session.userId}`, { limit: 10, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) return NextResponse.json({ error: 'Too many profile changes. Please try again later.' }, { status: 429 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const firstName = normalizeName(body?.firstName);
  const lastName = normalizeName(body?.lastName);
  const phone = typeof body?.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
  if (firstName.length < 2 || lastName.length < 1) return NextResponse.json({ error: 'Please enter your first and last name.' }, { status: 400 });
  if (phone && !/^\d{10}$/.test(phone)) return NextResponse.json({ error: 'Phone must contain 10 digits.' }, { status: 400 });
  const user = await updateUserProfile(auth.session.userId, { firstName, lastName, phone });
  return user ? NextResponse.json({ user }) : NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
}
