# DATA_MIGRATION_PLAN.md — Supabase Migration to Mumbai (ap-south-1)

**Date:** 9 November 2026  
**Source Project (Test/Staging):** Tokyo (`ap-northeast-1`, host `ttzfovaadeyynggnypru.supabase.co`) — **READ-ONLY**  
**Target Project (Production):** Mumbai (`ap-south-1`, new project) — **EMPTY, FRESH**  

---

## 1. Inventory & Classification

### 1a. Tables Backing Website Overview, Content, Theme, Settings & Policies

Every table backing the Website administration, storefront content, theme customization, store settings, customer policies, sale configuration, coupon visibility, and notifications was inspected in the live database via read-only transactions:

| Section / Screen | Table Name | Source Row Count | Detailed State / Breakdown |
|---|---|---|---|
| **Website Overview & Content** | `public.content_blocks` | **12** | 12 active, 0 archived (`apple.footer`, `apple.gallery`, `apple.hero_tiles`, `apple.hero_video`, `apple.promo_section`, `apple.ribbon`, `gadzio.category_grid`, `gadzio.crowd_favorites`, `gadzio.diwali_campaign`, `gadzio.in_the_wild`, `gadzio.reviews`, `gadzio.trust_badges`) |
| **Website Theme** | `public.site_settings` | **2** | 0 active, 2 archived (`fontFamily` = "Montserrat", `homepageUiMode` = "old" — both archived with timestamps preserved) |
| **Store Settings (Business, Orders, Payments, Storefront, Shipping)** | `public.store_settings` | **14** | `auto_confirm` (off), `cod_enabled` (off), `free_shipping_over` (4000), `free_shipping_threshold_paise` (400000), `maintenance_enabled` (off), `order_start_number` (1009), `pickup_enabled` (off), `shipping_charge_paise` (4000), `shipping_enabled` (on), `trade_name` (Gadzio), plus 4 operational reconcile heartbeat keys (excluded from copy) |
| **Payment Methods (Settings → Payments)** | `public.payment_methods` | **3** | All 3 active (`pm_cod`: Cash on delivery, `pm_manual`: Manual UPI/bank transfer, `pm_payu`: PayU gateway) |
| **Store Pages (Settings → Content)** | `public.store_pages` | **8** | All 8 in draft status (`about`, `cancellation`, `contact`, `privacy`, `refunds`, `shipping`, `terms`, `warranty`) |
| **SEO Defaults (Settings → Content)** | `public.seo_pages` | **14** | 14 fixed page keys (`about`, `account`, `cart`, `category`, `checkout`, `contact`, `home`, `privacy`, `product`, `refunds`, `search`, `shipping`, `terms`, `warranty`) |
| **Shipping Providers & Methods (Settings → Shipping)** | `public.fulfilment_providers` | **0** | 0 rows (configured via Settings UI or couriers) |
| | `public.shipping_methods` | **0** | 0 rows (legacy; checkout pricing uses `store_settings` shipping charge) |
| **Social Links (Settings → Analytics)** | `public.social_links` | **0** | 0 rows |
| **Analytics Scripts (Settings → Analytics)** | `public.analytics_scripts` | **0** | 0 rows |
| **Store Integrations (Settings → Analytics)** | `public.store_integrations` | **0** | 0 rows |
| **Automated Messages (Settings → Notifications)** | `public.automated_messages` | **0** | 0 rows (uses built-in code templates) |
| **Email Templates (Settings → Notifications)** | `public.email_templates` | **0** | 0 rows (uses built-in code templates) |
| **Notification Channel Matrix** | `public.notification_channel_settings` | **114** | 21 active (in-app staff alerts, customer waitlist invite, staff payment review), 93 inactive |
| **Cancellation Reasons (Settings → Reasons)** | `public.cancellation_reasons` | **6** | All 6 active (`cancel_customer_request`, `cancel_out_of_stock`, `cancel_payment_failed`, `cancel_address`, `cancel_duplicate`, `cancel_other`) |
| **Refund Reasons (Settings → Reasons)** | `public.refund_reasons` | **4** | All 4 active (`rfr_damaged`, `rfr_wrong`, `rfr_not_as_described`, `rfr_late`) |
| **Return Reasons (Settings → Reasons)** | `public.return_reasons` | **4** | All 4 active (`rtr_damaged`, `rtr_wrong`, `rtr_unwanted`, `rtr_defective`) |
| **Bill Request Reasons (Settings → Reasons)** | `public.bill_request_reasons` | **0** | 0 rows (built-in "Other" fallback available) |
| **Expense Categories (Admin)** | `public.expense_categories` | **9** | All 9 active (equipment, marketing, packaging, rent, salaries, software, travel, utilities, other) |
| **Customer Policy Settings** | `public.customer_settings` | **0** | 0 rows (system defaults in code: guest checkout on, retail group) |
| **Sale Mode Configuration** | `public.sale_settings` | **1** | Default row (`id="default"`, `enabled=false`, `starts_at=null`, `ends_at=null`) |
| **Staff Accounts (Settings → Staff)** | `public.store_admins` | **3** | Revanth (`store_owner`, active), pardhu (`store_admin`, inactive), Test Editor (`store_owner`, active) |
| **Staff Preferences** | `public.store_admin_preferences` | **0** | 0 rows |

