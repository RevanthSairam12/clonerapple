'use client';

import { useState } from 'react';

export function StoreAdminLogoutButton() {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="sa-btn sa-btn-quiet"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch('/api/store-admin/auth/logout', { method: 'POST' });
        } catch {
          // Redirect regardless: the UI must not appear signed in after the
          // operator has asked to leave. The cookie expires server-side too.
        }
        window.location.href = '/store-admin/login';
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
