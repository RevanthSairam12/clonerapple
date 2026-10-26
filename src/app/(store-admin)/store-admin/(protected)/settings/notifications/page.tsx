import { NotificationMatrix } from '@/components/store-admin/NotificationMatrix';
import { SettingList } from '@/components/store-admin/SettingList';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getStoreSession } from '@/lib/store-admin/auth';
import { listNotificationToggles } from '@/lib/store-admin/notification-settings';
import { LIST_KINDS, listSettingRows } from '@/lib/store-admin/setting-lists';

export const dynamic = 'force-dynamic';

export default async function StoreAdminNotificationSettingsPage() {
  const session = await getStoreSession();
  const [matrix, messages, templates] = await Promise.all([
    listNotificationToggles(),
    listSettingRows('automated-messages'),
    listSettingRows('email-templates'),
  ]);
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const messageKind = LIST_KINDS['automated-messages'];
  const templateKind = LIST_KINDS['email-templates'];

  return (
    <div>
      <h1 className="sa-page-title">Notifications</h1>
      <p className="sa-page-sub">
        What would be sent, to whom and by which channel. Nothing leaves the building until an
        outbound provider is configured and switched on.
      </p>

      <SettingsNav active="/store-admin/settings/notifications" />

      <p className="sa-notice">
        Only in-app notifications to store staff start enabled. Email and SMS stay off until their
        credentials exist and the channel is switched on under Email &amp; SMS.
      </p>

      {matrix.ok ? (
        <NotificationMatrix toggles={matrix.toggles} canEdit={canEdit} />
      ) : (
        <p className="sa-notice">The notification matrix could not be read. Apply migration 0032.</p>
      )}

      {messages.ok ? (
        <SettingList
          listKey={messageKind.key}
          label="Automated messages"
          fields={messageKind.fields}
          rows={messages.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Automated messages could not be read. Apply migration 0032.</p>
      )}

      {templates.ok ? (
        <SettingList
          listKey={templateKind.key}
          label="Email templates"
          fields={templateKind.fields}
          rows={templates.data}
          canEdit={canEdit}
        />
      ) : (
        <p className="sa-notice">Email templates could not be read. Apply migration 0032.</p>
      )}

      <p className="sa-readonly-foot">
        Definitions are saved and audited now; the queue that sends them arrives with the outbox
        worker. Unknown tokens are rejected on save.
      </p>
    </div>
  );
}
