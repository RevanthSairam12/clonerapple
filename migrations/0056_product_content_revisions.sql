-- Content history only. No product content is populated or inferred here.
create table if not exists product_content_revisions (
  id text primary key,
  revision_number bigint generated always as identity unique,
  product_id text not null references products(id),
  actor_id text not null references store_admins(id),
  source text not null check (source in ('product_draft','csv_import','restore','backfill','duplicate')),
  before_snapshot jsonb not null check (jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot jsonb not null check (jsonb_typeof(after_snapshot) = 'object'),
  restored_from_id text references product_content_revisions(id),
  created_at timestamptz not null default now()
);
alter table product_content_revisions enable row level security;
create index if not exists idx_product_content_revisions_product
  on product_content_revisions(product_id,revision_number desc);

create or replace function forbid_product_content_revision_mutation() returns trigger
language plpgsql as $$ begin raise exception 'product content revisions are immutable'; end $$;
create or replace trigger product_content_revisions_immutable
  before update or delete on product_content_revisions
  for each row execute function forbid_product_content_revision_mutation();
