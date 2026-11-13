# Gadzio — Feature Reference

**Verified:** 31 October 2026 for the automated checks below, against this repository
and the database reached through `.env.local`. Explicitly dated smoke/catalogue/content
snapshots remain historical, not reverified by these checks.

**Evidence collected at that moment**

| Check | Result |
|---|---|
| `npm test` | **808 tests, 808 pass, 0 fail, 0 skipped** (including real PostgreSQL fixtures, live customer dashboard, browsing history, coupons, in-app outbox and data privacy tests) |
| `node scripts/catalog-parity.mjs` | no fatal gaps: all 12 static products/variants exist in the database; 2 price drifts and 1 database-only product reported (last run 26 October 2026) |
| `node scripts/check-store-admin-routes.mjs` | **All 96 store-admin routes are guarded** |
| `node scripts/check-setting-lists.mjs` | all 14 settings tables readable, 114 notification cells |
| `node scripts/check-admin-boundary.mjs` | legacy CMS holds no commerce field; 11 Education collections exempt |
| `node scripts/check-account-routes.mjs` | **All 19 account API routes check the customer session and ownership boundary, and all 11 account pages are session-guarded and dynamic** |
| `npm run typecheck` / `npm run build` | both succeed |
| `npm audit` | 0 vulnerabilities |
| Live smoke test (`next start`) | home, product, buy, six category pages, cases (both routes), search, cart and bag return 200; unknown product id returns 404; database prices render (last run 26 October 2026) |
| Migrations applied | Migration runner successfully applied `0044_customer_dashboard.sql`; previous task migrations retained |
| Notification readiness (no send) | **3 pass, 5 fail**: mail driver not SMTP, SMS off, missing SMTP host, staff email/customer SMS cells off; required provider credentials missing. Exit 0 is not readiness success. |
| Database contents (historical, 29 October) | 13 active products, 29 orders, 3 users, 1 store admin, 6 content blocks, 0 media, 0 subscribers, 0 order requests, 0 collection rows |

### Spin and Win — 1:1 Poster Redesign, `42P01` Hardening & Reward Cooldown (`0070`) — 13 November 2026

- **Schema & fail-closed SSR guard (`migrations/0070_spin_wheel_cooldown.sql`, `src/lib/spin-wheel/store.ts`, `src/lib/spin-wheel/rules.ts`, `src/app/api/spin-wheel/spin/route.ts`):**
  - Added `reward_cooldown_mode` (`'until_coupon_expires' | 'custom_days' | 'disabled'`, default `'until_coupon_expires'`), `reward_cooldown_days` (`1..365`, default `7`), and `show_next_spin_countdown` (default `true`) on `spin_wheel_settings` (RLS preserved via `0069`).
  - Added `isUndefinedTableError` (`42P01`) fail-closed handling in `getSpinWheelConfigUsing`, `getCustomerSpinStateUsing`, and `getCustomerSpinState` so unmigrated environments return an unavailable/closed state cleanly instead of crashing SSR with `PostgresError: relation "spin_wheel_settings" does not exist`.
  - Enforced server-side reward cooldown in `executeSpinDrawUsing` (`reward_cooldown` → HTTP `429` with `Retry-After`) blocking coupon winners until coupon expiry or configured `N` days while keeping normal daily midnight resets for `NO_PRIZE` spins; exposed `dailySpinsTotal`, `remainingSpinsToday` (`1/1` → `0/1`), `cooldownBlocked`, `activeReward`, and signed-in `customerProfile` on `CustomerSpinState`.
- **1:1 UI redesign, Home popup, & Store Admin cooldown controls (`src/components/spin-wheel/SpinWheelSvg.tsx`, `SpinToWinShowcase.tsx`, `HomeSpinPopup.tsx`, `CustomerSpinWheelClient.tsx`, `AccountSpinCard.tsx`, `src/lib/spin-wheel/colors.ts`, `countdown.ts`, `src/lib/store-admin/spin-wheel.ts`, `SpinWheelAdminConsole.tsx`, `src/app/page.tsx`, `GadzioHomePage.tsx`):**
  - Updated `SpinWheelSvg.tsx` and `colors.ts` for Coral `#f25c3b` / Lilac `#e8c6ff` / Acid Lime `#d8f561` defaults, dotted white outer rim with grey boundary pegs, matte-white center hub, and stationary 2 o'clock black teardrop pointer (`WHEEL_POINTER_RIGHT_ANGLE_DEG = 68`) matched by `computeTargetWheelRotation(..., pointerAngleDeg)` while respecting Store Admin custom slice colors and `prefers-reduced-motion: reduce`.
  - Built shared `SpinToWinShowcase` (`variant="page" | "modal"`) with Cream `#fbf8ef` canvas, geometric `SPIN TO win` + lavender flower + tilted `"How much will you save?"` lockup, live `1/1` → `0/1` daily spin indicator, boxed `YOUR EMAIL` / `YOUR PHONE NUMBER` inputs (showing verified signed-in customer info or `/auth?redirect=/spin-and-win` links for guests), `#spin-terms` acceptance, lilac `SPIN TO WIN` pill CTA, `NO THANKS` / `×` controls, and live `formatSpinCountdown` (`Xd HH:MM:SS` / `HH:MM:SS`).
  - Mounted dismissible `HomeSpinPopup` (`sessionStorage` + Escape + `NO THANKS` + backdrop) on `/` alongside `HomeSpinStrip`, updated `AccountSpinCard` with `1/1`/`0/1` badge and multi-day countdown, and added Reward Cooldown & Next-Spin display controls in Store Admin.
- **Measured (13 November 2026):** Applied migration `0070_spin_wheel_cooldown.sql` via `npm run db:migrate`; `npm run typecheck` and `npm run build` pass; `RUN_LEGACY_DB_TESTS=1 node --test --test-concurrency=1 tests/spin-wheel-rules.test.mjs tests/spin-wheel-phase4.test.mjs tests/spin-wheel-db-integration.test.mjs tests/coupon-db-integration.test.mjs tests/coupon-order-integration.test.mjs`: **47/47 passed**; check scripts pass (`check-store-admin-routes`: **126 routes**, `check:account-routes`: **21 APIs / 11 pages**, `check:admin-boundary`, `check:field-help`, `check:links`: **142 links / 8 files**, `check-setting-lists`: **120 cells**); Playwright end-to-end walkthrough (`node scripts/spin-wheel-phase5-proof.mjs`) passed across **1440×900**, **768×1024**, and **390×844** including Home popup dismiss, two-tab double-spin lock, and **20 concurrent burst spins** (**20/20 HTTP 200**, **0 errors**, `p50 = 6,098 ms`, `p95 = 7,644 ms`, `max = 7,958 ms`, `20 DB rows`).

### Spin and Win — Phase 5 (End-to-End Proof, Browser Captures, Load Check & Owner Guide) — 13 November 2026

- **End-to-end DB checkout & next-day spin proof (`tests/spin-wheel-db-integration.test.mjs`):**
  - Expanded isolated-schema PostgreSQL tests to **9/9 passing**: added full flow where winner spins, checks out through `createOrderUsing` + `consumeCouponInTx` with the personal `SPIN-...` coupon applied, gets blocked by `CouponRejectedError` on a second order (single-use), is replayed on the same store day without re-spinning, and spins again cleanly after `Asia/Kolkata` midnight rollover.
- **Signed-in real browser walkthrough (`scripts/spin-wheel-phase5-proof.mjs`, `docs/images/spin-wheel/*.png`):**
  - Executed against a live `next start` server (`127.0.0.1:3105`) with Playwright Edge at **1440×900**, **768×1024**, and **390×844** (restoring pre-existing DB state in `finally`): Store Admin login + wheel save + zero-write `Test spin`; signed-out `/spin-and-win` `/auth?redirect=/spin-and-win` check; signed-in Home strip (`/`), Account card (`/account`), live wheel win + countdown reload block (`/spin-and-win`), Account Coupons `"From Spin and Win"` badge (`/account/coupons`), `/api/coupons/validate` acceptance for winner & rejection for peer customer, and **2-tab simultaneous double spin** producing strictly **1** spin row and **1** coupon.
  - Polished slice label sizing/radius in `SpinWheelSvg.tsx` (`maxChars`, `textR = 88`, `fontSize = 11.5`) and checkbox spacing in `SpinWheelAdminConsole.tsx`.
- **Concurrent load check (`POST /api/spin-wheel/spin`) & owner guide (`docs/spin-and-win-guide.md`):**
  - **20 concurrent signed-in accounts** firing `POST /api/spin-wheel/spin` simultaneously on the live server: **20/20 HTTP 200**, **0 errors**, **20 DB spin rows**, **`p50 = 8,617 ms`**, **`p95 = 10,174 ms`**, **`max = 10,487 ms`** (session pooler on local Windows dev machine).
  - Wrote one-page owner guide [`docs/spin-and-win-guide.md`](docs/spin-and-win-guide.md) documenting setup, monitoring, and exact visibility rules (wheel is disabled by default until turned on in Store Admin → Marketing → Spin wheel).
  - **Scope not yet built/proven:** **Free gift on orders** (Phases 1 & 2 — schema, admin rules, cart nudge/auto-gift, checkout gift stock lock & PayU staging checkout with gift item) remains intentionally deferred until user approval.
- **Measured (13 November 2026):** `RUN_LEGACY_DB_TESTS=1` `node --test --test-concurrency=1 tests/spin-wheel-rules.test.mjs tests/spin-wheel-phase4.test.mjs tests/spin-wheel-db-integration.test.mjs`: **20/20 passed**; `npm run build` and `npm run typecheck` pass; check scripts pass (`check:store-admin-routes` **126 routes**, `check:account-routes` **21 APIs / 11 pages**, `check:admin-boundary`, `check:field-help`, `check:links` **142 links / 8 files**, `check-setting-lists.mjs` **120 notification cells**).

### Spin and Win — Phase 4 (Customer Wheel UI & Entry Points) — 13 November 2026

- **Customer storefront route & interactive wheel (`src/app/spin-and-win/page.tsx`, `src/components/spin-wheel/CustomerSpinWheelClient.tsx`, `src/components/spin-wheel/SpinWheelSvg.tsx`, `src/lib/spin-wheel/countdown.ts`):**
  - Dynamic `/spin-and-win` page wrapped in `GadzioHeader` and `GlobalFooter`, handling signed-out sign-in/signup prompts (`/auth?redirect=/spin-and-win`), closed/scheduled-window states, Terms & Conditions acceptance gating (`#spin-terms`), crisp SVG wheel spin transition (`4.25s` ease-out) with `prefers-reduced-motion: reduce` instant snap, accessible live announcements (`role="status" aria-live="polite"`), `role="alert"` errors, plain-text prize list, personal coupon code copy + expiry display + `/account/coupons` link, and server-anchored midnight countdown (`Next spin in HH:MM:SS`).
- **Storefront API routes (`src/app/api/spin-wheel/route.ts`, `src/app/api/spin-wheel/spin/route.ts`):**
  - `GET /api/spin-wheel` (`force-dynamic`, `Cache-Control: no-store`) checks maintenance mode and returns customer-safe state (`getCustomerSpinState`).
  - `POST /api/spin-wheel/spin` enforces `assertSameOrigin`, `requireAccountSessionApi`, IP (`15/min`) and user (`10/min`) rate limits, SHA-256 hashing of non-empty trusted proxy IP, `executeSpinDraw`, and HTTP `200`/`400`/`401`/`403`/`429`/`503` responses.
- **Entry points & `"From Spin and Win"` coupon integration (`src/app/page.tsx`, `src/components/spin-wheel/HomeSpinStrip.tsx`, `src/components/sites/www-apple-com-736d3707/root-8a5edab2/GadzioHomePage.tsx`, `src/app/account/page.tsx`, `src/components/spin-wheel/AccountSpinCard.tsx`, `src/app/account/coupons/page.tsx`, `src/components/account/CouponsList.tsx`):**
  - Added conditional Home banner strip (`showOnHomePage` + active window), Account Overview live Spin card + quick navigation link, and Account Coupons `"Spin and Win →"` CTA + `"From Spin and Win"` badge on `spin_wheel` personal coupons; all entry points stay hidden when the wheel is disabled or outside its window.
- **Measured (13 November 2026):** `tests/spin-wheel-phase4.test.mjs` **5/5 passed**; targeted DB & Spin Wheel suite (`tests/spin-wheel-rules.test.mjs`, `tests/spin-wheel-phase4.test.mjs`, `tests/spin-wheel-db-integration.test.mjs`, `tests/coupon-db-integration.test.mjs`, `tests/coupon-order-integration.test.mjs` with `RUN_LEGACY_DB_TESTS=1` and `--test-concurrency=1`): **42/42 passed**; default `npm test`: **1,924 tests / 1,817 passed / 105 skipped / 2 pre-existing unrelated failures** (`tests/secret-scan.test.mjs` on untracked local `tests/env.download`, `tests/security-n1-products-dml-revoke.test.mjs` on `0068` migration cap); `npm run typecheck` and `npm run build` pass; check scripts pass (`check:store-admin-routes` **126 routes guarded**, `check:account-routes` **21 APIs / 11 pages**, `check:admin-boundary`, `check:field-help`, `check:links` **142 links / 8 files**, `check-setting-lists.mjs` **120 cells**, `check-security-db-state.mjs` **10/10**); `npm audit --omit=dev` **0 vulnerabilities**.

### Spin and Win — Phase 3 (Engine, Migration & Store Admin Console) — 13 November 2026

- **Schema & notification wiring (`migrations/0069_spin_wheel.sql`, `src/lib/notifications/*`, `src/lib/store-admin/notification-settings.ts`):**
  - Applied additive migration `0069_spin_wheel.sql`: created `spin_wheel_settings` (singleton `'default'`), `spin_wheel_segments`, `spin_wheel_segment_daily_counts`, and `spin_wheel_spins` (`unique (user_id, store_day)`) with RLS enabled and no public policies on all 4 tables; added `coupons.source` (`'admin' | 'spin_wheel'`); added `'spin_win'` to `notification_outbox_event_key_check`; seeded 6 `notification_channel_settings` cells (`inapp:customer:spin_win = true`, 120 cells total).
- **Weighted draw engine & coupon award (`src/lib/spin-wheel/colors.ts`, `src/lib/spin-wheel/rules.ts`, `src/lib/spin-wheel/store.ts`, `src/lib/account/coupon-rules.ts`, `src/lib/account/coupons.ts`):**
  - Cryptographic `randomInt` weighted draw over active, non-capped segments; atomic insert-first `spin_wheel_spins(user_id, store_day)` transaction with `FOR UPDATE OF s` segment locks, daily store-timezone reset (`store_settings.timezone`, default `Asia/Kolkata`, DB clock), configurable per-IP daily cap (default 1) and minimum account age, personal single-use coupon issuance restricted to the winner's email and hidden from all other customers, and post-commit `spin_win` notification enqueue.
- **Store Admin Marketing -> Spin wheel (`src/app/(store-admin)/store-admin/(protected)/marketing/spin-wheel/page.tsx`, `src/components/store-admin/SpinWheelAdminConsole.tsx`, `src/components/spin-wheel/SpinWheelSvg.tsx`, `src/lib/store-admin/spin-wheel.ts`, `src/lib/store-admin/needs-attention.ts`, `src/app/api/store-admin/spin-wheel/**`):**
  - Added Store Admin sidebar section `Marketing -> Spin wheel`, plain-language field help, 2..12 segment editor with WCAG contrast badge and live odds %, warnings panel, zero-side-effect `POST /api/store-admin/spin-wheel/test-spin` preview wheel, `spin_daily_cap` Needs-attention indicator, Spin & coupon reports, masked-email CSV export (`GET /api/store-admin/spin-wheel/export`), and `store_admin_audit` logging.
- **Measured (13 November 2026):** `node --test --test-concurrency=1 tests/spin-wheel-rules.test.mjs tests/spin-wheel-db-integration.test.mjs tests/coupon-db-integration.test.mjs tests/coupon-order-integration.test.mjs tests/stage2-payments-checkout.test.mjs tests/stage4-checkout-lock-optimization.test.mjs` (`RUN_LEGACY_DB_TESTS=1`): **48/48 passed** (**6/6** Spin Wheel rules, **8/8** Spin Wheel PostgreSQL concurrency/cap/reset/isolation tests); default `npm test`: **1,919 tests / 1,812 passed / 105 skipped (legacy DB env opt-in) / 2 pre-existing unrelated failures** (`tests/secret-scan.test.mjs` on untracked local `tests/env.download`, `tests/security-n1-products-dml-revoke.test.mjs` checking max migration number `<= 67` which already predated `0068_customer_password_reset.sql`); `npm run typecheck` and `npm run build` pass; check scripts pass (`check:store-admin-routes`, `check:account-routes` 21/11, `check:admin-boundary`, `check:field-help`, `check:links` 142/8, `check-setting-lists` 120 cells, `check-security-db-state` 10/10, `check-notifications` 108/108 templates with 0 unresolved tokens); `npm audit` **0 vulnerabilities**.

### Stage 5, Stage 6 & Stage 7 — UX, Admin & Site Completion, Verification & Staging Runbook — 8 November 2026

- **Cancelled orders hide active shipment details (`src/lib/account/order-live.ts`, `src/lib/account/orders.ts`, `src/lib/order-status.ts`, `src/lib/store-admin/orders.ts`, `src/lib/store-admin/returns.ts`):**
  - Cancelling an order marks its `order_deliveries` row `CANCELED`, appends a `shipment_cancelled` event to `order_delivery_events`, blocks subsequent delivery edits on closed orders, and hides active courier/tracking fields across customer order detail, order status, Store Admin order detail, and packing slips.
- **Plain-language field help on every admin field (`scripts/check-field-help.mjs`, `npm run check:field-help`):**
  - Verified plain-language help/hint text across all **60 `store_settings` fields**, **66 fields across 13 `setting-lists`**, **218 Website content and theme fields**, and **16 core `ProductHelp` rules**.
- **`/account/*` and `/auth` restyled to match the home page (`src/components/account/**`, `src/app/account/**`, `src/app/auth/**`):**
  - Replaced legacy `#0071e3` blue buttons, badges, and focus rings with the home page's Gadzio tokens (`#ffe100` primary CTA, `#1d1d1f` dark buttons/links, `transducer` font) and wrapped `/auth` in the shared `GadzioHeader` and `GlobalFooter`.
- **`/privacy`, `/terms`, and `/support` inside shared layout + link checker (`src/lib/storefront/site-pages.ts`, `scripts/check-links.mjs`):**
  - Wrapped `/privacy`, `/terms`, and `/support` in `GadzioHeader` + `GlobalFooter`, wired published `store_pages`, business contact settings (`trade_name`, `email`, `phone`, `address`, `footer_text`, `cookie_notice`), and `seo_pages` fallback metadata, with built-in copy as fallback. `npm run check:links` verifies **118 internal links across 8 files** with 0 broken links.
- **Live search suggestions (`GET /api/search/suggest`, `src/lib/storefront/search-suggest.ts`, `src/components/header/GadzioHeader.tsx`):**
  - Rate-limited, same-origin guarded typeahead endpoint returning at most 6 public-safe product suggestions (respecting maintenance mode and sale mode), wired to an accessible `role="combobox"` + `role="listbox"` dropdown in `GadzioHeader` with 200 ms debounce, keyboard navigation (`ArrowDown`/`ArrowUp`/`Enter`/`Escape`), recent searches, and `"See all results"`.
- **Stored-only settings disposition & Staging runbook (`REMAINING_NOTES.md`, `docs/staging-checklist.md`):**
  - Wired `store_pages`, `seo_pages`, and business/footer settings; labelled unwired settings (`social_links`, `analytics_scripts`, `store_integrations`, `recaptcha_*`, `login_*`, `cod_enabled`, `delay_minutes`) as `"Not active yet"`. Wrote `docs/staging-checklist.md` for staging and production rollout.
- **Measured (8 November 2026):** `npm test` **1,873 tests / 1,778 passed / 0 failed / 95 skipped** (plus `tests/stage2-payments-checkout.test.mjs`, `tests/stage3-option-low-stock-alerts.test.mjs`, `tests/stage4-checkout-lock-optimization.test.mjs`, `tests/stage5-ux-admin-site.test.mjs`, `tests/coupon-db-integration.test.mjs`, and `tests/coupon-order-integration.test.mjs` **42/42 passed** against the real test PostgreSQL database); `npm run typecheck` and `npm run build` pass; all 7 check scripts (`check:store-admin-routes` **122 routes**, `check:account-routes` **21 APIs / 11 pages**, `check:admin-boundary`, `check:field-help`, `check:links`, `check-setting-lists.mjs`, `check-security-db-state.mjs` **10/10**) pass; `npm audit` **0 vulnerabilities**.

### Stage 4 — Checkout Lock-Time Optimization — 8 November 2026

- **Plain reads moved before row locks (`src/lib/payu/orders.ts`):**
  - `readCheckoutConfigurationUsing` and `resolveCartItemsFromDbUsing` (sale state and catalogue prices) now execute before acquiring `orders` or `stock` row locks, while preserving the strict lock order `orders -> stock -> coupons -> order_number_counters`.
- **Coupon evaluation collapsed into 2 round trips (`src/lib/coupons/store.ts`):**
  - `loadCouponDefinition` loads the `coupons` row (`FOR UPDATE OF c`) and its `coupon_targets` JSON in 1 round trip.
  - `readCouponCustomerContext` reads `now()`, `customer_group`, prior paid-order flag, and total/personal `coupon_redemptions` counts in 1 round trip (down from 6 total round trips to 2).
- **Measured (8 November 2026):** `npm test` **1,867 tests / 1,772 passed / 0 failed / 95 skipped** (plus `tests/stage4-checkout-lock-optimization.test.mjs` **3/3**, `tests/coupon-db-integration.test.mjs` **18/18**, `tests/coupon-order-integration.test.mjs` **5/5**, and `tests/shipping-order-integration.test.mjs` **6/6** passed against the real test database); `npm run typecheck` and `npm run build` pass; all check scripts pass; `npm audit` **0 vulnerabilities**.

### Stage 3 — Product Options Completion & Per-Option Low-Stock Notifications — 8 November 2026

- **Per-option low-stock staff notifications for checkout and POS sales (`src/lib/notifications/stock-events.ts`, `src/lib/notifications/order-stock-alerts.ts`, `src/lib/payu/orders.ts`, `src/lib/store-admin/pos.ts`):**
  - After a web checkout (`createOrderUsing`) or POS sale (`createPosSaleUsing`) transaction commits, `enqueueOrderLowStockAlerts` reconstructs each sale movement's exact `availableBefore` and `availableAfter` from the append-only `stock_movements` ledger (`m2.id > m.id`).
  - When an option (or product) crosses from above its `low_stock_threshold` into `1..threshold`, a `low_stock` staff notification is enqueued with the option's name (`stockAlertProductName`, e.g. `"Gadzio Armor Case — iPhone 16 · Red"`), a deep link to `/store-admin/stock/<productId>?variant=<variantId>`, and a per-crossing dedupe token (`movement:<movementId>`).
  - Already-low options, out-of-stock (`0`) transitions, and untracked options do not re-alert.
- **Measured (8 November 2026):** `npm test` **1,864 tests / 1,770 passed / 0 failed / 94 skipped** (plus `tests/stage3-option-low-stock-alerts.test.mjs` **2/2 passed** with `RUN_LEGACY_DB_TESTS=1` on the test database); `npm run typecheck` and `npm run build` pass; all check scripts (`check-store-admin-routes`, `check-account-routes`, `check-admin-boundary`, `check-setting-lists`, `check-security-db-state`) pass; `npm audit` **0 vulnerabilities**.

### Stage 2 — Payments, Atomic Checkout, Status Glossary, Reconcile Heartbeat & Needs-Attention — 8 November 2026

- **Atomic one-active-checkout handling (`src/lib/payu/orders.ts`, `src/app/api/payu/initiate/route.ts`, `src/components/checkout/CheckoutForm.tsx`, `src/lib/storefront/availability-server.ts`):**
  - Signed-in checkouts serialize per account via `pg_advisory_xact_lock(513032, hashtext(userId))` before locking `orders` and `stock`.
  - If an active `CREATED`/`PENDING` attempt has the identical cart, shipping address, contact, and coupon (`isIdenticalCheckoutAttempt`), it is resumed atomically (`resumed: true`) without creating a duplicate order, claiming stock twice, or extending the reservation timer.
  - If anything changed (or the active attempt is `PROCESSING`), `/api/payu/initiate` verifies the old attempt with PayU first: if `PAID`, redirects to `/order/success`; if PayU is unreachable (`retryable: true`), fails closed with `"We could not confirm your previous payment yet. Please try again in a minute."`; otherwise `createOrderUsing` supersedes the old attempt in the same transaction (releasing its stock and coupon and marking it `CANCELLED` / `RELEASED` with `SUPERSEDED: replaced by a new checkout`).
  - A customer's own held units are added back to their view of `on_hand` in `readAvailabilityUsing` so a 1-unit item never looks sold out to the customer holding it.
- **Shared Payment & Order Status Glossary (`src/lib/orders/document-policy.ts`, `src/lib/order-status.ts`):**
  - `derivePaymentAndOrderStatus` derives independent `paymentStatusLabel` (`Pending`, `Verifying`, `Paid`, `Failed`, `Cancelled`, `Refund initiated`, `Partially refunded`, `Refunded`) and `orderStatusLabel` (`Awaiting payment`, `Confirmed`, `Packed`, `Shipped`, `Delivered`, `Cancelled`, `Returned`) rendered as separate chips across Store Admin Orders list/detail/QuickView, Customer Orders list/detail, and Order Result pages.
- **Reconcile GET Handler, Heartbeat & Needs-Attention Panel (`src/app/api/payu/reconcile/route.ts`, `src/lib/payu/reconcile-heartbeat.ts`, `src/lib/store-admin/needs-attention.ts`, `docs/reconcile-scheduling.md`):**
  - Added `GET /api/payu/reconcile` guarded by constant-time `authorizeCronRequest` requiring `CRON_SECRET`, with zero side effects without the secret.
  - Added database-backed reconciliation heartbeat (`recordReconcileHeartbeat`, `readReconcileHeartbeat`, turning red when no successful run occurred in the last 5 minutes on the database clock) and the **Needs attention** + **Background jobs** panels on `/store-admin` Overview.
  - Wired `payment_review` staff notification alerts across all payment-flagging paths (`recordRejection`, late capture, unresolved window expiry, repeated reconcile failures).
- **Measured (8 November 2026):** `npm test` **1,862 tests / 1,769 passed / 0 failed / 93 skipped** (plus `tests/stage2-payments-checkout.test.mjs` **8/8 passed** with `RUN_LEGACY_DB_TESTS=1` on the test database); `npm run typecheck` and `npm run build` pass; `check:store-admin-routes` **122 routes guarded**; `check:account-routes` **21 APIs and 11 pages** pass; `check:admin-boundary`, `check-setting-lists.mjs`, and `check-security-db-state.mjs` (**10/10**) pass; `npm audit` **0 vulnerabilities**.

### Phase 2 — options, price and stock — 5 November 2026

**Implemented and offline-verified; the migration and database acceptance are not run.**
Report: `docs/phase2-options-table-20261105.md`.

- Option prices are editable again, on one audited path shared by the single-option
  route (`upsertVariant`) and the product draft. Each save appends paired `price_history`
  rows — one per moved field, both carrying old and new regular **and** sale values under
  one `change_group` — and writes `catalog.variant.price` through the strict audit.
- A drop over 50%, a rise over 100% or a price below cost asks the editor to confirm and
  then saves. Without the confirmation flag the transaction rolls back with the same
  message; it is never a permanent block.
- `Sell by` (one item, colour, model, model and colour, another option) plans rows from
  shared colours and selected compatible devices. Only missing rows are proposed, at most
  60 per generation, and each new row starts inactive with zero stock and a suggested SKU.
- One table holds Model or option, Colour, SKU, Price, Sale, Stock, Active, History and
  Remove. Blank price means the product price; clearing a saved override sends an explicit
  clear. Fast entry fills a price, sale or stock value into every active sellable row, or a
  different price for each colour (Red ₹100, Black ₹120) into only the rows with that colour.
- Stock stays a deliberate choice: when a product is sold by options the shared **In stock**
  box is hidden and only the option stock table is shown. If shared units exist, a guided
  **Move existing stock into the options** step asks how many units go to each row. Nothing
  is split or transferred automatically, unallocated units stay in shared stock, and option
  stock turns on only through the existing explicit activation, transfer guard, reservation
  checks and append-only movements.
- A spreadsheet block can be pasted into the table (price, sale price, stock per line;
  tab/comma/semicolon) with a per-line preview and errors; nothing is applied unless every
  line parses. Arrow keys and Enter move between price, sale and stock cells; Tab stays native.
- Photos are chosen from the Media library: pick an existing image, upload, set the main
  photo, reorder, and edit alt text (saved back to Media). A photo can belong to a shared
  colour and falls back to the default gallery when that colour has none. Primary and hover
  stay product-wide; colour photos use the gallery role. A pasted URL remains under
  **Advanced** for legacy images.
