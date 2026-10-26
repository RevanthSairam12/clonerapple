import { SettingsForm } from '@/components/store-admin/SettingsForm';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getStoreSession } from '@/lib/store-admin/auth';
import { secretStatus } from '@/lib/store-admin/secret-status';
import { getStoreSettings } from '@/lib/store-admin/settings';
import { DEFAULT_SETTINGS, fieldsForSection } from '@/lib/store-admin/settings-rules';

export const dynamic = 'force-dynamic';

export default async function StoreAdminStorefrontSettingsPage() {
  const session = await getStoreSession();
  const result = await getStoreSettings();
  const settings = result.ok ? result.settings : DEFAULT_SETTINGS;
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const secrets = secretStatus([
    { label: 'reCAPTCHA secret key', envVar: 'RECAPTCHA_SECRET_KEY' },
  ]);

  return (
    <div>
      <h1 className="sa-page-title">Storefront</h1>
      <p className="sa-page-sub">
        Login screen copy and background, plus the reCAPTCHA site key. The secret key stays in the
        environment.
      </p>

      <SettingsNav active="/store-admin/settings/storefront" />

      <SettingsForm
        fields={fieldsForSection('storefront')}
        initial={settings}
        canEdit={canEdit}
        note="The login screen reads these values on its next load. Media ids come from the Media library."
      />

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>reCAPTCHA secret</h2>
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
        <p className="sa-note">
          reCAPTCHA stays off until both the site key and the secret are set; switching it on
          without a secret would lock staff out of the login form.
        </p>
      </section>
    </div>
  );
}
