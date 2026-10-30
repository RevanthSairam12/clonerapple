'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function StoreSessionMonitor({ role, mustChangePassword = false }: {
  role: string; mustChangePassword?: boolean;
}) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    let pending = false;
    async function check() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch('/api/store-admin/auth/session', { cache: 'no-store' });
        if (stopped) return;
        if (response.status === 401) {
          window.location.replace('/store-admin/login?reason=account-unavailable');
          return;
        }
        if (!response.ok) return;
        const session = await response.json();
        if (stopped) return;
        if (session.mustChangePassword && !mustChangePassword) {
          window.location.replace('/store-admin/change-password');
        } else if (!session.mustChangePassword && mustChangePassword) {
          window.location.replace('/store-admin');
        } else if (session.role !== role) router.refresh();
      } catch { /* A transient network error is not proof of a revoked session. */ }
      finally { pending = false; }
    }
    const interval = window.setInterval(check, 30_000);
    window.addEventListener('focus', check);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisible);
    void check();
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [role, mustChangePassword, router]);
  return null;
}