- Option price and sale editing is limited to `store_admin`/`store_owner` in both the API
  (`requireStoreRole('store_admin')`) and the UI; viewers get a disabled form and read-only
  cells. A `sale_cleared` history row is always shown as **Sale cleared** with an em dash,
  never ₹0.00.
- `scripts/review-product-options.mjs` is a read-only census of products that would show
  **Needs review** (options plus shared stock, missing option prices, duplicate SKUs). It
  refuses non-localhost/non-test hosts, opens a read-only transaction and prints counts only.
- `docs/migrations-pending.md` records the applied migration run for 0055–0061 in order,
  what each adds, which screens and APIs would break without it, the target and row counts,
  and the post-application verification.
- Duplicating a product copies its details, chosen models, colour links and photos with new
  SKUs, zero stock and no price history.
- `0060_product_options_pricing.sql` is additive and was applied on 2026-11-05 (with
  0058, 0059 and 0061). It adds `sell_by`, `sku_pattern`, the paired sale history columns,
  `change_group`, an option history index and `product_images.colour_id` with its index.

**Measured after the follow-ups:** `npm test` **1,671 tests / 1,587 pass / 0 fail / 84
skipped**; `npm run typecheck` and `npm run build` pass; store-admin guards **122 routes**,
account guards and admin boundary pass; `npm audit` **0 vulnerabilities**; `git diff --check`
clean apart from LF/CRLF advisories. `check:notifications` remains **3 pass / 5 fail**
because mail and SMS are not configured; no message was sent. PostgreSQL
migration/fixture and authenticated browser acceptance were not run.

### Phase 3 — customer product page — 5 November 2026

**Implemented and offline-verified; migrations 0058–0061 are now applied; database and
browser acceptance are not run.** Report: `docs/phase3-customer-options-20261105.md`.

- The product page asks for the **model first, then the colour** (named swatches;
  hex is decoration). Only active rows the catalogue supplies are offered, so a
  model × colour combination that does not exist is never shown. Colour-only and
  model-only products show only the step they have; the first step is labelled
  with the option's own name (e.g. Wattage).
- Choosing a colour switches the gallery to that colour's photos (main first,
  then stored order; hover photos excluded) and keeps the product's default
  gallery when the colour has none. The gallery box keeps its size and the next
  photo is preloaded, so switching is immediate and never shifts layout. Thumbnails
  are a labelled group with per-photo names.
- Price, availability and Add to Bag always describe the exact selected row.
  Before a choice the headline is the **cheapest row's amount**, never "From ₹X"
  (cards and detail pages use the same minimum), so the first price shown is a
  real buyable amount; after a choice it is that row's price.
  The strike-through is the selected row's own regular price while its sale is
  live. Tests assert the shown amount equals the row's charged price.
- Locked availability rules: normal mode keeps a sold-out option visible, disabled
  and labelled **Stock not available**; sale mode disables and marks nothing
  unavailable and checks stock only at Add to Bag, Buy Now and Pay, refusing with
  **Out of stock for this option.** The page never substitutes a sibling option.
- The selection is written to `?model=`/`?colour=` with `history.replaceState`, and
  the server restores it, so a shared link reopens the same model, colour, price
  and photos.
- The bag line, checkout buy-now line, order, receipt, invoice and store-admin
  order carry the chosen model, colour, SKU, price and photo. The client sends
  only `variantId`; price and snapshot fields are resolved server-side after the
  stock locks. `0061_order_item_option_snapshot.sql` stores them as plain-text
  columns without foreign keys, so renaming or replacing an option or photo never
  changes an old order. `createOrder` probes for the columns and keeps the previous
  insert on a database without 0061.
- **"Only N left" is deliberately not shown.** The storefront payload and the
  public availability API carry no stock counts; a per-option count would expose
  one. An exhausted row is refused at purchase instead.
- `docs/migrations-pending.md` records that 0061 is applied, with the verified
  `order_items` columns and unchanged 49 order-item rows.

**Measured:** `npm test` **1,693 tests / 1,609 pass / 0 fail / 84 skipped**;
`npm run typecheck` and `npm run build` pass; store-admin guards **122 routes**,
account guards and admin boundary pass; `npm audit` **0 vulnerabilities**;
`git diff --check` clean apart from LF/CRLF advisories.

**Migrations applied 5 November 2026:** the live Supabase target
(`aws-0-ap-northeast-1.pooler.supabase.com:5432`, database `postgres`, project
`ttzfovaadeyynggnypru`) was shown with its 55-row `schema_migrations` and row counts
(15 products / 36 variants / 49 order items), then approved. `npm run db:migrate`
applied 0058–0061 (0055–0057 were already applied on 2026-11-03). Read-only verification
found `colours` and `product_variant_colours` with RLS enabled, the new `order_items`,
`products`, `price_history` and `product_images` columns, the shared-catalogue function,
six indexes and three triggers. Row counts are unchanged and no order was placed, so no
order item carries a snapshot yet. The 84 skipped tests need a disposable database and
were not run.

### Phase 4 — category filters, search and count parity — 5 November 2026

**Implemented and offline-verified; no new migration or index was needed.**
Report: `docs/phase4-category-filters-20261105.md`.

- Category pages now filter by **Phone model** (grouped by brand), **Colour** (named
  swatches with counts) and **Price** (four bands in integer paise). A value is only
  offered when at least one active option in that category matches it, and every count
  is computed over the products passing the *other* active filters, so the list never
  offers a combination that yields nothing.
- A model filter matches a product through its active option rows; a product sold as
  one shared stock matches through its compatibility list. Deactivated models or brands
  never become filter values, and archived, inactive or draft products never match.
- Filters combine with OR inside a kind and AND across kinds. The chosen model narrows
  the colour list to colours that exist on that model's options. The selection lives in
  `?model=`/`?colour=`/`?price=` (repeated params), survives reload and a shared link,
  unknown values are dropped, and **Clear all** empties both the URL and the grid.
- When a model and/or colour is chosen, each card shows that exact option's price (never
  "From ₹X"), that option's sale strike-through and — for a colour — that colour's photo
  when one is linked. A matched but sold-out option keeps the card listed and labelled
  **Stock not available** in normal mode; a live sale never marks it.
- This reuses the existing bounded catalogue read (still exactly 9 queries) and the 30s
  `unstable_cache` snapshot; sale state is still applied per request and the cache key
  moved to `phase-b2-option-prices-v3`, so a sale never serves a cached price. Existing
  indexes (`product_device_models_device_idx`, `product_variant_colours_colour`,
  `product_variant_colours_product`) cover the joins; no additive migration was written.
- Header search already indexes compatibility model names, so "iphone 17" matches a
  product whose active options or compatibility list include that model; a deactivated
  model is not matched.

**Measured:** `npm test` **1,706 tests / 1,622 pass / 0 fail / 84 skipped**;
`npm run typecheck` and `npm run build` pass; store-admin guards **122 routes**, account
guards (21 APIs / 11 pages) and admin boundary pass; `npm audit` **0 vulnerabilities**.
`check:notifications` remains **3 pass / 5 fail** because mail, SMS and the staff/customer
channels are not configured; no message was sent. A read-only live check through
`loadCatalogUsing` read 6 categories / 15 products and built the facets without error:
the live catalogue currently has **1 active device model, 0 compatibility links, 0
variant-model links and 0 colour links or colour photos**, so the model and colour
sections correctly render no values until options are entered in store admin; the price
bands populated for all six categories. No write occurred, and no connection string was
printed. The 84 skipped tests still need an approved disposable database.

**File map:** `src/lib/storefront/category-filters.ts` (new, pure facet engine),
`src/lib/catalog/storefront.ts` (model brand/eligibility in the existing snapshot),
`src/lib/storefront/catalog-merge.ts`, `src/components/collection/{CollectionPage,
CollectionFilters,CollectionProductCard,CollectionProductGrid,types}.tsx`,
`collection.css`, `src/lib/storefront/catalog.ts` (cache key), and
`tests/category-option-filters.test.mjs`.

### Phase 5 — option stock, orders and price integrity — 5 November 2026

**Implemented and verified, including the database acceptance suite (3/3 pass on the
approved session-pooler target).**
Report: `docs/phase5-options-lifecycle-20261105.md`.

- Stock and Low-stock screens now say they report per sellable identity: the Stock page
  separates products from stock lines (marking "one per option" when they differ), shows
  each option's SKU and model/option label, and prints the product total over tracked,
  non-legacy options. The Low-stock page lists one row per option under its own count and
  threshold, with its SKU. The Stock and Low-stock report definitions now describe
  per-product-or-option rows.
- The product price history shows the stored model/option label and the option SKU for
  every entry, so an option's price change is readable without opening the variant.
- Orders list quick view, order detail, packing slip and invoice name the exact option
  sold ("iPhone 16 · Red") from the order-time snapshot (migration 0061); old orders keep
  their stored label and are never rewritten. POS writes the same model/colour/photo
  snapshot with a pre-0061 fallback insert.
- Price editing writes only the option, its `price_history` rows and the audit row: a
  test asserts the edit body contains no order, coupon-redemption, stock or reservation
  write, and the database test proves an existing order, its coupon hold and its
  reservation are unchanged while the next purchase pays the new price.
- New offline suite `tests/phase5-option-admin-surfaces.test.mjs` (9/9 pass) plus
  database suite `tests/phase5-option-lifecycle.test.mjs` (3/3 pass: full option life,
  last-unit race between two connections, price-edit isolation). The database suite
  writes only to new `itest_*` schemas and drops them; its first real run showed the
  copied `store_admins` needs `email`/`password_hash` and the authoritative sale read
  needs the `sale_settings` `default` row, so both are seeded in the fixture (production
  code unchanged).

**Measured:** `npm test` **1,718 tests / 1,631 pass / 0 fail / 87 skipped** (DB opt-ins
off); `RUN_LEGACY_DB_TESTS=1` Phase 5 suite **3/3 pass** (74.97 s / 38.09 s / 37.38 s);
`npm run typecheck` and `npm run build` pass; store-admin guards **122 routes**, account
guards (21 APIs / 11 pages) and admin boundary pass; `npm audit` **0 vulnerabilities**.
`check:notifications` remains **3 pass / 5 fail** (SMTP/SMS not configured, staff-email
and customer-SMS matrix cells off; no message sent). No migration, seed, backfill or
business write was performed: public counts (products 15, product_variants 36, stock 15,
stock_movements 27, orders 51, order_items 49, coupons 3, coupon_redemptions 4) were
identical before and after the approved run, and every `itest_*` schema it created was
dropped. Per-option low-stock notifications were not yet queued at this point; see the
Phase 7 section below, which adds them.

**File map:** `src/lib/store-admin/{catalog.ts,catalog-crud.ts,report-rules.ts,orders.ts,
order-channel.ts}`, `src/app/(store-admin)/store-admin/(protected)/{stock,low-stock}/
page.tsx`, `tests/phase5-option-admin-surfaces.test.mjs` and
`tests/phase5-option-lifecycle.test.mjs` (both new).

### Phase 6 — migration rehearsal, rollout plan and the owner guide — 5 November 2026

**Delivered against the approved throwaway-schema target; one part of the plan cannot be
proven on it.** Plan item 1 asks for a disposable database the owner provides plus an
authenticated browser run. The approved target is throwaway `itest_*` schemas on the
existing Supabase project, so the migration rehearsal and the real concurrency suite ran
for real, while the signed-in owner-to-customer browser checkout could not be run. It is
recorded below as not built rather than implied. `PRODUCT_EDITOR_FINISH.md`, which the
plan points at for F2/F3, is absent from this repo; those steps were reconstructed from
`PRODUCT_OPTIONS_FINAL_PLAN.md`, `DISPOSABLE_DB_RUNBOOK.md` and
`docs/migrations-pending.md`.

- Migration rehearsal (`scripts/rehearse-options-migrations.mjs`, new): spends one
  connection on the approved host, creates a random `itest_phase6_*` schema, replays
  0001–0057 with the schema rewrites it needs when `public` sits beside it, copies 1,935
  real rows across 93 tables, applies 0058–0061, asserts the columns, indexes, RLS,
  normalisation, duplicate and cross-product rules and unchanged counts, re-applies
  0058–0061 for idempotence, then drops the schema. Final run: **ok, 188/188 checks,
  168,515 ms**; public counts identical before and after; no `itest_phase6%` schema left.
- Rehearsal-only rewrites are documented, not patched into applied migrations:
  `table_schema = 'public'`, unscoped `pg_constraint where conname =` guards, and the
  `where t.relname =` constraint-replacement loops in 0034/0037 are unambiguous in
  production but collide when a second schema exists.
- Real concurrency re-run as Phase 6 evidence: `RUN_LEGACY_DB_TESTS=1` on
  `tests/phase5-option-lifecycle.test.mjs`, **3/3 pass, 115,298 ms**.
- Rollout plan `docs/phase6-rollout-plan-20261105.md` (F3 equivalent): backup and restore
  proof, counts to take before the window, maintenance window, migration order with a
  gate per file, smoke checks for storefront, PayU test mode, store-admin stock,
  low-stock, price history, orders, POS and price edit, read-only SQL checks, rollback
  limits (additive only; a code rollback is safe because of the 0061 probe; a schema
  rollback means restoring the backup), first-week watch list and what is not covered.
- Owner guide: `PRODUCTS_AND_CATALOG_SIMPLE_GUIDE.md` is now the one-page **Add a product
  with models and colours** — shared model CSV import (template, preview, near-match
  review, 2,000 rows / 1 MB), colour paste, Sell by, the options table and paste preview,
  per-colour photos, publish, customer check and a troubleshooting table. The old long
  guide moved to `docs/advanced-products-and-catalog-guide.md` and is linked as the
  Advanced appendix. Five screenshots in `docs/images/phase6/` were captured from the
  synthetic component fixture; the guide says they use sample data.
- Plain vocabulary in the app: `ProductHelp.tsx` rules for Sell by, SKU pattern, paste,
  stock per option and the price, sale, option and identity rules; "sub-item" removed
  from `ProductWorkflow`, `VariantEditor` and `ProductMetadataFields`; product-list links
  read "N options • Edit colours and models". Stale expectations in
  `tests/product-catalog-guidance.test.mjs`, `tests/product-list-stock.test.mjs`,
  `tests/product-help.test.mjs` and `scripts/product-admin-ui-browser.py` were updated.
- The UI fixture (`scripts/product-admin-ui-fixture.mjs`) now admits the two pure rule
  modules the editor imports (`price-history-rules`, `options-table-rules`) and still
  refuses every other `src/lib/store-admin` module.

**Migrations in order:** `0058_shared_catalogue_normalization`, `0059_shared_colours`,
`0060_product_options_pricing`, `0061_order_item_option_snapshot` — applied to the live
database on 5 November 2026 (0055–0057 before them, see `docs/migrations-pending.md`) and
rehearsed here in that order, each behind the gate in the rollout plan. Additive only; no
existing row is rewritten or deleted.

**Measured:** `npm test` **1,727 tests / 1,640 pass / 0 fail / 87 skipped**, 0 cancelled,
exit 0 (177.9 s; DB opt-ins off); new `tests/phase6-owner-guide.test.mjs` **9/9 pass**;
`npm run typecheck` and `npm run build` pass (25 static pages, known external-lockfile
warning); store-admin guards **122 routes**, account guards **21 APIs / 11 pages**, admin
boundary and settings lists pass; `check:notifications` **3 pass / 5 fail** (provider
configuration, no message sent); `npm audit` **0 vulnerabilities**; `git diff --check`
clean apart from existing line-ending warnings. No migration was applied, no business or
identity row was written, and nothing was committed or pushed.

**Not built / not proven:**

1. The authenticated end-to-end browser run — owner imports models by CSV, pastes
   colours, creates the red ₹100 and black ₹120 case with stock and colour photos and
   publishes; a customer filters by model, picks a colour, checks out in test mode with
   simulated PayU callbacks; only that option's stock moves; the admin shows the price
   history. The throwaway-schema target cannot sign in an owner without writing to the
   live identity tables, so this was not executed.
2. The five screenshots are component previews rendered by the fixture, not captures of a
   signed-in store admin.
3. Per-option low-stock notifications are still not queued (product-level only), so the
   notification check stays 3 pass / 5 fail.

**File map:** `scripts/rehearse-options-migrations.mjs`,
`scripts/phase6-guide-screenshots.py`, `tests/phase6-owner-guide.test.mjs` (all new);
`docs/phase6-rollout-plan-20261105.md`, `docs/advanced-products-and-catalog-guide.md`,
`docs/images/phase6/*.png` (new); `PRODUCTS_AND_CATALOG_SIMPLE_GUIDE.md` (rewritten);
`src/components/store-admin/{ProductHelp.tsx,VariantEditor.tsx,ProductWorkflow.tsx,
ProductMetadataFields.tsx}`; `scripts/product-admin-ui-fixture.mjs`.

### Phase 7 — per-option low-stock alerts — 6 November 2026

**Implemented and unit-verified (19/19 offline tests pass).** This closes limitation 3 of
Phase 6: a staff low-stock alert now fires for the **option** that crossed its own
threshold, not only for the product.

- **One option, one count.** The low-stock crossing is judged per stock row: option A
  dropping below its own threshold alerts even while option B sits well stocked, and a
  colour already low never re-alerts on every later adjustment. The product-level path
  is unchanged, so a simple product still alerts once.
- **The alert names the option.** `stockAlertProductName(productName, optionLabel)`
  (new, in `src/lib/notifications/stock-events.ts`) renders `iPhone 18 Case — Colour:
  Red`. Without it, one colour going low read as the whole product going low. The label
  is trimmed and the whole string capped at 300 characters, because it reaches a
  template.
- **The movement is the dedupe token.** `adjustVariantInventoryUsing` now returns the
  `stock_movements.id` it wrote (`returning id`), plus the option label, the product
  name, and the availability before and after. The route keys the message
  `movement:<id>`, so a retry cannot send the same alert twice — the same guarantee the
  product-level path already had.
- **The link opens the option.** The staff link carries the option
  (`/store-admin/stock/<product>?variant=<option>`), so the alert lands on the row that
  needs attention.
- **A brand-new stock row never alerts.** With no prior count there is no crossing, so
  `stockKnown` is false and the row is skipped. Queueing happens after the transaction
  commits and is fire-and-forget, so a mail outage cannot fail an adjustment.
- Tests: 4 new cases in `tests/variant-admin-pos.test.mjs` (option label, movement id
  and both availability counts returned; a product-level row carries no option label; a
  source contract pinning the route's per-row crossing test, option link and
  `movement:<id>` token, and that the service itself never queues) and 2 new cases in
  `tests/notifications-events.test.mjs` (option naming, including the empty and
  over-long cases; independent per-option crossings).

**File map:** `src/lib/notifications/stock-events.ts`,
`src/lib/store-admin/variant-inventory.ts`,
`src/app/api/store-admin/catalog/products/[id]/variant-inventory/route.ts`;
`tests/variant-admin-pos.test.mjs`, `tests/notifications-events.test.mjs`.

### Phase A — customer order flow — 2 November 2026

**Implementation delivered; acceptance is not fully complete.** Required real SQL
suites and populated end-to-end/provider checks remain pending fresh authorization.
This evidence supplements, rather than re-dates, the historical checks above.

- Cart/bag primary action is **Checkout** with no provider branding. Guest help
  follows the existing setting. Shared footer uses neutral payment methods.
- Checkout uses the normal storefront shell, left summary/right form on desktop,
  collapsible total/summary above the form at 768/390px, item images/options,
  existing coupon/totals/stock/price/reservation protections and amount-labelled Pay.
- Shared browser/server India validation covers unknown inputs, Unicode names,
  normalized +91/91/0 mobile prefixes, 36 states/UTs and exact nonzero-leading PINs.
  Inline errors are associated/focused; saved addresses are ownership-checked and
  revalidated. Edited values cannot silently reuse a selected old snapshot.
  Successful address saves retain their ID; ambiguous saves check owned rows before
  retrying, rather than blindly inserting duplicates. Marketing remains opt-in.
- All five result routes use shared header/footer and authoritative financial
  wording/actions. Verified success has one summary/shopping pair; uncertainty
  never offers repayment. Real timeline retained; result stepper/pickup placeholder
  removed. No unverified email-sent claim. Guest summary requires signed return
  access; full documents remain account-owner-only.
- Customer **Payment receipt** is available after settled payment; **Invoice**
  View/Print requires Delivered and existing identity. Direct invoice mode before
  delivery returns unavailable, never a substitute invoice. Request-bill mutation
  is retired with guarded 410; historical rows, shipment-time numbering and staff/POS
  eligibility are preserved. Refund overlays remain truthful. Confirm dispatch-time
  tax issuance with the accountant before changing issuance rules.
- Bounded payment prerequisites now share integrity checks and safe allowlisted
  persistence, use database lifecycle time, distinguish explicit cancellation,
  reject gateway-identity races and preserve uncertain callback recovery context.
  Historical raw payloads were not deleted.

| Check | Actual Phase A evidence |
|---|---|
| Full offline `npm test` | **1,249 tests: 1,167 passed, 0 failed, 82 skipped**, 0 cancelled; DB opt-ins off. `.tmp-phaseA-final-verified-tests.txt` |
| Typecheck / production build | Passed; `.tmp-phaseA-typecheck-verified.txt`, `.tmp-phaseA-build-verified.txt`. Existing external-lockfile warning retained. |
| Authorization / boundary scripts | **110 store-admin routes**, **21 account APIs / 11 pages**, admin boundary passed. |
| Read-only settings checker | All 15 settings/list tables plus staff columns readable; 114 notification cells. `.tmp-phaseA-setting-lists.txt` |
| Notification checker | **102 templates render cleanly**; offline readiness **1 pass / 4 fail**: DB omitted, SMTP driver unconfigured, SMS off, SMTP intentionally skipped. Exit 1, not readiness success. Fresh preview directory preserves earlier previews; no send. `.tmp-phaseA-notifications.txt` |
| Legacy compatibility | Configured running local app: **2/2 media routes pass**, zero old-admin references. `.tmp-phaseA-legacy-compat.txt`. Separate no-DB runtime diagnostic: 0/2 media routes, expected missing DB resolution, `.tmp-phaseA-legacy-local.txt`. |
| Actual browser smoke | Cart/bag/unavailable-result at **1440/768/390**: 9 HTTP-200 cases, header/footer, no horizontal overflow; guest-off checkout redirects to auth. Screenshots `tmp/phaseA-browser-20261102/`. Not populated checkout/payment/invoice acceptance. |
| `npm audit` | **0 vulnerabilities**, `.tmp-phaseA-audit.json` |
| Real SQL suites | **Not run / not passed**. Fresh write approval absent; manifest prepared read-only with hostname and private fixture row/sequence scope. `.tmp-phaseA-sql-preapproval.json` |
| Git | `git diff --check` passed. No new commits/staging; existing dirty tree retained. `git log -5 --oneline` and status captured in `.tmp-phaseA-git-*.txt`; not clean. |

**Historical SQL evidence reconciled:** `remaing tests.md` and the exact-name index
confirm **80/80 original registrations passed**, including callback **4/4**,
shipping **6/6** and expanded Phase 2 **15/15**. Of the latest 82 offline skips,
**79 exactly match historical passing registrations**; the other three are the
changed Phase 2 registration and separate Phase 4/5 suites. Phase 5 has separate
**9/9 SQL passing evidence**. These are completed earlier runs, not current-source
Phase A reruns; particularly, the old Phase 2 log tests active bill requests that
Phase A now retires. See the reconciliation section in `remaing tests.md`.

**Remaining:** freshly approved current-source isolated document/shipping/callback SQL tests;
populated checkout keyboard/saved-address/retry browser checks; confirmed payment,
Delivered/refund invoice checks against real isolated data; actual PayU test payment
and notification delivery readiness. No migration or live order written. Do not
interpret prior Phase 2/5 SQL evidence as current-source Phase A acceptance.

**File map:** `UX_NOTES.md`; `CartPageView.tsx`, cart/bag/checkout pages,
`CheckoutForm.tsx`, `GadzioFooter.tsx`; shared `checkout/india-validation.ts` and
`account/rules.ts`, payment initiation route; `order/layout.tsx`, five result pages,
`OrderResultPage.tsx`, `orders/result-state.ts`; `orders/{document-policy,document-data}.ts`,
`OrderDocument.tsx`, account order/receipt pages, guarded retired bill-request route
and service; `payu/{verify,process-response,reconcile,orders,callback-route,return-access}.ts`,
`checkout/reservation-rules.ts`; checkout/validation/initiation, result, customer-document,
document-policy/render and payment seam regression tests; `phase-a-test-manifest.mjs`,
`phase-a-browser-smoke.py`, notification checker fresh-output option. No new public API
or invoice route; no new Phase A migration. Phase B evidence follows separately.

### Phase B — catalogue and product admin — 3 November 2026

**Partial implementation verified; Phase B acceptance is not complete.** Independent
option-price writes remain safety-gated pending real authoritative checkout acceptance.
No configured-database migration/backfill or business-data write was performed.

- Six-step Add product and matching sectioned Edit with jump links, sticky Save,
  publish checklist, staged photos/options/descriptions/stock/metadata, shared paise
  parser and unsaved-exit warnings. One coordinated transaction rolls back on
  validation/history/audit failure; post-commit cache failure is not reported as rollback.
- Editable color/model sub-items with model × value generation, explicit device
  mappings, per-item stock limits/counts and Active controls. Saved commerce identity
  changes use Archive and replace; old order/stock history stays intact and replacement
  stock starts at zero. Product listing exposes sub-item counts/edit links and exact-row
  stock aggregates, including mixed/missing setup rather than false unlimited labels.
- Compatible devices active switch reveals searchable brand-grouped device dropdown;
  saved selections initialize it. Clearing requires confirmation, never claims universal
  compatibility, and cannot silently orphan active model-mapped sub-items.
- Plain stock vocabulary across products/options, Stock/Low-stock, Sale, POS, reports,
  CSV help and notifications. Existing schema keys, event names and ledger rules retained.
- Shared effective option pricing prevents parent-sale inheritance when an option owns
  its regular price. Checkout-valid option minimum/From display, sale refresh provenance,
  exact option price-change identities, coupon/shipping option totals and POS reference
  prices have focused offline coverage. Cashier-entered prices remain unchanged.
- Exact selected-variant checkout regression: seven new tests invoke real checkout,
  stock and signed callback services with injected SQL/verifier; focused matrix **48
  passed / 0 failed / 0 skipped**. Black 10→9 at reservation, verified payment consumes
  without a second decrement; same-product Blue/iPhone15, other product and retained
  parent balances unchanged. Replay, cancellation release/grace and missing/sold-out
  selection are covered. This is not real PostgreSQL/concurrency or live payment proof.
- Safe short description and ordered text/bullets/specs/FAQ sections with starters,
  hide/reorder/remove, typed formatting and safe links. Both detail renderers retain
  null legacy fallback and honor [] as intentionally empty. CSV preserves omitted/blank
  cells and supports explicit null/[] and stable structured JSON round trips.

**UI-only clarity follow-up (3 November 2026):** Products list has obvious Edit/View,
colors/models and Set stock actions, distinct review filters and labelled category counts.
Add/Edit retain six sections, existing controls and coordinated saving. Product-scoped
question-mark help covers fields, settings, actions, table headers and review items;
native disclosures work for viewers without enabling edits. Description formatting/link
controls are secondary disclosures, with errors and stock/publication warnings visible.
No API, schema, checkout, stock calculation or price-gate changes. Regression evidence:
**1,349 total / 1,267 passed / 0 failed / 82 skipped**, focused **71/71**;
`.tmp-product-ui-tests-20261103.txt`, `.tmp-product-ui-focused-20261103.txt`.
Typecheck/build and 111-route/admin-boundary checks pass. Loopback fixture browser matrix
passes at 1440/768/390 for actual hydrated Add/Edit/viewer components and mocked-data
Products list; keyboard/touch help, unchanged drafts, in-memory saves, sticky-footer
reachability and table overflow verified, zero hydration/console/external-request errors.
Screenshots/results: `tmp/product-admin-ui-20261103/`. This is not real authenticated
Next/database acceptance. UI details and fixture-browser limitations are in `UX_NOTES.md`.

| Check | Earlier Phase B evidence (before UI-only follow-up) |
|---|---|
| Full offline npm test | **1,342 total: 1,260 passed, 0 failed, 82 skipped**, 0 cancelled. `.tmp-phaseB-tests-complete-20261103.txt`; includes seven selected-variant deduction tests. Subsequent fixture-only addition of same-product iPhone15 sibling passed the 48-test focused rerun. |
| Typecheck / production build | Passed: `.tmp-phaseB-typecheck-complete-20261103.txt` (nonincremental), `.tmp-phaseB-build-complete-20261103.txt`. |
| Guards / boundaries | 111 store-admin routes, 21 account APIs / 11 pages, admin boundary passed. |
| Read-only settings / legacy media | 15 settings/list tables plus staff columns, 114 cells; 2/2 stored-media routes pass, zero old-admin references. |
| Notifications | 102 templates render; offline readiness **1 pass / 4 fail**, no send/SMTP connection. `.tmp-phaseB-notifications-final-20261103.txt`. |
| Audit | Zero vulnerabilities. `.tmp-phaseB-audit-final-20261103.json`. |
| Browser | Existing adapter PDP 200 at 1440/768/390, shared header/footer, no horizontal overflow/pageErrors; protected Add redirects login. Screenshots `tmp/phaseB-browser-20261103-final/`; desktop/mobile inspected. Not authenticated wizard/persisted section/option-payment acceptance. |
| SQL/migrations | Not run, not passed; 82 skips remain unverified for current source. 0054 prepared, not applied; backfill not executed. |

