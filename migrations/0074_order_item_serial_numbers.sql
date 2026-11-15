-- 0074: Per-item serial numbers on order_items and default invoice request reasons.
-- Additive only. Admin records a serial number for each product line in an
-- order; saving serial numbers for all products in a paid order issues the
-- invoice so every product's serial number appears on the invoice.

alter table order_items
  add column if not exists serial_number text;

insert into bill_request_reasons (id, label, is_active, sort_order)
values
  ('warranty', 'Warranty claim', true, 10),
  ('accounting', 'Tax / accounting record', true, 20),
  ('reimbursement', 'Employer / business reimbursement', true, 30),
  ('personal', 'Personal record', true, 40)
on conflict (id) do nothing;
