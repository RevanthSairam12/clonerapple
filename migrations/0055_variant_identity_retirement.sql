-- Preserve historical identities while allowing explicit same-label replacements.
alter table product_variants add column if not exists option_identity text;
alter table product_variants add column if not exists retired_at timestamptz;
alter table product_variants add constraint product_variants_retired_inactive
  check (retired_at is null or not is_active);
alter table product_variants add constraint product_variants_option_identity_bound
  check (option_identity is null or (length(option_identity) between 1 and 100 and option_identity = lower(btrim(regexp_replace(option_identity, '\s+', ' ', 'g')))));

create unique index if not exists idx_variants_live_option
  on product_variants(product_id, option_name, option_value) where retired_at is null;
-- NULL model and real models are disjoint buckets; stable model IDs, not labels.
create unique index if not exists idx_variants_semantic_identity
  on product_variants(product_id, coalesce(device_model_id, ''), lower(btrim(regexp_replace(option_name, '\s+', ' ', 'g'))), option_identity)
  where retired_at is null and is_purchasable and option_identity is not null;
drop index if exists idx_product_variants_option;

create or replace function protect_variant_identity() returns trigger
language plpgsql as $$
begin
  if old.retired_at is not null and new is distinct from old then
    raise exception 'Retired variant identity is immutable' using errcode='23514';
  end if;
  if old.sku is not null and new.sku is distinct from old.sku then
    raise exception 'Saved SKU is immutable' using errcode='23514';
  end if;
  if old.is_purchasable and (
    new.product_id is distinct from old.product_id or new.id is distinct from old.id or
    new.device_model_id is distinct from old.device_model_id or
    new.combination_key is distinct from old.combination_key or
    new.option_identity is distinct from old.option_identity or
    new.option_name is distinct from old.option_name or
    new.option_value is distinct from old.option_value or not new.is_purchasable
  ) then
    raise exception 'Saved commerce identity is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create or replace trigger product_variants_identity_guard before update on product_variants
  for each row execute function protect_variant_identity();
-- The existing global SKU and permanent commerce-combination indexes stay intact.
