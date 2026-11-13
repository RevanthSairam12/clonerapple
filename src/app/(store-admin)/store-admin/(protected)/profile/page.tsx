import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getStoreTimeZone } from '@/lib/store-admin/store-clock';
import { ProfilePanel } from '@/components/store-admin/ProfilePanel';
import { currentStoreTokenHash, getStoreSession, isOwnerTwoFactorRequired } from '@/lib/store-admin/auth';
import { getStaff, listStaffSessions } from '@/lib/store-admin/staff';
import { getTotpState } from '@/lib/store-admin/totp';

export const dynamic = 'force-dynamic';

export default async function StoreAdminProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ require2fa?: string }>;
}) {
  const session = await getStoreSession();
  if (!session) redirect('/store-admin/login');

  const [params, ownerTwoFactorRequired] = await Promise.all([
    searchParams,
    session.role === 'store_owner' ? isOwnerTwoFactorRequired() : Promise.resolve(false),
  ]);

  const [profile, tokenHash, totp] = await Promise.all([
    getStaff(session.adminId),
    currentStoreTokenHash(),
    getTotpState(session.adminId),
  ]);
  const sessions = await listStaffSessions(session.adminId, tokenHash);

  return (
    <div>
      <Link className="sa-back" href="/store-admin">← Overview</Link>
      <h1 className="sa-page-title">Your profile</h1>
      <p className="sa-page-sub">
        Your name, contact number, password and signed-in devices. Account role and status are
        managed by an owner on the Staff &amp; roles screen.
      </p>
      {session.role === 'store_owner' && !totp.enabled && (params.require2fa === '1' || ownerTwoFactorRequired) && (
        <p className="sa-notice" role="alert">
          Two-factor authentication is required for store owner accounts. Set up your authenticator
          app below to continue using Store Desk.
        </p>
      )}

      {profile.ok ? (
        <ProfilePanel
          timeZone={await getStoreTimeZone()}
          profile={profile.data}
          sessions={sessions.ok ? sessions.data : []}
          totp={totp}
        />
      ) : (
        <p className="sa-notice">
          Your profile could not be read. Apply migration 0029 and check the database connection.
        </p>
      )}
    </div>
  );
}
