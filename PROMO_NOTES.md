# PROMO_NOTES.md — Phase 0 Audit & Decisions

**Date:** 13 November 2026  
**Branch:** `traycer/lucky-otter` (note: pre-existing uncommitted storefront/header/footer/legal-page edits are present in working tree)  
**Target DB inspected (read-only):** `aws-0-ap-south-1.pooler.supabase.com` (port `6543`)  
**Row counts at audit:** `products`: 7, `orders`: 23, `users`: 1, `coupons`: 0, `store_admins`: 1  
**Last applied migration:** `0068_customer_password_reset.sql`

---

## 1. Phase 0 Audit Findings (Verified File Map)

### 1A. Coupons & Notifications
- **Schema:**
  - `migrations/0041_coupons.sql` creates `coupons`, `coupon_targets`, and `coupon_redemptions` (all with RLS enabled, no public policies), plus `orders.coupon_id`, `orders.coupon_snapshot`, and `order_items.discount_paise`.
  - `migrations/0053_coupon_visibility_assignments.sql` adds `show_to_all_users` (`boolean default false`), `assigned_to_emails` (`text[]`), and `assigned_customer_groups` (`text[]`) on `coupons`.
- **Visibility vs Redemption:**
  - Customer coupon listing (`src/app/account/coupons/page.tsx`, `src/lib/account/coupons.ts` -> `listCustomerCouponsUsing`, `src/lib/account/coupon-rules.ts` -> `customerCanDiscoverCoupon`) requires `coupons_enabled === 'on'`, `show_to_all_users` OR email in `assigned_to_emails` OR group in `assigned_customer_groups`, and passing `couponEligibilityRejection` (`status = 'active'`, within `starts_at`/`ends_at`, limits not exhausted, user eligible).
  - Redemption eligibility (`src/lib/coupons/rules.ts` -> `evaluateCoupon`, `src/lib/coupons/store.ts` -> `evaluateCouponFromDatabase`) checks `restricted_to_emails`, `allowed_customer_groups`, `only_new_customers`, `per_customer_limit`, `total_redemption_limit`, `min_order_paise`, `max_discount_paise`, and `allow_with_sale_price`.
  - A spin-win coupon created with `show_to_all_users = false`, `assigned_to_emails = [userEmail]`, `restricted_to_emails = [userEmail]`, `per_customer_limit = 1`, `total_redemption_limit = 1` will appear **only** on that winner's `/account/coupons` page and cannot be seen or used by any other customer.
- **Code Generation & Creation:**
  - `src/lib/coupons/codes.ts` exports `generateCouponCode(prefix, length)` using `globalThis.crypto.getRandomValues` and an unambiguous alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, omitting `0/O` and `1/I/L`).
  - `src/lib/store-admin/coupons.ts` exports `createCoupon` (using `newCouponId()`, `insertCoupon`, `replaceTargets`, `auditCoupon`). Spin win can share the same table/schema and insert inside the spin transaction (with `23505` code-collision retry) without building a second coupon engine.
- **Redemption Lifecycle (`src/lib/coupons/store.ts`):**
  - Checkout locks the coupon row `FOR UPDATE OF c` (`loadCouponDefinition`), counts uses in 1 round trip (`readCouponCustomerContext`), and inserts `'RESERVED'` into `coupon_redemptions` (`insertReservedRedemption`).
  - Capture transitions `RESERVED -> CONSUMED` (`consumeCouponInTx`).
  - Cancel / expiry / failure / supersede transitions `RESERVED -> RELEASED` (`releaseCouponInTx`).
  - Late payment capture attempts `RELEASED -> CONSUMED` if limits allow (`restoreCouponAfterLatePayment`).
- **Notifications:**
  - `src/lib/notifications/types.ts` (`NOTIFICATION_EVENTS`), `src/lib/store-admin/notification-settings.ts` (`NOTIFICATION_TOPICS`), `src/lib/notifications/templates.ts` (`TEMPLATE_VARIABLES`, `templateValues`), `src/lib/notifications/enqueue.ts` (`enqueueNotification`).
  - `migrations/0037_flash_sale_reservations.sql` defines a `CHECK (event_key in (...))` constraint on `notification_outbox` and seeds `notification_channel_settings`.
  - Adding `spin_win` requires an additive migration extending `notification_outbox`'s `event_key` check constraint, inserting the 6 `notification_channel_settings` rows (defaulting `inapp:customer:spin_win = true`, others `false`), and adding whitelisted template variables (e.g., prize/coupon details) in `src/lib/notifications/templates.ts`.

