import type { Metadata } from 'next';

import { getMaintenanceState } from '@/lib/storefront/maintenance';
import { maintenanceView } from '@/lib/storefront/maintenance-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Scheduled maintenance',
  robots: { index: false, follow: false },
};

/**
 * The maintenance page.
 *
 * Two jobs: it is the address staff can open to preview what customers see, and
 * it is the content the proxy serves as the 503 body for blocked storefront
 * requests (`renderMaintenanceDocument`). The copy comes from the same
 * `maintenanceView` either way.
 */
export default async function MaintenancePage() {
  const state = await getMaintenanceState();
  const view = maintenanceView(state);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#f5f5f7',
        color: '#1d1d1f',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 560,
          background: '#fff',
          borderRadius: 20,
          padding: '48px 40px',
          textAlign: 'center',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.06)',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 52,
            height: 52,
            marginBottom: 22,
            borderRadius: 14,
            background: '#1d1d1f',
            color: '#fff',
            fontSize: 24,
          }}
        >
          -
        </div>
        <p
          style={{
            margin: '0 0 8px',
            fontSize: 13,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: '#6e6e73',
          }}
        >
          {view.storeName}
        </p>
        <h1 style={{ margin: '0 0 14px', fontSize: 28, lineHeight: 1.2, letterSpacing: '-.01em' }}>
          {view.title}
        </h1>
        <p style={{ margin: '0 auto', maxWidth: 430, fontSize: 16, lineHeight: 1.55, color: '#424245' }}>
          {view.message}
        </p>
        {view.endsAtLabel ? (
          <p style={{ marginTop: 16, fontSize: 15, color: '#6e6e73' }}>
            We expect to be back by <strong>{view.endsAtLabel}</strong> ({view.timeZone}).
          </p>
        ) : null}
        <p style={{ marginTop: 28, fontSize: 13, color: '#86868b' }}>
          Store staff can keep working in the admin panel while this page is shown.
        </p>
      </section>
    </main>
  );
}
