import { SettingsForm } from '@/components/store-admin/SettingsForm';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getStoreSession } from '@/lib/store-admin/auth';
import { secretStatus } from '@/lib/store-admin/secret-status';
import { getStoreSettings } from '@/lib/store-admin/settings';
import { DEFAULT_SETTINGS, fieldsForSection } from '@/lib/store-admin/settings-rules';

export const dynamic = 'force-dynamic';

export default async function StoreAdminMailSettingsPage() {
  const session = await getStoreSession();
  const result = await getStoreSettings();
  const settings = result.ok ? result.settings : DEFAULT_SETTINGS;
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const secrets = secretStatus([
    { label: 'SMTP password', envVar: 'MAIL_PASSWORD' },
    { label: 'MSG91 auth key', envVar: 'MSG91_AUTH_KEY' },
    { label: 'Twilio auth token', envVar: 'TWILIO_AUTH_TOKEN' },
  ]);

  return (
    <div>
      <h1 className="sa-page-title">Email and SMS</h1>
      <p className="sa-page-sub">
        Outbound channels. The mail driver defaults to “log only” so nothing is sent by accident.
      </p>

      <SettingsNav active="/store-admin/settings/mail" />

      <SettingsForm
        fields={fieldsForSection('mail')}
        initial={settings}
        canEdit={canEdit}
        note="No message is sent until a driver or gateway is chosen, the channel is switched on, and its credential is present in the environment. The log driver records the message instead of sending it."
      />

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Credentials</h2>
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
          Set these in the deployment environment, never in this screen. The audit log records that
          a channel was switched on, not any credential value.
        </p>
      </section>
    </div>
  );
}
