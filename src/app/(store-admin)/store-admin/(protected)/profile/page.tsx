import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ProfilePanel } from '@/components/store-admin/ProfilePanel';
import { currentStoreTokenHash, getStoreSession } from '@/lib/store-admin/auth';
import { getStaff, listStaffSessions } from '@/lib/store-admin/staff';

export const dynamic = 'force-dynamic';

export default async function StoreAdminProfilePage() {
  const session = await getStoreSession();
  if (!session) redirect('/store-admin/login');

  const [profile, tokenHash] = await Promise.all([
    getStaff(session.adminId),
    currentStoreTokenHash(),
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

      {profile.ok ? (
        <ProfilePanel
          profile={profile.data}
          sessions={sessions.ok ? sessions.data : []}
        />
      ) : (
        <p className="sa-notice">
          Your profile could not be read. Apply migration 0029 and check the database connection.
        </p>
      )}
    </div>
  );
}
