import { NextResponse } from 'next/server';
import { getUserSession } from '@/lib/user-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getUserSession();
    if (!session) {
      return NextResponse.json({ authenticated: false, user: null });
    }
    return NextResponse.json({
      authenticated: true,
      user: {
        userId: session.userId,
        email: session.email,
        firstName: session.firstName,
        lastName: session.lastName,
      },
    });
  } catch (error) {
    console.error('[api/auth/me] error:', error);
    return NextResponse.json({ authenticated: false, user: null }, { status: 500 });
  }
}