### 1B. Cart, Checkout & Order Lines
- **Cart Storage:** Client-side `localStorage` (`gadzio_cart_v1`) in `src/lib/cart/CartContext.tsx`.
- **Server Pricing & Availability:**
  - `src/app/checkout/page.tsx` loads server catalog (`getStorefrontRefs`, `getProductDetail`), sale state (`readSaleState`), checkout settings (`readCheckoutConfiguration`), and availability (`src/lib/storefront/availability-server.ts` / `use-availability.ts`). `useCheckoutRefresh` (`src/lib/checkout/useCheckoutRefresh.ts`) refreshes on focus/visibility/interval/sale boundary.
- **Authoritative Checkout (`src/lib/payu/orders.ts` -> `createOrderUsing`, called by `src/app/api/payu/initiate/route.ts`):**
  1. Plain reads first (`readCheckoutConfigurationUsing`, `resolveCartItemsFromDbUsing` in `src/lib/payu/db-catalog.ts`).
  2. Free-shipping threshold (`src/lib/checkout/shipping-rules.ts` -> `quoteShipping`): compares sale-priced `subtotalPaise` **before** coupons against `freeShippingThresholdPaise`.
  3. Per-user advisory lock `pg_advisory_xact_lock(513032, hashtext(userId))`.
  4. Strict lock order: `orders` (`affectedOrders` `FOR UPDATE`) -> `stock` (`lockStockIdentities`, sorted by `productId, variantId`) -> `coupons` (`FOR UPDATE OF c`) -> `order_number_counters`.
  5. Resumes identical `CREATED`/`PENDING` attempts (`isIdenticalCheckoutAttempt`) or supersedes stale active holds (`releaseClaimedStock`, `releaseCouponInTx`).
  6. Plans and claims stock (`planStockClaim`, `claimPlannedStock`) and writes `orders`, `order_status_history`, `order_addresses`, `order_items`, and `coupon_redemptions`.
- **Where Free Gift Integrates:**
  - Rules evaluation runs after `resolveCartItemsFromDbUsing` (giving the exact eligible subtotal) and adds the qualifying gift's `(productId, variantId)` into `requestedIdentities`/`requestedRecords` so it participates in the same sorted `lockStockIdentities` batch.
  - Under lock, verify gift rule cap & per-customer limit and gift stock via `planStockClaim`; insert the `order_items` row with `unit_price_paise = 0`, `line_total_paise = 0`, `discount_paise = 0`, and gift flags; claim stock via `claimPlannedStock`.
- **Order Line Readers:**
  - `src/components/orders/OrderDocument.tsx` (customer receipt/invoice/status, admin invoice)
  - `src/app/account/orders/[txnid]/receipt/page.tsx`, `src/app/account/orders/[txnid]/page.tsx`, `src/lib/account/orders.ts` (including `listBuyAgainProducts`, which must exclude gift lines/gift-only items)
  - `src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/page.tsx`, `packing-slip/page.tsx`, `invoice/page.tsx`, `src/lib/store-admin/orders.ts`
  - `src/lib/store-admin/returns.ts` (returnable items)
  - `src/lib/store-admin/reports.ts` & `src/lib/store-admin/analytics.ts` (item-wise revenue/units — must exclude gift lines from revenue)
  - `src/lib/store-admin/pos.ts` (POS unchanged, gives no automatic gifts)

### 1C. Catalogue
- `products` (`migrations/0011_store_catalog.sql`) has column-level `SELECT` grants for `anon, authenticated` (`migrations/0064_products_column_grants.sql`, DML revoked in `0067_products_revoke_table_dml.sql`).
- Storefront reads go through `src/lib/catalog/storefront.ts` -> `src/lib/storefront/catalog.ts`. Search (`src/lib/search/searchService.ts`, `src/lib/storefront/search-suggest.ts`) is fed by the storefront catalogue. No `sitemap.ts` route exists in `src/app/`.
- Adding `is_gift_only boolean not null default false` to `products` (and filtering `is_gift_only = false` in storefront/search/suggestions/Buy Again) keeps gift-only items completely hidden from normal shopping while keeping them available to the gift engine and stock ledger.

