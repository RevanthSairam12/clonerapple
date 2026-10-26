import Link from 'next/link';

import { SettingsForm } from '@/components/store-admin/SettingsForm';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getStoreSession } from '@/lib/store-admin/auth';
import { secretStatus } from '@/lib/store-admin/secret-status';
import { getStoreSettings } from '@/lib/store-admin/settings';
import { DEFAULT_SETTINGS, fieldsForSection } from '@/lib/store-admin/settings-rules';

export const dynamic = 'force-dynamic';

const OTHER_SECTIONS = [
  {
    href: '/store-admin/settings/orders',
    title: 'Orders',
    body: 'Numbering, fulfilment defaults, checkout text and auto-cancel.',
  },
  {
    href: '/store-admin/settings/payments',
    title: 'Payments',
    body: 'Cash on delivery, PayU, manual payments and the payment methods list.',
  },
  {
    href: '/store-admin/settings/shipping',
    title: 'Shipping',
    body: 'Couriers, tracking URL templates, rates and delivery estimates.',
  },
  {
    href: '/store-admin/settings/mail',
    title: 'Email & SMS',
    body: 'SMTP and SMS configuration. Credentials stay in the environment.',
  },
  {
    href: '/store-admin/settings/storefront',
    title: 'Storefront',
    body: 'Login copy, background image and reCAPTCHA.',
  },
  {
    href: '/store-admin/settings/notifications',
    title: 'Notifications',
    body: 'Channel matrix, automated messages and email templates.',
  },
  {
    href: '/store-admin/settings/content',
    title: 'Pages & SEO',
    body: 'Policy pages and per-page meta defaults.',
  },
  {
    href: '/store-admin/settings/analytics',
    title: 'Social & analytics',
    body: 'Footer social links, analytics tags and integration endpoints.',
  },
  {
    href: '/store-admin/settings/reasons',
    title: 'Reasons',
    body: 'Cancellation, refund and return pick-lists.',
  },
] as const;

export default async function StoreAdminSettingsPage() {
  const session = await getStoreSession();
  const result = await getStoreSettings();
  const settings = result.ok ? result.settings : DEFAULT_SETTINGS;

  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const isOwner = session?.role === 'store_owner';
  const secrets = secretStatus([
    { label: 'PayU key', envVar: 'PAYU_KEY' },
    { label: 'PayU salt', envVar: 'PAYU_SALT' },
  ]);

  return (
    <div>
      <h1 className="sa-page-title">Store settings</h1>
      <p className="sa-page-sub">
        Trade identity, storefront behaviour and the maintenance switch. Every role can read;
        admins edit; maintenance stays with the owner.
      </p>

      <SettingsNav active="/store-admin/settings" />

      {result.ok ? null : (
        <p className="sa-notice">
          Settings could not be read. Check the database connection and migration 0017.
        </p>
      )}

      <SettingsForm
        fields={fieldsForSection('business')}
        initial={settings}
        canEdit={canEdit}
        note="The business is not GST-registered, so no tax number, HSN code or invoice header is collected. Receipts read “Receipt / Bill of Supply”."
      />

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Maintenance</h2>
        </div>
        <p className="sa-note">
          Taking the storefront offline also closes checkout, but never this panel. Starts and ends
          are optional; leave both blank to switch it on and off by hand.
        </p>
        {isOwner ? (
          <SettingsForm fields={fieldsForSection('maintenance')} initial={settings} canEdit />
        ) : (
          <p className="sa-lock-note">Only a store owner can change maintenance settings.</p>
        )}
      </section>

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Secrets</h2>
        </div>
        <p className="sa-note">
          Gateway keys and passwords are never stored in the database and never shown here — only
          whether each one is configured.
        </p>
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

      <h2 className="sa-section-title">More settings</h2>
      <div className="sa-hub-grid">
        {OTHER_SECTIONS.map((section) => (
          <Link className="sa-hub-card" href={section.href} key={section.href}>
            <strong>{section.title}</strong>
            <span>{section.body}</span>
          </Link>
        ))}
        {isOwner || session?.role === 'store_admin' ? (
          <Link className="sa-hub-card" href="/store-admin/settings/staff">
            <strong>Staff &amp; roles</strong>
            <span>Accounts, roles, sessions and the capability matrix.</span>
          </Link>
        ) : null}
        {isOwner || session?.role === 'store_admin' ? (
          <Link className="sa-hub-card" href="/store-admin/audit-log">
            <strong>Audit log</strong>
            <span>Every privileged action, filterable and exportable.</span>
          </Link>
        ) : null}
      </div>

      <p className="sa-readonly-foot">
        Every save writes an audit row with the key, the previous value and the new value.
      </p>
    </div>
  );
}
