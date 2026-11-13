-- Migration 0073: owner-only test-order classification on orders.
--
-- Keeps existing order rows, order numbers, and invoice numbers intact
-- (nothing is deleted or renumbered) while letting the store owner mark or
-- unmark an order as a test order so it is excluded from revenue, overview
-- analytics, customers, and reports.
--
-- Compatibility: orders already has RLS enabled (migration 0013), and the
-- invoice-immutability trigger (migration 0049) permits updates that do not
-- modify invoice_number, invoice_sequence, or invoice_issued_at.

alter table orders
  add column if not exists is_test boolean not null default false,
  add column if not exists test_marked_by text references store_admins(id) on delete set null,
  add column if not exists test_marked_at timestamptz,
  add column if not exists test_note text not null default ''
    check (char_length(test_note) <= 200);

create index if not exists idx_orders_is_test
  on orders (is_test, created_at desc);

