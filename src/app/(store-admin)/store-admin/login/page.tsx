import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { StoreAdminLoginForm } from '@/components/store-admin/StoreAdminLoginForm';
import { getStoreSession } from '@/lib/store-admin/auth';

export const metadata: Metadata = {
  title: 'Store Desk — Sign in',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function StoreAdminLoginPage() {
  const session = await getStoreSession();
  if (session) redirect('/store-admin');

  return (
    <main className="sa-shell sa-login-wrap">
      <div className="sa-login-card">
        <p className="sa-kicker">Gadzio Store Desk</p>
        <h1 className="sa-login-title">Operations sign-in</h1>
        <p className="sa-login-sub">For store staff only. Every action is audited.</p>
        <StoreAdminLoginForm />
        <p className="sa-login-foot">
          Separate from the content admin. Sessions expire after seven days.
        </p>
      </div>
    </main>
  );
}
