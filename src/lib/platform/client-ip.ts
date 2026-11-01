import { headers } from 'next/headers';

/**
 * Best-effort client IP from proxy headers; '' when unknown.
 *
 * Shared by every server-side login guard (Store Admin and the customer
 * account) and by the legacy panel until it is removed. The value is only
 * ever hashed before it is stored or written to an audit row — never logged
 * or persisted raw.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || '';
}
