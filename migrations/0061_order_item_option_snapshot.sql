-- 0061: The exact option and photo an order line sold, stored as a snapshot.
-- Additive only. Existing order rows are never rewritten; their new columns
-- stay null and readers fall back to the live catalogue exactly as before.
--
-- These are plain text snapshots, deliberately without foreign keys: renaming
-- or retiring a model, colour or photo must never change an old order.

alter table order_items add column if not exists variant_device_model_id text;
alter table order_items add column if not exists variant_device_model_name text;
alter table order_items add column if not exists variant_colour_id text;
alter table order_items add column if not exists variant_colour_name text;
alter table order_items add column if not exists variant_colour_hex text;
alter table order_items add column if not exists image_url text;
alter table order_items add column if not exists image_alt text;
