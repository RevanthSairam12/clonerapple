import { NextResponse } from 'next/server';
import { requireStoreRole } from '@/lib/store-admin/auth';

export const dynamic = 'force-dynamic';

/** A read-only, uncached check: every poll revalidates the live account and role. */
export async function GET() {
  const guard = await requireStoreRole({ allowPasswordChange: true });
  if (!guard.ok) return guard.response;
  return NextResponse.json({
    role: guard.session.role, mustChangePassword: guard.session.mustChangePassword,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
