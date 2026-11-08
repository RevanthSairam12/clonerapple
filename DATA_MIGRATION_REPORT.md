# DATA_MIGRATION_REPORT.md — Supabase Data Migration to Mumbai (ap-south-1)

**Date:** 9 November 2026  
**Source Project (Test / Staging):** Tokyo (`ap-northeast-1`, `ttzfovaadeyynggnypru.supabase.co`) — **Untouched & Read-Only**  
**Target Project (Production):** Mumbai (`ap-south-1`, `wdupzslotwetzwwibssn.supabase.co`) — **Migrated & Verified**  
**Verification Script:** `node scripts/verify-migrated-data.mjs`  

---

## 1. Schema, RLS & Security Verification on Target

All 65 migration files (`0001_admin_foundation.sql` through `0067_db_connection_decisions.sql`) were applied sequentially over port `5432` (`DATABASE_MIGRATION_URL`). Both database security verification scripts passed on the Mumbai target:

### `node scripts/check-security-db-state.mjs`
- `PASS MIG-1`: `0063-0067` all recorded (65 files total)
- `PASS PRIV-1`: no table-level privileges for `anon`/`authenticated`
- `PASS COLS-anon-allow`: 30 display columns granted (expected 30+)
- `PASS COLS-anon-deny`: `cost_paise`, `updated_by`, `catalog_revision` all withheld
- `PASS COLS-authenticated-allow`: 30 display columns granted (expected 30+)
- `PASS COLS-authenticated-deny`: `cost_paise`, `updated_by`, `catalog_revision` all withheld
- `PASS PRIV-2`: no column-level `INSERT`/`UPDATE`/`REFERENCES` for `anon`/`authenticated`
- `PASS RLS-1`: 5 table(s) have RLS enabled (`users`, `user_sessions`, `orders`, `content_blocks`, `products`)
- `PASS VIEW-1`: `security_invoker=true` on `order_sale_state`
- `PASS GUARD-1`: 6 ledger tables have a statement guard

### `node scripts/verify-rls-consumer-tables.mjs`
- `users`: HTTP 401, rows 0
- `user_sessions`: HTTP 401, rows 0
- `orders`: HTTP 401, rows 0
- `order_sale_state`: HTTP 401, rows 0
- `content_blocks`: HTTP 200, rows 12
- `products`: HTTP 200, rows 5
- `products.cost_paise`: HTTP 401, rows 0
- `schema_migrations`: HTTP 401, rows 0

---

## 2. Per-Table Row Counts & Canonical SHA-256 Parity (52 Kept Tables)

Every kept table was compared between Source (Tokyo) and Target (Mumbai) using canonical JSON serialization (including exact primary keys, foreign keys, `created_at` / `updated_at` / `archived_at` timestamps, and JSONB payloads):

| # | Table | Source Rows | Target Rows | Canonical SHA-256 (Prefix) | Result |
|---:|---|---:|---:|---|---|
| 1 | `content_blocks` | 12 | 12 | `30b645f0993c` | **IDENTICAL** |
| 2 | `site_settings` | 2 | 2 | `d1467bcdc749` | **IDENTICAL** (2 archived rows preserved) |
| 3 | `store_settings` | 10 | 10 | `2b5a60b6d89e` | **IDENTICAL** (excludes 4 ephemeral heartbeat keys) |
| 4 | `payment_methods` | 3 | 3 | `aa8e0088246f` | **IDENTICAL** |
| 5 | `cancellation_reasons` | 6 | 6 | `5211f2304712` | **IDENTICAL** |
| 6 | `refund_reasons` | 4 | 4 | `fdf2db20b4f7` | **IDENTICAL** |
| 7 | `return_reasons` | 4 | 4 | `8d0c3b488054` | **IDENTICAL** |
| 8 | `bill_request_reasons` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 9 | `expense_categories` | 9 | 9 | `9e2a2e1bc586` | **IDENTICAL** |
| 10 | `notification_channel_settings` | 114 | 114 | `6eb0af24710d` | **IDENTICAL** |
| 11 | `store_pages` | 8 | 8 | `61544ffbc59a` | **IDENTICAL** |
| 12 | `seo_pages` | 14 | 14 | `93878c0a045a` | **IDENTICAL** |
| 13 | `sale_settings` | 1 | 1 | `b4c4fcdd7f7e` | **IDENTICAL** |
| 14 | `customer_settings` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 15 | `fulfilment_providers` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 16 | `shipping_methods` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 17 | `social_links` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 18 | `analytics_scripts` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 19 | `store_integrations` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 20 | `automated_messages` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 21 | `email_templates` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 22 | `store_admins` (selected owner) | 1 | 1 | `615aa4c7cf22` | **IDENTICAL** (`revanth11330@gmail.com`) |
| 23 | `store_admin_preferences` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 24 | `categories` | 6 | 6 | `deeb361bd64b` | **IDENTICAL** |
| 25 | `media` | 2 | 2 | `b6a836aa9c18` | **IDENTICAL** |
| 26 | `store_media` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |
| 27 | `products` (real catalog) | 5 | 5 | `016d5bdc14be` | **IDENTICAL** |
| 28 | `product_images` | 31 | 31 | `9aa024e6376e` | **IDENTICAL** |
| 29 | `product_content_revisions` | 5 | 5 | `a1da036965b3` | **IDENTICAL** |
| 30 | `price_history` | 5 | 5 | `4bd40bbe7a4c` | **IDENTICAL** |
| 31 | `stock` | 5 | 5 | `5ec69e97da99` | **IDENTICAL** |
| 32–52 | `product_variants`, `product_variant_colours`, `colours`, `device_brands`, `device_models`, `product_device_models`, `product_collections`, `coupons`, `coupon_targets`, `brands`, `conditions`, `units`, `attributes`, `attribute_options`, `product_attribute_values`, `product_attribute_history`, `product_types`, `product_type_attributes`, `product_specs`, `product_facets`, `facet_defs` | 0 | 0 | `4f53cda18c2b` | **IDENTICAL** |

