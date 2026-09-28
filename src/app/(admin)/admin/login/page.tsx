import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdminLoginForm } from '@/components/admin/AdminLoginForm';
import { getSession } from '@/lib/admin/auth';

export const metadata: Metadata = {
  title: 'Admin — Sign in',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  const session = await getSession();
  if (session) redirect('/admin');

  return (
    <div className="admin-login">
      <div className="admin-login-card">
        <div className="admin-login-logo">✎</div>
        <h1 className="admin-login-title">Content Admin</h1>
        <p className="admin-login-sub">Sign in with your editor account</p>
        <AdminLoginForm />
      </div>
    </div>
  );
}
