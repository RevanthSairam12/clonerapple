import { SettingsForm } from '@/components/store-admin/SettingsForm';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getStoreSession } from '@/lib/store-admin/auth';
import { getStoreSettings } from '@/lib/store-admin/settings';
import { DEFAULT_SETTINGS, fieldsForSection } from '@/lib/store-admin/settings-rules';

export const dynamic = 'force-dynamic';

export default async function StoreAdminOrderSettingsPage() {
  const session = await getStoreSession();
  const result = await getStoreSettings();
  const settings = result.ok ? result.settings : DEFAULT_SETTINGS;
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';

  return (
    <div>
      <h1 className="sa-page-title">Order settings</h1>
      <p className="sa-page-sub">
        Numbering, fulfilment defaults and the text customers see at checkout.
      </p>

      <SettingsNav active="/store-admin/settings/orders" />

      {result.ok ? null : (
        <p className="sa-notice">Settings could not be read. Check the database connection.</p>
      )}

      <SettingsForm
        fields={fieldsForSection('orders')}
        initial={settings}
        canEdit={canEdit}
        note="Auto-confirm, auto-cancel and the free-shipping threshold apply once the storefront reads these settings. The order prefix and receipt numbering apply now."
      />
    </div>
  );
}
