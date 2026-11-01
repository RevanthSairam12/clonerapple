import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';
import { maskCustomerEmail, maskCustomerPhone } from '@/lib/store-admin/masking';
import type { StoreSettings } from '@/lib/store-admin/settings-rules';

import { dedupeKey, uniqueRecipients } from './rules';
import { readNotificationSettings } from './settings';
import {
  defaultTemplate,
  renderEmail,
  renderText,
  templateValues,
  type EmailParts,
} from './templates';
import {
  isNotificationEvent,
  type NotificationAudience,
  type NotificationChannel,
  type NotificationContext,
  type NotificationEntity,
  type NotificationEvent,
  type NotificationStatus,
} from './types';

/**
 * Turn a business event into outbox rows according to the settings matrix.
 *
 * Call this only after the order/payment transaction has committed. Every
 * error is caught and returned as a no-op: a mail outage or a missing settings
 * table must never fail checkout, a callback or a staff action. For the same
 * reason the catch block logs the event name only, never the recipient or the
 * database error text.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: notifications must be queued on the server only.');
}

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

export interface EnqueueResult {
  ok: boolean;
  /** Rows that will be delivered (including in-app rows already SENT). */
  queued: number;
  /** Rows written to explain why nothing could be sent. */
  skipped: number;
  /** Rows already present under the same dedupe key. */
  duplicates: number;
}

const EMPTY: EnqueueResult = { ok: true, queued: 0, skipped: 0, duplicates: 0 };

interface StoredEmail {
  subject: string;
  heading: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  footer: string;
}

interface AutoMessage {
  subject: string;
  body: string;
}

interface OwnerRecipient {
  email: string;
  phone: string;
}

interface TargetResult {
  recipients: string[];
  missingReason: string;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function firstNonEmpty(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (value && value.trim()) return value;
  }
  return '';
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || (
    process.env.NODE_ENV === 'production' ? 'https://gadzio.in' : 'http://localhost:3000'
  )).replace(/\/+$/, '');
}

async function readEmailTemplate(sql: Sql, event: NotificationEvent): Promise<StoredEmail | null> {
  const rows = (await sql`
    select subject, heading, body, button_label, button_url, footer_text
    from email_templates
    where template_key = ${event} and is_active
    limit 1
  `) as Row[];
  const row = rows[0];
  if (!row) return null;
  return {
    subject: text(row.subject),
    heading: text(row.heading),
    body: text(row.body),
    buttonLabel: text(row.button_label),
    buttonUrl: text(row.button_url),
    footer: text(row.footer_text),
  };
}

async function readAutomatedMessages(
  sql: Sql,
  event: NotificationEvent,
): Promise<Map<NotificationChannel, AutoMessage>> {
  const rows = (await sql`
    select channel, subject, body
    from automated_messages
    where message_key = ${event} and is_active
  `) as Row[];
  const messages = new Map<NotificationChannel, AutoMessage>();
  for (const row of rows) {
    const channel = String(row.channel ?? '');
    if (channel === 'email' || channel === 'sms' || channel === 'inapp') {
      messages.set(channel, { subject: text(row.subject), body: text(row.body) });
    }
  }
  return messages;
}

async function readOwners(sql: Sql): Promise<OwnerRecipient[]> {
  const rows = (await sql`
    select email, phone
    from store_admins
    where role = 'store_owner' and is_active
    order by created_at asc
  `) as Row[];
  return rows.map((row) => ({ email: text(row.email), phone: text(row.phone) }));
}

/**
 * Stored rows win over the built-in copy, but a blank field falls through so a
 * half-filled template never sends an empty subject or body.
 */
function buildParts(
  event: NotificationEvent,
  channel: NotificationChannel,
  audience: NotificationAudience,
  storedEmail: StoredEmail | null,
  automated: Map<NotificationChannel, AutoMessage>,
): EmailParts {
  const fallback = defaultTemplate(event, channel, audience);
  const automatedMessage = automated.get(channel);

  if (channel === 'email') {
    return {
      subject: firstNonEmpty(storedEmail?.subject, automatedMessage?.subject, fallback.subject),
      heading: firstNonEmpty(storedEmail?.heading, fallback.heading),
      body: firstNonEmpty(storedEmail?.body, automatedMessage?.body, fallback.body),
      buttonLabel: firstNonEmpty(storedEmail?.buttonLabel, fallback.buttonLabel),
      buttonUrl: firstNonEmpty(storedEmail?.buttonUrl, fallback.buttonUrl),
      footer: firstNonEmpty(storedEmail?.footer, fallback.footer),
    };
  }

  return {
    ...fallback,
    subject: firstNonEmpty(automatedMessage?.subject, fallback.subject),
    body: firstNonEmpty(automatedMessage?.body, fallback.body),
  };
}

