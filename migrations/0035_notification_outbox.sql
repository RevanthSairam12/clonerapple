-- 0035: Notification outbox.
--
-- The notification matrix, automated messages and email templates were stored
-- but nothing sent them. This table is the durable queue between the business
-- event and the provider. It is written after the business transaction
-- commits, so a mail or SMS outage can never roll back an order or payment.
--
-- RLS is enabled in this file with no policies, like every table created since
-- Phase 1. Only the server connection (DATABASE_URL) reads or writes it.
--
-- Append-only intent: no code path deletes rows. A FAILED row is retried or
-- left as evidence; a SKIPPED row records why nothing could be sent. A
-- retention job may be added later, but it is off by default and is not part
-- of this migration.
--
-- `next_attempt_at` is both the retry time and, while status = 'SENDING', the
-- worker lease. A crashed worker therefore becomes eligible again after the
-- lease expires instead of leaving a row stuck forever.

create table if not exists notification_outbox (
  id              text primary key,
  event_key       text not null check (event_key in (
                    'order_placed', 'payment_received', 'processing', 'shipped',
                    'delivered', 'cancelled', 'refund_requested', 'refund_completed',
                    'back_in_stock', 'password_reset', 'staff_invite', 'low_stock'
                  )),
  audience        text not null check (audience in ('customer', 'staff')),
  channel         text not null check (channel in ('email', 'sms', 'inapp')),
  entity_type     text not null,
  entity_id       text not null,
  recipient       text not null default '',
  recipient_masked text not null default '',
  subject         text not null default '',
  body            text not null default '',
  status          text not null default 'QUEUED'
                  check (status in ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  reason          text not null default '',
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  dedupe_key      text not null unique
);

create index if not exists idx_notification_outbox_due
  on notification_outbox(status, next_attempt_at)
  where status in ('QUEUED', 'SENDING');

create index if not exists idx_notification_outbox_recent
  on notification_outbox(created_at desc);

create index if not exists idx_notification_outbox_entity
  on notification_outbox(entity_type, entity_id, created_at desc);

alter table notification_outbox enable row level security;
