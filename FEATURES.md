# Gadzio — Feature Reference

**Verified:** 29 October 2026, against the code in this repository and the database
reached through `.env.local`.

**Evidence collected at that moment**

| Check | Result |
|---|---|
| `npm test` | **581 tests, 581 pass, 0 fail** (≈213 s with the database suites) |
| `node scripts/catalog-parity.mjs` | no fatal gaps: all 12 static products/variants exist in the database; 2 price drifts and 1 database-only product reported (last run 26 October 2026) |
| `node scripts/check-store-admin-routes.mjs` | **All 94 store-admin routes are guarded** |
| `node scripts/check-setting-lists.mjs` | all 14 settings tables readable, 114 notification cells |
| `node scripts/check-admin-boundary.mjs` | legacy CMS holds no commerce field; 11 Education collections exempt |
| `node scripts/check-account-routes.mjs` | **All 8 account API routes check the customer session and ownership boundary** |
| `npm run typecheck` / `npm run build` | both succeed |
| `npm audit` | 0 vulnerabilities |
| Live smoke test (`next start`) | home, product, buy, six category pages, cases (both routes), search, cart and bag return 200; unknown product id returns 404; database prices render (last run 26 October 2026) |
| Migrations applied | `schema_migrations` holds every migration file through `0041_coupons.sql` |
| Database contents | 13 active products, 29 orders, 3 users, 1 store admin, 6 content blocks, 0 media, 0 subscribers, 0 order requests, 0 collection rows |

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
  │        └── 86 API routes, each requireStoreRole(...); owns products, collections, orders, customers
  │
  └── Legacy CMS admin (/admin) ───────────────► admin_users / admin_sessions  (cookie admin_session)
                                                   edits content_blocks (design/marketing only), theme, shared media
