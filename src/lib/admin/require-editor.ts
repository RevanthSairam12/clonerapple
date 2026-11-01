import { NextResponse } from 'next/server';

import { getSession, type EditorSession } from './auth';

/**
 * Guard for the legacy /api/admin routes.
 *
 * Legacy-only: Store Admin uses `requireStoreRole()` from
 * `@/lib/store-admin/auth`. This module disappears together with the panel.
 */
export async function requireEditor(): Promise<
  | { ok: true; email: string; userId: string; session: EditorSession }
  | { ok: false; response: NextResponse }
> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true, email: session.email, userId: session.userId, session };
}
