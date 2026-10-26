# Gadzio — Feature Reference

**Verified:** 26 October 2026, against the code in this repository and the database
reached through `.env.local`.

**Evidence collected at that moment**

| Check | Result |
|---|---|
| `npm test` | **300 tests, 300 pass, 0 fail** |
| `node scripts/catalog-parity.mjs` | no fatal gaps: all 12 static products/variants exist in the database; 2 price drifts and 1 database-only product reported |
| `node scripts/check-store-admin-routes.mjs` | **All 84 store-admin routes are guarded** |
| `node scripts/check-setting-lists.mjs` | all 12 settings tables readable, 72 notification cells |
| `node scripts/check-admin-boundary.mjs` | legacy CMS holds no commerce field; 11 Education collections exempt |
| `npm run typecheck` / `npm run build` | both succeed |
| Live smoke test (`next start`) | home, product, buy, six category pages, cases (both routes), search, cart and bag return 200; unknown product id returns 404; database prices render |
| Migrations applied | `schema_migrations` holds all 31 migration files through `0033_storefront_collections.sql`; Phase 1 added no migration |
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
| `MAIL_PASSWORD`, `MSG91_AUTH_KEY`, `TWILIO_AUTH_TOKEN` | **no** | No outbound email or SMS exists in code at all. |

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
  │        └── 84 API routes, each requireStoreRole(...); owns products, collections, orders, customers
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
- **Prices:** the displayed amount is `price_paise / 100`, the same column checkout reads,
  so the page price and the PayU amount cannot drift.
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
- **Caveat:** stock is not held while an item sits in a bag. A line keeps the name and
  image it had when added; only price and availability are refreshed.

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
     the request, creates the order (`PENDING`), builds the PayU request hash and returns a
     hidden form. The browser auto-submits it to PayU.
  4. If the customer ticked the offer box **and** `checkout_marketing_optin` is on, the
     email is also inserted into `newsletter_subscribers`. Failure to record it never
     blocks the payment.
  5. PayU calls back to `/api/payu/success`, `/api/payu/failure`, `/api/payu/cancel`.
     `src/lib/payu/process-response.ts` verifies the reverse hash, calls PayU’s
     verification API for the transaction, then performs an **atomic, idempotent** status
     transition. A duplicate callback cannot double-mark an order paid.
  6. `/api/payu/webhook` accepts the same payloads server to server (rate limited to 100
     per minute per IP). `/api/payu/reconcile` re-checks stale pending orders.
- **No other payment method exists.** There is no cash-on-delivery path, no manual bank
  transfer path and no wallet. `payment_methods` in settings is not consulted.

### 2.8 Order result pages — 🟢 Live

| Route | What it shows |
|---|---|
| `/order/success` | Order summary after a verified payment. Reads the order by `txnid`; requires the signed-in owner if the order belongs to a user. |
| `/order/failed` | Failure page with a safe reason code (never a raw PayU response). |
| `/order/cancelled` | Cancellation page. |
| `/order/status` | Public-ish lookup by transaction ID. Shows only safe status labels from `getCustomerOrderStatus`. |

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
  - return: only after `DELIVERED`, within **7 days** of delivery;
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
   bundle. Per-product detail reads also carry `storefront-product:<id>`.
3. A component receives plain props. No client component queries the database.
4. Every catalogue-changing Store Admin write calls `revalidateCatalog(productId?)` after
   its audit row, so the next visit reads fresh data. Every call revalidates the
   `storefront-catalog` tag; a product-specific call also revalidates
   `storefront-product:<id>`.
5. On a database outage the read layer catches the failure and returns the static bundle,
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

**No migration was needed.** Phase 1 added no table or column; the next number remains
`0034`.

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
  this mechanically: 83/83 guarded.
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
- **What it does:** in-store selling. Search the catalogue, build a basket, take a payment
  (cash/UPI/card recorded manually), print a receipt, close the shift.
- **How it works:** `POST /api/store-admin/pos/sales` creates an order with
  `channel = 'pos'`, decrements stock and writes payment rows. `pos_shifts` records the
  opening/closing float and totals. The catalogue comes from the database through
  `/api/store-admin/pos/catalog`.
- **Caveat:** POS orders never touch PayU and are not visible to the customer account.

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

### 3.3 Catalog