---

## 3. Deep Comparison: Website Content, Theme & Store Settings

### 3a. `content_blocks` (12 active, 0 archived)
| Key | Canonical SHA-256 | Status |
|---|---|---|
| `apple.footer` | `e565b3bc10` | **IDENTICAL** |
| `apple.gallery` | `fe412f41a2` | **IDENTICAL** |
| `apple.hero_tiles` | `b28dfee6fa` | **IDENTICAL** |
| `apple.hero_video` | `529df38f52` | **IDENTICAL** |
| `apple.promo_section` | `08bab0c08f` | **IDENTICAL** |
| `apple.ribbon` | `9be3ce51ec` | **IDENTICAL** |
| `gadzio.category_grid` | `1469b4a4b6` | **IDENTICAL** |
| `gadzio.crowd_favorites` | `e6f3257329` | **IDENTICAL** |
| `gadzio.diwali_campaign` | `d7797934e4` | **IDENTICAL** |
| `gadzio.in_the_wild` | `2c225858fe` | **IDENTICAL** |
| `gadzio.reviews` | `5d1d6c5fc9` | **IDENTICAL** |
| `gadzio.trust_badges` | `947c66900e` | **IDENTICAL** |

### 3b. `site_settings` (Theme — 2 archived rows)
| Key | State | Canonical SHA-256 | Status |
|---|---|---|---|
| `fontFamily` | Archived (`archived_at` preserved) | `81ad6447d6` | **IDENTICAL** |
| `homepageUiMode` | Archived (`archived_at` preserved) | `c7cdb67f30` | **IDENTICAL** |

### 3c. `store_settings` (10 configuration keys)
| Key | Value | Canonical SHA-256 | Status |
|---|---|---|---|
| `auto_confirm` | `"off"` | `f135bb6866` | **IDENTICAL** |
| `cod_enabled` | `"off"` | `2387c046cf` | **IDENTICAL** |
| `free_shipping_over` | `"4000"` | `c7ac71ef24` | **IDENTICAL** |
| `free_shipping_threshold_paise` | `"400000"` | `e3e56324c5` | **IDENTICAL** |
| `maintenance_enabled` | `"off"` | `ade35e4543` | **IDENTICAL** |
| `order_start_number` | `"1009"` | `466955e248` | **IDENTICAL** |
| `pickup_enabled` | `"off"` | `69891fafbd` | **IDENTICAL** |
| `shipping_charge_paise` | `"4000"` | `1fd4a700f9` | **IDENTICAL** |
| `shipping_enabled` | `"on"` | `fea3e98ea9` | **IDENTICAL** |
| `trade_name` | `"Gadzio"` | `3cf133c27d` | **IDENTICAL** |

---

## 4. Product, Option, SKU & Price Comparison

| Product ID | Slug | Price (Paise) | Regular Price (Paise) | Sale Price | Stock On-Hand | Status |
|---|---|---:|---:|---|---:|---|
| `apple-20w-usbc-power-adapter` | `apple-20w-usbc-power-adapter` | 219,000 | 219,000 | `null` | 10 | **IDENTICAL** |
| `apple-60w-usbc-charge-cable-1m` | `apple-60w-usbc-charge-cable-1m` | 219,000 | 219,000 | `null` | 10 | **IDENTICAL** |
| `apple-earphones-lightning` | `apple-earphones-lightning` | 219,000 | 219,000 | `null` | 10 | **IDENTICAL** |
| `apple-earphones-usbc` | `apple-earphones-usbc` | 219,000 | 219,000 | `null` | 10 | **IDENTICAL** |
| `apple-usbc-to-lightning-cable-1m` | `apple-usbc-to-lightning-cable-1m` | 219,000 | 219,000 | `null` | 10 | **IDENTICAL** |