```

**The admin boundary (Phase 0).** The legacy CMS may edit layout, copy, imagery and
theme. It may not accept a product id, name, price, cost, SKU, stock, discount, order,
customer or shipping value; `/api/admin/content` rejects such a payload through
`validateLegacyContentWrite()` and `scripts/check-admin-boundary.mjs` proves it. Product
and merchandising data is written only by Store Admin. The Education Store (`edu.*`) is
exempt and untouched. See `PHASE0-AUDIT.md` for the full field-by-field audit.

Two independent admin identities exist and must never be mixed:

| | Store admin | Legacy CMS admin |
|---|---|---|
| Tables | `store_admins`, `store_admin_sessions` | `admin_users`, `admin_sessions` |
| Cookie | `store_admin_session` | `admin_session` |
| Login | email + password (bcrypt, 10 rounds) | email + password + optional TOTP |
| Purpose | running the shop | editing marketing content |
| Roles | `store_owner` ⊇ `store_admin` ⊇ `store_viewer` | single editor role |

Customer identity is a third store: `users` / `user_sessions`, with a separate cookie and
separate validation code.

---

## 2. Storefront (public pages)

### 2.1 Homepage — 🟢 Live (CMS-driven)

- **Route:** `/`
- **What it does:** renders the marketing homepage: hero, promotional tiles, gallery and
  section copy.
- **How it works:** `src/lib/content.ts` reads `content_blocks` rows by key. It tries the
  Supabase REST endpoint first (`NEXT_PUBLIC_SUPABASE_*`, read-only, publishable key) and
  falls back to a direct `DATABASE_URL` query if REST fails. A database row **overrides**
  the defaults baked into code, so editing the content collection in `/admin` changes the
  page even though the JSON in the repo is unchanged. Archived rows (`archived_at`) are
  ignored, so a collection can be reverted without deleting it.
- **Current data:** 6 content blocks exist (`apple.footer`, `apple.gallery`,
  `apple.hero_tiles`, `apple.hero_video`, `apple.promo_section`, `apple.ribbon`).
- **Caveat:** this is the legacy CMS path, not the new store-admin settings. There is no
  store-admin screen that edits homepage content. The homepage has no product carousel
  today; `product_collections` and `src/lib/storefront/collections.ts` are ready for the
  first rail when collections are wired in a later phase, but no storefront component
  consumes them yet (Phase 1 explicitly left collections alone).

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
     `system`.
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
| `/auth` | Sign up, sign in, sign out | `users`, `user_sessions` |
| `/account` | Dashboard with latest order | `users`, `orders` |
| `/account/profile` | Edit name/phone; change password | `users` |
| `/account/addresses` | Add, edit, delete, set default address | `customer_addresses` |
| `/account/orders` | Order history with status chips | `orders` |
| `/account/orders/[txnid]` | Order detail, request buttons | `orders`, `order_requests` |
| `/account/orders/[txnid]/receipt` | Printable receipt | `orders`, settings `receipt_footer` |

All account pages go through `requireAccountPageSession(...)`; APIs go through
`requireAccountSessionApi()`. Sessions are rows in `user_sessions`, not just a signed
cookie. `users`, `user_sessions` and `orders` have RLS enabled (migration `0013`), and all
access is through `DATABASE_URL` — the publishable key is never used on those tables.

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
| `auto_confirm` + `default_fulfilment_status` (Orders) | ignored; a paid order stayed `PENDING` | on the first verified PAID transition the order walks legal `order-rules.ts` steps up to the configured status (auto-confirm lifts `PENDING` to at least `ACCEPTED`). Each step writes `order_status_history` with actor `system`. Invalid or `CANCELED` defaults mean “stay `PENDING`”. |
| `auto_cancel_unpaid_hours` (Orders) | reconcile used a hard-coded 2-hour cutoff and wrote no audit row | reconcile cancels unpaid orders older than the configured hours with a system reason, releases their stock claim once and writes an `order.auto_cancel` audit row. `0` or empty keeps the 2-hour abandoned-checkout rule. |
| `return_window_days` (Orders) | hard-coded 7 | the account return window and its error message use the configured value; 7 when unset, empty or invalid. |
| `shipping_enabled`, `free_shipping_over`, `shipping_methods` (Shipping) | ignored; PayU charged the cart subtotal | initiate quotes shipping server-side: disabled → free; store-wide free-over reached → free; otherwise the first active method (sort order, then name), using its own free-over or rate. The quote is stored as `orders.shipping_paise` and charged by PayU. The cart’s existing Shipping row shows the same figure. |
| `payu_enabled` (Payments) | ignored | off refuses initiate through the existing error alert; nothing is created. |
| `payment_note` (Payments) | ignored | rendered in the checkout form’s existing PayU helper area. |
| `cod_enabled` (Payments) | defaulted on and unused | default is now **off**. Checkout has no payment-method selector, so COD stays unwired. |
| `pickup_enabled` (Orders) | ignored | not wireable — checkout has no delivery/pickup control (see below). |

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

- Pickup at checkout: `pickup_enabled` exists but the form has no delivery/pickup
  selector, so there is nothing to gate.
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
- **Sale prices.** By default a coupon skips lines charged at a live sale price. When the
  whole eligible scope is on sale the code is refused with *“This code is not valid on
  sale items.”* `allow_with_sale_price` lifts the restriction.
- **Minimum order** is compared with the pre-discount subtotal on the database clock.
  `starts_at` is inclusive and `ends_at` exclusive: at the end instant the code is
  already expired.
- **The ₹1 floor.** `MIN_PAYABLE_PAISE = 100`. The discount is reduced — never the order
  rejected — to keep the payable at or above it, and the customer is told *“The discount
  was adjusted to keep the order payable.”* A cart whose own subtotal is below ₹1 is
  refused instead of being sent to PayU.
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
- **POS never uses coupons.** No POS route or rule file mentions a coupon; a source guard
  in the tests enforces it.
- **Settings.** Payments → **Coupons** holds `coupons_enabled` (on by default; off hides
  the box and refuses codes at Pay without touching existing orders) and
  `refunds_restore_coupon` (off by default).
- **Evidence.** `tests/coupon-rules.test.mjs` (percent floor and cap, fixed, free shipping,
  scopes, sale exclusion, minimum order, ₹1 floor, never-negative, allocation, messages,
  admin parsing/audit masking, code generation), `tests/coupon-db-integration.test.mjs`
  (limits, customer history, the row-lock race, the full lifecycle, late-payment restore
  and review flag, refund restore) and `tests/coupon-guards.test.mjs` (migration RLS,
  route guards/audit, preview leaks, storefront wiring, POS isolation, notifications).
- **Migration.** `0041_coupons.sql` creates `coupons`, `coupon_targets` and
  `coupon_redemptions`, all with RLS enabled and no policies; adds `orders.coupon_id`,
  `orders.coupon_snapshot`, `order_items.discount_paise` and its bounds check. Additive
  only.

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
read-only.

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
- **Revenue definition:** order-level revenue — Overview, Sales list Amount, and the
  Order, Day-wise and Customer reports — is the order total as charged
  (items − discount + shipping), with the rupee `amount` fallback for orders created
  before migration `0014`. The Item-wise and Category & brand reports sum line totals,
  which are product revenue and exclude shipping by construction; their notes say so.
- **Coupon usage** (`/reports/coupon-usage`, CSV at
  `/api/store-admin/reports/coupon-usage/export`): one row per redemption in the date
  range, optionally filtered to one code. `Redemptions` counts every ledger row
  (`RESERVED` and `CONSUMED`) because both hold a use; `Discount` and `Order revenue`
  count **`CONSUMED` only** — revenue is the order total, which is already net of the
  discount, and the discount column is the coupon's own share of that order. `RELEASED`
  rows stay visible with their state so a cancelled checkout is never read as money.
  Customer emails are masked in the page and the CSV. The list is capped at 2,000 rows and
  says when it is truncated.
- **Expenses:** `/expenses`, `/expenses/new`, `/expenses/[id]`, with
  `/api/store-admin/expenses/categories`. Expenses feed the expense report and the
  profit view. Currently 0 rows.

### 3.6 Settings — 🟢 Live screens, mixed downstream effect

`/store-admin/settings` is a hub with cards. All pages render from the same validation
code the API uses (`settings-rules.ts`, `setting-lists.ts`), so the UI cannot save a value
the server would reject. Every write is audited.

| Page | Route | What it edits | Downstream status |
|---|---|---|---|
| Business | `/settings` | Trade/legal name, support email/phone, address, country, timezone, time format, footer text, receipt footer, cookie notice, logo/favicon media ids | 🟡 Only `trade_name`, `address`, `phone`, `email`, `receipt_footer` are consumed (by `DocumentHeader`, the invoice/packing-slip footer and the POS receipt). The rest are stored only. |
| Orders | `/settings/orders` | Order prefix, starting number, invoice prefix, auto-confirm, shipping/pickup toggles, free-shipping-over, auto-cancel hours, reservation/failure-grace/unresolved windows, waiting-list toggle + claim window + re-invite cooldown, default fulfilment status, return window, processing/cut-off text, confirm unusual POS prices | 🟢 Prefix/start number, invoice prefix, auto-confirm, default status, auto-cancel hours and return window are consumed at order creation and handling; `shipping_enabled`/`free_shipping_over` feed the shipping quote; the six reservation/waiting-list keys drive §2.15. `pos_confirm_unusual_price` gates the POS typo confirmation. `pickup_enabled` has no checkout control; processing/cut-off text stays stored only. POS receipts keep their separate `receipt_counters` table (`RCP-0000007`). |
| Payments | `/settings/payments` | COD/PayU/manual toggles, PayU mode, payment note | 🟡 `payu_enabled` gates initiate and `payment_note` renders under the checkout PayU helper. `cod_enabled` (default off), `manual_payments_enabled`, `payu_mode` and `payment_methods` are stored only — checkout has no method selector. |
| Storefront | `/settings/storefront` | Login heading/subheading, login background media, support link, reCAPTCHA site key + status | 🔵 None consumed by the storefront. The store-admin login page renders its own copy. |
| Mail | `/settings/mail` | Mail driver/status, SMTP host/port/username/encryption, from email/name, SMS gateway/status/sender id | 🟢 These settings decide whether the outbox can deliver email or SMS. Secrets stay in environment variables; the page still shows only configured/missing badges. |
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

**Known limits.** Indian transactional SMS through MSG91 normally requires a
DLT-registered template id, and no such setting exists, so MSG91 may reject live SMS until
that is added (report, not invented). The POS in-store sale path and sale/refund-induced
low-stock crossings do not raise notifications yet; nor does a later edit to delivery
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
- **What it does:** create staff, change name/phone, change role, deactivate, reset
  password, view and revoke sessions.
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

## 4. Legacy CMS admin (`/admin`)

| Screen | Route | Status | Notes |
|---|---|---|---|
| Login | `/admin/login` | 🟢 Live | Email + password, optional TOTP |
| Dashboard | `/admin` | 🟢 Live | Shows how many content collections have database overrides |
| Content editor | `/admin/content/[key]` | 🟢 Live | Design/marketing `content_blocks` for homepage, OPPO, Education Store, cases. Commerce-shaped fields are rejected. |
| Theme | `/admin/theme` | 🟢 Live | Theme settings read by `app/layout.tsx` |
| Security | `/admin/security` | 🟢 Live | TOTP setup/enable/disable |
| Media | `/api/admin/media` | 🟢 Live | Uploads into the shared `store_media` source; `/api/media/<id>` resolves it |

This panel is functional but **separate** from the store admin. It cannot see orders,
products, customers or settings, and the store admin cannot see content blocks. The
storefront reads whatever this panel writes — but only for design/marketing content.

**Boundary rules (Phase 0)**

- `/api/admin/content` runs `validateLegacyContentWrite()` before every save. A payload
  carrying `price`, `cost_paise`, `sku`, `variants`, `product_id`, `stock`, `discount`,
  `order_id`, `customer_id`, `shipping_method` or similar anywhere in a non-Education
  block is refused with the offending path. `edu.*` is exempt by rule.
- Removing a content override **archives it** (`archived_at = now()`), it does not delete
  the row. Saving the block again clears the archive, so every edit is reversible.
- The legacy media picker writes `store_media`, the same table and bucket Store Admin →
  Media uses; existing `/api/admin/media/<id>` URLs still resolve, including legacy
  `bytea` rows.
- `scripts/check-admin-boundary.mjs` fails the build check if any of the above regresses
  or if the legacy tree references `product_collections`.

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
| `pickup_enabled`, `processing_time_text`, `cutoff_text` | Settings → Orders | — (no checkout pickup control; text is copy only) | 🔵 |
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
| Migrations after `0036` | `0037` is flash-sale reservations, the waiting list, refund obligations and the new notification topics; `0038` indexes failed/cancelled rows still inside their grace window (§2.15); `0039` adds sale pricing and the `sale_settings` switch (§2.16); `0040` lets POS charge the till price; `0041` adds coupons and their redemption ledger (§2.18). The next free number is `0042`. |
| Storefront consuming `product_collections` | The table, API and read layer exist, but no homepage/category rail reads them yet. Phase 1 explicitly excluded collections; wiring them is a later phase. |
| Marketing/newsletter sending | Transactional messages only in this phase. `checkout_marketing_optin` still feeds the subscriber list, not a sender. |
| SMS DLT template ids | MSG91 transactional SMS in India normally needs a DLT-registered template, and no such setting exists. Live MSG91 SMS may be rejected until an id field is designed; reported rather than invented. |
| POS and staff-initiated notifications | In-store sales and their low-stock crossings do not enqueue. A later edit to delivery details after `shipped` sends no second message. |
| PayU refund API | Manual refunds by design. The admin records the refund and the owner moves money in the PayU dashboard. |
| Courier API integration | Third-party courier; the owner supplies a tracking URL template. |
| Wallet, loyalty, serial/IMEI tracking, vendor/marketplace modules | Out of scope for a single store. |
| Education Store admin | Deferred to the end; do not touch. |
| Pickup, COD and maintenance mode at checkout | Shipping rates **are** charged now (§2.14). There is no delivery/pickup control and no payment-method selector, so `pickup_enabled` and `cod_enabled` stay unwired (COD off). Maintenance mode is still not enforced. |
| Storefront reading `store_pages` / `seo_pages` | Not implemented. |
| reCAPTCHA enforcement | Secret not configured and no verification call exists. |
| Public deployment pipeline | No Vercel/CI config in the repo. |

---

## 7. Security model

| Area | Implementation |
|---|---|
| Database access | Server-side only, `DATABASE_URL`, `postgres` tagged templates. The Supabase publishable key is used **only** for read-only `content_blocks`. |
| RLS | Enabled on `users`, `user_sessions`, `orders` (migration `0013`), `product_collections` (`0033`), `order_number_counters` (`0034`), `notification_outbox` (`0035`), `waiting_list_entries`, `stock_reservations`, `refund_obligations` (`0037`), `sale_settings` (`0039`) and `coupons`, `coupon_targets`, `coupon_redemptions` (`0041`). Every table created since ships with RLS enabled in its own migration file, with no policies. |
| Admin identities | Three completely separate stores: customer (`users`), store staff (`store_admins`), legacy CMS (`admin_users`). No cookie or session table is shared. |
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
npm test                    # 581 tests
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
- Legacy CMS — `http://localhost:3000/admin/login`

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
| Coupons | `src/lib/coupons/{rules,codes,store,errors}.ts`, `src/lib/store-admin/{coupons,coupon-rules}.ts`, `src/components/cart/{CouponBox.tsx}`, `src/lib/cart/useCoupon.ts`, `src/app/api/coupons/validate/route.ts`, `src/app/api/store-admin/coupons/**`, `src/app/api/store-admin/reports/coupon-usage/export/route.ts`, `src/app/(store-admin)/store-admin/(protected)/coupons/**`, `src/app/(store-admin)/store-admin/(protected)/reports/coupon-usage/page.tsx`, `src/components/store-admin/{CouponForm,CouponActions}.tsx`, `migrations/0041_coupons.sql`, `tests/{coupon-rules,coupon-db-integration,coupon-guards}.test.mjs` |
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
| Admin boundary | `src/lib/admin/boundary.ts`, `scripts/check-admin-boundary.mjs`, `scripts/migrate-cms-products.mjs`, `src/lib/admin/cms-product-migration.ts`, `PHASE0-AUDIT.md` |
| Store-admin pages | `src/app/(store-admin)/store-admin/**` |
| Store-admin APIs | `src/app/api/store-admin/**` |
| Settings engine | `src/lib/store-admin/settings-rules.ts`, `setting-lists.ts`, `notification-settings.ts`, `secret-status.ts` |
| Notifications | `src/lib/notifications/{types,rules,templates,settings,enqueue,queue,outbox,providers,order-context,stock-events}.ts`, `src/app/api/store-admin/settings/notifications/retry/route.ts`, `src/components/store-admin/{NotificationMatrix,NotificationRetryButton}.tsx`, `migrations/0035_notification_outbox.sql` |
| Payment review flag | `src/lib/store-admin/payments.ts`, `src/app/api/store-admin/payments/review-flag/route.ts`, `src/components/store-admin/PaymentReviewFlagActions.tsx`, `migrations/0036_order_payment_review.sql` |
| Audit | `src/lib/store-admin/audit.ts`, `audit-log.ts`, `migrations/0010_store_admin_auth.sql` |
| Legacy CMS | `src/app/(admin)/admin/**`, `src/app/api/admin/**`, `src/lib/admin/*` |
| Database | `migrations/*.sql` |
| Tests | `tests/*.test.mjs` |
