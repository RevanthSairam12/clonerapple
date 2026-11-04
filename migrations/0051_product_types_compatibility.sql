-- Phase 3: explicit product classification and manual compatibility.
-- No historical assignments or device selections are made by this migration.
create table if not exists product_types (
  id text primary key,
  category_id text not null references categories(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  requires_compatibility boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, category_id)
);
create unique index if not exists product_types_category_name on product_types(category_id, lower(btrim(name)));
alter table product_types enable row level security;

create table if not exists product_type_attributes (
  product_type_id text not null references product_types(id),
  attribute_id text not null references attributes(id),
  is_required boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  show_in_specs boolean not null default true,
  show_in_filters boolean not null default false,
  show_in_search boolean not null default false,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (product_type_id, attribute_id)
);
alter table product_type_attributes enable row level security;

create table if not exists device_brands (
  id text primary key,
  name text not null check (length(btrim(name)) between 1 and 100),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index if not exists device_brands_name on device_brands(lower(btrim(name)));
alter table device_brands enable row level security;

create table if not exists device_models (
  id text primary key,
  brand_id text not null references device_brands(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index if not exists device_models_brand_name on device_models(brand_id, lower(btrim(name)));
alter table device_models enable row level security;

alter table products add column if not exists product_type_id text;
-- A non-null value records a deliberate selection, including a deliberately empty set.
alter table products add column if not exists compatibility_reviewed_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_type_category_fk' and conrelid = 'products'::regclass) then
    alter table products add constraint products_type_category_fk
      foreign key (product_type_id, category_id) references product_types(id, category_id);
  end if;
end $$;
create index if not exists products_type_idx on products(product_type_id);

create table if not exists product_device_models (
  product_id text not null references products(id),
  device_model_id text not null references device_models(id),
  sort_order integer not null default 0 check (sort_order >= 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (product_id, device_model_id)
);
create index if not exists product_device_models_device_idx on product_device_models(device_model_id, product_id) where archived_at is null;
alter table product_device_models enable row level security;

alter table product_attribute_values add column if not exists archived_at timestamptz;
alter table product_attribute_values add column if not exists updated_at timestamptz not null default now();
-- An archived value can be replaced only after its old representation is retained.
create table if not exists product_attribute_history (
  id bigint generated always as identity primary key,
  product_id text not null references products(id),
  attribute_id text not null references attributes(id),
  value_text text,
  value_number numeric(18,6),
  value_bool boolean,
  option_value text,
  archived_at timestamptz,
  changed_at timestamptz not null default now()
);
alter table product_attribute_history enable row level security;
create or replace function retain_product_attribute_value() returns trigger language plpgsql as $$
begin
  if row(old.value_text,old.value_number,old.value_bool,old.option_value,old.archived_at)
     is distinct from row(new.value_text,new.value_number,new.value_bool,new.option_value,new.archived_at) then
    insert into product_attribute_history(product_id,attribute_id,value_text,value_number,value_bool,option_value,archived_at)
      values(old.product_id,old.attribute_id,old.value_text,old.value_number,old.value_bool,old.option_value,old.archived_at);
  end if;
  return new;
end $$;
create or replace trigger retain_product_attribute_value before update on product_attribute_values
  for each row execute function retain_product_attribute_value();

-- Product values now flow through the server's type-aware projection. The legacy
-- policy exposed every value on an active product, including archived values.
drop policy if exists "public read values of active products" on product_attribute_values;