| Screen | Route | Status | Notes |
|---|---|---|---|
| Products list | `/products` | 🟢 Live | Filter, search, CSV export, status badges |
| New product | `/products/new` | 🟢 Live | Full create form |
| Edit product | `/products/[id]` | 🟢 Live | Details, price, cost, images, variants, attributes, specs |
| Price history | same page, `price` API | 🟢 Live | Every price write appends to `price_history` |
| Variants | `.../variants` API | 🟢 Live | SKU, options, stock |
| Images | `.../images` API | 🟢 Live | Ordered gallery, archive rather than hard delete |
| Categories | `/categories` | 🟢 Live | CRUD |
| Collections | `/collections` | 🟢 Live (no consumer yet) | Named, ordered product lists in `product_collections`; add, remove (archive), reorder |
| Brands, units, conditions, attributes | `/catalog` tabs | 🟢 Live | CRUD through catalog APIs |
| Stock | `/stock` | 🟢 Live | Per-product stock summary |
| Stock adjust | `/stock/[productId]` | 🟢 Live | Append-only `stock_movements`, reason required |
| Low stock | `/low-stock` | 🟢 Live | Available ≤ the product's own `stock.low_stock_threshold` |
| Catalogue data transfer | `/catalog/transfer` | 🟢 Live | CSV import/export, per-row error report |
| Reviews | `/reviews` | 🟢 Live | Approve/reject/hide product reviews |
| Media | `/media` | 🟢 Live | Upload to Supabase Storage; `/api/media/[id]` redirects to the public object URL |

**Price editing gate:** the PayU flow now reads prices from the database
(`src/lib/payu/db-catalog.ts`), which was the condition in the design. Price writes are
therefore enabled. `cost_paise` is internal and never sent to the storefront.

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

- **Reports:** `/reports` hub and `/reports/[report]`. Ten reports exist:
  Order, Item-wise, Day-wise, Transaction statement, Payment reconciliation, Expense,
  Stock, Low-stock, Customer, Category & brand. Each supports date range, channel,
  status, category and brand filters where relevant, plus CSV export.
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
| Orders | `/settings/orders` | Order prefix, starting number, invoice prefix, auto-confirm, shipping/pickup toggles, free-shipping-over, auto-cancel hours, default fulfilment status, processing/cut-off text | 🔵 None consumed. Order ids are hard-coded `GDZ{time}{rand}`; invoice references use the `txnid`; POS receipts use a separate `receipt_counters` table formatted `RCP-0000007`. |
| Payments | `/settings/payments` | COD/PayU/manual toggles, PayU mode, payment note | 🔵 None consumed. Checkout is PayU-only; nothing reads `cod_enabled`, `manual_payments_enabled`, `payu_mode` or `payment_note`. |
| Storefront | `/settings/storefront` | Login heading/subheading, login background media, support link, reCAPTCHA site key + status | 🔵 None consumed by the storefront. The store-admin login page renders its own copy. |
| Mail | `/settings/mail` | Mail driver/status, SMTP host/port/username/encryption, from email/name, SMS gateway/status/sender id | ⚪ Status only — no mail/SMS sender code exists. |
| Shipping | `/settings/shipping` | Couriers + tracking templates, shipping methods and rates, live link tester | 🟢 Couriers + tracking templates used at delivery save; 🔵 rates |
| Notifications | `/settings/notifications` | 72 toggles (12 events × 3 channels × 2 audiences), automated messages, email templates | 🔵 Stored only |
| Content | `/settings/content` | Store pages (8) and fixed SEO rows (14) | 🔵 Stored only — no route renders `store_pages`, no metadata reads `seo_pages` |
| Analytics | `/settings/analytics` | Social links, analytics script IDs, integrations (storage/mail/payment/webhook) | 🔵 Stored only |
| Reasons | `/settings/reasons` | Cancellation reasons, refund reasons, return reasons | 🟡 Cancellation reasons are used by the returns/cancel flow; refund and return reason lists are stored only. |
| Staff | `/settings/staff` | See §3.7 | 🟢 |
| Audit log | `/audit-log` | Filter and export the audit trail | 🟢 |

> **No cancellation-window or return-window setting exists.** The customer return
> window is the hard-coded constant `RETURN_WINDOW_DAYS = 7` in
> `src/lib/account/request-rules.ts`; cancellation eligibility is decided from the
> order’s fulfilment status, not a configured duration.