---

## 5. Storage Bucket Replication & Media Link Decisions

### 5a. Storage Objects (`media` bucket, `public = true`)
All 8 objects in the `media` bucket were downloaded from Source and uploaded to Target with identical object paths, byte sizes, and SHA-256 content hashes:

| Object Path | MIME Type | Byte Size | SHA-256 Checksum (Prefix) | Target HTTP Status | Parity |
|---|---|---:|---|---|---|
| `3ce6b3bb-b38a-40bb-b729-8cdb7506a97b.png` | `image/png` | 61 | `57b6797baf74` | 200 OK | **IDENTICAL** |
| `419b949f-bcbd-402b-8838-538553b95765.png` | `image/png` | 64 | `08133198aeec` | 200 OK | **IDENTICAL** |
| `724940a2-503f-40b8-aa28-f2d509bca1f3.png` | `image/png` | 61 | `57b6797baf74` | 200 OK | **IDENTICAL** |
| `85c6e85e-3925-493f-bf1c-3d37b33c775c.png` | `image/png` | 64 | `08133198aeec` | 200 OK | **IDENTICAL** |
| `b66fa9cd-cad1-4fa0-a822-1ecfd74fdeba.png` | `image/png` | 61 | `57b6797baf74` | 200 OK | **IDENTICAL** |
| `direct-test.png` | `image/png` | 61 | `57b6797baf74` | 200 OK | **IDENTICAL** |
| `e4b3552a-5632-45f8-a5ef-0343055eb456.mp4` | `video/mp4` | 743,663 | `2f3a299e9fd1` | 200 OK | **IDENTICAL** |
| `fb298492-1376-4aa6-a74f-e51172ca6b48.webm` | `video/webm` | 148,422 | `b8d0178768f1` | 200 OK | **IDENTICAL** |

### 5b. Image Link Decisions
- **0 absolute URLs** in any kept database table (`content_blocks`, `site_settings`, `store_settings`, `products`, `product_images`, `media`, `store_pages`, `seo_pages`) contained the old project host (`ttzfovaadeyynggnypru.supabase.co`).
- `public.media` stores relative `/api/admin/media/<id>` URLs and `storage_path` filenames, which resolve dynamically at runtime via `NEXT_PUBLIC_SUPABASE_URL`.
- `public.product_images` stores 31 external CDN URLs (`https://ik.imagekit.io/...`).
- **Decision:** Zero URL rewrites were required or executed.

---

## 6. Rendered HTML & Side-by-Side Admin Verification

Two production Next.js (`next start`) instances were run against the exact same `.next` build:
- **Source Server (`localhost:3101`):** Connected to Tokyo (`aws-0-ap-northeast-1.pooler.supabase.com`)
- **Target Server (`localhost:3103`):** Connected to Mumbai (`aws-0-ap-south-1.pooler.supabase.com`)

| Route | HTTP Status | DOM & Metadata SHA-256 (Source / Target) | Comparison Result |
|---|---|---|---|
| `/` (Home page) | 200 / 200 | `1c91a2ad3461` / `1c91a2ad3461` | **IDENTICAL (byte-for-byte)** |
| `/in/shop/iphone/accessories/power-adapter-cable` | 200 / 200 | `dbc33e4135a3` / `dbc33e4135a3` | **IDENTICAL (byte-for-byte)** |
| `/shop/product/apple-20w-usbc-power-adapter` | 200 / 200 | `cc482d9153d1` / `cc482d9153d1` | **IDENTICAL (byte-for-byte)** |
| `/privacy` | 200 / 200 | `3502104b530e` / `3502104b530e` | **IDENTICAL DOM & META** (Mumbai flushes `<title>` in `<head>` due to 12ms RTT vs Tokyo RSC tail at 65ms RTT) |
| `/terms` | 200 / 200 | `2ac6a3f7b871` / `2ac6a3f7b871` | **IDENTICAL DOM & META** (same Next.js RSC streaming head-flush timing) |
| `/support` | 200 / 200 | `b8ff34eb49af` / `b8ff34eb49af` | **IDENTICAL (byte-for-byte)** |
| `/store-admin/website` (Website Overview) | 200 / 200 | `f735d879fc23` / `f735d879fc23` | **IDENTICAL (byte-for-byte)** |
| `/store-admin/website/content` (Website Content) | 200 / 200 | `15b81d1a4f35` / `15b81d1a4f35` | **IDENTICAL (byte-for-byte)** |
| `/store-admin/website/theme` (Website Theme) | 200 / 200 | `e3b7c99c7c4a` / `e3b7c99c7c4a` | **IDENTICAL (byte-for-byte)** |
| `/store-admin/settings` (Store Settings) | 200 / 200 | `0a79498d323b` / `0a79498d323b` | **IDENTICAL (byte-for-byte)** |