function mask(channel: 'email' | 'sms', recipient: string): string {
  return channel === 'email'
    ? maskCustomerEmail(recipient)
    : maskCustomerPhone(recipient);
}

/**
 * Who receives one cell. Customer messages go to the order's contact; staff
 * messages go to the business support address plus active owners. Invitations
 * and password resets are the exception: they go only to the staff member the
 * context names, never to every owner.
 */
function targetsFor(
  channel: NotificationChannel,
  audience: NotificationAudience,
  context: NotificationContext,
  settings: StoreSettings,
  owners: OwnerRecipient[],
): TargetResult {
  if (channel === 'inapp') {
    if (audience === 'customer') {
      const recipient = context.customerEmail || context.txnid || 'customer';
      return { recipients: [recipient], missingReason: 'no customer in-app inbox' };
    }
    return { recipients: ['staff'], missingReason: '' };
  }

  if (audience === 'customer') {
    const raw = channel === 'email' ? context.customerEmail : context.customerPhone;
    const recipients = uniqueRecipients([raw], channel);
    return {
      recipients,
      missingReason: recipients.length
        ? ''
        : channel === 'email'
          ? 'no customer email address'
          : 'no customer phone number',
    };
  }

  const targeted = context.staffEmail !== undefined || context.staffPhone !== undefined;
  if (targeted) {
    const raw = channel === 'email' ? context.staffEmail : context.staffPhone;
    const recipients = uniqueRecipients([raw], channel);
    return {
      recipients,
      missingReason: recipients.length
        ? ''
        : channel === 'email'
          ? 'staff email address is missing or invalid'
          : 'staff phone number is missing or invalid',
    };
  }

  const rawValues = channel === 'email'
    ? [settings.email, ...owners.map((owner) => owner.email)]
    : [settings.phone, ...owners.map((owner) => owner.phone)];
  const recipients = uniqueRecipients(rawValues, channel);
  return {
    recipients,
    missingReason: recipients.length
      ? ''
      : channel === 'email'
        ? 'no staff email recipient configured'
        : 'no staff phone recipient configured',
  };
}

async function insertRow(
  sql: Sql,
  input: {
    event: NotificationEvent;
    entity: NotificationEntity;
    audience: NotificationAudience;
    channel: NotificationChannel;
    recipient: string;
    recipientMasked: string;
    subject: string;
    body: string;
    status: NotificationStatus;
    reason: string;
    sentAt: Date | null;
    token?: string | null;
    customerUserId?: string | null;
  },
): Promise<boolean> {
  const key = dedupeKey({
    event: input.event,
    entityType: input.entity.type,
    entityId: input.entity.id,
    channel: input.channel,
    audience: input.audience,
    recipient: input.recipient,
    token: input.token,
  });

  const rows = (await sql`
    insert into notification_outbox (
      id, event_key, audience, channel, entity_type, entity_id,
      recipient, recipient_masked, subject, body, status, reason,
      sent_at, dedupe_key, customer_user_id, read_at
    ) values (
      ${`ntf_${randomBytes(12).toString('hex')}`},
      ${input.event}, ${input.audience}, ${input.channel},
      ${input.entity.type}, ${input.entity.id},
      ${input.recipient}, ${input.recipientMasked}, ${input.subject}, ${input.body},
      ${input.status}, ${input.reason}, ${input.sentAt}, ${key},
      ${input.customerUserId ?? null}, ${null}
    )
    on conflict (dedupe_key) do nothing
    returning id
  `) as Row[];

  return rows.length > 0;
}

