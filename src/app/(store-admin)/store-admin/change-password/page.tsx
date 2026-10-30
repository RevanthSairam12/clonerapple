import { redirect } from 'next/navigation';
import { getStoreSession } from '@/lib/store-admin/auth';
import { StaffPasswordForm } from '@/components/store-admin/StaffPasswordForm';
import { StoreSessionMonitor } from '@/components/store-admin/StoreSessionMonitor';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await getStoreSession({ allowPasswordChange: true });
  if (!session) redirect('/store-admin/login?reason=account-unavailable');
  if (!session.mustChangePassword) redirect('/store-admin');
  return <main className="sa-shell sa-login-wrap">
    <StoreSessionMonitor role={session.role} mustChangePassword />
    <section className="sa-login-card">
      <h1 className="sa-login-title">Change your temporary password</h1>
      <p className="sa-notice">Choose a new password before accessing Store Desk.</p>
      <StaffPasswordForm forced />
    </section>
  </main>;
}