**Deployment:** keep existing 0051 metadata → 0052 inventory → 0053 coupon sequence;
apply additive **0054_product_descriptions.sql** before description writes. Description
reads tolerate absent columns; this is not migration acceptance. Backfill defaults to
read-only dry run and requires explicit reviewed source/digest/host/actor before apply.
CSV content format and precise responsive notes are in `UX_NOTES.md`.

**Remaining:** option-price write gate; option Sale inline/bulk/clear (current bulk is
explicitly product-default-only); writable option price CSV/history acceptance; real
isolated SQL checkout/stock/atomicity/concurrency/migration/backfill proof; source-bound
Phase B database fixture/manifest; authenticated Add/Edit/publish/structured-content
roundtrip; complete changed-screen keyboard/focus/AA and screenshots; real PayU test
payment. No Phase C started. Existing dirty tree preserved; no commit/staging.

**File map:** `ProductWorkflow.tsx`, `ProductCreateForm.tsx`, `ProductMetadataFields.tsx`,
`ProductDescriptionEditor.tsx`; products list/new/detail pages; new guarded
`POST /api/store-admin/catalog/products/draft`; `store-admin/{product-draft-rules,
product-draft,product-option-combinations,catalog,catalog-csv,catalog-transfer,sale,pos}.ts`;
`catalog/{product-description,storefront}.ts`, `storefront/{pricing,catalog,catalog-merge}.ts`,
`payu/{db-catalog,db-pricing}.ts`; both shop product/buy metadata routes,
`ProductDescriptionSections.tsx`, `ProductDetailPage.tsx`, `AccessoryDetailPage.tsx`,
collection/card quick-add surfaces; stock/Sale/POS/report/notification terminology;
0054 migration and `backfill-product-descriptions.mjs`; focused workflow/draft/route,
list-stock, metadata/CSV/description/backfill and option pricing/consumer/checkout tests;
`phase-b-browser-smoke.py`. No new public customer API.

### Phase 5 — coupon visibility controls — 2 November 2026

**Implemented and verified with isolated PostgreSQL tests; live migration and
browser acceptance are pending.** This supplements, not re-dates, older evidence.

- Coupons have **Show to all users**, default off, with independent discovery
  assignments by email or existing customer group. Existing redemption email and
  group restrictions keep their AND semantics. Assignments grant discovery only;
  a hidden code remains redeemable when its redemption rules allow it.
- Admin create/edit/generation forms include help, separate discovery inputs and
  read-only viewer behavior. The list adds public/hidden visibility, assignment
  counts, filtering, filter-preserving export and selected-row bulk show/hide.
  Duplicates remain paused, hidden and discovery-unassigned.
- New `POST /api/store-admin/coupons/visibility` accepts a bounded selected list;
  role/origin checks remain mandatory. Create/update/generation/duplication and
  bulk visibility audit in the mutation transaction and roll back on audit
  failure. Audits record visibility/assignment counts, not recipient lists.
- Customer list/count require coupons globally enabled, active/database-time
  validity, eligibility and remaining uses, plus public visibility OR a matching
  explicit email/group assignment. Ledger reads are batched. Customer DTOs expose
  only customer-facing details, expiry and personal remaining uses. Percentage,
  free-shipping and targeted-scope labels are corrected.

| Check | Actual Phase 5 evidence |
|---|---|
| Full offline `npm test` | **1,103 tests: 1,021 passed, 0 failed, 82 skipped**, 0 cancelled. SQL opt-ins disabled; skips are not passes. `.tmp-phase5-tests.txt` |
| Approved real PostgreSQL run | **9 passed, 0 failed, 0 skipped**; six nested SQL scenarios plus fixture/manifest registrations. Actual 0041/0053 migrations, rerun preservation, customer isolation/DTOs, real admin services, bulk action and audit rollback. `.tmp-phase5-sql-tests.txt` |
| SQL scope and cleanup | Only newly owned `itest_phase5_coupon_visibility_approved`; asserted final counts and local sequences; schema removal verified. No public writes/sequences, PayU, email or app-pool use. Owner-connected tests are not restricted-role RLS authorization proof. |
| `npm run typecheck` / `npm run build` | Both passed. `.tmp-phase5-typecheck.txt`, `.tmp-phase5-build.txt`; existing external-lockfile warning retained. |
| Route/boundary/settings checkers | **110 store-admin routes**, **21 account API routes / 11 account pages**, commerce boundary and read-only settings checks passed. |
| Notification checker | **Skipped at user's request** after its offline preview-directory replacement required approval. Existing previews preserved; no notification send. |
| Legacy compatibility checker | Database reference scan found zero old admin references; **failed at local media HTTP check** because no app was listening on localhost:3000. `.tmp-phase5-legacy-compat.txt` |
| `npm audit` | **0 vulnerabilities**. `.tmp-phase5-audit.json` |
| Git | No new commits. Existing branch/worktree remains dirty, including earlier phases; no unrelated changes discarded or staged. `.tmp-phase5-git-status.txt` |

**Rollout / manual acceptance:**
1. Back up the database. Re-run `node scripts/inspect-coupon-visibility.mjs` for a
   fresh read-only census. Current census: **3 existing coupons**, new columns
   absent; first application defaults all three hidden. No live migration applied.
2. Separately approve and apply `0053_coupon_visibility_assignments.sql` after its
   earlier coupon prerequisites. Do not blindly run the migration runner: other
   unapplied Phase 1–4 files are also present. No new environment variables.
3. Explicitly enable public visibility or assign each intended coupon; existing
   redemption restrictions are NOT copied into discovery assignments. A hidden
   coupon may still appear to its explicitly assigned eligible customers.
4. In the running app, create two coupons, enable public visibility on only one,
   and verify a customer sees only that one. Assign the hidden coupon to another
   email/group and verify isolation, list/count agreement, filters and bulk
   show/hide. Test a known hidden unrestricted code at checkout. Expired, paused
   or exhausted coupons must not appear. These browser checks are **not yet run**.
5. Safe rollback is operational: disable public discovery/remove explicit
   assignments through audited admin controls if needed; retain additive columns
   and existing redemption history. Do not use destructive SQL or restore old
   private-only discovery as a silent workaround.

**File map:** migration `0053_coupon_visibility_assignments.sql`; admin
`src/lib/store-admin/{coupon-rules,coupons}.ts`, coupon API routes and
`coupons/visibility/route.ts`; `CouponForm.tsx`, `CouponVisibilityControls.tsx` and
protected coupon pages; customer `src/lib/account/{coupon-rules,coupons}.ts`,
shared `src/lib/coupons/rules.ts`, `CouponsList.tsx`; tests
`account-coupons.test.mjs`, `store-admin-coupon-visibility.test.mjs`,
`phase5-coupon-integration.test.mjs`, `helpers/phase5-fixture.mjs`; scripts
`inspect-coupon-visibility.mjs`, `phase5-test-manifest.mjs`,
`run-phase5-approved.mjs`. Phase 6 was not started.

### Database fixture repair follow-up — 2 November 2026

- Current-source Phase 2 SQL rerun: **15 passed, 0 failed, 0 skipped**;
  repaired Phase 3 SQL rerun: **12 passed, 0 failed, 0 skipped**. The missing
  local `product_variants` dependency is supplied without changing live tables.
- Shared test isolation rebinds copied serial defaults to owned local sequences,
  protects schema cleanup ownership, and supplies additive Phase 4 fixture columns.
  Reports/shipping/availability clone empty metadata dependencies; notification,
  coupon, staff and PayU fixtures use the same fail-closed lifecycle.
- Offline regression: **1,072 tests; 991 passed, 0 failed, 81 skipped**. Original
  80-registration SQL reconciliation is still in progress; the separate new Phase 4
  suite is not included in those 80. Skips are not passes.
- Typecheck, production build, 109 store-admin route guards, account-route guards,
  and the admin commerce boundary pass. No live migration/allocation, real PayU
  request, notification delivery, commit or push is part of this follow-up.
- Evidence: `.tmp-phase2-approved-rerun.log`, `.tmp-phase3-fixed-retry.log`,
  `.tmp-fixture-repair-offline.log`, `.tmp-fixture-repair-typecheck.log`,
  `.tmp-fixture-repair-build.log`; see `PHASES_NOTES.md` for scope and pending SQL.

### Website merge verification — 1 November 2026

This supplements, rather than re-dates, the historical checks above:

- Repository caller audit: old API fetches occur only in legacy UI; public media
  URLs are the intentional compatibility exception. No repo CI/script caller found.
- Saved integration audit via `DATABASE_URL`: `social_links`, `analytics_scripts`,
  `store_integrations` each have 0 rows and 0 old API references (counts only).
- Stored media HTTP check against the running local app: **2/2 legacy rows resolve**;
  no active shared rows existed for a live shared-media check. Shared-source resolution,
  archiving and bytea headers are covered by fixtures instead.
- Local HTTP smoke: known/unknown old pages return 308; old login, content, theme,
  upload and unknown API requests return 410 with `no-store` and the moved message.
- Final full regression run: **895 passed, 0 failed, 0 skipped**. Typecheck and
  production build pass; all 103 Store Admin routes are guarded. Boundary and
  customer-route checkers pass. Step-7 SSR alignment checks are included.
- **Not verified:** owner browser save/no-op/reset and theme round trips, migrated
  password/TOTP sign-in, external provider configuration outside the repo/database,
  and remote CDN object bytes. Final legacy code deletion remains blocked.

### Phase 3 — scoped attributes and manual compatibility — 2 November 2026

**Implemented in the working tree; approved Phase 3 SQL tests pass. Live rollout
and browser acceptance remain pending.** This section supersedes the interrupted Phase 3 handoff in
`PHASES_NOTES.md`, not the earlier historical evidence. No public business-table writes, live migration application, backfill apply,
commits or pushes were performed. Approved SQL tests created and removed private
throwaway schemas on the configured database.

- Owners manage category-linked product types, ordered attribute mappings,
  required fields and specification/filter/search placement, and device brands/models.
- Create/edit use only mapped attributes and a searchable manual device picker.
  New products are drafts; no type or models are selected automatically. Category
  and type changes warn; unrelated saved/local values are retained. Clear archives;
  Restore is explicit. Inactive saved references stay visible for draft review.
- Shared transactional validation covers create, metadata/attribute edits,
  activation, CSV and duplication. Published products need an active matching type,
  valid required values and, where required, at least one active selected device.
  Reference changes cannot invalidate published classified products. Audit failure
  rolls back new metadata changes. Legacy unclassified copy-only edits remain possible.
- Product list offers separate **Needs compatibility review** and broader metadata
  review filters. Types not requiring devices are not automatically compatibility
  failures merely because their selection is empty.
- Draft duplication retains classification, selected devices and retained attribute
  values (including archived state); it never copies stock/reservations or orders.
  It currently does not copy gallery images or colour variants.
- CSV columns: `product_type_id` (ID or literal `null`), `device_model_ids` (JSON
  array), `attribute_values` (typed JSON object). Omission preserves on update;
  included blank metadata cells are rejected; `[]` clears devices, `{}` makes no
  attribute edits, and per-key `null` archives. Export omits archived/out-of-scope
  PAVs without deleting them. CSV dry-run records an import job and is **not** the
  no-write historical migration preflight or proof that publication will succeed.
- Storefront compatibility comes only from active selected device joins; attributes
  come only from active matching type mappings and unarchived values. Authoritative
  empty selections remain empty. PDP selectors no longer inject models; category
  filters and both search feeds use projected data. Connection-outage marketing
  fallback suppresses managed metadata. Missing schema is a deployment-readiness
  error, not permission to revive static compatibility. Variant stock is not added.

| Check | Actual Phase 3 evidence |
|---|---|
| Latest full suite, DB opt-ins disabled and `DATABASE_URL` empty | **1,034 tests: 954 pass, 0 fail, 80 skipped**, 0 cancelled. Includes 10 new pure fixture-isolation checks. This offline run does not supersede the separately completed SQL results or count SQL skips as passes. |
| Metadata/rules/admin/backfill/sale-entry focused regression | **100 tests: 99 pass, 0 fail, 1 legacy-DB skip** |
| Typecheck / production build | Pass; build retains the outside-repository lockfile warning |
| Role / account / CMS boundary checkers | Pass: **108 Store Admin APIs; 21 account APIs + 11 pages**; commerce boundary intact |
| Read-only settings checker | Pass: all settings tables readable, 114 notification cells; this is newer evidence than Phase 2's missing-table observation |
| Legacy compatibility checker | Pass: 0 saved old-API references; **2/2 legacy media routes** resolve; 0 shared-media rows |
| Offline notifications | **1 pass, 4 fail**; 102 templates render. Offline DB/provider readiness is not verified; no send/SMTP login attempted |
| `npm audit` | **0 vulnerabilities** |
| Whitespace / git | `git diff --check` passes (LF/CRLF notices); existing dirty tree preserved; no commits |
| Real Phase 3 SQL tests | **12 passed, 0 failed, 0 skipped** after explicit database-test permission. Actual migration/service/duplicate tests ran only in the approved temporary schema; count/sequence assertions passed and schema cleanup was verified |
| Real Phase 2 SQL tests (follow-up) | **15 passed, 0 failed, 0 skipped** in its approved temporary schema, including independent-session races and final insert-count assertions; cleanup verified |
| Additional database follow-up batches | Safe legacy allowlist **120/120**; payment/shipping **10/10**; sale-boundary **10/10**, all zero skipped. These batch counts include their non-DB tests and must not be added to full-suite totals as unique tests |
| Remaining legacy SQL / consolidated DB regression | **Not executed:** execution permission guard blocked the next batch pending fresh host-specific temporary-schema-write approval after context compaction. Remaining fixture batch contains **40 gated registrations**. Fixture isolation hardening is implemented; its SQL execution and hardened sale-boundary rerun remain unverified |
| Browser acceptance | Not run. Playwright is not installed; no dependency was added |

**Read-only historical backfill report.** Host:
`aws-0-ap-northeast-1.pooler.supabase.com`. Schema 0051 is absent (49 missing
schema items); apply is blocked. Proposed inserts: types **7**, type mappings
**18**, brands **1**, models **7**, product/device joins **7**, audit **1**;
products **12 updates**; PAV/history **0 writes**; conflicts **0**. Ten unrelated
legacy values are reported and retained. Three unknown products remain untyped:
`test-2026`, `test-item-xyz999`, `test-product`; the second also has unrecognized
model evidence. Six products receive seven exact static selections—never broad
phrases, model ranges or automatic all-model assignments. Existing reviewed-empty
selections and manual joins are never refilled/overwritten.

**File map:** schema `migrations/0051_product_types_compatibility.sql`; rules and
planner `src/lib/catalog/product-metadata-{rules,backfill}.ts`; service/duplicate
`src/lib/store-admin/product-{metadata,duplicate}.ts`; create/update/CSV modules
`catalog-crud*.ts`, `catalog-writes.ts`, `catalog-{csv,transfer}.ts`; shared UI
`ProductMetadataFields`, `ProductMetadataEditor`, `MetadataReferenceManager`,
`ProductAttributes`; APIs `catalog/metadata/[kind]`, product `metadata` and
`duplicate`; storefront `src/lib/catalog/storefront.ts`, `src/lib/storefront/catalog*.ts`,
case/accessory PDPs, five accessory category pages and `/api/catalog/summary`.
Tests: `product-metadata-{rules,admin,backfill}`, `catalog-metadata-csv`,
`storefront-phase3`, `phase3-metadata-integration`, and `helpers/phase3-fixture`.
Scripts: `migrate-product-compatibility.mjs`, `phase3-test-manifest.mjs`.

**Rollout and forward-fix order:**
1. Preserve a database backup and the current application artifact. Review earlier
   pending migrations 0047–0050 independently; do not run the blanket migration
   runner as a Phase 3 test. Review and separately authorize 0051 (six new RLS
   tables, product/PAV columns, category/type FK, history trigger; removal only of
   the old overly broad PAV public-read policy). No historical assignments in DDL.
2. Run the approved private-schema SQL fixture before release. Generate its exact
   host/count/digest manifest with `node scripts/phase3-test-manifest.mjs
   --configured-hostname`. Approval must cover the current digest, not a prior
   version. Production/public table writes and sequence advances are zero.
3. After authorized schema installation, rerun `node
   scripts/migrate-product-compatibility.mjs --dry-run`; obtain a separate approval
   for the new actual counts/digest and store-owner actor before apply. The current
   pre-schema digest is not apply approval. No new environment variables required
   for normal app operation: server-side `DATABASE_URL` remains authoritative.
4. Deploy only with schema ready. Review required flags before enforcing stricter
   business rules: proposed initial historical mappings are optional. Check unknown
   products manually; do not infer their types from category alone.
5. Forward-fix mappings/values or revert the app artifact if needed. Retain additive
   schema/history and data; do not roll back by deleting joins, PAVs or tables or
   restoring the overly broad public policy. Coordinate old-app rollback because
   older code does not enforce the new publication/scoping rules.

**Manual acceptance still required:** create a draft case with no devices; select
its type and verify only case attributes; select two exact models, save/reload,
then publish; confirm only those models in PDP/filter/search. Change type/category
and cancel/confirm the warning; return and verify values survived. Clear/restore a
value, duplicate to a draft, CSV export/reimport multiple models and false/zero.
Confirm required-value/device removal fails on a published product, empty optional
compatibility hides its block, viewers cannot write, and owner reference changes
cannot invalidate a published product. Verify authoritative-empty behavior and
outage handling in a safe environment. No browser or real SQL round-trip claim is
made beyond the specific approved SQL fixture coverage above; real CSV/browser
persistence still needs acceptance. Education Store, Phase 4 stock and Phase 5
coupons untouched.

### Phase 2 — receipts, refunds and invoices — 2 November 2026

**Implemented in the working tree; not deployed and not fully acceptance-verified.**
The older evidence above remains historical. No production migrations or order
mutations were performed for this phase. Real SQL transaction tests remain pending
because the finalized fixture manifest adds one rolled-back refund request beyond
the approved count; the expanded scope was not executed at that handoff.
**Follow-up after explicit full database-test permission:** the finalized Phase 2
fixture has now run successfully: **15 passed, 0 failed, 0 skipped**, including
invoice/refund races, rollback, and all declared row/sequence counts. Its temporary
schema was removed and verified absent. The historical table below records the
original handoff, not this later SQL result.

| Check | Actual result on 2 November 2026 |
|---|---|
| Full `npm test`, all DB write opt-ins disabled | **958 tests: 879 pass, 0 fail, 79 skipped**, 0 cancelled. Skips are not passes. |
| Document policy / renderer / shipment focused run | **28 pass, 0 fail, 0 skipped**; policy includes 720 status/fact combinations. |
| Refund lifecycle / return rules focused run | **48 pass, 0 fail, 0 skipped**; lifecycle uses transaction mocks, not a real DB. |
| Real SQL Phase 2 suite | **Not executed**. Default run proves manifest determinism and rejection before connection; transaction suite is skipped. |
| `npm run typecheck` / `npm run build` | Both pass. Build warns about an outside-repository lockfile; no root configuration changed for that warning. |
| Account / Store Admin / CMS boundary checkers | Pass: **21 account APIs + 11 pages**, **105 Store Admin routes**, commerce boundary intact. |
| Read-only settings checker | **Fails on missing `bill_request_reasons`**: migration 0049 is intentionally unapplied. Other existing settings tables are readable; 114 notification cells. |
| Legacy compatibility checker | 0 saved old-API references in each of the three scanned integration sources; **2/2** local legacy media routes resolve; 0 shared-media rows available for live checking. |
| Offline notifications | **102 templates render** without unresolved placeholders/secrets. Readiness summary **1 pass, 4 fail/unverified**; no DB/SMTP connection or message send in offline mode. |
| Running production-app authorization smoke | Customer receipt and staff invoice redirect unauthenticated requests (**307**); bill-request and refund-resolution APIs reject unauthenticated same-origin POSTs (**401**). **4/4 expected responses**; no real order mutation. |
| `npm audit` | **0 vulnerabilities** across all dependencies. |

**Behavior and scope**

- Shared policy keeps payment, order, shipment and refund status independent.
  Pending/verifying/review/failed/cancelled payments get status-only documents,
  not paid bills. Captured payment history is retained after cancellation.
- Paid, active, unshipped orders offer an owner-only **Request bill** flow with
  an active managed reason or bounded Other text. Durable throttling, reason
  snapshots and idempotency unlock **Bill / Payment receipt — invoice follows
  on shipment**. Staff can see the saved request.
- New shipments (`ON_THE_WAY`) and direct-delivered POS sales allocate a unique,
  sequential invoice reference and database issue time in the same transaction.
  Retries reuse it; later prefix edits cannot rename it. Existing shipped orders
  have explicit legacy wording, not invented issue times or silent backfill.
- Manual refunds now have immutable initiation and terminal history. Completion
  requires a reference for every method. Pending reservations count toward capture
  and return caps without prematurely writing completed refunds or restoring
  coupons/closing returns. Completion preserves the existing financial side effects.
- Customer/staff documents, order detail/quick-view, result summaries, POS and
  relevant notification context use the shared policy. Issued invoices retain their
  identity after cancellation/refunds and show the current stamp and amounts.
  Packing slips remain fulfilment documents. POS voids are not paid receipts.
- Existing non-GST wording remains; no tax calculation, credit-note workflow,
  payment-provider refund API, attachment pipeline or receipt pop-up was invented.
  Education Store and Phases 3–6 are outside this phase.

**Phase 2 file map**

| Area | Implementation |
|---|---|
| Shared policy / authoritative facts | `src/lib/orders/document-policy.ts`, `src/lib/orders/document-data.ts` |
| Invoice allocator / milestones | `src/lib/orders/invoice.ts`, `src/lib/store-admin/orders.ts`, `src/lib/store-admin/pos.ts` |
| Bill requests / reason management | `src/lib/account/bill-requests.ts`, account `bill-request/route.ts`, `RequestBillForm.tsx`, `setting-lists.ts`, Settings → Reasons |
| Refund lifecycle / APIs / staff UI | `src/lib/store-admin/refund-lifecycle.ts`, `returns.ts`, order/return refund APIs, new `refunds/[id]/route.ts`, `RefundForm.tsx` |
| Shared document renderer | `src/components/orders/OrderDocument.tsx`, `DocumentHeader.tsx`; customer receipt, staff invoice and POS receipt callers |
| Schema | `migrations/0049_order_documents.sql`, `migrations/0050_refund_lifecycle.sql` |
| Pure / mocked tests | `tests/document-policy.test.mjs`, `tests/order-documents.test.mjs`, `tests/refund-lifecycle-unit.test.mjs`, `tests/fulfilment-pickup.test.mjs` |
| Real SQL harness (pending execution) | `tests/phase2-documents-integration.test.mjs`, `tests/helpers/phase2-fixture.mjs`, `scripts/phase2-test-manifest.mjs` |
| Decisions / release gates / manual checks | `PHASES_NOTES.md` |

**Release gate:** take a backup, verify the existing migration ledger, then apply
outstanding migrations in order (existing 0047/0048 prerequisites before new
0049/0050). This was **not run** during implementation. The migration runner applies
*all* pending SQL, so do not use it as a test. Run the explicitly approved isolated
SQL tests and authenticated manual checklist in `PHASES_NOTES.md` before release.
New tables enable RLS with no policies and use server-side `DATABASE_URL` only.
No new environment variables are needed in the app; test flags are opt-in only.
Do not roll back by deleting invoice/refund history; stop affected writes and use
a reviewed forward fix. No historical invoice backfill is authorized.

---

## 0. What “live” means in this document

There are two separate questions, and it is worth keeping them apart.

**1. Is the feature wired up?** That is what the status column below answers: does code
exist, does it run end to end, does it read and write real data.

**2. Is it deployed on a public server?** Not from this repository. Verified on
25 October 2026:

| Check | Result |
|---|---|
| `vercel.json`, `Dockerfile`, CI workflow, deploy script | none exist |
| `next.config.ts` | empty (exported object has no keys) |
| GitHub branches | `main` only, at commit `2d50b69` |
| `GET https://<site>/vercel.json` | **404** |
| `GET .../vercel.json?` (cache-buster) | **404** |

The repository contains no deployment configuration and the Git remote has a single
branch. The build succeeds locally and the app runs on `next dev` at
`http://localhost:3000`. A 404 on `/vercel.json` is not conclusive on its own — a Vercel
project without that file also returns 404 — but combined with the empty remote it means
nothing in this repo or on its remote deploys this code. Treat “live” below as
**functional when the app runs against the configured database**, not as “already on the
internet”. To make it true, someone must connect the repo to a host and supply the
environment variables in the table below at deploy time.

### Status legend

| Status | Meaning |
|---|---|
| 🟢 **Live** | Implemented and wired end to end. Reads/writes the database (or the external gateway) and affects what the user sees. |
| 🟡 **Live (static data)** | Works, but reads a hard-coded catalogue rather than the database. Editing it in the admin does not change the page. |
| 🔵 **Stored only** | Edited and persisted in the admin, but nothing else consumes the value yet. |
| ⚪ **UI only** | Screen renders and behaves, but has no downstream effect. |
| ⛔ **Deferred** | Not built. Listed so it is not mistaken for missing work. |

### Environment currently configured

| Variable | Present? | Consequence |
|---|---|---|
| `DATABASE_URL` | yes | Everything DB-backed works. |
| `PAYU_KEY`, `PAYU_SALT`, `PAYU_ENV` | yes | PayU checkout can start and verify. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | CMS content reads through Supabase REST first. |
| `CRON_SECRET` | **no** | `/api/payu/reconcile` accepts unauthenticated POSTs. See §7. |
| `RECAPTCHA_SECRET_KEY` | **no** | reCAPTCHA is not enforced anywhere. |
| `MAIL_PASSWORD` | **no** | Email still queues, but every email row is marked `SKIPPED` with “mail not configured (`MAIL_PASSWORD` is missing)”. Checkout is unaffected. |
| `MSG91_AUTH_KEY` / `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | **no** | SMS still queues, but every SMS row is marked `SKIPPED` until the chosen gateway's credentials exist. |
| `APP_BASE_URL` | **no** | Optional. Absolute links in messages fall back to `https://gadzio.in` in production and `http://localhost:3000` in development. |
| `NOTIFICATION_RETENTION_ENABLED`, `NOTIFICATION_RETENTION_DAYS` | **no** | Optional. Retention is off unless the switch is `1`/`true`/`on`/`yes`; then finished outbox rows older than N days lose their body and recipient. N defaults to 90 and is clamped to 3650. |

---

## 1. How the system fits together

```
Browser
  │
  ├── Storefront  (src/app/(public routes))  ── reads content_blocks (Supabase REST → DATABASE_URL fallback)
  │        │                                      reads catalogue via src/lib/storefront/catalog.ts
  │        │                                        (DATABASE_URL; static bundle only on outage)
  │        │                                      reads product_collections only when a rail consumes one
  │        │                                      cart in localStorage + cart-id cookie
  │        └── /api/payu/* ──────────────► PayU hosted checkout ──► callbacks ──► orders table
  │
  ├── Customer account  (/account, /auth) ─────► users / user_sessions / orders / customer_addresses / order_requests
  │
  ├── Store admin  (/store-admin) ─────────────► store_admins / store_admin_sessions  (cookie store_admin_session)
  │        ├── guarded APIs: products, collections, orders, customers
  │        └── Website: content_blocks, site_settings; shared store_media library
  │
  └── Legacy /admin bookmarks ──308──► Store Admin Website
           /api/admin/* ──410──► moved message (public media GET retained)
```

**The content boundary (Phase 0, retained in Website).** Website edits layout, copy,
imagery and theme, not product ids, prices, costs, SKUs, stock, discounts, orders,
customers or shipping data. `/api/store-admin/website/content/[key]` calls
`validateLegacyContentWrite()` and `scripts/check-admin-boundary.mjs` checks that
boundary. Commerce remains in Store Admin's commerce modules. Education (`edu.*`)
keeps its existing exemption and storefront implementation unchanged.

**One active staff login.** Commerce and Website both use `store_admins`,
`store_admin_sessions` and `store_admin_session`, with roles
`store_owner` ⊇ `store_admin` ⊇ `store_viewer`. Website writes are **owner-only**;
other roles may read. Optional TOTP enrolment is under My profile → Security.
Customer identity (`users` / `user_sessions`) remains completely separate.

The old `admin_users` / `admin_sessions` tables are retained untouched, not dropped
or blanked. Legacy login APIs no longer issue sessions. Legacy UI/auth source and
the one-off migration script are still retained for rollback until the manual
owner/migrated-account verification gate in `MERGE_PLAN.md` is confirmed. This is
an in-progress retirement, not a claim that the final code-removal step is done.

---

## 2. Storefront (public pages)

### 2.1 Homepage — 🟢 Live (CMS-driven)

- **Route:** `/`
- **What it does:** renders the marketing homepage: hero, promotional tiles, gallery and
  section copy.