Side-by-side 1200×850 screenshots of `/store-admin/website`, `/store-admin/website/content`, `/store-admin/website/theme`, and `/store-admin/settings` were captured from both Source and Target and verified visually identical.

---

## 7. Environment-Specific Settings to Review Post-Cutover

| Setting / Variable | Current Value in Mumbai Target | Table / Source | Recommended Post-Cutover Action |
|---|---|---|---|
| `maintenance_enabled` | `"off"` | `store_settings` | Keep `"off"` for public access, or toggle `"on"` briefly during final smoke check. |
| `sale_settings.enabled` | `false` (`starts_at: null`, `ends_at: null`) | `sale_settings` | Keep `false` until launching a scheduled promotional sale. |
| `order_start_number` | `"1009"` | `store_settings` & `order_number_counters` | Initialized to `1009` in `order_number_counters`. Adjust in Settings → Orders if a different starting sequence is desired before first order. |
| `shipping_enabled` | `"on"` | `store_settings` | Enabled (`shipping_charge_paise = 4000` [₹40], `free_shipping_threshold_paise = 400000` [₹4,000]). |
| `cod_enabled` / `pickup_enabled` | `"off"` / `"off"` | `store_settings` | Confirm whether Cash on Delivery or Store Pickup should remain disabled at launch. |
| `PAYU_ENV`, `PAYU_KEY`, `PAYU_SALT` | Env variables | Vercel Environment | Switch from test sandbox (`PAYU_ENV=test`) to production PayU credentials at cutover. |
| `APP_BASE_URL` | Env variable | Vercel Environment | Set to canonical production HTTPS domain (`https://gadzio.in`). |
| `MAIL_PASSWORD`, `MAIL_ALLOWED_HOSTS` | Env variables | Vercel Environment | Configure production SMTP host allowlist and credentials when transactional email is enabled. |
| `analytics_scripts` / `social_links` | `0 rows` | `analytics_scripts`, `social_links` | Add production analytics tags or social profile URLs via Settings → Analytics when ready. |

---

## 8. Data Excluded from Copy (Clean Production Slate)

The following transactional, ephemeral, and test datasets were intentionally excluded from the Mumbai target project:
- **Customer & Session Tables (0 rows in target):** `users` (80 in source), `user_sessions` (40 in source), `customer_addresses`, `customer_browsing_history`, `customer_notes`, `user_login_events`, `newsletter_subscribers`.
- **Orders, Payments & Refunds (0 rows in target):** `orders` (40 in source), `order_items` (40 in source), `order_addresses` (40 in source), `order_status_history` (40 in source), `order_deliveries`, `order_delivery_events`, `order_edit_logs`, `order_notes`, `order_payments`, `order_requests`, `bill_requests`, `payment_events`, `refunds`, `refund_requests`, `refund_request_events`, `refund_obligations`, `return_requests`, `return_items`, `pos_shifts`.
- **Inventory Ledger & Waitlists (0 rows in target):** `stock_movements` (45 in source), `stock_reservations`, `waiting_list_entries`, `coupon_redemptions`.
- **Outbox, Audit & Import Scratch (not copied):** `notification_outbox` (40 in source), `store_admin_audit` (1,035 historical rows in source excluded), `store_admin_sessions`, `admin_users`, `admin_sessions`, `catalog_imports` (3 in source), `catalog_import_errors` (20 in source), `expenses`, `product_reviews`.
- **Benchmark Synthetic Products (excluded):** `perf-test-item-mw6auu61` and `perf-test-item-mw6cz9g9` excluded from `products` and `stock`.
- **Non-Owner Staff Accounts (excluded):** `pardhu@gadzio.com` (inactive) and `admin@appleclone.test` (Test Editor) excluded per owner selection; only `revanth11330@gmail.com` (`store_owner`) was copied.
- **Operational Heartbeats & Sequences:** `reconcile_heartbeat_*` keys in `store_settings` were excluded; sequence tables (`order_number_counters = 1009`, `receipt_counters = 1`, `invoice_number_counters = 0`) were initialized fresh.
