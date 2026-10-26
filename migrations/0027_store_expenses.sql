-- 0027: Expense ledger and product cost for the Reports phase.
--
-- The expense ledger is a simple book of manual entries — category, title,
-- amount, date, note, optional receipt in the media library. It is not
-- accounting software: entries can be corrected by editing them, and a removal
-- is a soft delete so the audit trail keeps pointing at a real row.
--
-- `products.cost_paise` exists only so the stock report can value on-hand
-- stock at cost as well as at retail. It is optional; a null cost is shown as
-- "not set" rather than zero, so an unpriced product cannot quietly deflate
-- the total.
--
-- Additive only. Every new table enables row level security in this same file,
-- with no policies: only the DATABASE_URL connection (the table owner) can
-- read or write them.

-- ------------------------------------------------------ expense categories

create table if not exists expense_categories (
  id         text primary key,
  name       text not null check (char_length(name) between 1 and 80),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into expense_categories (id, name) values
  ('exp_rent', 'Rent'),
  ('exp_utilities', 'Utilities'),
  ('exp_salaries', 'Salaries & wages'),
  ('exp_packaging', 'Packaging'),
  ('exp_marketing', 'Marketing'),
  ('exp_travel', 'Travel'),
  ('exp_equipment', 'Equipment'),
  ('exp_software', 'Software & subscriptions'),
  ('exp_other', 'Other')
on conflict (id) do nothing;

-- -------------------------------------------------------------- expenses

create table if not exists expenses (
  id                   text primary key,
  category_id          text references expense_categories(id) on delete set null,
  title                text not null check (char_length(title) between 1 and 160),
  amount_paise         bigint not null check (amount_paise > 0),
  spent_on             date not null default current_date,
  note                 text not null default '' check (char_length(note) <= 1000),
  attachment_media_id  text references store_media(id) on delete set null,
  created_by           text references store_admins(id) on delete set null,
  updated_by           text references store_admins(id) on delete set null,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_expenses_spent_on
  on expenses(spent_on desc, id desc) where deleted_at is null;

create index if not exists idx_expenses_category_spent
  on expenses(category_id, spent_on desc) where deleted_at is null;

alter table expense_categories enable row level security;
alter table expenses           enable row level security;

-- ---------------------------------------------------------- product cost

alter table products
  add column if not exists cost_paise integer
    check (cost_paise is null or cost_paise >= 0);