export async function enqueueNotification(
  event: NotificationEvent,
  entity: NotificationEntity,
  context: NotificationContext = {},
  sqlOverride?: Sql,
): Promise<EnqueueResult> {
  if (!isNotificationEvent(event)) return { ...EMPTY };

  const entityType = text(entity?.type).trim().slice(0, 60);
  const entityId = text(entity?.id).trim().slice(0, 160);
  if (!entityType || !entityId) return { ...EMPTY };

  const sql = sqlOverride ?? getSql();
  if (!sql) return { ...EMPTY };

  try {
    const matrix = (await sql`
      select channel, audience
      from notification_channel_settings
      where topic = ${event} and is_active
      order by channel, audience
    `) as Row[];

    if (matrix.length === 0) return { ...EMPTY };

    const settings = await readNotificationSettings(sql);
    const storedEmail = await readEmailTemplate(sql, event);
    const automated = await readAutomatedMessages(sql, event);

    const needsOwners = matrix.some((row) => (
      row.audience === 'admin'
      && (row.channel === 'email' || row.channel === 'sms')
    )) && context.staffEmail === undefined && context.staffPhone === undefined;
    const owners = needsOwners ? await readOwners(sql) : [];

    let queued = 0;
    let skipped = 0;
    let duplicates = 0;

    for (const row of matrix) {
      const channel = String(row.channel ?? '');
      if (channel !== 'email' && channel !== 'sms' && channel !== 'inapp') continue;

      const audience: NotificationAudience = row.audience === 'admin' ? 'staff' : 'customer';
      const link = audience === 'staff'
        ? firstNonEmpty(context.staffLink ?? undefined, context.adminLink ?? undefined)
        : firstNonEmpty(context.customerLink ?? undefined, context.adminLink ?? undefined);
      const values = templateValues({
        audience,
        txnid: context.txnid,
        orderNumber: context.orderNumber,
        customerName: context.customerName,
        orderTotalPaise: context.orderTotalPaise,
        shippingPaise: context.shippingPaise,
        refundPaise: context.refundPaise,
        couponCode: context.couponCode,
        discountPaise: context.discountPaise,
        orderStatus: context.orderStatus,
        trackingNumber: context.trackingNumber,
        trackingLink: context.trackingLink,
        itemCount: context.itemCount,
        productName: context.productName,
        stockAvailable: context.stockAvailable,
        storeName: settings.trade_name,
        supportPhone: settings.phone,
        supportEmail: settings.email,
        returnWindowDays: settings.return_window_days,
        adminLink: link,
      });

      const parts = buildParts(event, channel, audience, storedEmail, automated);
      const target = targetsFor(channel, audience, context, settings, owners);

      let status: NotificationStatus = 'QUEUED';
      let reason = '';
      let sentAt: Date | null = null;
      let customerUserId: string | null = null;

      if (target.recipients.length === 0) {
        status = 'SKIPPED';
        reason = target.missingReason || 'no recipient';
      } else if (channel === 'inapp' && audience === 'customer') {
        status = 'SKIPPED';
        reason = target.missingReason;
        if (context.customerUserId) {
          customerUserId = context.customerUserId;
        } else if (context.txnid) {
          try {
            const ordRows = (await sql`select user_id from orders where txnid = ${context.txnid} limit 1`) as Row[];
            if (ordRows[0]?.user_id) customerUserId = text(ordRows[0].user_id);
          } catch {}
        }
        if (!customerUserId && context.customerEmail) {
          try {
            const usrRows = (await sql`select id from users where lower(email) = ${context.customerEmail.trim().toLowerCase()} limit 1`) as Row[];
            if (usrRows[0]?.id) customerUserId = text(usrRows[0].id);
          } catch {}
        }

        if (customerUserId) {
          status = 'SENT';
          sentAt = new Date();
          reason = '';
        }
      } else if (channel === 'inapp') {
        status = 'SENT';
        sentAt = new Date();
      }

      let subject = '';
      let body = '';
      if (status !== 'SKIPPED') {
        if (channel === 'email') {
          const rendered = renderEmail(parts, values, appBaseUrl());
          subject = rendered.subject;
          body = rendered.html;
        } else if (channel === 'sms') {
          body = renderText(parts.body, values, true);
        } else {
          subject = renderText(parts.subject, values, true);
          body = renderText(parts.body, values);
        }
      }

      const recipients = target.recipients.length > 0 ? target.recipients : [''];
      for (const recipient of recipients) {
        const masked = recipient
          ? channel === 'inapp'
            ? recipient
            : mask(channel, recipient)
          : '';

        const inserted = await insertRow(sql, {
          event,
          entity: { type: entityType, id: entityId },
          audience,
          channel,
          recipient,
          recipientMasked: masked,
          subject,
          body,
          status,
          reason,
          sentAt,
          token: context.token,
          customerUserId,
        });

        if (!inserted) duplicates += 1;
        else if (status === 'SKIPPED') skipped += 1;
        else queued += 1;
      }
    }

    return { ok: true, queued, skipped, duplicates };
  } catch {
    console.warn(`[notifications] could not queue ${event} messages`);
    return { ok: false, queued: 0, skipped: 0, duplicates: 0 };
  }
}
