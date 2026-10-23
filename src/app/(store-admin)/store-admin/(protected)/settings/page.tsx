import { getStoreSession } from '@/lib/store-admin/auth';
import { getStoreSettings } from '@/lib/store-admin/settings';
import { DEFAULT_SETTINGS } from '@/lib/store-admin/settings-rules';
import { StoreSettingsForm } from '@/components/store-admin/StoreSettingsForm';

export const dynamic = 'force-dynamic';

export default async function StoreAdminSettingsPage() {
  const session = await getStoreSession();
  const result = await getStoreSettings();
  const settings = result.ok ? result.settings : DEFAULT_SETTINGS;

  return (
    <div>
      <h1 className="sa-page-title">Store settings</h1>
      <p className="sa-page-sub">
        Trade identity printed on receipts. Owners edit; every role can read.
      </p>

      {result.ok ? null : (
        <p className="sa-notice">
          Settings could not be read. Apply migration 0017 and check the database connection.
        </p>
      )}

      <p className="sa-note">
        The business is not GST-registered, so no tax number, HSN code or invoice header is
        collected here. Receipts read “Receipt / Bill of Supply”.
      </p>

      <StoreSettingsForm
        initial={settings}
        canEdit={session?.role === 'store_owner'}
      />

      <p className="sa-readonly-foot">
        Prices are not editable here. Every change is written to the audit log with the new value only.
      </p>
    </div>
  );
}
