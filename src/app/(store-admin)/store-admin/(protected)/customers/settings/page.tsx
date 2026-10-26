import Link from 'next/link';

import { CustomerSettingsForm } from '@/components/store-admin/CustomerSettingsForm';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getCustomerSettings } from '@/lib/store-admin/customer-settings';

export const dynamic = 'force-dynamic';

export default async function StoreAdminCustomerSettingsPage() {
  const [session, result] = await Promise.all([
    getStoreSession(),
    getCustomerSettings(),
  ]);

  if (!result.ok) {
    return (
      <div>
        <h1 className="sa-page-title">Customer settings</h1>
        <p className="sa-notice">
          Customer settings are not available. Check that the database is
          configured and migration 0026 is applied.
        </p>
      </div>
    );
  }

  const canEdit = session?.role === 'store_owner';

  return (
    <div>
      <Link className="sa-back" href="/store-admin/customers">
        ← Customers
      </Link>

      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Customer settings</h1>
          <p className="sa-page-sub">
            Checkout policy and the default group for new accounts. Changes take
            effect on the next storefront request.
          </p>
        </div>
        <div className="sa-inline-actions">
          <Link
            className="sa-btn sa-btn-quiet sa-btn-small"
            href="/store-admin/customers/accounts"
          >
            User accounts
          </Link>
          <Link
            className="sa-btn sa-btn-quiet sa-btn-small"
            href="/store-admin/customers/subscribers"
          >
            Subscribers
          </Link>
        </div>
      </div>

      {canEdit ? (
        <CustomerSettingsForm settings={result.settings} />
      ) : (
        <div className="sa-control-card">
          <p className="sa-control-title">Read-only</p>
          <dl className="sa-meta">
            <div>
              <dt>Guest checkout</dt>
              <dd>{result.settings.guest_checkout === 'on' ? 'On' : 'Off'}</dd>
            </div>
            <div>
              <dt>Default customer group</dt>
              <dd>{result.settings.default_customer_group}</dd>
            </div>
            <div>
              <dt>Checkout offer opt-in</dt>
              <dd>{result.settings.checkout_marketing_optin === 'on' ? 'On' : 'Off'}</dd>
            </div>
          </dl>
          <p className="sa-lock-note">Only the store owner can change these settings.</p>
        </div>
      )}

      <p className="sa-readonly-foot">
        Every change is written to the audit log. Guest checkout off means an
        account is required before payment.
      </p>
    </div>
  );
}
