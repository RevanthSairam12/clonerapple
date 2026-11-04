-- Owner-created shared colours. No catalogue names or device data are seeded.
create table if not exists colours (
  id text primary key,
  name text not null check (length(btrim(name)) between 1 and 100 and shared_catalogue_key(name) <> ''),
  hex text not null check (hex ~ '^#[0-9A-F]{6}$'),
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table colours enable row level security;
create unique index if not exists colours_shared_name_unique on colours(shared_catalogue_key(name));
create unique index if not exists colours_hex_unique on colours(hex);
create index if not exists colours_selection_order on colours(is_active,sort_order,id);

-- Add metadata alongside saved variants, never rewrite their immutable identity.
create table if not exists product_variant_colours (
  variant_id text primary key,
  product_id text not null references products(id),
  colour_id text not null references colours(id),
  created_at timestamptz not null default now(),
  foreign key (product_id,variant_id) references product_variants(product_id,id)
);
alter table product_variant_colours enable row level security;
create index if not exists product_variant_colours_colour on product_variant_colours(colour_id,product_id,variant_id);
create index if not exists product_variant_colours_product on product_variant_colours(product_id,variant_id);
create or replace function protect_variant_colour_reference() returns trigger language plpgsql as $$
begin
  raise exception 'Saved variant colour links are immutable; archive and replace the option' using errcode='23514';
end $$;
create or replace trigger protect_variant_colour_reference before update or delete on product_variant_colours
  for each row execute function protect_variant_colour_reference();
create or replace trigger catalog_revision_variant_colours after insert on product_variant_colours
  for each row execute function touch_catalog_revision_from_child();
create or replace function touch_catalog_revision_from_colour() returns trigger language plpgsql as $$
declare affected_ids text[];
begin
  if (to_jsonb(new) - array['updated_at','created_at']) is not distinct from (to_jsonb(old) - array['updated_at','created_at']) then return null; end if;
  select array_agg(distinct product_id order by product_id) into affected_ids from product_variant_colours where colour_id=new.id;
  perform touch_product_catalog_revisions(affected_ids);
  return null;
end $$;
create or replace trigger catalog_revision_shared_colour after update on colours
  for each row execute function touch_catalog_revision_from_colour();
