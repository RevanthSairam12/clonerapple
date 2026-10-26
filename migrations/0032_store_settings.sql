-- 0032: Settings data — fulfilment, shipping, payments, pages, storefront.
--
-- Business-profile and order settings stay in the existing key/value
-- `store_settings` table (0017); this migration adds the structured lists
-- that need rows of their own, plus the two extra reason lists.
--
-- Deliberate simplification, recorded in plan.md: `offline_payment_methods`
-- and `notification_templates` from the design have no tables of their own.
-- Manual payment methods are a `kind = 'manual'` row in `payment_methods`
-- (same fields, one list to manage), and notification templates are the
-- `email_templates` rows keyed by topic. No behaviour is lost.
--
-- Additive only. Every table enables RLS in this file. No policies: the server
-- connection is the table owner and the publishable key gets zero rows.

-- ------------------------------------------------------- fulfilment

create table if not exists fulfilment_providers (
  id                text primary key,
  name              text not null check (char_length(name) between 1 and 120),
  tracking_template text not null default '' check (char_length(tracking_template) <= 500),
  is_active         boolean not null default true,
  sort_order        integer not null default 50,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists shipping_methods (
  id              text primary key,
  name            text not null check (char_length(name) between 1 and 120),
  rate_paise      bigint not null default 0 check (rate_paise >= 0),
  free_over_paise bigint not null default 0 check (free_over_paise >= 0),
  eta_min_days    integer not null default 0 check (eta_min_days >= 0),
  eta_max_days    integer not null default 0 check (eta_max_days >= 0),
  is_active       boolean not null default true,
  sort_order      integer not null default 50,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------- payments

create table if not exists payment_methods (
  id           text primary key,
  code         text not null unique check (code ~ '^[a-z0-9_]+$'),
  label        text not null check (char_length(label) between 1 and 120),
  kind         text not null check (kind in ('gateway', 'cod', 'manual')),
  instructions text not null default '' check (char_length(instructions) <= 1000),
  is_active    boolean not null default true,
  sort_order   integer not null default 50,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

insert into payment_methods (id, code, label, kind, instructions, is_active, sort_order) values
  ('pm_cod', 'cod', 'Cash on delivery', 'cod', 'Pay the courier when the parcel arrives.', true, 10),
  ('pm_payu', 'payu', 'PayU (card, UPI, netbanking)', 'gateway', '', true, 20),
  ('pm_manual', 'manual', 'Manual payment (UPI or bank transfer)', 'manual', 'Send the amount and share the reference with support.', true, 30)
on conflict (id) do nothing;

-- ------------------------------------------------------------ pages

create table if not exists store_pages (
  id              text primary key,
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title           text not null check (char_length(title) between 1 and 160),
  body            text not null default '',
  seo_title       text not null default '' check (char_length(seo_title) <= 160),
  seo_description text not null default '' check (char_length(seo_description) <= 320),
  status          text not null default 'draft' check (status in ('draft', 'published')),
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

insert into store_pages (id, slug, title, status) values
  ('page_about', 'about', 'About us', 'draft'),
  ('page_privacy', 'privacy', 'Privacy policy', 'draft'),
  ('page_terms', 'terms', 'Terms of service', 'draft'),
  ('page_refunds', 'refunds', 'Refund and return policy', 'draft'),
  ('page_cancellation', 'cancellation', 'Cancellation policy', 'draft'),
  ('page_shipping', 'shipping', 'Shipping policy', 'draft'),
  ('page_warranty', 'warranty', 'Warranty', 'draft'),
  ('page_contact', 'contact', 'Contact us', 'draft')
on conflict (id) do nothing;

-- --------------------------------------------------------------- SEO

create table if not exists seo_pages (
  page_key         text primary key,
  meta_title       text not null default '' check (char_length(meta_title) <= 160),
  meta_description text not null default '' check (char_length(meta_description) <= 320),
  meta_image_media_id text references store_media(id) on delete set null,
  robots_index     boolean not null default true,
  robots_follow    boolean not null default true,
  updated_at       timestamptz not null default now()
);

insert into seo_pages (page_key) values
  ('home'), ('category'), ('product'), ('search'), ('cart'), ('checkout'),
  ('account'), ('about'), ('contact'), ('privacy'), ('terms'), ('refunds'),
  ('shipping'), ('warranty')
on conflict (page_key) do nothing;

-- ------------------------------------------------------ social links

create table if not exists social_links (
  id         text primary key,
  network    text not null check (char_length(network) between 1 and 60),
  url        text not null check (char_length(url) <= 500),
  is_active  boolean not null default true,
  sort_order integer not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------- analytics

create table if not exists analytics_scripts (
  id         text primary key,
  provider   text not null check (provider in ('ga4','gtm','meta_pixel','tiktok','snapchat','pinterest','linkedin','x')),
  script_id  text not null default '' check (char_length(script_id) <= 160),
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------- integrations

create table if not exists store_integrations (
  id              text primary key,
  provider        text not null check (char_length(provider) between 1 and 120),
  region          text not null default '',
  bucket          text not null default '',
  sender_identity text not null default '',
  webhook_url     text not null default '' check (char_length(webhook_url) <= 500),
  is_active       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -------------------------------------------------- messages/templates

create table if not exists email_templates (
  id           text primary key,
  template_key text not null unique check (template_key ~ '^[a-z0-9_.]+$'),
  name         text not null check (char_length(name) between 1 and 120),
  subject      text not null default '' check (char_length(subject) <= 200),
  heading      text not null default '' check (char_length(heading) <= 200),
  body         text not null default '',
  button_label text not null default '' check (char_length(button_label) <= 80),
  button_url   text not null default '' check (char_length(button_url) <= 500),
  footer_text  text not null default '' check (char_length(footer_text) <= 500),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists automated_messages (
  id            text primary key,
  message_key   text not null unique check (message_key ~ '^[a-z0-9_.]+$'),
  label         text not null check (char_length(label) between 1 and 120),
  channel       text not null check (channel in ('email', 'sms', 'inapp')),
  subject       text not null default '' check (char_length(subject) <= 200),
  body          text not null default '',
  delay_minutes integer not null default 0 check (delay_minutes between 0 and 10080),
  is_active     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per channel × audience × topic; the toggle is `is_active`.
create table if not exists notification_channel_settings (
  id         text primary key,
  channel    text not null check (channel in ('email', 'sms', 'inapp')),
  audience   text not null check (audience in ('admin', 'customer')),
  topic      text not null,
  is_active  boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (channel, audience, topic)
);

insert into notification_channel_settings (id, channel, audience, topic, is_active)
select
  c.channel || ':' || a.audience || ':' || t.topic,
  c.channel,
  a.audience,
  t.topic,
  (c.channel = 'inapp' and a.audience = 'admin')
from (values ('email'), ('sms'), ('inapp')) as c(channel)
cross join (values ('admin'), ('customer')) as a(audience)
cross join (values
  ('order_placed'), ('payment_received'), ('processing'), ('shipped'),
  ('delivered'), ('cancelled'), ('refund_requested'), ('refund_completed'),
  ('back_in_stock'), ('password_reset'), ('staff_invite'), ('low_stock')
) as t(topic)
on conflict (channel, audience, topic) do nothing;

-- ---------------------------------------------------------- reasons

create table if not exists refund_reasons (
  id         text primary key,
  label      text not null check (char_length(label) between 1 and 160),
  is_active  boolean not null default true,
  sort_order integer not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists return_reasons (
  id         text primary key,
  label      text not null check (char_length(label) between 1 and 160),
  is_active  boolean not null default true,
  sort_order integer not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into refund_reasons (id, label, sort_order) values
  ('rfr_damaged', 'Item arrived damaged', 10),
  ('rfr_wrong', 'Wrong item received', 20),
  ('rfr_not_as_described', 'Not as described', 30),
  ('rfr_late', 'Delivered too late', 40)
on conflict (id) do nothing;

insert into return_reasons (id, label, sort_order) values
  ('rtr_damaged', 'Damaged in transit', 10),
  ('rtr_wrong', 'Wrong item sent', 20),
  ('rtr_unwanted', 'Changed my mind', 30),
  ('rtr_defective', 'Defective on arrival', 40)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- RLS

alter table fulfilment_providers          enable row level security;
alter table shipping_methods              enable row level security;
alter table payment_methods               enable row level security;
alter table store_pages                   enable row level security;
alter table seo_pages                     enable row level security;
alter table social_links                  enable row level security;
alter table analytics_scripts             enable row level security;
alter table store_integrations            enable row level security;
alter table email_templates               enable row level security;
alter table automated_messages            enable row level security;
alter table notification_channel_settings enable row level security;
alter table refund_reasons                enable row level security;
alter table return_reasons                enable row level security;