- **How it works:** `src/lib/content.ts` reads `content_blocks` rows by key. It tries the
  Supabase REST endpoint first (`NEXT_PUBLIC_SUPABASE_*`, read-only, publishable key) and
  falls back to a direct `DATABASE_URL` query if REST fails. A database row **overrides**
  the defaults baked into code, so editing the collection in Store Admin → Website changes the
  page even though the JSON in the repo is unchanged. Archived rows (`archived_at`) are
  ignored, so a collection can be reverted without deleting it.
- **Current data:** 6 content blocks exist (`apple.footer`, `apple.gallery`,
  `apple.hero_tiles`, `apple.hero_video`, `apple.promo_section`, `apple.ribbon`).
- **Editing:** Store Admin → Website → Content edits marketing overrides; Website →
  Theme edits global font, homepage UI mode and the homepage copyright override.
  The Gadzio hero and other hard-coded marketing copy listed in `MERGE_PLAN.md`
  remain outside this editor. Marketing product cards do not write catalogue prices.
  `product_collections` is a separate commerce merchandising source; this migration
  does not wire a new storefront collection consumer.

### 2.2 Accessory category pages — 🟢 Live (database catalogue)

- **Routes (six):**
  `/in/shop/iphone/accessories/mobile-cases`,
  `/in/shop/iphone/accessories/cases-protection`,
  `/in/shop/iphone/accessories/airpods-case`,
  `/in/shop/iphone/accessories/cable-plug-case`,
  `/in/shop/iphone/accessories/power-adapter-cable`,
  `/in/shop/iphone/accessories/wired-earphones`
- **What they do:** category listing pages with their own hero, filters and product grids.
  Rendering is shared through `AccessoryCategoryPage`.
- **How they work:** the server calls `getAccessoryCategoryView(slug)` or
  `getAccessoryProductsView(slug)` in `src/lib/storefront/catalog.ts`. Live products come
  from `categories` / `products` / `product_images` / `product_facets` / `product_specs` /
  `stock`; database values win and the static bundle fills fields the database does not
  carry (marketing copy, colour swatches, gallery extras, in-the-box lists). The static
  keyword file is only used when the database is unreachable.
- **Page furniture:** the five explicit routes keep their coded `CONFIG` (hero, filters,
  navigation); the dynamic `[slug]` route also reads category furniture from the database.
- **Availability:** inactive/deleted products and inactive categories are omitted. A
  product whose database stock resolves to zero uses the card's existing **Out of stock**
  state and disabled quick-add. No low-stock text exists in the card, so none is added.
- **Also:** a category row that disappears while the database is reachable gives a 404 on
  the dynamic route; the five explicit pages fall back to their static products so a
  coding mistake cannot blank a live page.

### 2.3 Cases & Protection — 🟢 Live (database catalogue + CMS furniture)

- **Routes:** `/shop/iphone/accessories/cases-protection` and
  `/in/shop/iphone/accessories/cases-protection`
- **What it does:** the iPhone case range, with a richer layout than the generic accessory
  pages.
- **How it works:** `getCasesCategoryView()` reads the `cases-protection` category and its
  active products from the database, merges each row over its static record, and returns
  grid-card props. `CasesProtectionPage` still accepts `cases.*` overrides loaded through
  `getContentMany(...)` from `content_blocks`, but those overrides hold page furniture only
  (`category_links`, `page_header`). The inline product override was removed in Phase 0.
- **Fallback:** if the database is unreachable the page renders
  `STATIC_CASES_CONFIG` + the static case bundle exactly as before. If the database answers
  but the category row is gone, the route 404s.

### 2.4 Product detail — 🟢 Live (database catalogue)

- **Routes:** `/shop/product/[productId]` and `/shop/buy/[productId]`
- **What they do:** product detail, variant selection and an “add to bag / buy now” action.
- **How they work:** `getProductDetail(id)` reads the live row, decides case vs accessory
  from the static case set or the `cases-protection` category, and merges database values
  over the static record. `/shop/buy/…` remains case-only.
- **Failure rules:** an unknown, inactive or deleted row on a reachable database → `404`.
  An unreachable database (or no `DATABASE_URL`) → the static record renders exactly as
  before, so an outage cannot blank the page. `/shop/product/…` still 404s when no static
  record exists either.
- **Prices:** the displayed amount is the effective price from
  `resolveEffectivePrice` (§2.16) divided by 100 — the same resolver checkout uses, so the
  page price and the PayU amount cannot drift. While a sale is live the regular price is
  shown struck through beside the sale price.
- **Not read:** reviews/ratings (there is no rating UI on the page), `cost_paise`, internal
  notes, audit rows or customer data. Compare-at is carried in the read model but no
  component renders it yet.
- **Out of stock:** the detail page has no availability state or disabled add button today,
  so none was invented. The cart marks the line unavailable, excludes it from the total
  and blocks the PayU button.

### 2.5 Search — 🟢 Live (database catalogue, client-side matching)

- **Route:** `/search`
- **What it does:** query box, results, popular searches and recent-search history.
- **How it works:** the server page calls `getStorefrontRefs()` and passes the compact list
  to `SearchPageView`. Matching stays in the browser (`scoreProducts`), over those
  database refs plus the fixed `PAGE_SEARCH_ITEMS` navigation links. Education Store
  content is unchanged. Recent searches are stored in `localStorage` under
  `gadzio_search_history_v1`, capped at 25 entries. No search query is sent to the server
  and no analytics row is written.
- **Payload:** each ref carries only id, name, subtitle, `pricePaise`, `priceDisplay`,
  image, category, `inStock` and display keywords. No cost, notes, audit or customer data.
- **Fallback:** if the database is unreachable the page receives the static ref bundle.

### 2.6 Cart and bag — 🟢 Live

- **Routes:** `/cart`, `/bag`
- **What it does:** add/remove/change quantity, see totals, proceed to checkout.
- **How it works:** `CartContext` keeps the cart in `localStorage`; `src/lib/cart/cart-id.ts`
  maintains a `cart_id` cookie so a cart can be identified across pages. Nothing is
  reserved in the database — a cart is a browser artefact until a PayU order is created.
- **Pricing:** the server passes the live catalogue refs to `CartPageView`. A line is
  payable only while its product still exists and is in stock; its price and total come
  from `pricePaise`, not the price stored in `localStorage`. Unknown, archived or
  out-of-stock lines keep the existing **Unavailable** state, are excluded from the
  displayed subtotal and disable checkout. Checkout re-prices from the database again
  (§2.7), so the bag total is a display value only.
- **Shipping:** the existing Shipping row shows the same quote checkout charges (§2.7):
  a method rate, a method's own free-over threshold, the store-wide free-shipping
  threshold, or `FREE` when shipping is disabled or no method is configured. It is a
  display value — initiate recomputes it server-side.
- **Coupon.** A collapsed **Have a coupon code?** box sits in the summary. The discount
  row and the Total come from `POST /api/coupons/validate` (§2.18); only the code is kept
  in the browser, and the bag never applies a discount of its own.
- **Caveat:** stock is not held while an item sits in a bag. It is claimed when checkout
  creates the order (§2.7). A line keeps the name and image it had when added; only price
  and availability are refreshed.

### 2.7 Checkout and PayU — 🟢 Live (PayU only)

- **Route:** `/checkout`, API `/api/payu/initiate`
- **What it does:** collects name, email, phone and address, validates the cart, computes
  the amount, creates a pending order and redirects the browser to PayU’s hosted page.
- **How it works:**
  1. `checkout/page.tsx` requires a signed-in customer **unless** `guest_checkout` is on in
     Customers → Settings.
  2. Each line is re-priced with `getProductFromDatabase`. This is authoritative: an
     unknown product ID fails closed, and a database error fails closed. The static
     catalogue is only used when `DATABASE_URL` is unset. The product detail, category,
     cases, search and bag surfaces now read the same `price_paise`, so the amount the
     customer saw is the amount PayU is asked to charge.
  3. `CheckoutForm` posts the cart to `/api/payu/initiate`, which validates and rate-limits
     the request. Settings gate it first: if the store settings cannot be read the route
     returns 503 and creates nothing; if `payu_enabled` is off it refuses through the
     existing error alert. No client-sent price, shipping amount or total is ever read.
  4. The amount is recomputed on the server: the re-priced subtotal plus a shipping quote
     from `shipping_methods` / `free_shipping_over` / `shipping_enabled` (§2.14). The
     subtotal, shipping and total are stored as paise on the order; `orders.amount` and the
     PayU request both use that total. The checkout Total row and Pay Now button show the
     same figure.
  5. The order number comes from `order_prefix` + `order_start_number` through the
     `order_number_counters` row (migration `0034`), and the formatted number is the
     `txnid` (`GDZ001001`). An empty prefix keeps the previous `GDZ{time}{rand}` id and
     leaves `orders.order_number` NULL.
  6. The order and its stock claim are created in **one transaction**. Tracked `stock` rows
     are locked `for update`, re-checked against `on_hand - reserved` and decremented; each
     decrement writes a `stock_movements` row with reason `sale`. If any line no longer
     fits, everything rolls back — no order row, no claim — and the customer sees the
     existing error alert. Two buyers of the last unit serialise on the row lock, so only
     one order is created. The order is written with payment status `CREATED` and fulfilment
     status `PENDING` (the sale-state view already shows it as pending); PayU’s request hash is built
     and a hidden form returned. The browser auto-submits it to PayU.
  7. If the customer ticked the offer box **and** `checkout_marketing_optin` is on, the
     email is also inserted into `newsletter_subscribers`. Failure to record it never
     blocks the payment.
  7a. **Coupon.** The form re-checks the code and sends `couponCode` plus
     `expectedTotalPaise` (a comparison value). The route locks the coupon row inside the
     order transaction, re-validates under the same stock locks, allocates the discount to
     the lines and charges the server total; the client-sent total is only compared. A
     refusal returns 409 `coupon_invalid` (drop the code and show the message) or
     `coupon_unavailable` (no order created, pay without the code). See §2.18.
  8. PayU calls back to `/api/payu/success`, `/api/payu/failure`, `/api/payu/cancel`.
     `src/lib/payu/process-response.ts` verifies the reverse hash, calls PayU’s
     verification API for the transaction, then performs an **atomic, idempotent** status
     transition. A duplicate callback cannot double-mark an order paid. On the first
     verified PAID transition, `auto_confirm` and `default_fulfilment_status` are applied
     as legal `order-rules.ts` steps, each recorded in `order_status_history` with actor
     `system`. Automation stops at `PROCESSING` (Preparing); courier pickup and delivery
     require explicit staff actions, even if a legacy default selected a later status.
  9. A verified failure or cancellation releases the stock claim once, through the movement
     ledger (`sale` minus `release`), so duplicate callbacks and reconcile runs cannot
     release twice. An admin cancelling an unpaid order releases too; cancelling a paid
     order gives its sold units back through `restoreSoldStock` (§2.14). If a payment is
     captured after its order was cancelled and the released units are still on the shelf,
     the late PAID transition re-claims them atomically in one transaction. If they are
     gone, the order still becomes PAID — the money was taken — but is flagged
     `payment_review_required`, audited and shown in Payments review; nothing is
     auto-refunded and no partial claim is written.
  10. `/api/payu/webhook` accepts the same payloads server to server (rate limited to 100
      per minute per IP). `/api/payu/reconcile` is the durable worker tick (§2.15): it
      claims due order rows with a database lease, verifies them against PayU, releases
      expired reservations and failed-payment grace holds, flags unresolved payments, runs
      waiting-list expiry/allocation and cancels unpaid orders older than
      `auto_cancel_unpaid_hours` (0 or empty keeps the 2-hour abandoned-checkout rule),
      releasing stock once and writing an `order.auto_cancel` audit row. The same run drains
      the notification outbox and, when retention is switched on, scrubs old finished
      message bodies (§3.6). The production scheduler must POST this endpoint **every
      minute** with `CRON_SECRET`; it fails closed (503) when the secret is unset (§2.14).
- **Callback test seams and simulator (2026-11-02):** `processPayUCallback` and
  `verifyOrderWithPayU` accept a caller-owned SQL connection, verifier, reservation
  policy and `sideEffects: false`. Reads, review flags, transitions and timeline rows
  stay on that connection; notifications, global audit writes (including late-capture
  audits inside the transition wrapper) and cache invalidation are suppressed only
  when explicitly requested in-process. Production callers retain all defaults; no
  HTTP field enables a verifier override.
  - `scripts/simulate-payu-callback.mjs` constructs signed success/failure/cancel/pending,
    duplicate, out-of-order and invalid-amount/unknown-reference POSTs. It is dry-run
    by default; `--send` requires disposable test orders. Live-mode execution is
    refused. Secrets, payloads and signed redirect links are never printed. The
    receiving server still verifies with PayU: synthetic success alone cannot pay.
  - Evidence: processor seam + pricing + reservation-rule suites: **30 passed,
    0 failed, 0 skipped**. Typecheck and store-admin/account/boundary guards passed.
    Four new real-SQL cases in `tests/payu-callback-integration.test.mjs` are **not
    executed** pending explicit database-test approval; opt in with
    `RUN_PAYU_CALLBACK_INTEGRATION=1` and an explicitly supplied `DATABASE_URL`.
    They use a throwaway schema, local sequences and the real timeline migration,
    covering duplicates, late capture, gateway-id reuse and append-only/RLS rules.
    The notification checker reported **3 passed / 5 failed** due to unconfigured
    mail/SMS and disabled notification matrix cells; no message was sent.
- **Missed-return customer recovery (2026-11-02):** checkout now handles
  `reservation_active` with a validated existing-payment link and expiry rather
  than only a generic error. Owners can explicitly POST a payment check from the
  status/processing page; summary-token visitors cannot authorize this action.
  The endpoint checks ownership before PayU, applies process-local account/order
  rate limits, and uses the same atomic settlement as staff verification with
  honest `customer` audit/timeline attribution. Pending/outage results never
  count as paid; customer checks do not extend the current active hold. Effective
  PAID consumes the hold, and recovery success navigation preserves a newer bag.
  Verification needs gateway credentials but no valid browser-return origin;
  initiation still requires an explicit validated origin and production HTTPS.
  - Migration `0048_customer_payment_verification.sql` extends only the timeline
    source constraint. It has **not been applied**; customer timeline writes
    require this migration after 0047. Append-only triggers and RLS are unchanged.
  - Focused recovery/processor/pricing/reservation/sale suite: **75 passed,
    0 failed, 4 database integration tests skipped**. API guard coverage includes
    dependency-injected service tests, the real origin guard, and static route
    wiring checks; frontend tests are pure helpers/source guards, not browser E2E.
    Typecheck, account/store-admin/boundary checks and `git diff --check` passed
    (Git emitted only line-ending warnings).
  - Operational verification is **incomplete**: starting Next on port 3001 failed
    because Next detected an existing dev process on port 3000; HTTP probes to
    localhost, IPv4/IPv6 loopback and the reported LAN address were refused. No
    existing process was stopped. The `.env.local` return-origin edit was blocked
    pending explicit approval, so the expired tunnel origin remains configured.
    No production build, real sandbox payment, actual order recovery, database
    migration or database integration run was performed for this repair.
- **No other payment method exists.** There is no cash-on-delivery path, no manual bank
  transfer path and no wallet. `payment_methods` in settings is not consulted, and
  `cod_enabled` ships off because checkout has no payment-method selector.

### 2.8 Order result pages — 🟢 Live

| Route | What it shows |
|---|---|
| `/order/success` | Order summary after a verified payment. Reads the order by `txnid`; requires the signed-in owner if the order belongs to a user. |
| `/order/failed` | Failure page with a safe reason code (never a raw PayU response). Explains that the held unit went back on the shelf and a **new** checkout is needed to retry. |
| `/order/cancelled` | Cancellation page, including the expired-reservation case. |
| `/order/processing` | “Payment being verified”. Used when the outcome is not yet reliably known; the exact copy is fixed (§2.15). A GET refresh re-reads the order and redirects to success/failed/cancelled when the status resolves. It never starts another payment. |
| `/order/status` | Public-ish lookup by transaction ID. Shows only safe status labels from `getCustomerOrderStatus`, including the processing explanation. |

### 2.9 Customer account — 🟢 Live

| Route | What it does | Data |
|---|---|---|
| `/auth` | Customer sign-up, sign-in, and sign-out | `users`, `user_sessions` |
| `/account` | Modern customer dashboard: 8 primary action cards in a responsive 3/2/1 grid, grouped quick navigation, live Buy Again carousel, Recently Viewed history row, and Inspired by History recommendations | `users`, `orders`, `order_requests`, `customer_addresses`, `customer_browsing_history`, `notification_outbox`, `coupons` |
| `/account/orders` | Order history with filter tabs (All, In-Flight, Delivered, Cancelled), customer status chips, live background order polling, and Buy Again quick reorder | `orders` |
| `/account/orders/[txnid]` | Detailed order summary with itemised pricing, delivery status, auto-refreshing live poller, and customer request actions (cancel / return / help) | `orders`, `order_requests` |
| `/account/orders/[txnid]/receipt` | Clean, printable tax invoice / receipt with order itemisation and company receipt footer | `orders`, settings `receipt_footer` |
| `/account/addresses` | Address book: create, edit, delete shipping addresses, and switch default address | `customer_addresses` |
| `/account/coupons` | Customer promotional wallet: view private assigned coupons (by email or group), copyable coupon codes, discount value, plain-word scope, min order, expiry date, and remaining uses | `coupons`, `coupon_redemptions` |
| `/account/messages` | Message centre / in-app notification inbox: read/unread badges, single-item mark read, mark all as read, and neutral fallback display for retention-scrubbed messages | `notification_outbox` (`customer_user_id`, `read_at`) |
| `/account/history` | Browsing history manager: list recently viewed products, remove individual items, clear all history, and toggle browsing history tracking on/off | `customer_browsing_history`, `users.save_browsing_history` |
| `/account/preferences` | Communication preferences: toggle marketing email & SMS opt-in, synchronized automatically with newsletter subscriptions | `users.marketing_opt_in`, `newsletter_subscribers` |
| `/account/profile` | Profile & security: edit display name, contact phone, and change account password with current-password verification | `users` |
| `/account/data` | Privacy & data management: download complete JSON data export (rate-limited with 24h cooldown) or execute irreversible account closure (guards against open/unpaid orders and active returns, revokes sessions, clears addresses & history, and frees the original email) | `users`, `user_sessions`, `customer_addresses`, `customer_browsing_history` |

#### Key Guardrails & Security Architecture

1. **Session & Ownership Boundary:**
   - All 11 account pages enforce `requireAccountPageSession(...)` and export `dynamic = 'force-dynamic'` with no shared CDN cache headers.
   - All 19 account API routes enforce `requireAccountSessionApi()` and filter strictly on `auth.session.userId`.
   - All mutating API requests enforce `assertSameOrigin(request)`.
   - Verified continuously by `scripts/check-account-routes.mjs`.

2. **Database Isolation & Migration 0044:**
   - Added table `customer_browsing_history` with strict Row Level Security (RLS) enabled and composite unique index (`user_id, product_id`).
   - Added user columns `save_browsing_history` (default true), `password_changed_at`, and `last_data_export_at`.
   - Added `customer_user_id` (indexed) and `read_at` to `notification_outbox` for owner-scoped customer in-app notifications.
   - All account access uses `DATABASE_URL`; publishable keys are never used on customer tables.

3. **Performance & Bounded Queries:**
   - `getAccountDashboardSummary` executes in parallel bounded batches (no unbounded queries or N+1 leaks).
   - Live order poller runs every 30 seconds only while the tab is active and visible; pauses in the background and halts permanently upon reaching a terminal order state (`DELIVERED`, `CANCELLED`, `FAILED`).
   - Browsing history writes are debounced client-side (30-second deduplication) and automatically pruned at 90 days during the background reconcile cron.
   - Buy Again row queries only delivered/accepted products from customer-owned paid orders, re-verifies live catalogue prices, and checks inventory rules before adding to the bag.

### 2.10 Order requests (cancel / return / help) — 🟢 Live

- **API:** `POST /api/account/orders/[txnid]/requests`
- **What it does:** lets a customer ask to cancel, return or get help on an order.
- **Rules (`src/lib/account/request-rules.ts`):**
  - cancel: only while the order is `PENDING` or `ACCEPTED`;
  - return: only after `DELIVERED`, within the configured return window
    (`return_window_days`, 7 days by default);
  - help: always allowed.
  - Status flow: `OPEN → IN_PROGRESS → RESOLVED | REJECTED`.
- **Guardrails:** same-origin check, signed-in session required, 10 requests per 15
  minutes per user.
- **Staff side:** appears in Store admin → Sales → Requests. Currently 0 rows.

### 2.11 Static and informational pages — 🟢 Live (static)

`/support`, `/privacy`, `/terms` render fixed content. `/android` is a coming-soon page
for the OPPO/Android site. There is no backend behind any of them.

### 2.12 Education Store — ⛔ Deferred

`/in-edu/store` exists and is content-driven, and its products appear in search. Per the
project rules it is **out of scope for the admin build** and must not be touched unless
asked.

### 2.13 Store Admin → storefront wiring (Phase 1) — 🟢 Live

**Goal:** Store Admin is the owner of product data. A successful write there changes what
the storefront shows on the next request, without new routes and without changing the
page layout.

**How a request flows**

1. A server page calls the read layer (`getProductDetail`, `getAccessoryCategoryView`,
   `getAccessoryProductsView`, `getCasesCategoryView`, `getStorefrontRefs`).
2. The read layer runs one cached catalogue query (`unstable_cache`, tag
   `storefront-catalog`, 30-second safety net) and merges database rows over the static
   bundle. Per-product detail reads also carry `storefront-product:<id>`. The cached rows
   hold the **regular** price only; the sale switch is never part of a cache entry.
3. The sale switch is read once per request (`readSaleState()`, on the database clock) and
   applied to each row by `applySaleDisplay()`. A sale starting or ending is therefore
   visible on the next request with no wait and no cache clearing; the 30 seconds only
   ever delays a catalogue edit.
4. A component receives plain props. No client component queries the database.
5. Every catalogue-changing Store Admin write calls `revalidateCatalog(productId?)` after
   its audit row, so the next visit reads fresh data. Every call revalidates the
   `storefront-catalog` tag; a product-specific call also revalidates
   `storefront-product:<id>`.
6. On a database outage the read layer catches the failure and returns the static bundle,
   so pages still render.

**Admin edit → next-request storefront effect**

| Store Admin action | Storefront result |
|---|---|
| Rename product / edit subtitle or description | New copy on detail, category grid, cases grid, search |
| Edit price | New price on detail, grids, search, bag; PayU charges the same `price_paise` |
| Add / reorder / archive images | New primary image and gallery; card hover image; search result image |
| Edit specs, highlights, features, in-the-box | Detail page and grid props |
| Edit facets / compatibility | Filters, compatibility lists and search keywords |
| Create a product | Appears in its active category and search (if active) |
| Archive / deactivate product | Disappears from categories/cases/search; detail 404s; bag marks it Unavailable |
| Archive / deactivate category | Dynamic category route and Cases 404; the five explicit accessory routes keep their coded page and static product list |
| Adjust stock / change stock settings / POS sale / void / return receipt | Out-of-stock products disable the card quick-add and are excluded from the bag total |
| Approve/reject a review | Revalidates the catalogue, but no storefront component renders ratings yet |
| CSV import (committed) | Imported changes appear on the next request |

**Evidence**

| Rule | Proof |
|---|---|
| Database wins, static fills gaps | `tests/storefront-catalog.test.mjs` merge tests |
| Database down → static | `chooseCatalogSource` tests + live outage test: server started against an unreachable `DATABASE_URL` (cache cleared) returned 200 on product, category, cases, search and cart pages, rendered the static prices and omitted the database-only product |
| Reachable database + missing row → 404 | `chooseCatalogSource` tests + `getProductDetail` null |
| Inactive/archived hidden | read-query assertions + `deleted_at`/`is_active` predicates |
| Stock in/low/out and threshold | `stockStateFrom` tests; out-of-stock card-state test |
| Search payload has no cost/notes | exact key-set test + source scan |
| Each admin write revalidates | source assertion over all 18 write routes |
| Displayed price equals charged price | merge/ref tests + `db-catalog.ts` source assertion |
| No route/visual change | only existing pages/components were rewired; smoke test hits the same routes |

**Not wireable without a visual/UI change (left alone deliberately)**

- Compare-at price: stored and read, but no existing component renders a struck-through
  price.
- Reviews/ratings: no storefront rating component exists; adding one would be new UI.
  Store Admin review writes still invalidate the catalogue so a future UI is correct.
- Low-stock hint: the data (`availableStock`, `lowStockThreshold`, `stockState`) is
  available, but no card/detail component has a low-stock treatment. Only the existing
  out-of-stock state is used.
- Detail-page availability copy/button: the accessory detail page always prints
  “In Stock” and never disables add-to-bag. Changing that is a copy/behaviour change, so
  the cart remains the gate.
- Cart line name/image: a bag stores the values it captured when the item was added.
  Price and availability are refreshed from the database; the historical name/image is
  not rewritten.

### 2.14 Checkout and order settings wiring (Phase 2) — 🟢 Live

**Goal:** shipping, numbering, payment availability, paid-order automation, unpaid-order
expiry and the return window come from Store Admin; checkout can never sell stock that
does not exist.

**Settings → behaviour (before → now)**

| Setting (Settings → …) | Before | Now |
|---|---|---|
| `order_prefix` + `order_start_number` (Orders) | ignored; ids were `GDZ{time}{rand}` | new online orders get the prefix plus a 6-digit number from `order_number_counters` (migration `0034`), and that number **is** the `txnid`. Empty prefix keeps the old random id and leaves `order_number` NULL. Existing orders are untouched and never renumbered. |
| `invoice_prefix` (Orders) | invoice printed the `txnid` | invoices print `invoice_prefix` + the padded order number; legacy orders still print `txnid`. |
| `auto_confirm` + `default_fulfilment_status` (Orders) | ignored; a paid order stayed `PENDING` | on the first verified PAID transition the order walks legal `order-rules.ts` steps up to the configured status, capped at `PROCESSING` (Preparing); auto-confirm lifts `PENDING` to at least `ACCEPTED`. Each step writes `order_status_history` with actor `system`. Invalid or `CANCELED` defaults fall back to `PENDING` before auto-confirm. Legacy pickup/delivered defaults are capped without rewriting settings or existing orders. |
| `auto_cancel_unpaid_hours` (Orders) | reconcile used a hard-coded 2-hour cutoff and wrote no audit row | reconcile cancels unpaid orders older than the configured hours with a system reason, releases their stock claim once and writes an `order.auto_cancel` audit row. `0` or empty keeps the 2-hour abandoned-checkout rule. |
| `return_window_days` (Orders) | hard-coded 7 | the account return window and its error message use the configured value; 7 when unset, empty or invalid. |
| `shipping_enabled`, `free_shipping_over`, `shipping_methods` (Shipping) | ignored; PayU charged the cart subtotal | initiate quotes shipping server-side: disabled → free; store-wide free-over reached → free; otherwise the first active method (sort order, then name), using its own free-over or rate. The quote is stored as `orders.shipping_paise` and charged by PayU. The cart’s existing Shipping row shows the same figure. |
| `payu_enabled` (Payments) | ignored | off refuses initiate through the existing error alert; nothing is created. |
| `payment_note` (Payments) | ignored | rendered in the checkout form’s existing PayU helper area. |
| `cod_enabled` (Payments) | defaulted on and unused | default is now **off**. Checkout has no payment-method selector, so COD stays unwired. |
| `pickup_enabled` (Orders) | ignored | **locked off** — pickup does not exist; see §2.20. |

**Stock safety.** Order creation runs in one transaction: tracked `stock` rows are locked
`for update`, re-checked against `on_hand - reserved`, then decremented; every decrement
writes a `stock_movements` row with reason `sale`. If any line no longer fits, the whole
transaction rolls back and initiate returns 409 through the existing alert — no order and
no claim are left behind. A verified failure/cancel, an admin cancellation of an unpaid
order and auto-cancel each release the outstanding claim once, guarded by the movement
ledger (`sale` minus `release`), so duplicate callbacks or reconcile runs cannot release
twice. A paid order keeps its stock until it is cancelled or returned.

Returns, paid-order cancellations and POS voids restock through the same ledger.
`restoreSoldStock` gives back at most `sale` minus earlier `return`/`release` movements
for that order and product, so a partial, repeated receive or a cancel after a return
cannot over-restock. An order created **before Phase 2** has no `sale` movement, so
cancelling, voiding or returning it restores nothing — legacy orders can never invent
stock.

**Late payment.** A payment can arrive after auto-cancel or a failed/cancelled callback
has already released its claim. The PAID transition reads the order's `release` movements
and tries to take exactly those units back in one transaction, locking every stock row
`for update` first. Success continues normally (a second `sale` ledger line). If any line
no longer fits, nothing is claimed, the order is marked PAID with
`payment_review_required = true` and a fixed reason, paid-order automation is skipped, and
the order appears under **Payments → Captured payments needing attention**, where an owner
or admin can mark it reviewed (`payment_reviewed_at/by`). The flag write is audited as
`payment.late_capture_review`. There is no automatic refund and a duplicate callback is a
no-op (the order is already PAID and the transaction returns early).

