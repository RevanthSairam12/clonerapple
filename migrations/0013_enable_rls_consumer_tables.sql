alter table if exists public.users enable row level security;
alter table if exists public.user_sessions enable row level security;
alter table if exists public.orders enable row level security;

revoke all privileges on table public.users from anon, authenticated;
revoke all privileges on table public.user_sessions from anon, authenticated;
revoke all privileges on table public.orders from anon, authenticated;
