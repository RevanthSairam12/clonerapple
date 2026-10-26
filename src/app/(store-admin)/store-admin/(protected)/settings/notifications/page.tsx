import Link from 'next/link';

import { NotificationMatrix } from '@/components/store-admin/NotificationMatrix';
import { NotificationRetryButton } from '@/components/store-admin/NotificationRetryButton';
import { SettingList } from '@/components/store-admin/SettingList';
import { SettingsNav } from '@/components/store-admin/SettingsNav';
import { getNotificationDeliveryLog } from '@/lib/notifications/outbox';
import { NOTIFICATION_STATUSES, type NotificationStatus } from '@/lib/notifications/types';
import { getStoreSession } from '@/lib/store-admin/auth';
import { formatDate } from '@/lib/store-admin/catalog';
import { listNotificationToggles } from '@/lib/store-admin/notification-settings';
import { LIST_KINDS, listSettingRows } from '@/lib/store-admin/setting-lists';

export const dynamic = 'force-dynamic';

const EVENT_LABELS: Record<string, string> = {
  order_placed: 'Order placed',
  payment_received: 'Payment received',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  refund_requested: 'Refund requested',
  refund_completed: 'Refund completed',
  back_in_stock: 'Back in stock',
  password_reset: 'Password reset',
  staff_invite: 'Staff credentials',
  low_stock: 'Low stock',
};

const STATUS_LABELS: Record<NotificationStatus, string> = {
  QUEUED: 'Queued',
  SENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};

export default async function StoreAdminNotificationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await getStoreSession();
  const params = await searchParams;
  const requested = typeof params.status === 'string' ? params.status.toUpperCase() : '';
  const status = (NOTIFICATION_STATUSES as readonly string[]).includes(requested)
    ? requested as NotificationStatus
    : null;
  const [matrix, messages, templates, log] = await Promise.all([
    listNotificationToggles(),
    listSettingRows('automated-messages'),
    listSettingRows('email-templates'),
    getNotificationDeliveryLog({ status }),
  ]);
  const canEdit = session?.role === 'store_admin' || session?.role === 'store_owner';
  const messageKind = LIST_KINDS['automated-messages'];
  const templateKind = LIST_KINDS['email-templates'];
  const totalMessages = log.ok
    ? NOTIFICATION_STATUSES.reduce((sum, key) => sum + log.counts[key], 0)
    : 0;

  return (
    <div>
      <h1 className="sa-page-title">Notifications</h1>
      <p className="sa-page-sub">
        What is sent, to whom and by which channel. Messages queue after the business action
        commits; delivery needs the matching provider under Email &amp; SMS.
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

      <section className="sa-detail-card">
        <div className="sa-detail-head">
          <h2>Delivery log</h2>
        </div>
        <p className="sa-page-sub">
          Recent queued messages. Recipients are masked; subjects and bodies never leave the
          database. FAILED means the provider rejected the message or the attempt budget ran out.
        </p>

        {log.ok ? (
          <>
            <nav className="sa-filter-row" aria-label="Filter messages by status">
              <Link
                className={`sa-filter-chip${status === null ? ' is-active' : ''}`}
                href="/store-admin/settings/notifications"
              >
                All <span className="sa-chip-count">{totalMessages}</span>
              </Link>
              {NOTIFICATION_STATUSES.map((candidate) => (
                <Link
                  key={candidate}
                  className={`sa-filter-chip${status === candidate ? ' is-active' : ''}`}
                  href={`/store-admin/settings/notifications?status=${candidate}`}
                >
                  {STATUS_LABELS[candidate]}{' '}
                  <span className="sa-chip-count">{log.counts[candidate]}</span>
                </Link>
              ))}
            </nav>

            {log.rows.length === 0 ? (
              <p className="sa-empty">No messages match this filter yet.</p>
            ) : (
              <div className="sa-table-wrap">
                <table className="sa-table">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Channel</th>
                      <th>Audience</th>
                      <th>Recipient</th>
                      <th>Status</th>
                      <th>Reason</th>
                      <th className="sa-num">Tries</th>
                      <th className="sa-date">When</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {log.rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          {EVENT_LABELS[row.eventKey] ?? row.eventKey}
                          <span className="sa-row-sub sa-mono">{row.id}</span>
                        </td>
                        <td>{row.channel === 'inapp' ? 'In-app' : row.channel.toUpperCase()}</td>
                        <td>{row.audience === 'staff' ? 'Staff' : 'Customer'}</td>
                        <td className="sa-mono">{row.recipientMasked || '—'}</td>
                        <td>{STATUS_LABELS[row.status]}</td>
                        <td className="sa-row-sub">{row.reason || '—'}</td>
                        <td className="sa-num">{row.attempts}</td>
                        <td className="sa-date">{formatDate(row.createdAt.toISOString())}</td>
                        <td>
                          {canEdit && row.status === 'FAILED' ? (
                            <NotificationRetryButton id={row.id} />
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="sa-notice">
            The delivery log could not be read. Apply migration 0035.
          </p>
        )}
      </section>

      <p className="sa-readonly-foot">
        Delivery is background work: a slow provider never holds up checkout or a staff action.
        The reconcile cron retries due messages, and a failed row can be requeued above.
        Unknown tokens are rejected on save.
      </p>
    </div>
  );
}