---

### 1b. Other Tables to Copy for Real Work (Catalogue, Media, Pricing)

These tables contain real catalog data, product descriptions, photography links, category hierarchies, and price history:

| Table Name | Source Row Count | Purpose & Migration Strategy |
|---|---|---|
| `public.categories` | **6** | 6 active categories (`cases-protection`, `mobile-cases`, `power-adapter-cable`, `wired-earphones`, `cable-plug-case`, `airpods-case`). Copied with stable IDs and timestamps. |
| `public.products` | **7** | 5 real Apple accessory products (`apple-20w-usbc-power-adapter`, `apple-60w-usbc-charge-cable-1m`, `apple-earphones-lightning`, `apple-earphones-usbc`, `apple-usbc-to-lightning-cable-1m`) + 2 perf benchmark items (`perf-test-item-mw6auu61` [deleted], `perf-test-item-mw6cz9g9` [active]). The 5 real products are copied; perf items filtered out. |
| `public.product_images` | **31** | 31 image gallery rows for the 5 real products (primary and gallery views). All point to hosted CDN (`ik.imagekit.io`). |
| `public.product_content_revisions` | **5** | 5 revision audit records for the 5 real products. |
| `public.price_history` | **5** | Initial regular price history rows (₹2,190.00 / 219,000 paise) for the 5 real products. |
| `public.stock` | **7** | Inventory rows (10 units on-hand per real product, low-stock threshold = 2). Perf items excluded. |
| `public.media` | **2** | 2 uploaded media records (`gemini_generated_video_3abae3c8.mp4`, `9f9cd920ad5949d0a59cf373a23a982f.webm`) with `storage_path` in Supabase Storage `media` bucket. |
| `public.store_media` | **0** | 0 rows (table ready for future admin media uploads). |
| `public.product_variants` | **0** | 0 rows (table created by migration 0011). |
| `public.product_variant_colours` | **0** | 0 rows (table created by migration 0059). |
| `public.shared_colours` / `colours` | **0** | 0 rows (ready for shared colour catalogue). |
| `public.device_brands` | **0** | 0 rows (ready for device brands catalogue). |
| `public.device_models` | **0** | 0 rows (ready for device models catalogue). |
| `public.product_device_models` | **0** | 0 rows (ready for device model compatibility). |
| `public.product_collections` | **0** | 0 rows (collections managed under Website → Content). |
| `public.coupons` | **0** | 0 rows (ready for promotional codes). |
| `public.coupon_targets` | **0** | 0 rows (coupon targeting rules). |
| `public.coupon_visibility_assignments`| **0** | 0 rows (customer-specific coupon assignments). |
| `public.brands` | **0** | 0 rows. |
| `public.conditions` | **0** | 0 rows. |
| `public.units` | **0** | 0 rows. |
| `public.attributes` | **0** | 0 rows. |
| `public.attribute_options` | **0** | 0 rows. |
| `public.product_attribute_values` | **0** | 0 rows. |
| `public.product_attribute_history` | **0** | 0 rows. |
| `public.product_types` | **0** | 0 rows. |
| `public.product_type_attributes` | **0** | 0 rows. |
| `public.product_specs` | **0** | 0 rows. |
| `public.product_facets` | **0** | 0 rows. |
| `public.facet_defs` | **0** | 0 rows. |

---

### 1c. Tables NOT Copied (Transactional, Customer, Ephemeral, Test)

Per the migration specification, the target database must start clean of test transactions, test customers, abandoned sessions, and ephemeral logs:

