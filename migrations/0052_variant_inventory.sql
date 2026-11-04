-- 0052: Explicit opt-in commerce variants. No stock allocation or order rewrite.
alter table products add column if not exists inventory_mode text not null default 'product'
  check (inventory_mode in ('product','variant'));
alter table product_variants add column if not exists is_purchasable boolean not null default false;
alter table product_variants add column if not exists device_model_id text references device_models(id);
alter table product_variants add column if not exists combination_key text;

create unique index if not exists idx_variants_product_identity on product_variants(product_id,id);
create unique index if not exists idx_variants_commerce_combination
  on product_variants(product_id,combination_key) where is_purchasable;

alter table order_items add column if not exists variant_id text;
alter table order_items add column if not exists variant_sku text;
alter table order_items add column if not exists variant_label text;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='product_variants'::regclass and conname='variant_commerce_identity') then
    alter table product_variants add constraint variant_commerce_identity check (
      not is_purchasable or (sku is not null and btrim(sku) <> '' and combination_key is not null and btrim(combination_key) <> '')
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid='stock'::regclass and conname='stock_variant_owner') then
    alter table stock add constraint stock_variant_owner foreign key(product_id,variant_id)
      references product_variants(product_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='stock_movements'::regclass and conname='movement_variant_owner') then
    alter table stock_movements add constraint movement_variant_owner foreign key(product_id,variant_id)
      references product_variants(product_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='order_items'::regclass and conname='order_item_variant_owner') then
    alter table order_items add constraint order_item_variant_owner foreign key(product_id,variant_id)
      references product_variants(product_id,id);
  end if;
end $$;

create index if not exists idx_stock_movements_order_variant
  on stock_movements(order_id,product_id,variant_id,reason);
create index if not exists idx_order_items_stock_identity on order_items(product_id,variant_id,order_id);

create or replace function forbid_stock_movement_mutation() returns trigger
language plpgsql as $$ begin raise exception 'stock movements are immutable'; end $$;
create or replace trigger stock_movements_immutable before update or delete on stock_movements
  for each row execute function forbid_stock_movement_mutation();
