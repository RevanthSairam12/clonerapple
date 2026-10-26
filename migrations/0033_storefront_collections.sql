-- 0033: Storefront collections and non-destructive CMS archiving.
--
-- product_collections records which products belong to a named merchandising
-- collection (a homepage rail or carousel, for example) and in what order.
-- The storefront reads only the collection key it asks for; an empty or
-- unreachable collection falls back to the coded/CMS list supplied by the
-- caller. Membership is archived with is_active = false, never destroyed.
--
-- content_blocks gains archived_at so the legacy editor can revert a block to
-- its coded defaults without deleting the row. The storefront readers ignore
-- archived rows, and every content row remains available for rollback.
--
-- Additive only: no rows, policies or existing columns are removed. RLS is
-- enabled on the new table in this same file, with no policies (the server
-- connection is the table owner; the publishable key gets zero rows).

-- ------------------------------------------------------- collections

create table if not exists product_collections (
  collection_key text not null
                 check (collection_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  product_id     text not null references products(id) on delete cascade,
  position       integer not null default 0 check (position >= 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (collection_key, product_id)
);

-- The storefront reads one key ordered by position. There is deliberately no
-- unique constraint on (collection_key, position): swapping two products must
-- not require a temporary negative position during a reorder transaction.
create index if not exists idx_product_collections_order
  on product_collections(collection_key, position, product_id)
  where is_active;

create index if not exists idx_product_collections_product
  on product_collections(product_id);

alter table product_collections enable row level security;

-- ------------------------------------------------ non-destructive revert

alter table content_blocks
  add column if not exists archived_at timestamptz;
