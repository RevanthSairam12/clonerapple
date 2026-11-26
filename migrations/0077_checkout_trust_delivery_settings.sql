-- 0077: Checkout Trust Review + Delivery & Dispatch Announcement settings.
--
-- Additive only. Seeds fail-closed defaults into `store_settings` (already has
-- RLS enabled from 0017) and adds a partial index on `product_reviews`
-- (already has RLS enabled from 0025) to speed up published review lookups
-- for checkout trust rendering.

insert into store_settings (key, value) values
  ('checkout_trust_enabled', 'off'),
  ('checkout_trust_mode', 'trust_message'),
  ('checkout_trust_review_id', ''),
  ('checkout_trust_text', ''),
  ('checkout_trust_reviewer_name', ''),
  ('checkout_trust_min_rating', '4'),
  ('checkout_trust_show_verified', 'on'),
  ('checkout_trust_verified_only', 'on'),
  ('checkout_delivery_normal_enabled', 'off'),
  ('checkout_delivery_normal_title', 'Expected Delivery'),
  ('checkout_delivery_normal_min_days', '4'),
  ('checkout_delivery_normal_max_days', '6'),
  ('checkout_delivery_normal_description', 'Estimated delivery after your order is confirmed.'),
  ('checkout_delivery_normal_icon', 'truck'),
  ('checkout_delivery_sale_enabled', 'off'),
  ('checkout_delivery_sale_title', 'Sale Dispatch Update'),
  ('checkout_delivery_sale_message', 'Dispatch starts after the sale ends.'),
  ('checkout_delivery_sale_description', 'Orders placed during the sale will be processed once the sale concludes.'),
  ('checkout_delivery_sale_estimate', ''),
  ('checkout_delivery_sale_icon', 'clock')
on conflict (key) do nothing;

create index if not exists idx_product_reviews_published_checkout
  on product_reviews (verified_purchase desc, rating desc, created_at desc, id desc)
  where status = 'published';
