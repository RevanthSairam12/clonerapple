import type { Metadata } from 'next';

import { AdminSecurityClient } from '@/components/admin/AdminSecurityClient';
import { getSession } from '@/lib/admin/auth';
import { getTotpStatus } from '@/lib/admin/totp';

export const metadata: Metadata = {
  title: 'Admin — Security',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * /admin/security — two-factor enrollment for the signed-in editor.
 * Server shell reads the editor's TOTP state; the interactive flow (QR →
 * confirm code → recovery code) is AdminSecurityClient, a proper client
 * component so it works after client-side navigation too.
 */
export default async function AdminSecurityPage() {
  const session = await getSession();
  const status = session ? await getTotpStatus(session.userId) : { enabled: false, pending: false };

  return (
    <div>
      <div className="admin-topbar">
        <div>
          <h1 className="admin-topbar-title">🔐 Security</h1>
          <p className="admin-topbar-sub">Two-factor authentication for your editor account</p>
        </div>
      </div>
      <div className="admin-content">
        <div className="admin-card" style={{ maxWidth: 640 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 22 }} aria-hidden>{status.enabled ? '🔐' : '🔓'}</span>
            <h2 className="admin-card-title" style={{ margin: 0 }}>
              Two-factor authentication is {status.enabled ? 'ON' : 'off'}
            </h2>
          </div>
          <p className="admin-hint" style={{ margin: '0 0 16px' }}>
            {status.enabled
              ? 'Sign-in requires your password and a code from your authenticator. Keep your recovery code somewhere safe — it is the only way in if you lose your device.'
              : 'Add a second factor so a stolen password alone cannot sign in to the admin panel. Works with Google Authenticator, Authy, 1Password, Microsoft Authenticator, and any RFC 6238 app.'}
          </p>
          <AdminSecurityClient enabled={status.enabled} />
        </div>
      </div>
    </div>
  );
}