**Reconciliation scheduling (required in production).** The deployment scheduler must
`POST /api/payu/reconcile` **every minute** with
`Authorization: Bearer $CRON_SECRET`. A checked-out unit is held for 600 seconds (10
minutes) by default (§2.15), so a late tick keeps expired stock off the shelf for longer
than necessary; a checkout also frees overdue holds for the products it wants (§2.15,
lazy expiry), so an outage of the scheduler cannot leave a sold-out product locked while
its units are really free. The optional `?staleMinutes=` (default 15) controls how old a pending order must
be before PayU is asked about it; the reservation window and the reconcile lease decide
everything else. Each run verifies due payments, releases expired reservations and ended
failure grace, cancels unpaid orders older than `auto_cancel_unpaid_hours` (0 or empty
keeps 2 hours), writing an `order.auto_cancel` audit row, and expires/allocates
waiting-list invitations. Without the schedule, abandoned orders keep holding stock
forever.

Each run also drains up to **10 due notification outbox rows** (§3.6), so the same cron
retries email and SMS that a provider rejected. Enqueued messages first get one best-effort
send in the request's `after()` hook; the cron is the safety net. When
`NOTIFICATION_RETENTION_ENABLED` is on, the run then clears `body` and `recipient` on
terminal rows older than `NOTIFICATION_RETENTION_DAYS` (default 90, clamped to 3650),
keeping event, status, masked recipient, reason and timestamps; the response reports
`retention: { enabled, days, scrubbed }`. Off by default. `CRON_SECRET` behaviour is
unchanged.

- Host cron: `* * * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<store-host>/api/payu/reconcile`
- GitHub Actions `on: schedule` (`* * * * *`, or the shortest interval the account
  allows) running the same `curl`.
- Any scheduler that can send a POST. The route accepts POST only, so a GET-only cron
  service needs a POST-capable alternative (or a wrapper).
- Prefer the header over `?secret=`, which can end up in access logs.

When `CRON_SECRET` is unset the route returns **503 in production** (fail closed) and
remains callable in development for manual runs.

**Evidence**

| Rule | Proof |
|---|---|
| Two buyers of the last unit → exactly one order | `tests/order-stock-integration.test.mjs` — two real connections race in a throwaway schema; one order, one `InsufficientStockError` |
| Insufficient / unknown / archived rejected before any order row | `checkout-stock.test.mjs` plan tests; `createOrder` plans and throws before the insert |
| Claim released once on failure/cancel/void/auto-cancel, never twice | ledger idempotence tests in `checkout-stock.test.mjs` + `tests/auto-cancel.test.mjs` |
| Legacy order (no `sale` movement) never restocks | `tests/stock-restore.test.mjs` ledger-cap tests + source guard that only `stock.ts` adds `on_hand` |
| A late PAID after release re-claims once, or flags with no partial claim | `tests/late-payment-stock-integration.test.mjs` (ledger `[sale, release, sale]`; out-of-stock sets `payment_review_required`, skips automation, duplicate callback adds nothing) |
| A cancelled paid order gives its sold units back, capped by the ledger | `tests/stock-restore.test.mjs` + `src/lib/store-admin/returns.ts` / `orders.ts` use `restoreSoldStock`, not a raw increment |
| Reconcile fails closed without `CRON_SECRET` | `tests/cron-auth.test.mjs` (503 in production, open in development) |
| Revenue definition consistent | `tests/revenue-definition.test.mjs` (total-with-fallback in Overview and reports; item revenue excludes shipping) |
| Shipping threshold matrix (below/above/no method/pickup/disabled) | `tests/checkout-shipping.test.mjs` (disabled, no method, inactive method, at/above threshold, method free-over, zero rate) |
| Client-sent shipping/total ignored | initiate reads only `price_paise` plus `quoteShipping`; no request field feeds the amount |
| Numbering unique, padded, fallback, old ids kept | `tests/order-numbering.test.mjs` (25 concurrent allocations, start number, sanitisation, invoice fallbacks) |
| Automation only through legal transitions | `tests/fulfilment-automation.test.mjs` full matrix |
| Auto-cancel hours + idempotence | `tests/auto-cancel.test.mjs`; reconcile transitions idempotently and audits only on a real transition |
| PayU off / COD default off | `tests/settings-rules.test.mjs` |
| Return window default and configured | `tests/request-rules.test.mjs` |

**Not wireable without a UI change (left alone deliberately)**

- Pickup at checkout: does not exist; the setting is locked off (§2.20).
- Cash on delivery: no payment-method selector exists, so an honest COD path cannot be
  reached from the UI; the setting ships off.
- A shipping line on checkout: the checkout form has only Subtotal and Total rows. The
  server charges the quote and the Total row includes it, but no new row was invented. The
  cart page already has a Shipping row and now shows the quote.
- Itemised revenue in reports: reports stay item-wise and continue to exclude shipping; the
  shipping figure is available on order detail and in the orders CSV export.
- A separate order-number column in the admin list: the `txnid` **is** the formatted number
  for new orders, so the existing Transaction column already shows it. The export gains
  explicit Order number and Shipping columns.
- Maintenance mode, manual payments and PayU mode remain stored-only.

**Migration `0034`** adds `orders.order_number`, the `order_number_counters` table (RLS
enabled, reset-blocking trigger), a partial unique index on `order_number`, an index on
`stock_movements.order_id`, and adds `release` to the movement-reason check. Phase 1 needed
no migration; Phase 2 used `0034`, the notification outbox used `0035` and the payment
review flag used `0036`, so the next free number is `0037`.

**Migration `0036`** adds `orders.payment_review_required` (boolean, default false),
`orders.payment_review_reason`, `orders.payment_reviewed_at` and
`orders.payment_reviewed_by` (references `store_admins(id)`), plus a partial index on the
unreviewed flag. `orders` already has RLS; no new table is created.

### 2.15 Flash-sale reservations and payment reconciliation — 🟢 Live

**Goal:** one unit cannot be sold twice, an abandoned checkout cannot hold stock forever,
a payment that may have left the bank is never reported as failed, and a late capture after
the unit was re-sold produces a tracked refund rather than an untracked charge.

**Defaults and settings (Settings → Orders, all owner-editable, all clamped)**

| Setting | Default | Range | Effect |
|---|---|---|---|
| `reservation_seconds` | **600** | 30–1800 | How long a checkout holds its claimed units. Shown as a countdown at checkout. A repeat request never extends it. |
| `payment_failure_grace_seconds` | **120** | 0–900 | After a **definitive** failure/cancel, stock stays held this long so a quick retry on the same order can still succeed. Then it is released once and the order stays FAILED. |
| `payment_unresolved_minutes` | 60 | 5–1440 | How long an ambiguous payment may keep its claim before the stock is released and the order is flagged for operations. The worker keeps checking afterwards. |

Unknown, empty or junk values fall back to the default; out-of-band numbers are clamped
(`src/lib/checkout/reservation-rules.ts`). All timing uses the **database's** `now()` (or a
test-injected clock), never a browser-supplied timestamp.

**Reservation lifecycle (`orders.reservation_state`, migration `0037`)**

| State | Meaning |
|---|---|
| `NONE` | Legacy/POS row with no reservation window. |
| `ACTIVE` | Units are claimed in `stock.on_hand` (a `sale` movement) and held until `reservation_expires_at`. One live reservation per account (`initiate` refuses a second checkout with `409 reservation_active`). |
| `CONSUMED` | A trusted verification confirmed the capture; the claim became a sale. Never expires. |
| `RELEASED` | A definitive failure/cancellation (after its grace) gave the units back with a `release` movement. |
| `EXPIRED` | The window closed before payment was confirmed; units went back. |

Once `RELEASED`/`EXPIRED`, the reservation and the original payment attempt are terminal:
that `txnid` cannot be re-initiated, a delayed callback cannot revive the window, and a
customer who wants the item starts a **new** checkout, which re-checks stock and may fail
if the unit is gone.

**Lazy expiry at checkout.** The cron is the normal expiry path, but a checkout never
depends on it. When the claim does not fit, `createOrderUsing` releases the `ACTIVE`
reservations for the requested products whose `reservation_expires_at` has passed on the
**database** clock, inside the same transaction that holds the stock row locks. A
`CREATED`/`PENDING` row is cancelled exactly as the worker would; a `FAILED`/`CANCELLED`
row keeps its status and moves to `RELEASED` (the grace rule); a `PROCESSING` row keeps its
status, loses its claim and is scheduled for an immediate check so the worker still flags
an unresolved payment. The refreshed counters are then re-planned, and the order row lock
plus the `reservation_state = 'ACTIVE'` guard make a duplicate release — worker or second
checkout — a no-op. The worker remains responsible for expiring holds on products nobody
is buying and for telling those customers.

**Payment states.** The existing `orders.status` vocabulary is reused without duplication:
`CREATED`/`PENDING` (awaiting/at the gateway), `PROCESSING` (the customer may have been
charged; outcome not yet reliable — distinct from failed), `PAID`, `FAILED`, `CANCELLED`.
The sale-state view reports `PROCESSING` separately so account pages can explain it.
Only `PAID` is set after a trusted server-side answer: reverse-hash callback plus PayU's
`verify_payment` (or the same verification from the worker). A client redirect, a browser
success URL, a timeout or a closed tab is never proof.

`PROCESSING` is carried through every surface that lists, filters, counts or labels an
order, and it is never revenue: the store-admin Orders list shows/filters it as its own
sale state, the order detail shows the payment status, reports accept `status=PROCESSING`
and their revenue/average/net figures still require `PAID`, the Overview labels it and
counts it under **Pending** (not captured), the transactions CSV only contains orders with
a recorded payment row or `PAID`, and the customer account/order pages explain that the
bank may already have been debited. The full audit is in §2.15's evidence table.

**Definitive vs ambiguous**

| Gateway answer | Outcome |
|---|---|
| Verified capture, amount matches | `PAID`, reservation `CONSUMED`, fulfilment events queued. |
| Verified failure / user cancelled (hash-authenticated callback) | `FAILED`/`CANCELLED` immediately; stock released after the grace window. |
| `NOT_FOUND` / no gateway record | Abandoned: the worker cancels at the reservation deadline and releases (`EXPIRED`) — never because a browser closed. |
| Network/HTTP/parse error, pending, success that failed verification | **Unknown**: order goes/stays `PROCESSING` and keeps its claim until `payment_unresolved_minutes`, then stock is released and the order flagged for review while checking continues. A `success` claim that cannot be verified is deliberately *not* `FAILED`. |

**Durable reconciliation.** `orders.next_reconcile_at` is a moving lease; the worker claims
due rows with `FOR UPDATE SKIP LOCKED` (index `idx_orders_reconcile_due`, plus
`idx_orders_grace_due` for failed/cancelled rows still holding grace stock, migration
`0038`). Retries back off 60 s → 120 s → 240 s … capped at 15 min, reset on a reliable
answer; five consecutive gateway failures flag the order
(`payment_review_required`). A restart or a second application instance cannot lose a row:
a crashed claim simply becomes due again, and a processed row records `next_reconcile_at
= null`. All transitions are conditional and idempotent inside one transaction, so
duplicate callbacks and concurrent worker ticks cannot change inventory twice.

**Race: capture vs expiry.** The verified-PAID transition locks the order and locks stock
rows `for update`; if the claim is still `ACTIVE` it wins and consumes it. If the window
already released the units, the transition tries to re-claim exactly the released
quantities (ledger `sale` minus `release`). If they are still available it succeeds
(one new `sale` movement). If they are gone, the order still becomes `PAID` — the money was
taken — and:

1. `orders.payment_review_required` is set with a fixed reason (Payments → Captured
   payments needing attention),
2. **one** `refund_obligations` row (unique while `PENDING`) records the amount owed, and
3. `refund_pending` + `payment_review` messages queue for staff.

Recording a manual refund against the order (Returns → refund, or the order detail) closes
the obligation once refunds cover its amount (`status = RECORDED`, last refund id). The
obligation is never deleted; a duplicate callback creates no second obligation and no
second refund. **Bank-debit-unknown policy:** when the outcome is unknown the order is
never auto-failed or auto-refunded; it is kept in `PROCESSING`, the customer is told not
to pay again, and after the recovery window a human checks the PayU dashboard. The worker
still transitions a later verified capture to `PAID`.

**Customer experience.** The checkout form shows a live countdown from
`reservationExpiresAt` and disables the Pay button while a payment is in flight
(`ReservationCountdown`, duplicate-submit guard). Expiry is explained as “this checkout
expired; start a new one”, and a stale tab cannot silently re-claim stock — the next
initiate re-checks inventory. `/order/processing` shows exactly: *“Your payment is being
verified. If your bank has debited the amount, please do not pay again while this
transaction is being checked. We'll update your order status when confirmation is
received.”* Its only action is a GET refresh that re-reads the order (never a new charge).
`/order/failed` explains that the held unit was returned and a fresh valid checkout is
needed; `/order/success` appears only after the trusted transition; unresolved stays
processing.

**Waiting list — removed.** The product-page waiting list, `/api/waitlist`, the
`/waitlist/claim` page, the `WaitlistPanel`, the invite/allocation worker and the
`waitlist_*` settings and notification topics are all gone; the reconcile tick now only
reconciles orders. The `waiting_list_entries` and `stock_reservations` tables stay in
place (migrations are additive) but nothing in the application reads or writes them.
`scripts/release-waitlist-holds.mjs` runs
`releaseWaitingListHoldsUsing` (`src/lib/payu/waitlist-cleanup.ts`) once: it returns every
unit still held by a `HELD` reservation to availability inside one transaction, cancels
the hold and its invitation, and writes one `catalog.waitlist.release_holds` audit row
when anything moved. It is idempotent; the production run reported **0 held reservations
and 0 units returned**.

**Notifications (reuses the outbox/matrix/templates).** Topics added for this feature:
`payment_processing`, `payment_failed`, `reservation_expired`, `refund_pending`,
`payment_review` — added to `notification_channel_settings` by migration `0037` with the
same conservative default (only staff in-app on). Every queue carries a `dedupe_key`, so a
retried callback or reconcile tick never duplicates a message. Templates carry no card
data, no raw gateway response and no full PII; the delivery-log masking and retention
scrub of §3.6 still apply.

**Migrations.** `0037_flash_sale_reservations.sql` adds the reservation/lease columns and
constraints, `waiting_list_entries`, `stock_reservations` and `refund_obligations` (all
RLS-enabled in the same file, no policies), the due indexes, the `PROCESSING` sale state
and the new notification topics. `0038_failed_grace_index.sql` adds a partial index for
failed/cancelled rows still holding grace stock. Both are additive; no existing row is
rewritten or removed.

**Evidence**

| Rule | Proof |
|---|---|
| Two customers, one unit → one order | `tests/order-stock-integration.test.mjs`; `tests/flash-sale-reservation-integration.test.mjs` #1 and #9 (five concurrent buyers, one success) |
| Reservation is atomic; expiry releases once; a fresh checkout works afterwards | `tests/flash-sale-reservation-integration.test.mjs` #1 |
| Failed payment holds through its 120 s grace, then releases | same #2 |
| Ambiguous payment stays `PROCESSING`, never prematurely failed, claim released at the window | same #3 |
| A checkout frees an overdue hold when the cron is down; a live hold is never taken; grace keeps `FAILED`; `PROCESSING` is queued; two buyers racing a stale hold make one order | `tests/flash-sale-reconcile-integration.test.mjs` (lazy-expiry cases) |
| Reconciler decision tree: verified capture, verified failure → grace → release once, unresolved → `PROCESSING` → release + flag, late capture with and without stock, duplicate runs, two workers at once | same (reconcile cases) |
| Duplicate PAID callbacks make one ledger row | same #4 |
| Verified capture racing expiry ends `PAID`/`CONSUMED` exactly once | same #5 |
| The queue is durable across a restart (lease reclaim, attempts increment) | same #6 |
| Waiting list is gone: files/routes/panel/settings/topics/reconcile wiring absent | `tests/waitlist-removal.test.mjs` |
| A leftover HELD reservation returns its unit once; a second run moves nothing | `tests/flash-sale-reservation-integration.test.mjs` (removed waiting list) |
| Late capture after release creates exactly one pending refund obligation | `tests/late-payment-stock-integration.test.mjs` |
| Pure decision rules (defaults, clamping, classification, backoff, phases) | `tests/reservation-rules.test.mjs` |
| Signature/cron/auth surfaces unchanged | `tests/cron-auth.test.mjs`, existing PayU tests |

**Deployment requirements.** Run `POST /api/payu/reconcile` every minute with
`Authorization: Bearer $CRON_SECRET` (in-memory timers are not sufficient; the queue and
all state live in Postgres, so any number of instances may share the schedule, but at
least one must be running). Apply migrations `0037` and `0038`. Alert on: orders left in
`PROCESSING` beyond `payment_unresolved_minutes`, `payment_review_required` rows,
`refund_obligations` that stay `PENDING`, and consecutive reconcile failures
(`consecutive_reconcile_failures >= 5`). The endpoint returns counts
(`processed`, `markedPaid`, `released`, `flagged`, `pendingRefundObligations`) for a
scheduler-side check.

### 2.16 Sale pricing — 🟢 Live (storage, resolver and every price surface)

- **Storage.** `products.sale_price_paise` (integer paise, nullable; migration `0039`)
  holds an optional sale price. It is stored all year and **applies only while sale mode
  is live**. `product_variants.sale_price_paise` exists for schema parity, but variants
  have no customer-facing price surface (checkout and the storefront price the product
  row), so no variant sale-price path is wired.
- **One resolver.** `src/lib/storefront/pricing.ts` →
  `resolveEffectivePrice({ pricePaise, salePricePaise }, saleLive)`. A sale price applies
  only when sale mode is live **and** it is a positive amount genuinely below the regular
  price. Anything else returns the regular price. `discountPercent()` is the one
  percentage helper (floored whole percent).
- **Every surface.** The resolver feeds the storefront read model
  (`src/lib/catalog/storefront.ts` → detail pages, accessory/cases pages, collection
  grids, search refs and the bag) and the PayU path (`src/lib/payu/db-catalog.ts` →
  `/api/payu/initiate`, checkout display, direct-buy checkout). POS deliberately does
  **not** use the resolver: the cashier types the price charged, and the catalogue price
  is shown only as a reference (§3.2 POS). Order lines, receipts, invoices and
  notifications store and render the charged amount, so they never re-price later.
  Display components show the sale price with the regular struck through only while a
  sale is live; with sale mode off they render the regular price alone.
- **The clock.** `src/lib/storefront/sale.ts` → `saleStatusAt(window, databaseNow)`.
  `starts_at` is inclusive, `ends_at` exclusive; the switch alone decides when there is
  no window. `src/lib/storefront/sale-state.ts` reads the one-row `sale_settings` table
  (migration `0039`, RLS enabled) together with `now()` from PostgreSQL. The browser
  clock is never consulted. If the table or connection cannot be read,
  `readSaleState()` returns `SALE_OFF` — regular prices and normal mode — rather than
  throwing or guessing a sale.
- **Admin editing.** The product page's **Price** card stores a sale price beside the
  selling price; blank clears it. Validation: positive and lower than the regular price
  (blocked, with the regular price named in the message); below `cost_paise` (warned,
  still saved and explicitly confirmed as saved). Every money field on every admin
  surface — product card, sale table, bulk actions and CSV — uses
  `src/lib/store-admin/money.ts`: it accepts `499.50`, `₹1,299.50` and `1,29,900.50`,
  rejects negatives and more than two decimals, and converts with integer arithmetic
  (no floating-point or 100× drift). Every sale price write appends a `price_history`
  row with `price_kind = 'sale'`; a clear records `'sale_cleared'` with the
  `new_price_paise` sentinel `0`. Regular changes record `'regular'` (also the column
  default). The products list shows a **Sale price** column and the price-history table
  shows the kind.
- **The sale screen.** `/store-admin/sale` (sidebar **Sale**, beside Products; not under
  Settings) carries the switch, the optional store-local window, the SALE LIVE /
  SCHEDULED / OFF badge (also on Overview, linking there), a product table with an inline
  sale price, discount %, tracked and available, and Adjust links. A four-step **How to
  start a sale** block sits above the table. Inline editing is absent for
  `store_viewer` (stored value only), so the screen never offers a write the API would
  reject. It filters by has/no sale price, tracking off, and low or zero stock. Bulk
  percent-off and clear-all are
  possible from the same screen, each writing a `sale`/`sale_cleared` history row per
  changed product. Writes need `store_admin`; `store_viewer` sees the same data read-only.
- **Why a dedicated table.** `sale_settings` is a typed one-row table rather than a
  `store_settings` text row: the window is two `timestamptz` columns compared with
  `now()` in the database, so there is no parsing of a text value and no chance of the
  app clock leaking in. The settings engine stays for plain text/boolean preferences.
- **Cache.** The switch itself is never cached. Cached catalogue rows carry the regular
  price; every read applies the switch read for that request, so starting or ending a sale
  changes the displayed price and badge on the very next request. Every sale write also
  calls `revalidateCatalog()` for price/column edits, and checkout always re-prices per
  request.
- **CSV.** `sale_price` is an import and export column; a row is rejected when the sale
  price is not positive or is not lower than `price`, with the error reported against
  that row. Blank means no sale price, and an update with a blank cell clears it (with a
  `sale_cleared` history row).
- **Evidence.** `tests/sale-pricing.test.mjs` (resolver, window boundaries, validation,
  CSV, history markers, DB-clock source guard, resolver-only reader guard),
  `tests/sale-admin.test.mjs` (settings validation, bulk maths, pre-flight, labels, route
  guards, timezone conversion against the database, bulk history),
  `tests/sale-boundary-display.test.mjs` (the cached snapshot never holds the sale switch;
  the displayed price and badge flip on the next request when a sale starts or ends) and
  `tests/catalog-csv.test.mjs`.
- **Migrations.** `0039_sale_pricing.sql` adds `products.sale_price_paise`,
  `product_variants.sale_price_paise`, `price_history.price_kind` (default `regular`) and
  the one-row `sale_settings` table (RLS enabled, no policies). Additive only.

### 2.17 Stock behaviour at checkout — 🟢 Live

**One rule, two modes.** `src/lib/storefront/availability-rules.ts` →

```ts
stockBlocked(inStock, saleLive) === !saleLive && !inStock
```

Normal mode lets stock disable a purchase. Sale mode deliberately never does in the UI: a
limited-time sale is expected to be raced, and the authoritative check is the stock row
lock at Pay. There is no third variant — the detail pages, the cart/bag, checkout, the
collection/search cards and the click-time endpoint all import this function.

- **Product page (normal mode, unavailable).** Both the sticky bar and the main button are
  `disabled` and read **Stock not available**; the delivery block shows the same label
  instead of the old hard-coded “In Stock”. Pressing Add in sale mode is never disabled,
  whatever the stock flag says.
- **Click-time re-check.** `useAvailability(productId, { saleLive, inStock })`
  (`src/lib/storefront/use-availability.ts`) seeds from the server-rendered props, refreshes
  on mount, and refreshes again when the customer presses Add to Bag. The detail pages
  `await` that refresh and refuse with **Stock not available** when it comes back blocked,
  so a sale that started after the page was rendered removes the block, and a unit taken by
  someone else restores it. `GET /api/catalog/availability?ids=…`
  (`src/app/api/catalog/availability/route.ts`) is the read: same-origin
  (`assertSameOrigin`), rate-limited per IP (60/minute, `Retry-After` on 429), at most 50
  ids, `Cache-Control: no-store`, and 503 when the database cannot answer. The payload is
  only `{ saleLive, products: [{ id, inStock, low }] }`: exact counts, `reserved`, the
  threshold and the tracking flag never leave the server. A failed check is *not* treated
  as “in stock”: the hook keeps the last known state.
- **Bag (`/cart`, `/bag`).** A line is payable when its catalogue row exists *and*
  `stockBlocked` is false — so sale mode keeps an out-of-stock line payable, while a line
  whose product is gone from the catalogue stays unavailable in both modes and still
  blocks checkout. Suggested-product quick-adds use the same predicate.
- **Checkout.** The page passes `saleLive` and a `stockById` map built from
  `getStorefrontRefs()`; the form derives availability from it (the static PayU catalogue
  is the fallback when the map is absent) and the Pay button is genuinely `disabled`, not
  merely styled grey. An unknown id is unavailable.
- **Where stock is actually checked.** Only at Buy Now / Checkout / Pay, on the server,
  inside the order transaction: `createOrderUsing` locks every tracked row `for update`,
  lazily releases reservations whose window has closed (so a sale-mode buyer can win a unit
  whose hold has expired even when the reconcile worker is behind), and re-plans the
  claim. Sale state never enters `stock.ts`, `stock-rules.ts` or `orders.ts` — a source
  guard in the tests enforces that, because honouring sale mode at Pay would sell one unit
  twice.
- **Failure.** A failed claim rolls the whole transaction back: no order row, no
  reservation, no stock movement. The message names the item — **“Out of stock: <name>. Remove
  it from your bag to continue.”** — or, when units remain because someone else took some,
  **“Only N left of <name>. Reduce the quantity or remove it from your bag.”** `claimPlannedStock`
  re-reads the still-locked row on a miss so the count is real, not a flat sold-out. No
  waitlist wording appears anywhere; the waiting list is removed (§2.15).
- **Price boundary crossing.** Each cart line sends `expectedUnitPaise` — a display hint
  only; it is never charged. `priceCartLines` compares it with the resolved database price
  and records `priceChanges`. `/api/payu/initiate` answers **409** with
  `code: 'price_changed'`, *“Prices have changed, please review your cart.”* and the priced
  snapshot **before** reserving stock or creating an order. `CheckoutForm` calls the new
  `syncPrices()` on the cart context to adopt the server prices and stops; the customer
  re-reviews and presses Pay again. A sale ending before Pay therefore never charges the
  old amount, and a sale starting never charges more than what is on screen.
- **Fail-safe.** If `sale_settings` cannot be read, `readSaleState()` returns `SALE_OFF`
  (`unreadable: true`): every surface falls back to regular prices **and** normal mode,
  never to sale prices or sale-mode permissiveness.
- **Evidence.** `tests/stock-behaviour.test.mjs` — pure rules (block matrix, price-change
  detection, last-unit message), a guard that sale state cannot reach the Pay-side stock
  code, source guards for the endpoint/pages/bag/checkout/listings/initiate, and a
  throwaway-schema read proving the availability query reports `on_hand − reserved`,
  untracked rows, inactive/missing rows, and a live/ended window on the database clock.
  The race and lazy-expiry end-to-end behaviour is proven by
  `tests/order-stock-integration.test.mjs` and
  `tests/flash-sale-reservation-integration.test.mjs`.

### 2.18 Coupons, limits and the redemption ledger — 🟢 Live

**One decision, made on the server.** `src/lib/coupons/rules.ts` is pure: it receives the
coupon definition, the resolved cart lines and a context whose clock (`now()`), paid-order
history and redemption counts come from PostgreSQL. `evaluateCoupon` returns either the
money to charge or a safe refusal. Both the preview endpoint and the order transaction
call it, so the discount the customer sees is the discount that is charged.

- **Types.** `PERCENT` (whole 1–100, floored to paise, optional maximum discount),
  `FIXED` (paise, capped at the eligible value) and `FREE_SHIPPING` (cuts shipping only,
  never line value). One code per order — there is no stacking path in the schema, the
  request or the rules.
- **Scopes.** `ORDER`, `PRODUCTS`, `CATEGORIES`, `BRANDS`; targets live in
  `coupon_targets` (exactly one of product/category/brand per row). A line outside the
  scope pays full price, and its allocated discount is zero.
- **Sale prices.** By default a coupon skips lines charged at a live sale price. With sale
  mode live and a mixed cart, only the full-price lines are discounted and the box notes
  *“Not valid on sale items.”*; when the whole eligible scope is on sale the code is
  refused with *“This code is not valid on sale items.”* `allow_with_sale_price` lifts the
  restriction.
- **Minimum order** is compared with the pre-discount subtotal on the database clock.
  `starts_at` is inclusive and `ends_at` exclusive: at the end instant the code is
  already expired.
- **The ₹1 floor.** `MIN_PAYABLE_PAISE = 100`. The discount is reduced — never the order
  rejected — to keep the payable at or above it, and the customer is told *“The discount
  was adjusted to keep the order payable.”* A cart whose own subtotal is below ₹1 is
  refused instead of being sent to PayU.
- **No benefit, no record.** A code that would change nothing — free shipping on an order
  that already ships free, or a value that floors to zero paise — is refused with *“This
  code does not take anything off this order.”* and no redemption row is written. A scoped
  code with no eligible line is refused generically, also before any write.
- **Allocation.** The order discount is spread across the eligible lines with the
  largest-remainder method; `order_items.discount_paise` is that share, the shares sum
  exactly to `orders.discount_paise`, and returns/refunds compare against
  `line_total_paise − discount_paise`.
- **Customer eligibility.** `only_new_customers` reads PAID order history by user id or
  normalized email; `allowed_customer_groups` reads `users.customer_group` (a guest fails
  closed); `restricted_to_emails` matches case-insensitively.
