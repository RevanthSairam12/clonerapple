-- 0025: Catalog operations — review moderation, media library, import log.
--
-- Reviews are customer-written content. Nothing in this migration creates a
-- storefront review form; the back office moderates rows written by the site.
--
-- Media rows keep metadata only. The bytes live in the public Supabase Storage
-- `media` bucket under an unguessable uuid path, exactly like the CMS uploads;
-- `/api/media/[id]` redirects to the CDN so storefront <img> tags never need a
-- store-admin session.
--
-- Import jobs keep the row-level result of every dry-run and commit so the
-- error report can be downloaded later. Catalogue writes themselves happen in a
-- single transaction in the import service.

create table if not exists product_reviews (
  id               text primary key,
  order_id         text references orders(id) on delete set null,
  user_id          text,
  customer_name    text not null default '' check (char_length(customer_name) <= 120),
  customer_email   text not null default '' check (char_length(customer_email) <= 254),
  product_id       text not null references products(id) on delete cascade,
  rating           integer not null check (rating between 1 and 5),
  title            text not null default '' check (char_length(title) <= 160),
  body             text not null default '' check (char_length(body) <= 4000),
  verified_purchase boolean not null default false,
  status           text not null default 'pending'
                   check (status in ('pending', 'published', 'rejected')),
  rejection_reason text not null default '' check (char_length(rejection_reason) <= 300),
  store_reply      text not null default '' check (char_length(store_reply) <= 2000),
  replied_at       timestamptz,
  replied_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_product_reviews_status
  on product_reviews(status, created_at desc);
create index if not exists idx_product_reviews_product
  on product_reviews(product_id, created_at desc);

create table if not exists store_media (
  id           text primary key,
  filename     text not null check (char_length(filename) between 1 and 200),
  url          text not null,
  mime_type    text not null check (mime_type in (
                 'image/jpeg', 'image/png', 'image/webp', 'image/gif',
                 'image/svg+xml', 'image/avif', 'video/webm', 'video/mp4'
               )),
  size         integer not null check (size > 0),
  width        integer,
  height       integer,
  alt          text not null default '' check (char_length(alt) <= 300),
  storage_path text not null,
  uploaded_by  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists idx_store_media_created
  on store_media(created_at desc) where deleted_at is null;

create table if not exists catalog_imports (
  id            text primary key,
  filename      text not null default '' check (char_length(filename) <= 200),
  mode          text not null check (mode in ('dry_run', 'commit')),
  status        text not null check (status in ('validated', 'imported', 'rejected')),
  rows_total    integer not null default 0 check (rows_total >= 0),
  rows_created  integer not null default 0 check (rows_created >= 0),
  rows_updated  integer not null default 0 check (rows_updated >= 0),
  rows_failed   integer not null default 0 check (rows_failed >= 0),
  created_by    text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_catalog_imports_created
  on catalog_imports(created_at desc);

create table if not exists catalog_import_errors (
  id          bigserial primary key,
  import_id   text not null references catalog_imports(id) on delete cascade,
  row_number  integer not null check (row_number > 0),
  column_name text not null default '',
  message     text not null check (char_length(message) <= 500)
);

create index if not exists idx_catalog_import_errors_import
  on catalog_import_errors(import_id, row_number);

alter table product_reviews enable row level security;
alter table store_media enable row level security;
alter table catalog_imports enable row level security;
alter table catalog_import_errors enable row level security;
