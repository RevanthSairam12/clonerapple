import { getSql } from '@/lib/admin/db';

/**
 * The channel × audience × topic matrix behind Settings → Notifications.
 *
 * These toggles decide what would be sent once an outbound provider exists;
 * they do not send anything themselves. Only in-app notifications for staff
 * are on by default, so switching a channel on is always a deliberate act.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Notification settings must be handled on the server only.');
}

export const NOTIFICATION_CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'inapp', label: 'In-app' },
] as const;

export const NOTIFICATION_AUDIENCES = [
  { value: 'admin', label: 'Store staff' },
  { value: 'customer', label: 'Customer' },
] as const;

export const NOTIFICATION_TOPICS = [
  { value: 'order_placed', label: 'Order placed' },
  { value: 'payment_received', label: 'Payment received' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refund_requested', label: 'Refund requested' },
  { value: 'refund_completed', label: 'Refund completed' },
  { value: 'back_in_stock', label: 'Back in stock' },
  { value: 'password_reset', label: 'Password reset' },
  { value: 'staff_invite', label: 'Staff credentials' },
  { value: 'low_stock', label: 'Low stock' },
] as const;

type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]['value'];
type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number]['value'];
type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number]['value'];

export interface NotificationToggle {
  id: string;
  channel: NotificationChannel;
  audience: NotificationAudience;
  topic: NotificationTopic;
  isActive: boolean;
}

type Row = Record<string, unknown>;

export type NotificationLoad =
  | { ok: true; toggles: NotificationToggle[] }
  | { ok: false; reason: 'unavailable' };

export async function listNotificationToggles(): Promise<NotificationLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select id, channel, audience, topic, is_active
      from notification_channel_settings
      order by channel, audience, topic
    `) as Row[];

    return {
      ok: true,
      toggles: rows.map((row) => ({
        id: String(row.id),
        channel: String(row.channel) as NotificationChannel,
        audience: String(row.audience) as NotificationAudience,
        topic: String(row.topic) as NotificationTopic,
        isActive: row.is_active === true,
      })),
    };
  } catch {
    console.warn('[store-admin/notifications] could not read the notification matrix');
    return { ok: false, reason: 'unavailable' };
  }
}

export type NotificationSaveResult =
  | { ok: true; toggle: NotificationToggle }
  | { ok: false; reason: 'invalid-input' | 'not-found' | 'unavailable'; error: string };

export async function saveNotificationToggle(input: {
  id: unknown;
  isActive: unknown;
}): Promise<NotificationSaveResult> {
  if (typeof input.id !== 'string' || !input.id.trim()) {
    return { ok: false, reason: 'invalid-input', error: 'Which notification?' };
  }
  if (typeof input.isActive !== 'boolean') {
    return { ok: false, reason: 'invalid-input', error: 'Choose on or off.' };
  }

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Notifications are not available.' };

  try {
    const rows = (await sql`
      update notification_channel_settings
      set is_active = ${input.isActive}, updated_at = now()
      where id = ${input.id.trim()}
      returning id, channel, audience, topic, is_active
    `) as Row[];

    const row = rows[0];
    if (!row) return { ok: false, reason: 'not-found', error: 'That notification does not exist.' };

    return {
      ok: true,
      toggle: {
        id: String(row.id),
        channel: String(row.channel) as NotificationChannel,
        audience: String(row.audience) as NotificationAudience,
        topic: String(row.topic) as NotificationTopic,
        isActive: row.is_active === true,
      },
    };
  } catch {
    console.warn('[store-admin/notifications] could not save a notification toggle');
    return { ok: false, reason: 'unavailable', error: 'Notifications are not available.' };
  }
}