- **Preview endpoint.** `POST /api/coupons/validate` is same-origin, rate-limited to 10 per
  minute per IP **and** per signed-in user, `Cache-Control: no-store`, and writes nothing.
  It returns only `{ valid, code, subtotalPaise, discountPaise, shippingPaise, totalPaise,
  currency, message }` — no coupon id, limits, targets, group/email rules or other
  customers' use. Unknown, malformed, paused, not-started and out-of-scope codes all answer
  *“This code is not valid for your cart.”* Only expired, minimum-order and already-used
  reasons are specific, because those help the customer without revealing anything.
- **Checkout is the authority.** `CheckoutForm` re-checks the code immediately before Pay,
  then posts `couponCode` (the only coupon input accepted) and `expectedTotalPaise` (a
  comparison value, never a charge). `/api/payu/initiate` locks the coupon row
  `for update` inside the same transaction and under the same stock locks, counts uses,
  evaluates again, allocates the discount to the lines, writes `coupon_id`,
  `coupon_code`, `coupon_snapshot`, `discount_paise` and the per-line shares, and charges
  the server total. A client-sent discount, total or coupon id is ignored.
- **Limits under a row lock.** `total_redemption_limit` and `per_customer_limit` are
  checked after the coupon row is locked and count `RESERVED` + `CONSUMED` rows. Two
  buyers competing for the last use serialise on that lock: the second reads the first
  redemption and is refused. `tests/coupon-db-integration.test.mjs` proves it with two
  connections.
- **Lifecycle.** Creating the order inserts a `RESERVED` row (unique per coupon + order,
  so a retry cannot double-count). A verified PAID payment moves it to `CONSUMED`; a
  duplicate callback finds nothing and is a no-op. Failure, cancellation, expiry or a
  superseding checkout moves `RESERVED → RELEASED` with a reason, and a released row is
  never consumed later. A verified late payment tries `RELEASED → CONSUMED` when both
  limits still allow it; when they do not, the order stays paid and is flagged
  `payment_review_required` with a `coupon.late_restore_review` audit row — a human
  reviews the discount. Refunds do **not** give a use back unless the store setting
  `refunds_restore_coupon` is on and the refund covers the whole order.
- **Storefront.** The bag and checkout show a collapsed **Have a coupon code?** box. The
  applied code is a chip with Remove; the summary shows Subtotal, Shipping, Discount (with
  the code) and Total, all from the server's answer. Only the code is kept in
  `localStorage`; the discount never is. The code is re-validated on load, after a
  debounced cart change and again at Pay. If the server refuses, the discount disappears,
  the box shows the server's message and Pay is blocked until the customer sees the new
  total. The order success page, account order detail and receipt show the same
  breakdown.
- **Failure mode.** If the coupon tables or settings cannot be read, the preview answers
  “temporarily unavailable” and never invents a discount; `/api/payu/initiate` creates no
  order and answers `coupon_unavailable` when a code was sent, so checkout proceeds
  normally once the code is removed. An unverified discount is never applied.
- **Retiring a code.** Archiving is the only retirement path and a coupon row is never
  removed. `DELETE /api/store-admin/coupons/[id]` refuses with **409** (`code:
  coupon_in_use`, *“This coupon has usage history and cannot be deleted. Archive it
  instead.”*) when the coupon has **any** redemption — RESERVED, CONSUMED or RELEASED. An
  unused coupon is archived instead of deleted and the route answers `200 { archived: true,
  deleted: false }`. Either path writes a `coupon.archive` audit row, and the explicit
  **Archive** action on the detail page goes through the same status route as before.
- **POS never uses coupons.** No POS route or rule file mentions a coupon; a source guard
  in the tests enforces it.
- **Settings.** Payments → **Coupons** holds `coupons_enabled` (on by default; off hides
  the box and refuses codes at Pay without touching existing orders) and
  `refunds_restore_coupon` (off by default).
- **Evidence.** `tests/coupon-rules.test.mjs` (percent floor and cap, fixed, free shipping,
  scopes with mixed carts, sale exclusion and its exact message, minimum order, ₹1 floor,
  zero-benefit refusal, never-negative, allocation, messages, admin parsing/audit masking,
  code generation), `tests/coupon-db-integration.test.mjs` (limits, customer history,
  scopes by product/category/brand on a mixed cart, the row-lock race, the full lifecycle,
  late-payment restore and review flag, refund restore, archive-on-delete for unused and
  used codes), `tests/coupon-order-integration.test.mjs` (real `createOrderUsing`: free
  shipping zeroes shipping, the order total and the PayU amount and the refund cap; sale
  lines skipped; scoped allocations; a no-benefit code writes no order and no redemption)
  and `tests/coupon-guards.test.mjs` (migration RLS, route guards/audit, DELETE
  semantics, preview leaks and message pass-through, storefront wiring, POS isolation,
  notifications).
- **Migration.** `0041_coupons.sql` creates `coupons`, `coupon_targets` and
  `coupon_redemptions`, all with RLS enabled and no policies; adds `orders.coupon_id`,
  `orders.coupon_snapshot`, `order_items.discount_paise` and its bounds check. Additive
  only.

---

### 2.19 Maintenance mode — 🟢 Live

Owner-only, on Settings → Business & maintenance. Before this change the four keys were
stored and editable but **nothing read them**; the storefront had no maintenance page.

- **When it is on.** `maintenance_enabled = on` **and**, if a window is set, the database
  clock (`now()`) is inside `maintenance_starts_at` … `maintenance_ends_at` (inclusive
  start, exclusive end). With no window, the toggle alone decides. The window is typed as
  `datetime-local`; Postgres resolves it with `… at time zone <store timezone>`, so both
  sides of the comparison are absolute.
- **What customers see.** Blocked page requests are answered **503** with a
  `Retry-After` header and the maintenance page body (`renderMaintenanceDocument`), so
  search engines keep the URL. `/maintenance` is also a real page (noindex, same copy,
  same view model) that staff can preview. Blocked purchase APIs
  (`/api/payu/initiate`, `/api/coupons/validate`, `/api/catalog/availability`,
  `/api/account/*`) answer 503 JSON with the same message; `/api/payu/initiate` creates
  no order and holds no stock.
- **What is blocked.** `/`, `/shop/*`, `/in/shop/*`, `/search`, `/cart`, `/bag`,
  `/checkout`, `/auth`, `/account/*`, `/support`, `/android` and the purchase APIs above.
  `/privacy` and `/terms` stay reachable on purpose. The Education Store is untouched.
- **Badge.** `SCHEDULED` means the toggle is on and the start is still in the future; a
  window that has already ended shows `OFF`.
- **What always works.** `/store-admin` and `/api/store-admin/*`, public media
  (including `/api/admin/media/*`), every PayU callback (`success`, `failure`, `cancel`, `webhook`,
  `reconcile`), the order result pages (`/order/success|failed|cancelled|processing|status`),
  `/api/media/*`, `/maintenance`, `_next`, favicon, robots and static assets. An
  in-flight payment therefore settles and shows its result; `tests/maintenance-integration.test.mjs`
  pays an order through the callback path with maintenance on.
- **Fail open.** No database, a query error or an unparseable row all leave the store up.
- **Cheap.** One query per 5 seconds (`MAINTENANCE_CACHE_MS`), cleared immediately when a
  maintenance setting is saved; the settings route also revalidates the layout.
- **Admin.** A LIVE / SCHEDULED / OFF badge and a “Preview maintenance page” link appear
  on Settings → Storefront; the same small badge is on the Overview. The toggle stays
  owner-only, audited like every other setting.
- **Tests.** `tests/maintenance.test.mjs` (23 tests: window boundaries, every blocked and
  allowed path, fail-open parsing, badge, copy escaping, owner-only, callback wiring) and
  `tests/maintenance-integration.test.mjs`.

### 2.20 Store pickup — ⛔ Not available (locked off)

Checkout has no delivery-method choice, so pickup could never work. It is now impossible to
turn on by mistake:

- **Setting.** `pickup_enabled` defaults to `off`, is rendered disabled on Settings → Orders
  with “Store pickup is not available yet”, and `validateSettingValue` refuses every value but
  `off`, so a crafted request cannot bypass the disabled control. Migration
  `0042_pickup_off.sql` forced the stored value to `off` and wrote an audit row
  (`settings.update`, actor `system`).
- **Server.** No server code reads the setting; `pickupEnabled()` returns `false`
  unconditionally, so a stored `on` could never create behaviour in checkout, shipping quotes
  or anywhere else.
- **Copy removed.** The “Pickup: Check availability” row and the “Store Pickup / Gadzio
  Experience Center” modal were removed from `ProductDetailPage.tsx` and
  `AccessoryDetailPage.tsx`. A search of the storefront, notification templates, receipts,
  invoices and admin screens found no other offer of pickup (“pick up where you left off” on
  Saved Items is unrelated and stays).
- **Tests.** `tests/pickup-off.test.mjs`.

### 2.21 Notification checks (mail and SMS proof)

Before this, no real message had ever been sent and there was no way to prove the setup.

- **Settings → Mail (owner only, 5 per hour per owner, same-origin checked, audited).**
  *Check connection* runs the SMTP verify (host, port, encryption, login) and sends nothing.
  *Send test email* sends a message labelled `[TEST]` to an address the owner types.
  *Send test SMS* goes through the configured gateway. Results are one of a fixed set of
  plain sentences (sent, not configured, bad credentials, connection refused, timeout, TLS
  problem, DNS failure, DLT required …). Only error *codes* are read, so a secret, host, user
  name or stack trace cannot reach the response. Audit rows hold the outcome code and a
  masked recipient. Route: `POST /api/store-admin/mail-check`.
- **Configuration status.** Names only: which environment variables and settings are present
  or missing, plus the last 10 outbox rows (event, channel, status, reason).
- **MSG91 and India DLT.** New setting `sms_dlt_template_id`, sent as `DLT_TE_ID`. Without it
  MSG91 sending is `SKIPPED` and the test SMS says a DLT template is required.
- **`npm run check:notifications`** (`scripts/check-notifications.mjs`, no server needed):
  loads `.env.local`, lists which credentials exist, renders every event × channel × audience
  template (and stored email templates) with sample data, fails on an unresolved or unknown
  placeholder, `undefined`/`NaN` or a secret value, runs the SMTP verify when it can, checks
  the matrix, writes an HTML preview of every email to `tmp/notification-previews/`
  (git-ignored) and prints a pass/fail table. It sends nothing unless `--send-to <address>`.
- **Tests.** `tests/notification-checks.test.mjs`.
- **Actual readiness run, 31 October 2026:** 3 passed, 5 failed; no message sent.
  Database access, 102 template renders and one customer-email matrix cell passed.
  Email is blocked by a non-SMTP driver, missing SMTP host and `MAIL_PASSWORD`.
  SMS is off; `MSG91_AUTH_KEY` and Twilio credentials are missing. No staff-email
  or customer-SMS cells are enabled. To activate delivery, configure SMTP driver,
  host, port, encryption, login and From identity plus `MAIL_PASSWORD`; enable the
  intended matrix cells. For SMS, enable one gateway and its environment credentials,
  and configure approved sender/DLT template for MSG91. Re-run connection checks,
  then deliberately send to an owner-selected test recipient. A script exit code of
  zero does not mean these readiness checks passed.

**Deliverability (DNS for the From-address domain).** SPF: one TXT record listing your SMTP
provider’s include. DKIM: publish the selector TXT/CNAME records your provider gives you and
turn signing on. DMARC: a TXT record at `_dmarc.<domain>`, start with `p=none` and an `rua`
mailbox, tighten to `quarantine` once reports are clean. Send from an address on that domain.

---

## 3. Store admin (`/store-admin`)

### 3.0 Sign-in, sessions and roles — 🟢 Live

- **Login:** `/store-admin/login` → `POST /api/store-admin/auth/login` (the only public
  route in this tree). Email + password, bcrypt comparison, generic error message.
- **Session:** a random token stored hashed in `store_admin_sessions`, carried in the
  `store_admin_session` cookie. The session row records the role, so a demotion or
  deactivation takes effect immediately.
- **Temporary passwords:** an owner can create staff with a generated password and
  `must_change_password = true`; the panel forces a change before anything else.
- **Roles:**
  - `store_viewer` — read-only.
  - `store_admin` — everything except owner-only actions (staff changes, maintenance).
  - `store_owner` — everything, including staff and destructive settings.
- **Every** API route in `src/app/api/store-admin/**` calls `requireStoreRole(...)`;
  every mutating route also calls `assertSameOrigin(request)`. The checker script verifies
  this mechanically: 87/87 guarded.
- **Current data:** 1 store admin (an owner).

### 3.1 Overview — 🟢 Live

- **Route:** `/store-admin`
- **What it does:** date-ranged dashboard with four blocks:
  - **Sales:** revenue, captured orders, average order value, units sold; revenue over
    time; sales by category; top products; channel mix.
  - **Customers:** new customers, active buyers, repeat rate, signed-in sessions; new
    customer chart; checkout mix (registered vs guest); top customers.
  - **Payments:** captured, failed, pending, refunded; payment outcomes by status;
    captured revenue by method; recent transactions.
  - **Funnel:** order-status funnel.
- **How it works:** all figures are SQL aggregates over `orders`, `order_items`,
  `order_payments`, `refunds`, `users` and `user_sessions`, scoped by the selected range.
  Revenue counts paid orders only.

### 3.2 Sales

#### Orders list — 🟢 Live
`/store-admin/orders` — searchable, filterable table (status, channel, date range, payment
method), saved views, CSV export through `/api/store-admin/orders/export`. Pages are
server-rendered from the database.

#### Order detail — 🟢 Live
`/store-admin/orders/[txnid]` shows customer, address (masked until revealed), items,
money breakdown, payment history, delivery, notes, status history and the action panel.

| Action | API | Behaviour |
|---|---|---|
| Reveal PII | `/orders/[txnid]/reveal` | Returns the unmasked address/phone/email and writes an audit row. |
| Add note | `/orders/[txnid]/notes` | Internal notes only, never shown to the customer. |
| Record payment | `/orders/[txnid]/payments` | Manual/POS payment against an order. |
| Refund | `/orders/[txnid]/refund` | Manual refund record; **no PayU refund API call**. |
| Void | `/orders/[txnid]/void` | Voids an uncaptured payment. |
| Cancel | `/orders/[txnid]/cancel` | Cancels with a reason from `cancellation_reasons`, restores stock. |
| Delivery | `/orders/[txnid]/delivery` | Records courier/self delivery, tracking number/slot. |
| Fulfilment | `/orders/[txnid]/fulfilment` | Moves the order along its allowed status transitions. |

Status transitions are validated by `order-rules.ts`; illegal jumps are refused server
side, not just hidden in the UI.

#### Courier pickup and shipment visibility — implemented 2026-11-02

The Fulfilment panel shows the complete workflow:
**Pending → Accepted → Preparing → Pickup done / In transit → Delivered**.
These labels reuse `PENDING → ACCEPTED → PROCESSING → ON_THE_WAY → DELIVERED`;
there is no new database status or migration. Pickup here means courier collection
from the store, not customer store pickup. Self delivery uses **Dispatched / Out for
delivery** and **Mark dispatched** instead.

- Staff can take only the next legal step: **Accept order**, **Start preparing**,
  **Mark pickup done**, then **Mark delivered**. Acceptance still requires payment
  `PAID`. Viewers see read-only progress. Cancellation is separate, requires a reason,
  and remains owner-only after pickup.
- Before pickup, use **Prepare shipment** to save method, courier name, required
  tracking number, optional HTTPS tracking link, expected delivery date and slot
  (or the existing delivery-person fields for self delivery). Saving does **not**
  mark pickup. The pickup action requires valid, persisted delivery details.
- The admin Shipment summary, signed-in customer order detail/live payload and
  owner-visible `/order/status` reveal shipment metadata only from pickup onward.
  Preparing a tracking label alone does not expose it. Fulfilment history preserves
  shipment visibility after a later cancellation; payment history cannot prove pickup.
  Shipping address and charges remain available before pickup. Summary-token visitors
  remain summary-only, and customer snapshots omit private delivery-person contacts.
- Existing recorded pickup/dispatch time is shown in the admin summary when present;
  no historical timestamp, carrier event, live tracking integration or ETA is invented.
- Paid-order automation stops at **Preparing**, including legacy later defaults.
  Settings only offer Pending, Accepted and Preparing for automation. Existing orders
  and stored defaults are not rewritten. Shipped/delivered notification mappings stay
  tied to their existing fulfilment transitions.

**Verification:** `npm run typecheck` passed; 110 focused tests passed across pickup,
shared order rules, automation/settings, customer shipment/live snapshots, notifications,
tracking templates and payment-recovery/processor regression tests. Account route checks
(20 APIs / 11 pages), store-admin route checks (104 routes), the admin boundary check and
CRLF-aware diff whitespace check passed. Local HTTP smoke reached the status page (200),
redirected unauthenticated admin/customer order pages to sign-in (307), and rejected an
unauthenticated pickup request (401). No actual order transition, real notification or
SQL integration test was performed; the authenticated end-to-end workflow is untested.

#### Tracking links — 🟢 Live
`/store-admin/orders/[txnid]/delivery` accepts a courier name and tracking number. If no
explicit URL is supplied, `src/lib/store-admin/orders.ts` looks up an **active**
`fulfilment_providers` row whose `name` matches the courier, then
`buildTrackingUrl(template, number)` substitutes `{tracking}` (percent-encoded) and
validates that the result is HTTPS. An explicit URL always wins. Templates that lack the
token, use HTTP, or embed credentials are rejected at save time and again at apply time.

#### Documents — 🟢 Live
- `/store-admin/orders/[txnid]/invoice` — invoice with the store header and footer from
  settings. **Owner only**; other roles see a message asking the owner to print.
- `/store-admin/orders/[txnid]/packing-slip` — packing slip, also **owner only**.
- Both use `PrintButton`, `DocumentHeader` and server-side `order-documents.ts`. The header
  reads `trade_name`, `address`, `phone` and `email`; the footer reads `receipt_footer`.
  The invoice reference is the order’s `txnid` — the prefix/numbering settings are not
  used here (see §3.6).

#### POS — 🟢 Live
- **Routes:** `/store-admin/pos`, `/store-admin/pos/end-of-day`,
  `/store-admin/pos/receipt/[txnid]`.
- **What it does:** in-store selling. Search the catalogue, build a basket, type the
  selling price on every line, take a payment (cash/UPI/card recorded manually), print a
  receipt, close the shift.
- **How it works:** `POST /api/store-admin/pos/sales` creates an order with
  `channel = 'pos'`, decrements stock and writes payment rows. `pos_shifts` records the
  opening/closing float and totals. The catalogue comes from the database through
  `/api/store-admin/pos/catalog`, and its price is a **reference only**: a new line's
  Price box starts empty and focused and is never pre-filled. `order_items.unit_price_paise`
  stores the integer paise the cashier typed; `reference_price_paise` keeps the regular
  catalogue price at that moment for comparison. The sale resolver, storefront prices and
  online checkout are never read or written by this path, so sale mode starting or ending
  mid-bill does not change a typed price.
- **Confirmations:** a blank price blocks the sale with “Enter the selling price”. A zero
  price needs an explicit free-item confirmation. A price above 10× list or below cost
  asks “Confirm this price?”; the answer can only confirm or edit the price, never block a
  confirmed one. The prompt is controlled by Settings → Orders → **Confirm unusual POS
  prices** (`pos_confirm_unusual_price`, on by default).
- **Audit:** each sale writes `pos.price_entered` with the product, reference price and
  charged price; customer contact values are not copied into the audit row.
- **Caveat:** POS orders never touch PayU and are not visible to the customer account.
  A zero-total free sale has no `order_payments` row (that table requires a positive
  amount); the order is still PAID with its receipt number.

#### Returns and requests — 🟢 Live
- `/store-admin/returns` and `/store-admin/returns/[id]` — approve, receive, refund,
  reject. Uses `return_items`; the reason list comes from `cancellation_reasons`.
- `/store-admin/requests` and `/store-admin/requests/[id]` — the customer requests from
  §2.10, with allowed status transitions.
- Refunds are **records only**; the money movement is done manually in the PayU dashboard
  or by bank transfer.

#### Payments review — 🟢 Live
`/store-admin/payments` lists recorded payments needing review (mismatched amount,
missing reference) and lets staff mark them reviewed through
`/api/store-admin/payments/[id]/review`. Audited.

A second table, **Captured payments needing attention**, lists orders whose late PayU
capture could not re-claim its released stock (§2.14). It shows the order, capture time,
the fixed reason and how long it has waited; `store_admin` and above can mark it reviewed
through `POST /api/store-admin/payments/review-flag` (same-origin checked, audited as
`payment.review_cleared`). Reviewing clears the flag and records who and when
(`payment_reviewed_at/by`); it does not move stock or money, and the page says so.

A third, read-only table, **Refunds owed**, lists every `refund_obligations` row still
`PENDING` (§2.15): order, amount, fixed reason and how long it has waited, with the total
owed in the panel head. It closes itself when refunds recorded against the order cover the
amount (Returns → record refund, which stays a manual money movement).

### 3.3 Catalog

| Screen | Route | Status | Notes |
|---|---|---|---|
| Products list | `/products` | 🟢 Live | Filter, search, CSV export, status badges, **Sale price** column |
| Sale | `/sale` | 🟢 Live | Switch + store-local window, SALE LIVE/SCHEDULED/OFF badge, inline and bulk sale prices, pre-flight stock/cost warnings |
| Coupons | `/coupons`, `/coupons/new`, `/coupons/[id]` | 🟢 Live | List/filter/CSV, create/edit, pause/resume/duplicate/archive, bulk generate, usage log and totals |
| New product | `/products/new` | 🟢 Live | Full create form |
| Edit product | `/products/[id]` | 🟢 Live | Details, price + sale price, cost, images, variants, attributes, specs, **Inventory** card |
| Price history | same page, `price` API | 🟢 Live | Every price write appends to `price_history`, tagged `regular` / `sale` / `sale_cleared` |
| Variants | `.../variants` API | 🟢 Live | SKU, options, stock |
| Images | `.../images` API | 🟢 Live | Ordered gallery, archive rather than hard delete |
| Categories | `/categories` | 🟢 Live | CRUD |
| Collections | `/collections` | 🟢 Live (no consumer yet) | Named, ordered product lists in `product_collections`; add, remove (archive), reorder |
| Brands, units, conditions, attributes | `/catalog` tabs | 🟢 Live | CRUD through catalog APIs |
| Stock | `/stock` | 🟢 Live | Per-product summary, tracked Yes/No, Adjust link, **Tracking off** filter |
| Stock adjust | `/stock/[productId]` | 🟢 Live | Append-only `stock_movements`, reason required |
| Low stock | `/low-stock` | 🟢 Live | Available ≤ the product's own `stock.low_stock_threshold` |
| Catalogue data transfer | `/catalog/transfer` | 🟢 Live | CSV import/export with `sale_price`, per-row error report |
| Reviews | `/reviews` | 🟢 Live | Approve/reject/hide product reviews |
| Media | `/media` | 🟢 Live | Upload to Supabase Storage; `/api/media/[id]` redirects to the public object URL |

**Price editing gate:** the PayU flow now reads prices from the database
(`src/lib/payu/db-catalog.ts`), which was the condition in the design. Price writes are
therefore enabled. `cost_paise` is internal and never sent to the storefront.

**Sale screen:** `/store-admin/sale` is its own sidebar entry (Catalog group, after
Products), not a Settings tab. The status badge is computed on the database clock and
the same badge appears on Overview. Writes go through
`PATCH /api/store-admin/sale` (switch + window) and `POST /api/store-admin/sale` (bulk
percent or clear). Both call `assertSameOrigin`, require `requireStoreRole('store_admin')`,
write a `sale.settings` / `sale.bulk` audit row and call `revalidateCatalog()`. The
inline per-product sale price uses the existing price route, so it has the same
validation, audit and `price_history` behaviour as the product page. Pre-flight warnings
list products on sale whose tracking is off, whose available count is zero, or whose
sale price is below cost; none of them blocks the write.

**Coupons screen:** `/store-admin/coupons` is a Catalog sidebar entry after Sale. The
list shows a derived badge computed in SQL on `now()` (Active, Scheduled, Expired, Used
up, Paused, Archived), uses/limit, minimum order, window, search and status filter, CSV
export and a **New coupon** button. The detail page shows the four numbers that matter —
used, remaining, discount given and order revenue — the target list and the complete
redemption log (including released rows and their reason). Create, edit, pause, resume,
duplicate (fresh generated code, paused) and archive go through
`/api/store-admin/coupons/**`; bulk generate creates 1–500 unique codes with a shared
definition, copies them or downloads a CSV. Reads need `store_viewer`, writes
`store_admin`; every route calls `assertSameOrigin` and `writeAudit`, and the audit
records counts of restricted emails/groups, never the addresses. An archived coupon is
read-only. `DELETE` on a coupon never removes the row: it answers 409 when the code has
any redemption and archives an unused code instead (§2.18).

**Inventory controls:** the product page's **Inventory** card shows on hand, reserved
and available (= on hand − reserved), a Track inventory toggle and the low-stock
threshold, with an **Adjust stock** link to the movement ledger. The stock list shows
tracked yes/no, the same counts, an Adjust button per row and a **Tracking off** filter;
the products list badges every active product whose tracking is off as **Can be
oversold** and shows a count banner. Turning tracking **on for a product with no stock
row requires the current on-hand count**; it is stored as an opening `receipt`
movement, so every unit still has a paper trail. Turning tracking **off** asks for
confirmation and warns that the product can be oversold, and is audited as
`catalog.stock.settings`. Reads need any store role; the write route keeps
`requireStoreRole('store_admin')` and `assertSameOrigin`. Variants have no stock of
their own: stock rows are product-level (`variant_id is null`), so there is no
per-variant inventory control to duplicate.

**Collections:** `/store-admin/collections` and
`/api/store-admin/catalog/collections` write `product_collections` (migration `0033`,
RLS enabled, no policies). Writes require `store_admin`, call `assertSameOrigin`, and are
audited as `catalog.collection.add/remove/reorder`; every write revalidates the
`storefront-collections` cache tag and the root layout. `src/lib/storefront/collections.ts`
reads one key server-side: database membership wins whole, and the caller's coded/CMS
list is used only when the collection is empty. No storefront page consumes it yet.

**Storefront wiring:** catalog edits now change what customers see on the next request —
product detail, the six accessory category pages, both Cases & Protection routes, search
and the bag refs all read the database through `src/lib/storefront/catalog.ts`. Every
catalogue-changing write (product create/edit/price, variants, images, attributes,
categories, CSV import, stock settings/adjust, POS sale, order void/cancel, return
receipt, review status) calls `revalidateCatalog()` after its audit row. Reads carry the
`storefront-catalog` tag plus `storefront-product:<id>`; `{ expire: 0 }` makes the next
request a blocking refresh. See §2.13 for the exact edit → effect table and the few
things deliberately left unwired because they have no existing UI.

### 3.4 Customers

| Screen | Route | Status | Notes |
|---|---|---|---|
| Customers | `/customers` | 🟢 Live | List, search, group, status, export |
| Customer detail | `/customers/[id]` | 🟢 Live | Orders, addresses, notes, sessions |
| Notes | API | 🟢 Live | Internal notes |
| Status | API | 🟢 Live | Activate/deactivate the account |
| Reveal | API | 🟢 Live | Unmasks PII, audited |
| Sessions | API | 🟢 Live | List and revoke customer sessions |
| Anonymise | API | 🟢 Live | GDPR-style scrub; orders keep an anonymous reference |
| Accounts | `/customers/accounts` | 🟢 Live | Registered vs guest summary |
| Subscribers | `/customers/subscribers` | 🟢 Live | `newsletter_subscribers`, add/export/remove |
| Settings | `/customers/settings` | 🟢 Live | Three settings, **all consumed by the storefront** |

**Customer settings that actually do something**

| Setting | Default | Effect |
|---|---|---|
| `guest_checkout` | off | When off, `/checkout` and `/api/payu/initiate` reject anonymous customers. |
| `checkout_marketing_optin` | off | When off, the checkbox is hidden and opt-ins are ignored even if posted. |
| `default_customer_group` | retail | New sign-ups are assigned this group (`retail` / `vip` / `wholesale`). |

### 3.5 Reports and Expenses

- **Reports:** `/reports` hub and `/reports/[report]`. Eleven reports exist:
  Order, Item-wise, Day-wise, Transaction statement, Payment reconciliation, Expense,
  Stock, Low-stock, Customer, Category & brand, and **Coupon usage**. Each supports date
  range, channel, status, category and brand filters where relevant, plus CSV export.
  The Transaction statement additionally offers an exact, case-insensitive payment
  method filter (for example `cash`, `upi` or `card`), shared by its table and CSV.
- **Revenue definition:** order-level revenue — Overview, Sales list Amount, and the
  Order, Day-wise and Customer reports — is the order total as charged
  (items − discount + shipping), with the rupee `amount` fallback for orders created
  before migration `0014`. Only `PAID` orders whose fulfilment is not `CANCELED`
  qualify; failed, pending, processing and cancelled orders never count. The Item-wise
  and Category & brand reports sum line totals **minus line discounts**, excluding
  shipping. Refunds are separate from gross revenue; sales Net subtracts refunds on
  qualifying orders by refund-recorded day, never expenses or refunds of excluded sales.