#### Shipping methods — 🔵 Stored only
`shipping_methods` supports name, rate, free-over threshold, ETA range and active flag.
No code reads it. Checkout has **no shipping calculation at all**; the PayU amount is the
cart subtotal.

#### Notifications — 🔵 Stored only
The matrix and message templates persist, but there is no dispatcher, no outbox table and
no provider client. Nothing is ever sent.

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
| Order/invoice prefixes and numbering | Settings → Orders | — (ids are hard-coded `GDZ{time}{rand}`; POS uses `RCP-######`) | 🔵 |
| `auto_confirm`, `shipping_enabled`, `pickup_enabled`, `free_shipping_over`, `auto_cancel_unpaid_hours`, `default_fulfilment_status`, `processing_time_text`, `cutoff_text` | Settings → Orders | — | 🔵 |
| `guest_checkout` | Customers → Settings | Checkout page + PayU initiate | 🟢 |
| `checkout_marketing_optin` | Customers → Settings | Checkout UI + newsletter insert | 🟢 |
| `default_customer_group` | Customers → Settings | Sign-up | 🟢 |
| `fulfilment_providers` + tracking template | Settings → Shipping | Delivery save | 🟢 |
| `cancellation_reasons` | Settings → Reasons | Returns/cancel flows | 🟢 |
| `shipping_methods` (rates, free-over, ETA) | Settings → Shipping | — | 🔵 |
| `payment_methods`, `cod_enabled`, `payu_enabled`, `manual_payments_enabled`, `payu_mode`, `payment_note` | Settings → Payments | — | 🔵 |
| `refund_reasons`, `return_reasons` | Settings → Reasons | — | 🔵 |
| `login_heading`, `login_subheading`, `login_background_media_id`, `login_support_link`, `recaptcha_site_key`, `recaptcha_status` | Settings → Storefront | — | 🔵 |
| `maintenance_enabled`, `maintenance_message`, `maintenance_starts_at`, `maintenance_ends_at` | Settings → Storefront (owner only) | — | 🔵 |
| `mail_driver`, `mail_status`, `mail_host`, `mail_port`, `mail_username`, `mail_encryption`, `mail_from_email`, `mail_from_name`, `sms_gateway`, `sms_status`, `sms_sender_id` | Settings → Mail | — | 🔵 |
| Notification matrix (72 cells) | Settings → Notifications | — | 🔵 |
| Automated messages | Settings → Notifications | — | 🔵 |
| Email templates | Settings → Notifications | — | 🔵 |
| `store_pages` | Settings → Content | — | 🔵 |
| `seo_pages` | Settings → Content | — | 🔵 |
| Social links | Settings → Analytics | — | 🔵 |
| Analytics script IDs | Settings → Analytics | — | 🔵 |
| Integrations (storage/mail/webhooks) | Settings → Analytics | — | 🔵 |
| SMTP password, MSG91/Twilio token, reCAPTCHA secret, PayU key/salt | Environment only | Secret-presence badges | ⚪ |

Summary: of the **50 keys** in `store_settings`, **5 are consumed** (`trade_name`,
`address`, `phone`, `email`, `receipt_footer`), plus the three customer settings which
live in `customer_settings`. The remaining 45 are persisted and audited but read by
nothing.

`store_settings` currently holds **1 row** — the smoke run from Phase 9 set `trade_name` to
“Gadzio”. Every other key still shows its coded default.

---

## 6. Deferred or not built

These are deliberate gaps, not bugs.

| Item | Why |
|---|---|
| Migrations `0034`–`0035` | Reserved for notifications/outbox, background jobs and search indexes. Not written yet. (`0033` is now `product_collections` + `content_blocks.archived_at`.) |
| Storefront consuming `product_collections` | The table, API and read layer exist, but no homepage/category rail reads them yet. Phase 1 explicitly excluded collections; wiring them is a later phase. |
| Email and SMS delivery | No provider client, no outbox, no worker. The settings exist so the configuration has a home when the sender is built. |
| PayU refund API | Manual refunds by design. The admin records the refund and the owner moves money in the PayU dashboard. |
| Courier API integration | Third-party courier; the owner supplies a tracking URL template. |
| Wallet, loyalty, serial/IMEI tracking, vendor/marketplace modules | Out of scope for a single store. |
| Education Store admin | Deferred to the end; do not touch. |
| Storefront consuming shipping rates / COD / maintenance mode | Not implemented. Checkout is PayU-only and free of shipping charges. |
| Storefront reading `store_pages` / `seo_pages` | Not implemented. |
| reCAPTCHA enforcement | Secret not configured and no verification call exists. |
| Public deployment pipeline | No Vercel/CI config in the repo. |

