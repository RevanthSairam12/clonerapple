# Task 1 — Real Authenticated Browser E2E Evidence

- **Generated at:** `2026-11-09T15:32:06.488Z`
- **Runner:** `scripts/e2e/final-readiness-browser.mjs` (`playwright-core` driving system Chrome against `npm run build && npm run start` on `http://localhost:3000`)
- **Seeder:** `scripts/e2e/seed-final-readiness.mjs` (fixture tag: `fr20261109`)
- **Outcome:** **21 passed, 0 failed** (`results.json`)

## Root-Cause Stability Fix Applied Before E2E Run

When `postgres.js` connects to Supabase's Transaction Pooler (`:6543`) with `prepare: false`, unparameterized queries finish with `Sync` while parameterized queries set `describeFirst = true` and send `Parse + Describe + Flush` first. If `postgres.js` pipelines a parameterized query onto a `busy` connection behind an unparameterized query, Supavisor detaches the backend after the first `ReadyForQuery`, leaving the second query's backend stranded in `wait_event = 'ClientRead'`.

- **`src/lib/platform/db.ts`**: Added `disablePoolerPipelining(client)` for port-6543 pooler connections so `onexecute` returns `false` on non-`BEGIN` queries, moving in-flight connections to `full` until `ReadyForQuery` arrives while preserving `sql.begin` transactions and `fetchArrayTypes()` array serializers.
- **`scripts/e2e/seed-final-readiness.mjs`**: Normalized product slug (`test-product-fr20261109`) and variant SKUs (`SKU-BLK-FR20261109`, `SKU-BLU-FR20261109`) to match `validateNewProductInput` and `validateVariantInput` rules.

## Step Results & Screenshots (`results.json`)

| # | Step | Status | Evidence / Detail |
|---|---|---|---|
| 1 | `customer: public storefront loads` | PASS | `01-storefront-home.png` (`title="Gadzio"`) |
| 2 | `customer: signs in with real credentials` | PASS | `02-customer-signed-in.png` (`session cookie set`) |
| 3 | `customer: browses category listing` | PASS | `03-category-listing.png` |
| 4 | `customer: opens product and selects model + colour` | PASS | `04-variant-selected.png` (`₹1,999.00` + availability rendered) |
| 5 | `customer: adds the selected variant to the bag` | PASS | Cart line persisted in `gadzio_cart_v1` |
| 6 | `customer: bag shows the server-priced line` | PASS | `05-cart.png` |
| 7 | `customer: checkout page renders server-side pricing` | PASS | `06-checkout.png` |
| 8 | `customer: fills contact and shipping address` | PASS | `07-checkout-filled.png` |
| 9 | `customer: starts a PayU test-mode checkout` | PASS | `08-payu-redirect.png`, `payu-gateway-post.json` (`txnid=GDZ001031`, `amount=2039.00`, 11 form fields, gateway POST intercepted & aborted) |
| 10 | `database: order, stock claim and ledger entry exist` | PASS | `order CREATED · reservation_state=ACTIVE · total=203900 paise · item SKU-BLK-R2-FR20261109 · sale movement -1 · on_hand=11 reserved=0` |
| 11 | `customer: order history lists the order` | PASS | `09-account-orders.png` |
| 12 | `customer: order detail shows items, totals and payment state` | PASS | `10-account-order-detail.png` |
| 13 | `boundary: customer B cannot open customer A order` | PASS | `11-boundary-order-denied.png` (order detail & receipt both HTTP 404 for Customer B) |
| 14 | `boundary: customer session cannot open the store admin` | PASS | Redirected to `/store-admin/login` |
| 15 | `boundary: customer session cannot call a store-admin API` | PASS | `GET /api/store-admin/orders → 401` |
| 16 | `admin: signs in to the Store Desk` | PASS | `12-store-admin-dashboard.png` (`store_admin_session` cookie set) |
| 17 | `admin: product list and product detail` | PASS | `13-store-admin-products.png`, `14-store-admin-product-detail.png` (`products 200/2593ms, detail 200/734ms`) |
| 18 | `admin: edits variant stock and low-stock threshold` | PASS | `15-store-admin-variant-stock-editor.png`, `16-store-admin-stock-saved.png` (`on_hand 11 → 10` and `threshold 3 → 4` persisted via `/api/store-admin/catalog/products/draft`) |
| 19 | `admin: orders list and order detail with payment state` | PASS | `17-store-admin-orders.png`, `18-store-admin-order-detail.png` |
| 20 | `admin: notification matrix and delivery log` | PASS | `19-store-admin-notifications.png` |
| 21 | `boundary: unauthenticated visitor is refused by the store admin` | PASS | `20-boundary-admin-login-required.png` (`page → /store-admin/login; GET /api/store-admin/orders → 401`) |
