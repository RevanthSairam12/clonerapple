-- An opaque edit token, not a count of user saves. A draft may advance it more
-- than once. Stock balances/reservations and denormalised in_stock never touch it.
alter table products add column if not exists catalog_revision integer not null default 0
  check (catalog_revision >= 0);

create or replace function guard_product_catalog_revision() returns trigger language plpgsql as $$
declare
  editorial_changed boolean;
begin
  editorial_changed :=
    (to_jsonb(new) - array['catalog_revision','updated_at','updated_by','created_at','in_stock'])
    is distinct from
    (to_jsonb(old) - array['catalog_revision','updated_at','updated_by','created_at','in_stock']);

  -- The explicit +1 path is used by child touches. Arbitrary assignments cannot
  -- rewind, skip tokens, or suppress a concurrent editorial change.
  if new.catalog_revision is distinct from old.catalog_revision then
    if new.catalog_revision is null or new.catalog_revision::bigint <> old.catalog_revision::bigint + 1 then
      raise exception 'Invalid product catalog revision assignment' using errcode = '23514';
    end if;
  end if;
  if editorial_changed or new.catalog_revision is distinct from old.catalog_revision then
    if old.catalog_revision = 2147483647 then
      raise exception 'Product catalog revision exhausted' using errcode = '22003';
    end if;
    new.catalog_revision := old.catalog_revision + 1;
  else
    new.catalog_revision := old.catalog_revision;
  end if;
  return new;
end $$;
create or replace trigger guard_product_catalog_revision before update on products
  for each row execute function guard_product_catalog_revision();

-- Callers writing child rows must lock parents before children; shared metadata
-- writers must first take their existing metadataGate fence (513031,3). Taking
-- that fence in an AFTER ROW trigger would reverse the established lock order.
-- Every multi-product fanout below visits distinct parent IDs in sorted order.
create or replace function touch_product_catalog_revisions(product_ids text[]) returns void language plpgsql as $$
declare
  product_id_to_touch text;
begin
  for product_id_to_touch in
    select distinct id from unnest(product_ids) as ids(id) where id is not null order by id
  loop
    update products set catalog_revision = catalog_revision + 1 where id = product_id_to_touch;
  end loop;
end $$;

create or replace function touch_catalog_revision_from_child() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['updated_at','updated_by','created_at'])
       is not distinct from (to_jsonb(old) - array['updated_at','updated_by','created_at']) then
      return null;
    end if;
    perform touch_product_catalog_revisions(array[old.product_id, new.product_id]);
  elsif tg_op = 'DELETE' then
    perform touch_product_catalog_revisions(array[old.product_id]);
  else
    perform touch_product_catalog_revisions(array[new.product_id]);
  end if;
  return null;
end $$;

create or replace trigger catalog_revision_images after insert or update or delete on product_images
  for each row execute function touch_catalog_revision_from_child();
create or replace trigger catalog_revision_variants after insert or update or delete on product_variants
  for each row execute function touch_catalog_revision_from_child();
create or replace trigger catalog_revision_device_links after insert or update or delete on product_device_models
  for each row execute function touch_catalog_revision_from_child();
create or replace trigger catalog_revision_attribute_values after insert or update or delete on product_attribute_values
  for each row execute function touch_catalog_revision_from_child();
create or replace trigger catalog_revision_facets after insert or update or delete on product_facets
  for each row execute function touch_catalog_revision_from_child();
create or replace trigger catalog_revision_specs after insert or update or delete on product_specs
  for each row execute function touch_catalog_revision_from_child();

-- Only references whose services already share metadataGate fan out here.
-- Legacy attribute definitions/options/units do not: they are revalidated when
-- saving a draft, without introducing reference->parent lock inversions.
create or replace function touch_catalog_revision_from_reference() returns trigger language plpgsql as $$
declare
  before_row jsonb;
  after_row jsonb;
  reference_ids text[];
  affected_ids text[];
begin
  if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and
     (after_row - array['updated_at','updated_by','created_at'])
     is not distinct from (before_row - array['updated_at','updated_by','created_at']) then
    return null;
  end if;

  if tg_table_name = 'product_types' then
    reference_ids := array[before_row->>'id', after_row->>'id'];
    select array_agg(p.id) into affected_ids from products p where p.product_type_id = any(reference_ids);
  elsif tg_table_name = 'product_type_attributes' then
    reference_ids := array[before_row->>'product_type_id', after_row->>'product_type_id'];
    select array_agg(p.id) into affected_ids from products p where p.product_type_id = any(reference_ids);
  elsif tg_table_name = 'device_models' then
    reference_ids := array[before_row->>'id', after_row->>'id'];
    select array_agg(product_id) into affected_ids from (
      select pm.product_id from product_device_models pm where pm.device_model_id = any(reference_ids)
      union
      select v.product_id from product_variants v where v.device_model_id = any(reference_ids)
    ) affected;
  elsif tg_table_name = 'device_brands' then
    reference_ids := array[before_row->>'id', after_row->>'id'];
    select array_agg(product_id) into affected_ids from (
      select pm.product_id from product_device_models pm join device_models dm on dm.id = pm.device_model_id
        where dm.brand_id = any(reference_ids)
      union
      select v.product_id from product_variants v join device_models dm on dm.id = v.device_model_id
        where dm.brand_id = any(reference_ids)
    ) affected;
  end if;
  perform touch_product_catalog_revisions(affected_ids);
  return null;
end $$;
create or replace trigger catalog_revision_types after insert or update or delete on product_types
  for each row execute function touch_catalog_revision_from_reference();
create or replace trigger catalog_revision_type_attributes after insert or update or delete on product_type_attributes
  for each row execute function touch_catalog_revision_from_reference();
create or replace trigger catalog_revision_device_models after insert or update or delete on device_models
  for each row execute function touch_catalog_revision_from_reference();
create or replace trigger catalog_revision_device_brands after insert or update or delete on device_brands
  for each row execute function touch_catalog_revision_from_reference();
