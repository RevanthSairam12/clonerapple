import { MailChecksPanel } from '@/components/store-admin/MailChecksPanel';
import { SettingsForm } from '@/components/store-admin/SettingsForm';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { configurationStatus } from '@/lib/notifications/diagnostics';
import { getNotificationDeliveryLog } from '@/lib/notifications/outbox';
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
  const isOwner = session?.role === 'store_owner';
  const config = configurationStatus(settings);
  const recent = await getNotificationDeliveryLog({ limit: 10 });
  const zone = settings.timezone.trim() || 'Asia/Kolkata';
  const when = (date: Date) => {
    try {
      return new Intl.DateTimeFormat('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: zone,
      }).format(date);
    } catch {
      return date.toISOString();
    }
  };
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

      {isOwner ? (
        <MailChecksPanel />
      ) : (
        <p className="sa-lock-note">Only a store owner can run the mail and SMS checks.</p>
      )}

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Configuration status</h2>
        </div>
        <table className="sa-table">
          <thead>
            <tr>
              <th>Needed</th>
              <th>For</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {config.map((item) => (
              <tr key={item.name}>
                <td>
                  <code>{item.name}</code>{' '}
                  <span className="sa-hint">{item.kind === 'env' ? 'environment' : 'setting'}</span>
                </td>
                <td>{item.neededFor}</td>
                <td>
                  <span className={item.present ? 'sa-status sa-status-on' : 'sa-status sa-status-off'}>
                    {item.present ? 'Present' : 'Missing'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="sa-note">
          Names only; values are never shown. A message also needs its row switched on in
          Settings → Notifications.
        </p>
      </section>

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Last 10 notifications</h2>
        </div>
        {!recent.ok ? (
          <p className="sa-note">The notification log is not available right now.</p>
        ) : recent.rows.length === 0 ? (
          <p className="sa-note">No notification has been queued yet.</p>
        ) : (
          <table className="sa-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Channel</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {recent.rows.map((row) => (
                <tr key={row.id}>
                  <td>{when(row.createdAt)}</td>
                  <td>{row.eventKey}</td>
                  <td>{row.channel}</td>
                  <td>{row.status}</td>
                  <td>{row.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