### 1D. Storefront, Admin Nav & Store Timezone
- **Homepage:** `src/app/page.tsx` -> `src/components/sites/www-apple-com-736d3707/root-8a5edab2/GadzioHomePage.tsx` (supports `new` and `old` UI modes).
- **Account:** `src/app/account/page.tsx` uses a 3-column card grid (`grid gap-4 sm:grid-cols-2 lg:grid-cols-3`); `src/app/account/coupons/page.tsx` renders `CouponsList`.
- **Store Admin Nav:** `src/components/store-admin/StoreAdminShell.tsx` (`NAV_GROUPS`). `Sale` and `Coupons` currently live under `Catalog` (can add a `Marketing` group or link `Free gifts` and `Spin wheel` cleanly).
- **Store Timezone:** `store_settings.timezone` (default `'Asia/Kolkata'`) is actively read via `src/lib/store-admin/store-clock.ts` (`getStoreTimeZone`, `getDatabaseNow`) and converted in SQL via `at time zone ${timezone}::text`.
- **Shared Helpers:** `parseRupeesToPaise` / `formatRupees` in `src/lib/store-admin/money.ts`; `HEX_COLOR_RE` / `safeThemeColor` in `src/lib/website/theme-rules.ts`.

### 1E. Bot Protection & Sign-up
- `src/app/api/auth/signup/route.ts` -> `signUp` in `src/lib/user-auth.ts`:
  - Protected by `assertSameOrigin` and in-memory `tooManyRequests(..., 'signup')`.
  - No email verification exists.
  - No CAPTCHA / Turnstile / reCAPTCHA check is active (`recaptcha_site_key` and `recaptcha_status` in `src/lib/store-admin/settings-rules.ts` are marked `"Not active yet"`).
  - Duplicate email sign-up runs `bcrypt.hash` for timing parity and returns `{ ok: true, token: null }` without setting a session cookie.

---

## 2. Confirmed Decisions (User Approved 13 November 2026)

1. **Build Order:** **Phases 3 & 4 (Spin wheel) first**, then hold/confirm Phases 1 & 2 (Free gift) until PayU staging proof and load test are confirmed.
2. **Database Approval:** `aws-0-ap-south-1.pooler.supabase.com` (`port 6543`) is approved as the test database for migrations and DB-backed tests.
3. **Free Gift Policy (for Phases 1 & 2):**
   - **Threshold basis:** Item subtotal at live sale prices, **before** coupons, excluding gift, shipping, and tax lines — computed by the exact same shared function as the free-shipping threshold (with a test that fails if they ever diverge).
   - **Highest qualifying rule:** Highest target amount; tie-break by rule priority, then oldest rule. Maximum 1 gift per order.
   - **No automatic fallback:** If the highest qualifying gift is out of stock, do **not** silently switch to a lower qualifying rule; treat as "gift unavailable" and trigger the warn-and-continue confirmation flow.
   - **Warn-and-continue:** Customer must see what changed (gift removed + new totals) and confirm before order creation; never silently create an order without the gift. Increment a counter surfaced in Store Admin **Needs attention**, and alert staff by email when gift stock reaches warning level or zero.
   - **Coupon interaction per rule:**
     - `"When a coupon is used"`: `"Still give this gift"` (default) or `"Do not give this gift"`.
     - Optional `"Minimum amount the customer actually pays (after coupons), in rupees"` (blank by default). If set, gift requires post-coupon item total >= this minimum; losing the gift due to a coupon change triggers the same warn-and-continue flow. Both settings are editable anytime (new orders only), audited, and displayed in live preview and rule list.
4. **Spin Wheel Policy (for Phases 3 & 4):**
   - **Reset window:** Calendar day in the store timezone (`store_settings.timezone`, default `Asia/Kolkata`, midnight reset on the database clock).
   - **Eligibility:** Signed-in customers only.
   - **Per-IP daily limit:** **1 spin per IP per store day** (strict).
   - **Minimum account age:** **0 days** (plus bot check once one exists).
   - **Prize shape:** Personal single-use coupon copied from the winning segment's template at win time, restricted to and visible only to the winning customer, expiring N days after the win.
