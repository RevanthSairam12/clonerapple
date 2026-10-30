-- Store pickup is not supported at checkout: there is no pickup choice, so a
-- stored "on" could never do anything. Force the stored value to "off" and
-- leave an audit row. The application also ignores the setting entirely
-- (settings-rules.ts `pickupEnabled`), so this is a tidy-up, not the guard.
--
-- No new table, so nothing to enable row level security on.

with before_value as (
  select value from store_settings where key = 'pickup_enabled'
), upsert as (
  insert into store_settings (key, value, updated_by, updated_at)
  values ('pickup_enabled', 'off', 'migration:0042', now())
  on conflict (key) do update
    set value = 'off', updated_by = 'migration:0042', updated_at = now()
    where store_settings.value is distinct from 'off'
  returning key
)
insert into store_admin_audit (actor_id, actor_email, action, entity, entity_id, before, after, route, reason)
select null, 'system', 'settings.update', 'store_settings', 'pickup_enabled',
       jsonb_build_object('value', coalesce((select value from before_value), '(unset)')),
       jsonb_build_object('value', 'off'),
       'migration/0042_pickup_off',
       'Store pickup is not available; forced off'
from upsert;
