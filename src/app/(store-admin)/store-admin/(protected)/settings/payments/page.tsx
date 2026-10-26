import { SettingList } from '@/components/store-admin/SettingList';
import { SettingsForm } from '@/components/store-admin/SettingsForm';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getStoreSession } from '@/lib/store-admin/auth';
import { secretStatus } from '@/lib/store-admin/secret-status';
import { LIST_KINDS, listSettingRows } from '@/lib/store-admin/setting-lists';
import { getStoreSettings } from '@/lib/store-admin/settings';
import { DEFAULT_SETTINGS, fieldsForSection } from '@/lib/store-admin/settings-rules';

export const dynamic = 'force-dynamic';

export default async function StoreAdminPaymentSettingsPage() {
  const session = await getStoreSession();
  const [result, methods] = await Promise.all([
    getStoreSettings(),
    listSettingRows('payment-methods'),
  ]);
  const settings = result.ok ? result.settings : DEFAULT_SETTINGS;
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const secrets = secretStatus([
    { label: 'PayU merchant key', envVar: 'PAYU_KEY' },
    { label: 'PayU salt', envVar: 'PAYU_SALT' },
  ]);
  const kind = LIST_KINDS['payment-methods'];

  return (
    <div>
      <h1 className="sa-page-title">Payments</h1>
      <p className="sa-page-sub">
        Which methods the store accepts. Gateway credentials stay in environment variables.
      </p>

      <SettingsNav active="/store-admin/settings/payments" />

      <SettingsForm
        fields={fieldsForSection('payments')}
        initial={settings}
        canEdit={canEdit}
        note="Switching a gateway off here does not remove its keys; it stops the storefront offering it."
      />

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Gateway secrets</h2>
        </div>
        <table className="sa-table">
          <thead>
            <tr>
              <th>Secret</th>
              <th>Environment variable</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {secrets.map((secret) => (
              <tr key={secret.envVar}>
                <td>{secret.label}</td>
                <td><code>{secret.envVar}</code></td>
                <td>
                  <span className={secret.present ? 'sa-status sa-status-on' : 'sa-status sa-status-off'}>
                    {secret.present ? 'Configured' : 'Missing'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {methods.ok ? (
        <SettingList
          listKey={kind.key}
          label={kind.label}
          fields={kind.fields}
          rows={methods.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Payment methods could not be read. Apply migration 0032.</p>
      )}

      <p className="sa-readonly-foot">
        Methods are hidden, never deleted, so past orders keep the label they were paid with.
      </p>
    </div>
  );
}