---

## 7. Security model

| Area | Implementation |
|---|---|
| Database access | Server-side only, `DATABASE_URL`, `postgres` tagged templates. The Supabase publishable key is used **only** for read-only `content_blocks`. |
| RLS | Enabled on `users`, `user_sessions`, `orders` (migration `0013`) and `product_collections` (`0033`). Every table created since ships with RLS enabled in its own migration file. |
| Admin identities | Three completely separate stores: customer (`users`), store staff (`store_admins`), legacy CMS (`admin_users`). No cookie or session table is shared. |
| Role checks | Every store-admin API route calls `requireStoreRole(...)`; verified by `scripts/check-store-admin-routes.mjs`. |
| CSRF | `assertSameOrigin(request)` on every mutating store-admin route and on account request routes. |
| Audit | `store_admin_audit` is append-only at the database level (trigger). PII is masked; IP and user agent are hashed. |
| Secrets | Never stored in the database and never rendered. Settings pages show only “configured / missing” badges via `secret-status.ts`. |
| Rate limiting | In-memory sliding window on PayU initiate, PayU webhook (100/min/IP) and customer order requests (10/15 min/user). |
| Payment integrity | Reverse-hash verification plus a server-side PayU verification call before an order becomes paid; atomic idempotent transition prevents double capture. |
| Order documents | Invoice/packing slip pages are behind the store-admin session and role check. |

**Open issue to fix before a public launch:** `CRON_SECRET` is unset. In
`src/app/api/payu/reconcile/route.ts`, the secret check is skipped entirely when the
variable is empty, so anyone who knows the URL can trigger a reconciliation run. The run
only re-checks stale pending orders and cannot mark a fake payment paid (PayU’s
verification still applies), but the endpoint should be closed. Set `CRON_SECRET` in the
deployment environment — the check activates automatically once the variable exists.

---

## 8. Running and verifying locally

```bash
npm install
npm run db:migrate          # applies migrations/*.sql in order
npm run dev                 # http://localhost:3000
npm test                    # 300 tests
node scripts/catalog-parity.mjs                 # read-only static ↔ database parity report
node scripts/check-store-admin-routes.mjs
node scripts/check-setting-lists.mjs
node scripts/check-admin-boundary.mjs
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
| PayU | `src/lib/payu/*`, `src/app/api/payu/*` |
| Cart | `src/lib/cart/*` |
| Customer account | `src/lib/account/*`, `src/app/api/account/*` |
| Store-admin auth | `src/lib/store-admin/auth.ts`, `src/app/api/store-admin/auth/*` |
| Store-admin data | `src/lib/store-admin/*` |
| Collections | `src/lib/store-admin/collections.ts`, `src/lib/store-admin/collection-rules.ts`, `src/lib/storefront/collections.ts`, `src/lib/storefront/collections-rules.ts`, `src/components/store-admin/CollectionManager.tsx` |
| Admin boundary | `src/lib/admin/boundary.ts`, `scripts/check-admin-boundary.mjs`, `scripts/migrate-cms-products.mjs`, `src/lib/admin/cms-product-migration.ts`, `PHASE0-AUDIT.md` |
| Store-admin pages | `src/app/(store-admin)/store-admin/**` |
| Store-admin APIs | `src/app/api/store-admin/**` |
| Settings engine | `src/lib/store-admin/settings-rules.ts`, `setting-lists.ts`, `notification-settings.ts`, `secret-status.ts` |
| Audit | `src/lib/store-admin/audit.ts`, `audit-log.ts`, `migrations/0010_store_admin_auth.sql` |
| Legacy CMS | `src/app/(admin)/admin/**`, `src/app/api/admin/**`, `src/lib/admin/*` |
| Database | `migrations/*.sql` |
| Tests | `tests/*.test.mjs` |