- **Coupon usage** (`/reports/coupon-usage`, CSV at
  `/api/store-admin/reports/coupon-usage/export`): one row per redemption in the date
  range, optionally filtered to one code. `Redemptions` counts every ledger row
  (`RESERVED` and `CONSUMED`) because both hold a use; `Discount` and `Order revenue`
  count **`CONSUMED` uses on qualifying captured orders only** — revenue is the order total, which is already net of the
  discount, and the discount column is the coupon's own share of that order. `RELEASED`
  rows stay visible with their state so a cancelled checkout is never read as money.
  Customer emails are masked in the page and the CSV. The list is capped at 2,000 rows and
  says when it is truncated.
- **Expenses:** `/expenses`, `/expenses/new`, `/expenses/[id]`, with
  `/api/store-admin/expenses/categories`. Expenses feed the expense report and the
  profit view. Currently 0 rows.

- **Clock and report definitions (Task 4).** Date filters include both selected store
  days (start inclusive, next midnight exclusive). Defaults use database `now()`;
  buckets and displayed report dates use the `timezone` setting, including DST.
  A missing database clock is an error, not a substitute host-clock date.

  | Report / Overview block | How this is calculated |
  |---|---|
  | Order | All orders by creation day/week/month; captured totals include shipping and subtract discounts; Net subtracts qualifying refunds by recorded day. |
  | Item-wise | Captured line quantities and charged line totals minus discounts by order creation day; no shipping or monetary refund subtraction; approved/received/refunded return quantities use request creation day. |
  | Day-wise | Captured order totals and AOV by creation day, sign-ups by account creation day, qualifying refunds by recorded day; no expenses. |
  | Transaction statement | Cash view: manual/POS payment rows plus PayU order fallback, without duplicate fallback when payment rows exist; settled receipts minus all recorded refunds, including cancelled sales. |
  | Payment reconciliation | Orders created in range with payment activity; Expected is PAID order total, Recorded is manual/POS payments marked PAID, Refunded includes all order refunds; gateway references are compared separately. |
  | Expense | Non-deleted expenses by spent-on date and category; no sales, shipping, coupons or refunds. |
  | Stock | Current product-level on-hand/reserved/available; retail value uses list price and cost value omits missing costs; date range does not rewind inventory. |
  | Low-stock | Current tracked availability at/below threshold; reorder is max(1, twice threshold minus availability); last movement is shown in store time. |
  | Customer | Captured orders by creation day, grouped by account, else email, else individual walk-in order; new buyers have no earlier captured order; gross charged revenue includes shipping and discounts, no refunds/expenses. |
  | Category & brand | Captured line totals minus line discounts by creation day, each rolled up independently; no shipping, monetary refunds or expenses, and the two rollups must not be added together. |
  | Coupon usage | Redemptions by redemption creation day; held uses count RESERVED/CONSUMED, money counts only CONSUMED uses on captured orders; charged revenue includes shipping, no refund subtraction. |
  | Overview Sales | Captured order totals, units and AOV by order creation day; same gross revenue definition as reports; qualifying refunds shown separately by recorded day. |
  | Overview Customers | Sign-ups and sessions by their creation day; buyers/repeat buyers and top customer revenue from captured orders created in range. |
  | Overview Payments / status funnel | Order creation-day status counts and amounts; all fulfilment-cancelled orders appear as CANCELLED so unpaid cancellations are not pending and PAID agrees with Sales; all refunds use recorded day; not a tracked browsing/conversion funnel. Method buckets use settled payment methods (mixed for multiple instruments), then gateway mode, then order method; they attribute the charged order total, not cash collected. |

  The persistent known-total checks are in
  `tests/reports-correctness-integration.test.mjs`, with independent JavaScript
  expectations, IST midnight/month boundaries, typed POS prices, coupons, refunds,
  returns, filters, pagination, CSV reconciliation and formatting. Pure timezone,
  DST and clock checks are in `tests/report-timezone.test.mjs`.

  **Recovered baseline and corrected results (31 October 2026):** the same independent
  dataset at committed baseline `42c363f` passed 18/80 leaf checks and failed 62.
  The corrected implementation passes those original checks; additional regressions
  cover historical-sale returns, unpaid cancellations, actual gateway instruments,
  split instruments, payment-attempt dates and payment-method filtering.
  Money below is integer paise.

  | Check | Expected | Baseline actual | Corrected actual |
  |---|---:|---:|---:|
  | Order cancelled count | 3 | 2 | 3 |
  | Order qualifying refunds | 248000 | 538000 | 248000 |
  | Order net revenue | 3104665 | 2814665 | 3104665 |
  | April 1 inclusive order count | 7 | 6 | 7 |
  | Item net line revenue | 3342765 | 3491217 | 3342765 |
  | Transaction settled payment count | 13 | 14 | 13 |
  | Underpaid POS reconciliation | Unmatched | Matched | Unmatched |
  | Customer distinct buyer count | 10 | 7 | 10 |
  | Coupon captured consumed discount | 148452 | 158452 | 148452 |
  | Overview today captured revenue | 152450 | 124900 | 152450 |
  | Overview seven-day captured payment count | 7 | 9 | 7 |

  The fixture uses throwaway tables and local sequences. Earlier fixture runs used
  copied serial defaults and may have advanced public sequence counters, but inserted
  no public-table rows. No counter reset was performed. After sequence isolation,
  the final full suite passes **747/747, zero failures and zero skips** after the
  isolation and edge-case fixes; typecheck, production build, all route/boundary/
  settings checks and dependency audit pass (95 guarded store-admin routes,
  8 guarded account routes, zero vulnerabilities). Notification delivery readiness
  remains configuration-blocked as recorded in §2.21, not falsely marked passing.

### 3.6 Settings — 🟢 Live screens, mixed downstream effect

`/store-admin/settings` is a hub with cards. All pages render from the same validation
code the API uses (`settings-rules.ts`, `setting-lists.ts`), so the UI cannot save a value
the server would reject. Every write is audited.

| Page | Route | What it edits | Downstream status |
|---|---|---|---|
| Business | `/settings` | Trade/legal name, support email/phone, address, country, timezone, time format, footer text, receipt footer, cookie notice, logo/favicon media ids | 🟡 `trade_name`, `address`, `phone`, `email`, `receipt_footer` feed documents/receipts; `timezone` controls report and Overview date boundaries and displayed report dates. Other fields remain stored only. |
| Orders | `/settings/orders` | Order prefix, starting number, invoice prefix, auto-confirm, shipping/pickup toggles, free-shipping-over, auto-cancel hours, reservation/failure-grace/unresolved windows, waiting-list toggle + claim window + re-invite cooldown, default fulfilment status, return window, processing/cut-off text, confirm unusual POS prices | 🟢 Prefix/start number, invoice prefix, auto-confirm, default status, auto-cancel hours and return window are consumed at order creation and handling; `shipping_enabled`/`free_shipping_over` feed the shipping quote; the six reservation/waiting-list keys drive §2.15. `pos_confirm_unusual_price` gates the POS typo confirmation. `pickup_enabled` is shown disabled (“Store pickup is not available yet”) and can only be `off` (§2.20); processing/cut-off text stays stored only. POS receipts keep their separate `receipt_counters` table (`RCP-0000007`). |
| Payments | `/settings/payments` | COD/PayU/manual toggles, PayU mode, payment note | 🟡 `payu_enabled` gates initiate and `payment_note` renders under the checkout PayU helper. `cod_enabled` (default off), `manual_payments_enabled`, `payu_mode` and `payment_methods` are stored only — checkout has no method selector. |
| Storefront | `/settings/storefront` | Login heading/subheading, login background media, support link, reCAPTCHA site key + status | 🔵 None consumed by the storefront. The store-admin login page renders its own copy. |
| Mail | `/settings/mail` | Mail driver/status, SMTP host/port/username/encryption, from email/name, SMS gateway/status/sender id/DLT template id (plus owner-only connection check and test sends, §2.21) | 🟢 These settings decide whether the outbox can deliver email or SMS. Secrets stay in environment variables; the page still shows only configured/missing badges. |
| Shipping | `/settings/shipping` | Couriers + tracking templates, shipping methods and rates, live link tester | 🟢 Couriers + tracking templates used at delivery save; rates and free-over thresholds consumed by the checkout quote and the cart Shipping row |
| Notifications | `/settings/notifications` | 114 toggles (19 events × 3 channels × 2 audiences), automated messages, email templates, delivery log | 🟢 Enabled cells queue real messages when their event fires; stored templates render them; the delivery log shows every send, skip and failure. |
| Content | `/settings/content` | Store pages (8) and fixed SEO rows (14) | 🔵 Stored only — no route renders `store_pages`, no metadata reads `seo_pages` |
| Analytics | `/settings/analytics` | Social links, analytics script IDs, integrations (storage/mail/payment/webhook) | 🔵 Stored only |
| Reasons | `/settings/reasons` | Cancellation reasons, refund reasons, return reasons | 🟡 Cancellation reasons are used by the returns/cancel flow; refund and return reason lists are stored only. |
| Staff | `/settings/staff` | See §3.7 | 🟢 |
| Audit log | `/audit-log` | Filter and export the audit trail | 🟢 |

> **Return window; no cancellation window.** The customer return window is the
> `return_window_days` setting (7 when unset, empty or invalid), and its error message
> changes with it. There is still no configurable cancellation window: cancellation
> eligibility is decided from the order’s fulfilment status.

#### Shipping methods — 🟢 Live at checkout
`shipping_methods` supports name, rate, free-over threshold, ETA range and active flag.
Checkout quotes the first active method (sort order, then name); `shipping_enabled` off or
a store-wide `free_shipping_over` threshold short-circuits to free. The quote is stored as
`orders.shipping_paise` and charged by PayU; the cart page shows the same figure in its
existing Shipping row.

#### Notifications and delivery — 🟢 Live
The 72-cell matrix now drives real messages. When a business event fires, the app reads
the enabled cells for that event and writes one row per channel and audience into
`notification_outbox` (migration `0035`, RLS enabled, no policies). Queueing happens after
the business transaction commits and is best-effort: a failed enqueue, a slow SMTP server
or a missing provider can never roll back an order, payment callback or request update.
Only the customer's order-visible data reaches a template; both audiences get their own
link (`/order/status?txnid=…` for the customer, `/store-admin/orders/…` for staff).

**Message timing.** Customer order confirmation should use the `payment_received` cell,
not `order_placed`. `order_placed` fires when PayU checkout creates the order, before the
money is confirmed, so it can only honestly say “we have your order, awaiting payment”.
The matrix itself is unchanged; this is how to choose the cell.

| Matrix event | Fires when | Code |
|---|---|---|
| `order_placed` | PayU checkout creates the order | `src/app/api/payu/initiate/route.ts` |
| `payment_received` | The first verified PAID transition (callback or reconcile) | `src/lib/payu/process-response.ts`, `reconcile.ts` |
| `processing` | Fulfilment moves to `PROCESSING` | `orders/[txnid]/fulfilment/route.ts` |
| `shipped` | Fulfilment moves to `ON_THE_WAY` (with tracking number/link) | same |
| `delivered` | Fulfilment moves to `DELIVERED` | same |
| `cancelled` | Admin cancel, PayU failure/auto-cancel, approved customer cancel | cancel + reconcile + requests routes |
| `refund_requested` | A customer opens a return/refund request, or staff creates one | account requests + `store-admin/returns` |
| `refund_completed` | A refund is recorded | refund routes |
| `back_in_stock` | Available stock crosses up from 0 | `stock/[productId]/adjust` |
| `low_stock` | Available crosses down through `low_stock_threshold` | same |
| `password_reset` | A customer or staff password is changed | `account/password`, `staff/[id]/password` |
| `staff_invite` | A staff account is created | `store-admin/staff` |

- **Defaults:** only in-app messages to staff start on. Email and SMS stay off until the
  owner turns the cell on *and* configures the provider under `/settings/mail`.
- **Recipients:** customer email/phone come from the order. Staff messages go to the
  business `email` setting; invitations and password resets go to the staff member's own
  address. A missing address/phone creates a `SKIPPED` row with a reason, never silence.
- **Templates:** stored `email_templates` / `automated_messages` win; a missing or empty
  template falls back to a built-in plain default so an enabled cell is never blank.
  Variables are whitelisted (order number, customer name, total, shipping, status,
  tracking, store name, support contact, return window, refund amount, item count, product
  and stock count, relative admin link). Unknown tokens render empty. Email values are
  HTML-escaped; SMS values are stripped of control characters. Tracking links must already
  be `https`. `staff_invite` is a notice only: it says an account was created and links to
  the store-admin sign-in page; the owner shares the password out of band. A password,
  temporary password, token or reset link is not a template variable, so a message can
  never carry one.
- **Delivery:** `processNotificationOutbox()` claims due rows with
  `FOR UPDATE SKIP LOCKED`, marks them `SENDING` with a 5-minute lease, sends with a ~10 s
  provider timeout, then writes `SENT`, or `FAILED` with `attempts + 1` and exponential
  backoff (60/120/240/480 s, capped at 1 h). Five attempts is the cap; a permanently
  invalid recipient is `FAILED` immediately. Two workers never send the same row. A crash
  between send and the status write can repeat one message (at-least-once), never lose one.
- **Dedupe:** the unique `dedupe_key` makes duplicate PayU callbacks, repeated reconcile
  runs and double-clicks harmless. Order-level events are once per order; legitimate
  repeats (multiple return requests, refunds, stock movements, password changes) carry a
  token in the key.
- **Retention:** off by default. With `NOTIFICATION_RETENTION_ENABLED` on, each reconcile
  run clears `body` and `recipient` for `SENT`/`FAILED`/`SKIPPED` rows older than
  `NOTIFICATION_RETENTION_DAYS` (default 90, clamped to 3650). Event, status, masked
  recipient, reason and timestamps remain, so the delivery log still shows that a message
  happened without keeping its content. `QUEUED`/`SENDING` rows are never touched.
- **Visibility:** the page shows counts per status and the recent log (event, channel,
  audience, masked recipient, status, reason, attempts, time), filterable by status.
  `store_viewer` can read; `store_admin` and above can requeue a terminal `FAILED` row,
  which is same-origin checked and audited by message id only.

**What actually sends.** Email needs `mail_driver = smtp`, `mail_status = on`, a host, a
valid From address and `MAIL_PASSWORD`. SMS needs `sms_status = on`, a gateway, a sender id,
and `MSG91_AUTH_KEY` or `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN`. Anything missing leaves
the row `SKIPPED` with a “not configured” reason that names the setting, never its value.
Application logs and `store_admin_audit` contain masked recipients only; a secret never
appears in a log line, an audit row or the admin screen.

**Evidence**

| Rule | Proof |
|---|---|
| Payment success sends one message per order despite duplicate callbacks/reconcile | `tests/notifications-enqueue-integration.test.mjs` (repeat enqueue inserts nothing) + the unique `dedupe_key` |
| Auto-cancel sends the cancellation once | same test file (`cancelled` matrix, two calls, three rows once) |
| A disabled cell creates no row and sends nothing | `tests/notifications-enqueue-integration.test.mjs` |
| Guest with email only: email queues, SMS is `SKIPPED` with a reason | `tests/notifications-enqueue-integration.test.mjs` |
| Missing mail configuration never breaks checkout | `tests/notifications-providers.test.mjs` + enqueue swallows every error; `notifications-enqueue-integration.test.mjs` drops the settings table and asserts a no-op |
| Template escaping and unknown variables | `tests/notifications-templates.test.mjs` (`<script>` escaped, unknown token empty, header injection blocked, only `https` links) |
| Retry/backoff stops at the cap; two workers never share a row | `tests/notifications-outbox-integration.test.mjs` (`FOR UPDATE SKIP LOCKED`, attempts, terminal `FAILED`) |
| No secret or full PII in errors/logs/audit | `tests/notifications-providers.test.mjs` (missing secret named, never echoed); masked recipient in `recipient_masked` and the audit retry row |
| No message can carry a password, token or reset link | `tests/notifications-templates.test.mjs` renders all 12 events × 3 channels × 2 audiences with secret markers and finds none; `tests/notifications-enqueue-integration.test.mjs` stores `{{token}} {{password}} {{temporary_password}} {{reset_link}}` in a template and every outbox row renders them empty |
| Staff invite is a notice, never a credential | `tests/notifications-templates.test.mjs` (absolute `/store-admin/login` link, “password the owner shared”, no secret) |
| Old finished messages lose body and recipient but keep the audit trail | `tests/notifications-outbox-integration.test.mjs` (terminal rows scrubbed, `QUEUED`/recent kept, masked recipient and status stay, rerun is a no-op) + `tests/notifications-rules.test.mjs` (off by default, 90-day default, 3650 clamp, exact cutoff) |

**Known limits.** Indian transactional SMS through MSG91 requires a DLT-registered
template id. The `sms_dlt_template_id` setting now exists, is sent as `DLT_TE_ID`, and MSG91
sending stays `SKIPPED` (“needs an India DLT template id”) until it is filled in, so a send
is never reported as working when carriers would drop it. Manual stock adjustments — a
product-level row or a single option — do raise low-stock and back-in-stock alerts
(§ Phase 7); the POS in-store sale path and sale/refund-induced low-stock crossings still
do not, nor does a later edit to delivery
details after `shipped` (the first message already carried the tracking data). There is no
customer “forgot password” flow to notify. Staff in-app messages are marked `SENT` and are
visible in the delivery log but have no separate inbox screen; a customer in-app cell has
no destination and is `SKIPPED`.

#### Content pages and SEO — 🔵 Stored only
`store_pages` holds eight pages (about, contact, FAQ, policies, etc.). They are edited and
saved but no `/pages/[slug]` route exists. `seo_pages` holds metadata for fourteen keys and
no page reads them; storefront metadata is still hard-coded in each `page.tsx`.

### 3.7 Staff — 🟢 Live

- **Route:** `/settings/staff`; APIs under `/api/store-admin/staff/**`.
- **What it does:** create staff, change name/phone, change role, deactivate, permanently
  remove an account, reset passwords, and view/revoke sessions.
- **Permanent removal (migration 0043):** owner-only, no self-removal or removal of the
  last active owner. Two sequential confirmations require the exact email, verified again
  by the server. A transaction revokes all sessions, deletes preferences, clears personal
  and authentication data, frees the original email and writes an audit entry. An opaque
  anonymized tombstone is retained because historical foreign keys (including immutable
  refund/order-edit records and non-null shift attribution) prevent safe hard deletion.
  Removed accounts are excluded from staff reads and cannot be restored. Audit screen/CSV
  projections show “Removed staff member” without rewriting append-only history.
- **Live session enforcement:** page requests and API guards recheck active/nonremoved
  accounts against database expiry. Session issuance locks/rechecks the account against
  concurrent removal, deactivation or password resets. Open pages check immediately,
  every 30 seconds, on focus and when visible via `/api/store-admin/auth/session`.
  Revoked sessions go to login with “Your account was removed or deactivated. Contact
  the store owner.” Role changes/reset sessions are picked up by these checks.
- **Temporary-password gate:** `/store-admin/change-password` sits outside the protected
  shell. Every other page/API is blocked until completion, except session check, logout
  and the password-change API. Current/new/confirmation fields have show/hide controls
  and shared live/submit/server validation: minimum 8 characters, maximum 72 UTF-8 bytes,
  matching confirmation, a different new password, and correct current password.
  The same form is used on My profile. Success atomically clears the flag, revokes other
  sessions and audits the change, then displays a dashboard success notice.
- **Task 5 verification:** isolated-schema PostgreSQL fixtures verify removal, email
  reuse, session rejection, immutable history and password/session changes; unit and
  source-contract tests cover removal rules, rollback, exact password messages,
  confirmations and audit redaction. Executable mocked-runtime tests exercise API role/
  password gates, login rejection and issuance races, plus immediate/interval/focus/
  visibility monitor checks and redirects. Browser interaction has not been exercised;
  these are not end-to-end browser tests.
  The initial full run hit a PostgreSQL `ECONNRESET`; the final combined rerun passed
  763/763 tests with zero skips. Typecheck, production build, route/account/boundary/
  settings checks and npm audit passed (0 vulnerabilities); notification readiness remains
  blocked as listed in the evidence table, with no messages sent.
- **Rules enforced server side:**
  - only an owner may create or modify staff;
  - nobody can change their own role or deactivate themselves;
  - the last active owner cannot be demoted or deactivated;
  - a new password must pass the shared policy (8+ characters, max 72 bytes).
- **Deactivation is real:** it flips `is_active` **and** deletes that staff member’s
  session rows, so the cookie stops working on the next request.
- **Audit:** every change writes a `store_admin_audit` row; the before/after never contains
  a password or a raw token.

### 3.8 Audit log — 🟢 Live

- **Route:** `/store-admin/audit-log`; API `/api/store-admin/audit`; export
  `/api/store-admin/audit/export`.
- **What it records:** actor, action, entity, before/after JSON, hashed IP, hashed user
  agent, timestamp.
- **PII policy:** `writeAudit()` masks emails, phones and addresses before writing; raw
  PayU payloads are never stored.
- **Immutability:** a database trigger blocks UPDATE and DELETE on `store_admin_audit`.
  There is no code path that removes a row.
- **Current size:** 793 rows, including the rows created during the Phase 9 smoke test
  (append-only means they stay).

### 3.9 My profile — 🟢 Live

`/profile` edits the signed-in staff member’s own name/phone, changes their password, and
lists/revokes their own sessions. Available to every role.

---

## 4. Store Admin → Website (legacy CMS replacement)

| Screen | Route | Access / behaviour |
|---|---|---|
| Website overview | `/store-admin/website` | All staff; saved override metadata and links to shared Media/Audit |
| Content | `/store-admin/website/content/[key]` | All staff read; owner saves/resets; marketing content only |
| Theme | `/store-admin/website/theme` | All staff read; owner saves/resets; global layout revalidation |
| Security | `/store-admin/profile#security` | Own TOTP enrolment, backup codes and password-confirmed disable |
| Media | `/store-admin/media` | Shared library, with image/video picker in Website fields |

Content resets archive `content_blocks` rows, and theme resets archive `site_settings`;
neither deletes values. Writes enforce same-origin, role checks and audit logging
without copying full content or secrets into audit rows. Content writes retain
`validateLegacyContentWrite()` and the `edu.*` exemption.

The editor follows the current storefront, not removed OPPO components. Old-UI-only,
unreachable and nonconsumed fields are labelled or removed from the editable schema;
stored rows are not rewritten. Gadzio section prefills share the components' fallback
values. Crowd Favorites uses display-only `priceDisplay`, with old `price` values
still readable by the storefront; it is not a catalogue price-editing path.
Footer copyright stays in Content, with the Theme field explicitly a homepage override.
Settings → Pages & SEO is labelled as not consumed by the storefront and links here.

**Legacy bookmark compatibility**

| Old path | Result |
|---|---|
| `/admin` | 308 → `/store-admin/website` |
| `/admin/login` | 308 → `/store-admin/login?next=/store-admin/website` |
| `/admin/content/:key` | 308 → `/store-admin/website/content/:key` |
| `/admin/theme` | 308 → `/store-admin/website/theme` |
| `/admin/security` | 308 → `/store-admin/profile#security` |
| Other `/admin/*` | 308 → Website overview |
| Retired `/api/admin/*` | 410 plain moved message, `Cache-Control: no-store`; fixed route/status hit events |
| `GET /api/admin/media/:id` | Retained: shared media first, legacy storage/bytea fallback |
| `GET /api/media/:id` | Retained: nonarchived shared media |

The old UI/auth source is not deleted yet: manual owner content/theme round trips and
migrated-account password/TOTP sign-in must be confirmed first. No session is created
programmatically to bypass that gate. Old credential tables remain untouched; their
backup, credential blanking and eventual removal require a separate approved task.

---

## 5. Settings inventory: consumed vs stored

A single view of every Phase 9 setting.

| Setting / table | Edited in | Consumed by | Status |
|---|---|---|---|
| `trade_name`, `address`, `phone`, `email` | Settings → Business | `DocumentHeader` (invoice, packing slip), POS receipt | 🟢 |
| `receipt_footer` | Settings → Business | Invoice, packing slip, POS receipt footers | 🟢 |
| `legal_name`, `country`, `timezone`, `time_format`, `footer_text`, `cookie_notice`, `logo_media_id`, `favicon_media_id` | Settings → Business | — | 🔵 |
| `order_prefix`, `order_start_number`, `invoice_prefix` | Settings → Orders | Order creation (`txnid` + `orders.order_number`), invoice references; POS keeps `RCP-######` | 🟢 |
| `auto_confirm`, `default_fulfilment_status`, `auto_cancel_unpaid_hours`, `return_window_days` | Settings → Orders | Paid-order automation (`transitionOrderStatus`), reconcile, account return requests | 🟢 |
| `shipping_enabled`, `free_shipping_over` | Settings → Orders / Shipping | Checkout shipping quote, cart Shipping row | 🟢 |
| `reservation_seconds`, `payment_failure_grace_seconds`, `payment_unresolved_minutes`, `waitlist_enabled`, `waitlist_claim_minutes`, `waitlist_retry_minutes` | Settings → Orders | Reservation deadline, failure grace, unresolved window, waiting-list join/allocation/expiry/cooldown (§2.15) | 🟢 |
| `pickup_enabled` | Settings → Orders | Locked `off`; the server never reads it (`pickupEnabled()` is always false) | ⛔ locked |
| `processing_time_text`, `cutoff_text` | Settings → Orders | — (copy only) | 🔵 |
| `guest_checkout` | Customers → Settings | Checkout page + PayU initiate | 🟢 |
| `checkout_marketing_optin` | Customers → Settings | Checkout UI + newsletter insert | 🟢 |
| `default_customer_group` | Customers → Settings | Sign-up | 🟢 |
| `fulfilment_providers` + tracking template | Settings → Shipping | Delivery save | 🟢 |
| `cancellation_reasons` | Settings → Reasons | Returns/cancel flows | 🟢 |
| `shipping_methods` (rates, free-over, ETA) | Settings → Shipping | Checkout shipping quote, cart Shipping row | 🟢 |
| `payu_enabled`, `payment_note` | Settings → Payments | PayU initiate gate, checkout helper text | 🟢 |
| `payment_methods`, `cod_enabled`, `manual_payments_enabled`, `payu_mode` | Settings → Payments | — (no payment-method selector; COD ships off) | 🔵 |
| `coupons_enabled`, `refunds_restore_coupon` | Settings → Payments → Coupons | Validate endpoint, PayU initiate, bag/checkout coupon box; refund release of a consumed use | 🟢 |
| `refund_reasons`, `return_reasons` | Settings → Reasons | — | 🔵 |
| `login_heading`, `login_subheading`, `login_background_media_id`, `login_support_link`, `recaptcha_site_key`, `recaptcha_status` | Settings → Storefront | — | 🔵 |
| `maintenance_enabled`, `maintenance_message`, `maintenance_starts_at`, `maintenance_ends_at` | Settings → Storefront (owner only) | — | 🔵 |
| `mail_driver`, `mail_status`, `mail_host`, `mail_port`, `mail_username`, `mail_encryption`, `mail_from_email`, `mail_from_name` | Settings → Mail | Notification outbox email delivery (SMTP); `MAIL_PASSWORD` stays in the environment | 🟢 |
| `sms_gateway`, `sms_status`, `sms_sender_id` | Settings → Mail | Notification outbox SMS delivery (MSG91/Twilio); credentials stay in the environment | 🟢 |
| Notification matrix (114 cells) | Settings → Notifications | Which outbox rows each business event creates | 🟢 |
| Automated messages | Settings → Notifications | SMS/email copy rendered into outbox rows, with built-in fallbacks | 🟢 |
| Email templates | Settings → Notifications | Email subject/heading/body/button/footer, with built-in fallbacks | 🟢 |
| `store_pages` | Settings → Content | — | 🔵 |
| `seo_pages` | Settings → Content | — | 🔵 |
| Social links | Settings → Analytics | — | 🔵 |
| Analytics script IDs | Settings → Analytics | — | 🔵 |
| Integrations (storage/mail/webhooks) | Settings → Analytics | — | 🔵 |
| SMTP password, MSG91/Twilio token, reCAPTCHA secret, PayU key/salt | Environment only | Secret-presence badges | ⚪ |

Summary: of the **59 keys** in `store_settings`, **35 are consumed** — `trade_name`,
`address`, `phone`, `email`, `receipt_footer`, `order_prefix`, `order_start_number`,
`invoice_prefix`, `auto_confirm`, `default_fulfilment_status`, `auto_cancel_unpaid_hours`,
`return_window_days`, `shipping_enabled`, `free_shipping_over`, `payu_enabled`,
`payment_note`, `coupons_enabled`, `refunds_restore_coupon`, the six
reservation/waiting-list keys, the eight mail keys and the three SMS keys — plus the
`shipping_methods` table, the three `customer_settings` keys, the 114-cell notification
matrix and both message tables. The remaining 24 are persisted and audited but read by
nothing.

`store_settings` currently holds **1 row** — the smoke run from Phase 9 set `trade_name` to
“Gadzio”. Every other key still shows its coded default.

---

## 6. Deferred or not built

These are deliberate gaps, not bugs.