| Table Category | Table Names | Source Row Count | Reason Excluded |
|---|---|---|---|
| **Customer Accounts & Auth** | `users`<br>`user_sessions`<br>`customer_addresses`<br>`customer_browsing_history`<br>`customer_notes`<br>`user_login_events` | 80<br>40<br>0<br>0<br>0<br>0 | Test and benchmark customer accounts. Real customers create accounts on the production store. |
| **Orders & Commerce** | `orders`<br>`order_items`<br>`order_addresses`<br>`order_status_history`<br>`order_deliveries`<br>`order_delivery_events`<br>`order_edit_logs`<br>`order_notes`<br>`order_payments`<br>`order_requests`<br>`bill_requests` | 40<br>40<br>40<br>40<br>0<br>0<br>0<br>0<br>0<br>0<br>0 | Synthetic and test orders created during staging/test runs. Production starts with 0 orders. |
| **Payments & Refunds** | `payment_events`<br>`refunds`<br>`refund_requests`<br>`refund_request_events`<br>`refund_obligations` | 0<br>0<br>0<br>0<br>0 | Test payment event timeline and refund records. |
| **Stock Movements & Reservations** | `stock_movements`<br>`stock_reservations`<br>`waiting_list_entries` | 45<br>0<br>0 | Ephemeral ledger entries and reservation holds generated by test checkouts. Real inventory is set cleanly on `stock`. |
| **Coupons Redemptions** | `coupon_redemptions` | 0 | Redemptions tied to test orders. |
| **Notification Outbox** | `notification_outbox` | 40 | Outbox logs for test order notifications. |
| **Audit Logs & Sessions** | `store_admin_audit`<br>`store_admin_sessions`<br>`store_admin_recovery_codes`<br>`admin_sessions` | 1,035<br>1<br>0<br>1 | Historical admin session tokens and test audit events. Production starts fresh audit logging. |
| **Import History & Operational** | `catalog_imports`<br>`catalog_import_errors`<br>`expenses`<br>`newsletter_subscribers`<br>`product_reviews` | 3<br>20<br>0<br>0<br>0 | Staging CSV import scratch logs. |
| **Operational Counters** | `order_number_counters`<br>`receipt_counters`<br>`invoice_number_counters` | 1<br>1<br>1 | Counters are NOT copied. Initialized from `order_prefix` and `order_start_number` (1009). |
| **Reconcile Heartbeat** | In `store_settings`: `reconcile_heartbeat_*` | 4 keys | Operational timestamp / status of background worker. Resets to empty on production. |

---

### 1d. Storage Inventory & Link Analysis

#### 1. Storage Buckets
- Bucket name: **`media`**
- Visibility: **`public = true`**
- Object count: **8 objects**
- Total size: **892,457 bytes (~871.5 KB)**

#### 2. Storage Objects
| Object Name | MIME Type | Size (Bytes) | ETag | Usage / Referencing Record |
|---|---|---|---|---|
| `e4b3552a-5632-45f8-a5ef-0343055eb456.mp4` | `video/mp4` | 743,663 | `"099b465435f66111705093098b8f1218"` | `public.media` (id: `e4b3552a-5632-45f8-a5ef-0343055eb456`) |
| `fb298492-1376-4aa6-a74f-e51172ca6b48.webm` | `video/webm` | 148,422 | `"d531802e2909cd3c9319359a571718ed"` | `public.media` (id: `fb298492-1376-4aa6-a74f-e51172ca6b48`) |
| `3ce6b3bb-b38a-40bb-b729-8cdb7506a97b.png` | `image/png` | 61 | `"a6556fb0153fae24a394f838458bc967"` | Direct storage upload |
| `419b949f-bcbd-402b-8838-538553b95765.png` | `image/png` | 64 | `"68edd00e4326b2b3c397f08e5a61ae38"` | Direct storage upload |
| `724940a2-503f-40b8-aa28-f2d509bca1f3.png` | `image/png` | 61 | `"a6556fb0153fae24a394f838458bc967"` | Direct storage upload |
| `85c6e85e-3925-493f-bf1c-3d37b33c775c.png` | `image/png` | 64 | `"68edd00e4326b2b3c397f08e5a61ae38"` | Direct storage upload |
| `b66fa9cd-cad1-4fa0-a822-1ecfd74fdeba.png` | `image/png` | 61 | `"a6556fb0153fae24a394f838458bc967"` | Direct storage upload |
| `direct-test.png` | `image/png` | 61 | `"a6556fb0153fae24a394f838458bc967"` | Integration test artifact |

#### 3. How `/api/media/[id]` and `/api/admin/media/[id]` Resolve Images
- Both routes resolve media dynamically by querying the database for `storage_path`:
  - `/api/media/[id]` queries `public.store_media`. If found, it issues a `302 Found` redirect to:
    `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${storage_path}`
  - `/api/admin/media/[id]` queries `public.store_media` first; if not found, it queries `public.media`. If `storage_path` is present, it issues a `302 Found` redirect to:
    `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media/${storage_path}`
