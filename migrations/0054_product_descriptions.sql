-- Phase B3 foundation: nullable values retain the legacy fallback until reviewed.
-- No product content is populated or changed by this migration.
alter table products add column if not exists short_description text;
alter table products add column if not exists description_sections jsonb;
