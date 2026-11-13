-- 0070: Add Store Admin reward cooldown policy and customer countdown display
-- toggle to spin_wheel_settings.
--
-- Additive only. spin_wheel_settings already has RLS enabled (0069).

alter table spin_wheel_settings
  add column if not exists reward_cooldown_mode text not null default 'until_coupon_expires'
    check (reward_cooldown_mode in ('disabled', 'until_coupon_expires', 'custom_days')),
  add column if not exists reward_cooldown_days integer not null default 7
    check (reward_cooldown_days >= 1 and reward_cooldown_days <= 365),
  add column if not exists show_next_spin_countdown boolean not null default true;