| Item | Why |
|---|---|
| Migrations after `0036` | `0037` added reservations/waiting-list/refund obligations; `0038` grace-window indexes; `0039` sale pricing; `0040` POS entered prices; `0041` coupons; `0042` locks pickup off; `0043` adds permanent staff-removal markers. The next free number is `0044`. |
| Storefront consuming `product_collections` | The table, API and read layer exist, but no homepage/category rail reads them yet. Phase 1 explicitly excluded collections; wiring them is a later phase. |
| Marketing/newsletter sending | Transactional messages only in this phase. `checkout_marketing_optin` still feeds the subscriber list, not a sender. |
| SMS DLT template ids | MSG91 transactional SMS in India normally needs a DLT-registered template, and no such setting exists. Live MSG91 SMS may be rejected until an id field is designed; reported rather than invented. |
| POS and staff-initiated notifications | In-store sales and their sale/refund-induced low-stock crossings do not enqueue. Manual stock adjustments (product or per-option) **do** queue low-stock and back-in-stock alerts (§ Phase 7). A later edit to delivery details after `shipped` sends no second message. |
| PayU refund API | Manual refunds by design. The admin records the refund and the owner moves money in the PayU dashboard. |
| Courier API integration | Third-party courier; the owner supplies a tracking URL template. |
| Wallet, loyalty, serial/IMEI tracking, vendor/marketplace modules | Out of scope for a single store. |
| Education Store admin | Deferred to the end; do not touch. |
| Pickup and COD at checkout | Shipping rates **are** charged now (§2.14). There is no delivery/pickup control and no payment-method selector: pickup is locked off (§2.20) and `cod_enabled` stays unwired (COD off). Maintenance mode **is** enforced (§2.19). |
| Storefront reading `store_pages` / `seo_pages` | Not implemented. |
| reCAPTCHA enforcement | Secret not configured and no verification call exists. |
| Public deployment pipeline | No Vercel/CI config in the repo. |

---

## 7. Security model

| Area | Implementation |
|---|---|
| Database access | Server-side only, `DATABASE_URL`, `postgres` tagged templates. The Supabase publishable key is used **only** for read-only `content_blocks`. |
| RLS | Enabled on `users`, `user_sessions`, `orders` (migration `0013`), `product_collections` (`0033`), `order_number_counters` (`0034`), `notification_outbox` (`0035`), `waiting_list_entries`, `stock_reservations`, `refund_obligations` (`0037`), `sale_settings` (`0039`) and `coupons`, `coupon_targets`, `coupon_redemptions` (`0041`). Every table created since ships with RLS enabled in its own migration file, with no policies. |
| Admin identities | One active staff store (`store_admins`) for commerce + Website; customer (`users`) stays separate. Old CMS tables/source are retained pending the documented removal gate, with legacy login APIs disabled. |
| Role checks | Every store-admin API route calls `requireStoreRole(...)`; verified by `scripts/check-store-admin-routes.mjs`. |
| CSRF | `assertSameOrigin(request)` on every mutating store-admin route and on account request routes. |
| Audit | `store_admin_audit` is append-only at the database level (trigger). PII is masked; IP and user agent are hashed. |
| Secrets | Never stored in the database and never rendered. Settings pages show only “configured / missing” badges via `secret-status.ts`. The notification worker reads `MAIL_PASSWORD`, `MSG91_AUTH_KEY`, `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` from the environment; a missing credential is reported by name only, and provider errors are reduced to a code. |
| Notification PII | The outbox stores the recipient because it must send; the admin log shows `recipient_masked` and never the subject or body. Audit rows for retries carry the message id only. No log line contains a full email or phone. Retention can clear `body` and `recipient` on finished rows after N days (off by default). |
| Notification credentials | No template variable can read a password, temporary password, token or reset link; `staff_invite` carries a notice and a sign-in link only. A test renders every channel/audience/topic combination with secret markers. |
| Rate limiting | In-memory sliding window on PayU initiate, PayU webhook (100/min/IP), customer order requests (10/15 min/user) and coupon validation (10/min/IP **and** per signed-in user). |
| Payment integrity | Reverse-hash verification plus a server-side PayU verification call before an order becomes paid; atomic idempotent transition prevents double capture. |
| Coupon integrity | The discount and total are computed server-side under the coupon row lock and the same stock locks; the browser sends only a code and a comparison total. Limits cannot be probed — the preview returns only totals and a safe message, and every refusal except expired/minimum/already-used is the same generic sentence. |
| Order documents | Invoice/packing slip pages are behind the store-admin session and role check. |
| Coupon store-admin surface | Every `/api/store-admin/coupons/**` and coupon-report route calls `requireStoreRole(...)` (reads `store_viewer`, writes `store_admin`); mutations also call `assertSameOrigin(request)`. Every action writes a `store_admin_audit` row; restricted email lists are recorded as a count, never as addresses. |

**Reconciliation must be scheduled.** `CRON_SECRET` is now required in production: with
it unset, `/api/payu/reconcile` returns 503 instead of running unauthenticated, because a
run releases stock held by expired reservations and stale unpaid orders. Set the secret
and call the endpoint over POST **every minute** (§2.14, §2.15). In development an unset
secret still allows a manual run.

---

## 8. Running and verifying locally

```bash
npm install
npm run db:migrate          # applies migrations/*.sql in order
npm run dev                 # http://localhost:3000
npm test                    # 592 tests
npm run typecheck
npm run build
node scripts/catalog-parity.mjs                 # read-only static ↔ database parity report
node scripts/check-store-admin-routes.mjs
node scripts/check-setting-lists.mjs
node scripts/check-admin-boundary.mjs
node scripts/check-account-routes.mjs
npm audit
node scripts/migrate-cms-products.mjs           # dry run; add --commit to write
```

Panels:

- Storefront — `http://localhost:3000/`
- Store admin — `http://localhost:3000/store-admin/login`
- Customer account — `http://localhost:3000/auth`
- Website — `http://localhost:3000/store-admin/website` (old `/admin/login` redirects to Store Admin login)

Note: the session pooler allows 15 clients. A running `next dev` plus ad-hoc scripts can
exhaust it; keep script connection pools at `max: 1`.

---

## 9. File map for the features above

| Area | Key files |
|---|---|
| Storefront pages | `src/app/page.tsx`, `src/app/in/shop/...`, `src/app/shop/...`, `src/app/search`, `src/app/checkout`, `src/app/order/*`, `src/app/account/*`, `src/app/auth` |
| CMS content reader | `src/lib/content.ts` |
| Storefront catalogue read layer | `src/lib/storefront/catalog.ts`, `catalog-merge.ts`, `catalog-rules.ts`, `catalog-tags.ts`, `revalidate.ts`, `static-catalog.ts`, `src/lib/catalog/storefront.ts` |
| Static catalogue | `src/lib/products/registry.ts`, `src/components/sites/accessories/data/*`, `src/components/sites/cases-protection/data/*` (fallback + marketing fields only) |
| Parity report | `scripts/catalog-parity.mjs` |
| DB pricing | `src/lib/payu/db-catalog.ts` |
| Sale pricing | `src/lib/storefront/{pricing,sale,sale-state}.ts`, `src/lib/catalog/storefront.ts` (`applySaleDisplay`), `src/lib/storefront/catalog.ts`, `src/lib/store-admin/{sale,sale-admin-rules}.ts`, `src/app/(store-admin)/store-admin/(protected)/sale/page.tsx`, `src/app/api/store-admin/sale/route.ts`, `src/components/store-admin/{SaleStatusBadge,SaleSettingsForm,SaleBulkActions,SaleProductRow,ProductPriceEditor}.tsx`, `migrations/0039_sale_pricing.sql`, `tests/{sale-pricing,sale-admin,sale-boundary-display}.test.mjs` |
| POS entered prices | `src/lib/store-admin/{pos,pos-rules}.ts`, `src/components/store-admin/PosTill.tsx`, `src/app/api/store-admin/pos/sales/route.ts`, `migrations/0040_pos_entered_prices.sql`, `tests/pos-entered-prices.test.mjs` |
| Coupons | `src/lib/coupons/{rules,codes,store,errors}.ts`, `src/lib/store-admin/{coupons,coupon-rules}.ts`, `src/components/cart/{CouponBox.tsx}`, `src/lib/cart/useCoupon.ts`, `src/app/api/coupons/validate/route.ts`, `src/app/api/store-admin/coupons/**`, `src/app/api/store-admin/reports/coupon-usage/export/route.ts`, `src/app/(store-admin)/store-admin/(protected)/coupons/**`, `src/app/(store-admin)/store-admin/(protected)/reports/coupon-usage/page.tsx`, `src/components/store-admin/{CouponForm,CouponActions}.tsx`, `migrations/0041_coupons.sql`, `tests/{coupon-rules,coupon-db-integration,coupon-order-integration,coupon-guards}.test.mjs` |
| Availability at checkout | `src/lib/storefront/{availability-rules,availability-server,use-availability}.ts`, `src/app/api/catalog/availability/route.ts`, `src/components/{shop/ProductDetailPage,sites/accessories/AccessoryDetailPage,cart/CartPageView,checkout/CheckoutForm}.tsx`, `src/lib/payu/db-pricing.ts`, `tests/stock-behaviour.test.mjs` |
| PayU | `src/lib/payu/*`, `src/app/api/payu/*` |
| Stock claim/release | `src/lib/payu/stock.ts` |
| Checkout rules (pure) | `src/lib/checkout/shipping-rules.ts`, `stock-rules.ts`, `settings.ts` |
| Reservations + payment outcome (pure) | `src/lib/checkout/reservation-rules.ts` |
| Reservation/reconcile repository | `src/lib/payu/orders.ts`, `src/lib/payu/reconcile.ts`, `src/lib/payu/refund-obligations.ts`, `src/app/api/payu/reconcile/route.ts` |
| Waiting-list removal | `src/lib/payu/waitlist-cleanup.ts`, `scripts/release-waitlist-holds.mjs` (tables kept, no UI) |
| Reservation UI | `src/components/checkout/ReservationCountdown.tsx`, `src/app/order/processing/page.tsx` |
| Inventory controls | `src/components/store-admin/{ProductInventoryCard,StockControls}.tsx`, `src/lib/store-admin/catalog-crud.ts`, `catalog-crud-rules.ts`, `tests/inventory-controls.test.mjs` |
| Order numbering + automation | `src/lib/orders/numbering.ts`, `fulfilment-automation.ts`, `auto-cancel-rules.ts` |
| Cart | `src/lib/cart/*` |
| Customer account | `src/lib/account/*`, `src/app/api/account/*` |
| Store-admin auth | `src/lib/store-admin/auth.ts`, `src/app/api/store-admin/auth/*` |
| Store-admin data | `src/lib/store-admin/*` |
| Collections | `src/lib/store-admin/collections.ts`, `src/lib/store-admin/collection-rules.ts`, `src/lib/storefront/collections.ts`, `src/lib/storefront/collections-rules.ts`, `src/components/store-admin/CollectionManager.tsx` |
| Admin boundary | `src/lib/website/boundary.ts`, `scripts/check-admin-boundary.mjs`, `scripts/migrate-cms-products.mjs`, `src/lib/catalogue/product-import.ts`, `PHASE0-AUDIT.md` |
| Store-admin pages | `src/app/(store-admin)/store-admin/**` |
| Store-admin APIs | `src/app/api/store-admin/**` |
| Settings engine | `src/lib/store-admin/settings-rules.ts`, `setting-lists.ts`, `notification-settings.ts`, `secret-status.ts` |
| Notifications | `src/lib/notifications/{types,rules,templates,settings,enqueue,queue,outbox,providers,order-context,stock-events}.ts`, `src/app/api/store-admin/settings/notifications/retry/route.ts`, `src/components/store-admin/{NotificationMatrix,NotificationRetryButton}.tsx`, `migrations/0035_notification_outbox.sql` |
| Payment review flag | `src/lib/store-admin/payments.ts`, `src/app/api/store-admin/payments/review-flag/route.ts`, `src/components/store-admin/PaymentReviewFlagActions.tsx`, `migrations/0036_order_payment_review.sql` |
| Audit | `src/lib/store-admin/audit.ts`, `audit-log.ts`, `migrations/0010_store_admin_auth.sql` |
| Website + compatibility | `src/app/(store-admin)/store-admin/(protected)/website/**`, `src/app/api/store-admin/website/**`, `src/lib/website/*`, `src/app/api/admin/**`; old UI/auth source retained pending removal |
| Database | `migrations/*.sql` |
| Tests | `tests/*.test.mjs` |

---

Current product-options results are in [Phase 1 shared-list verification](docs/phase1-shared-lists-20261104.md). The earlier audit, implementation and repair checkpoints below retain historical evidence, including superseded limits and failures. The latest Phase 1 status follows them.

### Historical product options Phase 0 audit — 4 November 2026

Read-only product audit completed against `PRODUCT_OPTIONS_FINAL_PLAN.md`; no migration, seed, backfill, real business-table write, disposable-fixture write, product implementation change, push, or destructive git operation was performed. Existing source work was secured in local checkpoint `77c7dcf` on `backup/product-options-phase0-20261104`; documentation is saved separately. Public remote push is deferred for explicit publication confirmation. Findings are recorded in `OPTIONS_NOTES.md`. The referenced `PRODUCT_EDITOR_FINISH.md` and obsolete simple plan are absent.

**Database read-only evidence**

- Hostname only: `aws-0-ap-northeast-1.pooler.supabase.com`.
- Applied migration ledger: `0001` through `0057`, including `0055_variant_identity_retirement.sql`, `0056_product_content_revisions.sql`, and `0057_catalog_edit_revision.sql`. No unapplied migration was found.
- Product preflight: all expected Phase-B columns/indexes present; all reported conflict groups were zero.
- Census: 15 products; 36 variants (1 purchasable, 3 regular price overrides, 0 sale overrides); 1 device brand/1 model; 23 live images; 89 price-history rows; 15 parent stock rows and 0 variant stock rows; 49 order items with 0 variant snapshots; 8 active reservations; 37 product facets and 0 colour facets.
- Existing disposable namespaces were listed read-only only; none was adopted or removed. The inventory census found one candidate with a tracked parent balance and three active variants; no allocation was proposed or applied.

**Checks run**

| Check | Result |
|---|---|
| `npm test` | **1,532 tests: 1,445 passed, 4 failed, 83 skipped; 0 cancelled**. Exit 1. The four failures are source-contract assertions in `payment-recovery.test.mjs:85` and `stock-behaviour.test.mjs:230,262,319`; their runtime significance has not been resolved in this read-only phase. DB-opt-in tests were skipped, not passed. Full output: `.tmp-phase0-tests.txt`. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed with the existing external-lockfile warning; 25 static pages generated. |
| `node scripts/check-store-admin-routes.mjs` | Passed: 115 routes guarded. |
| `node scripts/check-account-routes.mjs` | Passed: 21 account APIs and 11 pages guarded. |
| `node scripts/check-admin-boundary.mjs` | Passed. |
| `node scripts/check-setting-lists.mjs` | Passed: all settings/list tables readable. |
| `node scripts/check-notifications.mjs` | 3 passed / 5 failed; no message sent. Failures are missing provider configuration and notification matrix settings, not product-option code. |
| `node --env-file=.env.local scripts/check-legacy-admin-compat.mjs` | Passed: 2/2 media routes; zero stored old-admin references. |
| `node scripts/catalog-parity.mjs` | Failed (exit 2): static `Midnight Black` colour has no matching database variant; also reports two price drifts and specification differences. No data repair applied. |
| `npm audit --json` | Passed: 0 vulnerabilities. |
| `git diff --check` | No whitespace errors; Git emitted only existing line-ending warnings. |

**Phase 0 conclusion:** stable variant identity, database-authoritative option pricing resolution, exact variant stock/payment plumbing, retirement/replacement, and availability infrastructure exist substantially. Shared colours, colour reconciliation, bulk model/colour import/export, unified options/price/stock table, unlocked option price writes, paired option history UI, colour photos, two-step selector, URL state, option-derived model/colour filters/counts, colour-aware search/cards, and structured model/colour/photo order snapshots remain incomplete. No product code was changed in this phase.

**Current user decisions (4 November 2026; supersede earlier limits)**

1. Store admins and owners may create a model/colour inline; owners alone rename, deactivate, reactivate and manage. Bulk paste and CSV import/export are owner-only.
2. Paste/CSV imports are capped at **2,000 data rows and 1 MB (1,000,000 UTF-8 bytes)**.
3. Price drops over 50%, rises over 100%, or prices below cost require confirmation, never a block. Option-price editing stays deferred to Phase 2.

**Remaining Phase 0 gates:** approve public remote publication for the backup; retain and investigate the four failing baseline tests. At this audit checkpoint no Phase 1 implementation or DB-backed fixture acceptance was claimed; the subsequent status follows.

### Historical product options Phase 1 shared-list checkpoint (4 November 2026)

**Implemented in source; not deployed or fully accepted.** Reused the existing device catalogue, metadata locking/publication/revision/audit, immutable options and stock services. Added shared colours, owner model/colour management and named paginated use warnings, explicit near-match/deactivation confirmation, CSV/paste read-only preview and atomic owner confirmation, safe template/export/error downloads, and admin create-only inline models/colours with draft preservation. Brand creation remains owner-only; viewers cannot write. Prices remain locked. No unified options table, per-colour photo workflow, customer-selector redesign or Education Store work.

Prepared, **not applied**: `0058_shared_catalogue_normalization.sql` and `0059_shared_colours.sql`. New tables enable RLS without public policies. Variant-colour links are immutable and enforce composite product/variant ownership. Legacy compatibility backfill no longer invents device records. The new colour reconciliation is dry-run-first and requires separate exact-target approval for apply; no seed/backfill/reconciliation/migration/fixture/business-table write was performed.

Imports enforce 500 data records and 262,144 UTF-8 bytes, including input BOM/header/line endings; the full JSON body must also fit that bound. Preview tokens expire after ten minutes and bind session/actor/target/input/snapshot/row decisions. All applies replan under the metadata fence, with owner recheck and strict count-only batch audit. Re-import leaves existing catalogue rows/timestamps unchanged. Signing/rate limits are process-local; multi-worker rollout requires addressing this limitation. PostgreSQL normalization parity is not yet proven.

Inactive references are excluded from new choices. Existing active/purchasable/non-retired options retain them only with server-proven unchanged identity, existing same-product compatibility and existing stock/ownership checks. Model management through both API paths shares the publication guard; invalidating a published product rolls back. Review regressions cover max-500-row compact tokens and prefix-ID use pagination.

| Final verification | Observed result |
|---|---|
| Full `npm test` | **1,621 total: 1,533 passed, 4 failed, 84 skipped, 0 cancelled**. Four Phase 0 failures remain in payment-recovery/stock-behaviour; runtime significance unresolved. PostgreSQL parity adds one explicit skip. `.tmp-options-phase1-tests-complete.txt`. |
| Review fixes | 31/31 service/metadata tests passed, including publication rollback, bounded 500-row approvals and pagination. |
| Typecheck / build | **Both passed after the final review fixes (exit 0)**. Build generated 25 static pages; existing external-lockfile warning retained. `.tmp-options-phase1-typecheck-complete.txt`, `.tmp-options-phase1-build-complete.txt`. |
| Store-admin guard | Passed: 122 guarded routes. |
| Account guard / admin boundary / setting lists | Passed. |
| Notifications | **3 passed / 5 failed**, unchanged provider/matrix readiness; no message sent. |
| Legacy-admin compatibility | Fresh run **failed at local media HTTP check** (exception category not captured by the old checker; app availability was not established); stored-reference scan found zero old-admin references. Earlier 2/2 pass is historical, not the latest result. |
| Catalogue parity | Failed, exit 2: missing `Midnight Black` database variant, two price drifts and specification differences. No repairs applied. |
| `npm audit --json` | Passed: zero vulnerabilities. |
| `git diff --check`, log/status | No whitespace errors (line-ending advisories only); repository evidence captured, existing/unrelated changes preserved. No Phase 1 commit or push. |
| Read-only preflight | Host `aws-0-ap-northeast-1.pooler.supabase.com`, schema public: 15 products, 36 variants, 1 brand/1 model; no normalized collisions; new colour/link schema absent, not zero-row tables. |
| Synthetic browser 1440/768/390 | **Overall failed at all widths** on owner shared-input locator timeout. Prior steps verified inline model/admin colour, draft/Enter/reload/conflict behavior; captured errors/external requests empty and no stray page overflow. Bulk preview/apply/near/deactivation browser proof remains unverified. Memory-only fixture, not authenticated acceptance. `tmp/product-admin-ui-20261103/results.json`. |

The mobile inline-colour and failed owner-import screenshots were visually reviewed. Fixture servers on 43129/43130 may remain; old-process cleanup was denied and was not bypassed, and the fresh task handle was unavailable for stopping. Cleanup is pending.

**Open acceptance gates:** separately approved disposable PostgreSQL migration/normalization/index/FK/trigger/RLS/concurrency/rollback/revision proof; authenticated owner/admin/viewer acceptance; successful full shared-list browser flow; unresolved baseline tests/readiness/parity; public backup publication approval. Phase 1 is not fully complete and Phase 2 has not started. Detailed decisions and non-measured workload/backup/SLO targets are in `OPTIONS_NOTES.md`.

### Historical Phase 1 repair rerun — 4 November 2026

Diagnostic source repairs are complete: the legacy-media checker now requires an explicit credential-free loopback HTTP origin and aggregates sanitized timeout/refused/interrupted/DNS/abort/other transport, HTTP-status and body-cancellation failures. Manual redirects remain unfollowed. No stored URLs, IDs, redirects or raw exceptions are reported. The earlier “local app unavailable” conclusion was unsupported and is corrected above. Without a separately established safe app origin, the fresh check refuses before constructing a database client (exit 1); this is a safety refusal, **not** live HTTP acceptance.

Catalogue parity now uses the actual storefront normalization for known case-spec keys, reports ambiguous collisions rather than selecting a winner, and no longer promises static filling for missing data. The fresh report has no spec-label differences; it still exits 2 for missing `Midnight Black`, reports extra `Midnight NLU`, and retains both price differences: `iphone18pro-max-clear-magsafe` 349900 static / 350900 database paise; `cpc-gadzio-silicone-organizer` 79900 / 87900 paise. No saved option, SKU, price, stock or history was changed. Business intent and dependency/provenance acceptance remain unresolved.

Notification diagnostics now support `--no-provider-probe`, prohibit combining it with `--send-to`, use a read-only database session and preserve failed readiness for skipped SMTP. Fresh previews are in `tmp/notification-options-repair-20261104-r1/`; no old previews replaced, provider connections attempted or messages sent. Result remains **3 passed / 5 failed**, with **102 templates rendered successfully**. SMTP/SMS configuration and staff-email/customer-SMS matrix readiness remain owner decisions, not code changes to fabricate a pass.

Fresh verification: diagnostic/legacy regression suite **18 passed / 0 failed / 0 skipped**; full suite **1,633 total / 1,545 passed / 4 failed / 84 skipped / 0 cancelled**. The same four source assertions were reproduced (focused baseline 19 total / 14 passed / 4 failed / 1 skipped); exploration identifies obsolete guard/delegation shapes, not a reason to revert production protections. Implementation delegation for their behavioral repairs and the UI accessible-label fix was denied by the permission system; neither denial was bypassed. Browser source and failed acceptance remain unchanged. Typecheck and production build passed (25 static pages; external-lockfile warning retained). Store-admin guards (122 routes), account guards, admin boundary and setting-list checks passed. Dependency audit found zero vulnerabilities. Final post-fixture evidence: `.tmp-options-repair-tests-final.txt` (test command exit 1), `.tmp-options-repair-typecheck-final.txt`, `.tmp-options-repair-build-final.txt` (both exit 0), other `.tmp-options-repair-*.txt` and `.tmp-options-repair-audit.json`. Final whitespace check passed; git log/status captured without commit or push.

Prepared a genuine opt-in PostgreSQL integration path (`tests/shared-list-integration.test.mjs`, schema-local helper and `scripts/shared-list-test-manifest.mjs`) replacing the unconditional parity placeholder. Production preview/apply/save wrappers still use the application pool; new transaction seams let the fixture use isolated transactions without replacing that pool. Approval binds exact target, source/migration/runtime hashes, TLS, finite operations and cleanup before PostgreSQL driver import. Existing disposable schemas are refused; cleanup requires run ownership. Default one connection; separately approved race permits exactly two. Offline focused tests: **27 passed / 0 failed / 1 skipped**. Actual engine/RLS/constraint/revision/race proof is **not executed**; authenticated/non-owner isolation and full production-schema equivalence remain separate gaps.

**Phase 2 did not start:** required local repairs, browser acceptance, separately approved PostgreSQL/authenticated acceptance and business/provider readiness remain open. No migration, fixture database execution, business/configuration write, commit or push was performed.

### Product options Phase 0 main-session final verification — 4 November 2026

[The Phase 0 verification report](docs/phase0-final-verification-20261104.md) supersedes the earlier failure and backup-permission results above. The four original failing test names now pass; reservation/payment availability tests execute actual handlers/resolvers, and the detail/listing guards match the current exact-option flow. The shared textarea uses a stable explicit label and linked instructions; its exact accessible name survived repeated typing/clearing at 1440, 768 and 390 pixels.

The fresh full suite is **1,639 total / 1,555 passed / 0 failed / 84 skipped**. Typecheck, production build, 122 store-admin route guards, account guards, admin boundary, settings checks, whitespace and dependency audit passed (0 vulnerabilities). Diagnostic/legacy regressions are 18/18; PostgreSQL fixture offline tests are 27 passed with one existing live-acceptance skip. The read-only local production media gate passed **2/2 legacy routes**, with no HTTP/transport/cancellation failures and no shared rows to exercise.

Catalogue parity remains failed: iphone18pro-max-clear-magsafe is ₹3,499 static versus ₹3,509 database, cpc-gadzio-silicone-organizer is ₹799 versus ₹879, and iphone17-silicone-black has Midnight NLU instead of Midnight Black. The existing NEWPLOO variant has no exact stock row, zero exact variant order references, and seven product orders without variant IDs; archive-and-replace is proposed only. Notifications remain **3 passed / 5 failed**, with all 102 templates rendered and no provider probe/message.

[All 84 skipped tests](docs/phase0-skipped-tests-20261104.md) are listed by exact name and skip reason; each needs a session database connection plus its fixture write authorization. Authenticated production-browser acceptance and PostgreSQL engine acceptance remain pending. The user authorized logical commits and a push to the new `backup/phase0-final-verification-20261104` branch; generated diagnostics, fixture snapshots and machine-local permissions are ignored. No migration or business-data/provider change was made. Work stops after this backup and waits for the user to say “continue”; Phase 2 has not started.

### Product options Phase 1 main-session completion — 4 November 2026

[The Phase 1 report](docs/phase1-shared-lists-20261104.md) records the comparison with PRODUCT_OPTIONS_FINAL_PLAN.md and the repairs to existing code. Imports accept **2,000 data rows / 1,000,000 UTF-8 bytes** with a separate bounded JSON envelope; maximum-size approvals remain compact. Atomic apply now uses one parameterized insert, preserving strict count-only audit and re-import no-op behavior. Owners can directly review paginated products using a model/colour. Rename checks cover inactive-brand models; edited names invalidate stale confirmation; colour UI/server limits agree; labels and scoped help-text contrast are repaired.

| Current verification | Result |
| --- | --- |
| Full suite, DB opt-ins disabled | **1,645 total / 1,561 passed / 0 failed / 84 skipped / 0 cancelled** |
| Typecheck / production build | Passed; 25 static pages; existing external-lockfile warning |
| Store-admin / account guards | Passed: 122 store-admin APIs, 21 account APIs and 11 pages |
| Admin boundary / dependency audit | Passed; zero vulnerabilities |
| Component browser 1440/768/390 | Passed; imports, downloads, no-op/near review, direct uses, draft preservation; zero console errors/external requests; help contrast ≥6.98:1 |
| Offline notifications | 102 templates pass rendering; diagnostic total 1 passed / 4 failed; no DB read, provider probe or message |
| Database/authenticated acceptance | Pending; all 84 skips need disposable session connections and approved fixture scope |

Static fallback prices are now **₹3,509** for iphone18pro-max-clear-magsafe and **₹879** for cpc-gadzio-silicone-organizer, with page/ref regressions against the accepted snapshot. No database price or saved option was edited; the owner will manage Midnight NLU. Live parity/settings/media checks were not rerun.

[DISPOSABLE_DB_RUNBOOK.md](DISPOSABLE_DB_RUNBOOK.md) documents Docker, installed Windows and separate hosted PostgreSQL, a non-superuser/NOBYPASSRLS role with schema creation privilege, all 57 migrations, guarded session/TLS variables and exact commands/approvals for all 84 skips. Documentation only; its 15 PowerShell blocks parse successfully. PostgreSQL engine and authenticated application proof remain pending; component fixtures use synthetic data and mocked persistence. Process-local preview signing/throttling needs consideration before a multi-worker deployment.

Backup: `backup/phase1-shared-lists-20261104`. All work ran in the main session. Sandbox test/build worker restrictions were resolved by approved escalation; no action was denied. No database was contacted, migrated or seeded and no provider was probed. Phase 1 work stops here.
