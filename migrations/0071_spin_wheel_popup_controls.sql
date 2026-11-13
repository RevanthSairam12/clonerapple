-- 0071: Add Home page popup behavior controls to spin_wheel_settings.
--
-- Additive only. spin_wheel_settings already has row level security enabled (0069).

alter table spin_wheel_settings
  add column if not exists popup_enabled boolean not null default true,
  add column if not exists popup_delay_seconds integer not null default 10
    check (popup_delay_seconds >= 0 and popup_delay_seconds <= 120),
  add column if not exists popup_require_scroll boolean not null default true,
  add column if not exists popup_mobile_floating_button boolean not null default true;