- **Key Architecture Benefit:** Because redirect URLs are resolved at runtime using the server's ambient `NEXT_PUBLIC_SUPABASE_URL` environment variable, the database itself does not need to store absolute Supabase project URLs.

#### 4. Scan for Absolute URLs Containing the Old Project Host
- Scanned all 45 kept tables and all JSON/text fields for `ttzfovaadeyynggnypru.supabase.co` and `supabase.co`.
- **Result:**
  - Absolute URLs containing old Supabase host: **0**
  - External CDN URLs: **31** in `public.product_images` (`https://ik.imagekit.io/...`)
  - Relative API URLs: **2** in `public.media` (`/api/admin/media/...`)
  - Relative asset URLs: local paths in `content_blocks` (e.g. `/sites/www-apple-com-736d3707/...`, `/images/wild/...`)
- **Conclusion:** No URL rewrite is required because zero rows store hardcoded old project hosts.

---

### 1e. Environment-Specific Settings to Review Post-Copy

The following settings store environment-sensitive parameters or flags that must be reviewed after copying to production:

| Setting Name | Current Stored Value | Location / Table | Review Action for Production |
|---|---|---|---|
| `maintenance_enabled` | `"off"` | `public.store_settings` | Confirm storefront is open (`off`) or keep `on` during final cutover checks. |
| `sale_settings` | `enabled: false`, `starts_at: null`, `ends_at: null` | `public.sale_settings` | Confirm sale mode is off initially until a real promotion is launched. |
| `order_start_number` | `"1009"` | `public.store_settings` | Review whether production online orders should begin at 1001, 1009, or another sequence. |
| `order_prefix` | `"GDZ"` (default) | `public.store_settings` | Confirm order prefix for customer invoices and receipts. |
| `trade_name` | `"Gadzio"` | `public.store_settings` | Verified correct production trade name. |
| `shipping_enabled` | `"on"` | `public.store_settings` | Enabled for checkout. |
| `shipping_charge_paise` | `"4000"` (₹40.00) | `public.store_settings` | Review standard shipping fee. |
| `free_shipping_threshold_paise` | `"400000"` (₹4,000.00) | `public.store_settings` | Review free-shipping order threshold. |
| `reconcile_heartbeat_*` | 4 keys | `public.store_settings` | Omitted from copy; resets to blank on production until first cron run. |
| `payu_mode` | `"test"` (in code default) | `public.store_settings` / Env | Production uses live PayU credentials via Vercel env (`PAYU_ENV=production`). |
| `mail_driver` / `mail_host` | Not set (code defaults to `log`) | `public.store_settings` / Env | Set production SMTP host in settings and `MAIL_PASSWORD` + `MAIL_ALLOWED_HOSTS` in env when ready. |
| `APP_BASE_URL` | Staging URL | Environment | Must be set to production canonical HTTPS URL (`https://...`). |
| `analytics_scripts` / `social_links` | Empty | `public.analytics_scripts`, `social_links` | Add production Google Analytics / Meta Pixel IDs if desired. |

---

## 2. Target Project Preparation & Execution Order

1. **Gate 1 (User Confirmation):** User confirms the new Supabase Mumbai (`ap-south-1`) project is created and provides target connection string (`DATABASE_MIGRATION_URL` on port 5432) or confirms it is placed in the local environment.
2. **Pre-flight Safety Check:** The migration tool connects to target, queries `pg_tables` in `public`, and **strictly halts** if any table exists, or if the connection resolves to the Tokyo host (`ttzfovaadeyynggnypru`).
3. **Schema Migrations:** Apply all migrations `0001` through `0067` sequentially using `DATABASE_MIGRATION_URL` (port 5432).
4. **Target Schema & Security Verification:**
   - Run `node scripts/check-security-db-state.mjs` against target.
   - Run `node scripts/verify-rls-consumer-tables.mjs` against target.
5. **Storage Bucket Setup:**
   - Create bucket `media` with `public = true`.
6. **Data Copy (`scripts/migrate-data-to-new-project.mjs`):**
   - Dry run first (counts, comparison).
   - Copy kept tables in topological dependency order within explicit transactions.
   - Copy storage objects with SHA-256 verification.
   - Initialize sequences (`order_number_counters`, `receipt_counters`, `invoice_number_counters`).
7. **Verification (`scripts/verify-migrated-data.mjs`):**
   - Deep comparison of canonical JSON for `content_blocks`, `site_settings`, `store_settings`.
   - Side-by-side verification and rendered HTML comparison.
