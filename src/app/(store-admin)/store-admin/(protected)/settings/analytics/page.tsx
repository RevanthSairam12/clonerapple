import { SettingList } from '@/components/store-admin/SettingList';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getStoreSession } from '@/lib/store-admin/auth';
import { LIST_KINDS, listSettingRows } from '@/lib/store-admin/setting-lists';

export const dynamic = 'force-dynamic';

export default async function StoreAdminAnalyticsSettingsPage() {
  const session = await getStoreSession();
  const [social, analytics, integrations] = await Promise.all([
    listSettingRows('social-links'),
    listSettingRows('analytics-scripts'),
    listSettingRows('integrations'),
  ]);
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const socialKind = LIST_KINDS['social-links'];
  const analyticsKind = LIST_KINDS['analytics-scripts'];
  const integrationKind = LIST_KINDS.integrations;

  return (
    <div>
      <h1 className="sa-page-title">Social and analytics</h1>
      <p className="sa-page-sub">
        Footer social links, analytics tags and non-secret integration settings.
      </p>

      <SettingsNav active="/store-admin/settings/analytics" />

      {social.ok ? (
        <SettingList
          listKey={socialKind.key}
          label={socialKind.label}
          fields={socialKind.fields}
          rows={social.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Social links could not be read. Apply migration 0032.</p>
      )}

      {analytics.ok ? (
        <SettingList
          listKey={analyticsKind.key}
          label={analyticsKind.label}
          fields={analyticsKind.fields}
          rows={analytics.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Analytics could not be read. Apply migration 0032.</p>
      )}

      {integrations.ok ? (
        <SettingList
          listKey={integrationKind.key}
          label={integrationKind.label}
          fields={integrationKind.fields}
          rows={integrations.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Integrations could not be read. Apply migration 0032.</p>
      )}

      <p className="sa-readonly-foot">
        API keys, bucket secrets and webhook signing secrets are not stored here. Webhook URLs are
        recorded in the audit log without their query string.
      </p>
    </div>
  );
}
