ROLE
You are a senior full-stack and backend engineer working in the Gadzio repository
(Next.js App Router, TypeScript, Postgres via DATABASE_URL, Supabase REST for read-only
content_blocks, PayU checkout). Read FEATURES.md first. It is the verified source of truth
for what is wired and what is stored-only.

GOAL
1. Make the customer-facing storefront dynamic by making it consume the data and settings
   that the Store Admin (/store-admin) already manages, so an admin edit is visible on the
   storefront without a code change or redeploy.
2. Keep the two admin panels cleanly separated:
   - Store Admin (/store-admin) owns everything commercial: products, prices, stock,
     images, categories, brands, orders, shipping, payments, customers, notifications.
   - Legacy CMS admin (/admin) is ONLY for website design and marketing content:
     homepage layout and copy, hero and tile imagery, theme, OPPO page content, TOTP
     security. Anything product- or commerce-related found there must be moved out of it
     and into the Store Admin.

HARD CONSTRAINTS (non-negotiable)
1. Do NOT add, remove, rename or move any STOREFRONT route (pages or API paths).
   Store Admin may gain the minimum new screens/APIs needed for the move in Phase 0;
   every new store-admin API must call requireStoreRole(...) and, if mutating,
   assertSameOrigin(request).
2. Do NOT change the visual UI of the storefront: no layout, styling, copy, class names
   or component structure changes. Pixel output must be identical when the database holds
   the same values as the current hard-coded data. You may only change WHERE data comes
   from.
3. Do NOT touch the Education Store (/in-edu/store) or its admin or content keys.
4. Do NOT change the three separate identity systems (customer, store admin, legacy CMS)
   or their cookies/sessions.
5. Keep pricing fail-closed: the amount charged is always resolved from the database
   (src/lib/payu/db-catalog.ts). Never trust a client-sent price.
6. Never expose cost_paise, internal notes, audit data, secrets or masked PII to the
   storefront. Select explicit columns; no SELECT *.
7. Every new table ships with RLS enabled in its own migration file (next free number is
   0033). Prefer reusing existing tables; add a migration only when truly needed.
8. All DB access stays server-side through DATABASE_URL (postgres tagged templates). The
   Supabase publishable key stays limited to read-only content_blocks.
9. Existing tests (249) and both check scripts must still pass. Add tests for every new
   rule. scripts/check-store-admin-routes.mjs must report every route guarded.
10. Graceful fallback: if the DB is unreachable or a row is missing, fall back to the
    current hard-coded defaults so the site never breaks and never shows an empty page.
11. No destructive data changes. Never delete content_blocks rows; archive or mark them.

WORKING METHOD
- First produce a short plan listing each file you will change and the data source it
  will read. Then implement phase by phase. After each phase run npm test, both check
  scripts and npm run build, and report results before moving on.
- Build one shared server-side read layer (for example src/lib/storefront/*) with small
  cached readers (React cache() plus revalidate tags). Admin write APIs must call
  revalidateTag/revalidatePath so edits appear immediately. Do not query the DB directly
  from components.
- Keep the existing static data files as the fallback defaults, not as the primary source.

----------------------------------------------------------------------
PHASE 0: Admin boundary audit and consolidation (do this first)
----------------------------------------------------------------------
Step A. Audit (read-only, report before changing anything).
  Inspect src/app/(admin)/admin/**, src/app/api/admin/**, src/lib/admin/*, and every
  content_blocks key the legacy editor can write. Produce a table:
    key / field -> what it controls -> design/marketing, or product/commerce?
  Known suspects from FEATURES.md that must be checked in the code:
    a. cases.* content blocks (Cases & Protection): if they carry product names, prices,
       images, variants or stock text, they are product data, not design.
    b. Homepage product carousels: the choice of WHICH products appear is merchandising
       and belongs with the catalogue. Carousel headings and tile copy stay in the CMS.
    c. Any field in the OPPO or homepage blocks holding a price, SKU, product ID,
       stock status or discount. Those are commerce data.
    d. Legacy media library (/api/admin/media) duplicates Store Admin -> Media (which
       uploads to Supabase Storage). Report whether the two can share one source.
  Do NOT touch the Education Store keys even if they look product-like. List them as
  "left alone by rule".

Step B. Move product/commerce data into the Store Admin.
  - Product fields in cases.* blocks: write an idempotent, dry-run-first migration script
    (scripts/migrate-cms-products.mjs) that maps each item to the matching products /
    variants / images rows by product ID or SKU. Report unmatched items; never guess.
    Where the DB row already has the value, the DB wins.
  - Carousel and collection membership: add migration 0033 with a small table, for
    example product_collections (collection key, product_id, position, active) with RLS
    on. Add a Store Admin screen under Catalog (reuse the existing catalog tab pattern)
    plus guarded APIs to add, remove and reorder products in a collection. The homepage
    carousels read membership from here and fall back to the current CMS/static list if
    the collection is empty.
  - Anything else commerce-related found in Step A goes to the matching existing store
    admin screen (price -> Products, stock -> Stock, etc.). Do not duplicate editors.

Step C. Strip it from the legacy admin.
  - Remove the migrated product/commerce fields from the content editor screens and make
    the legacy save API reject writes to them (return a clear validation error).
  - Leave in /admin only: homepage and OPPO layout/copy/imagery, theme, security (TOTP),
    and Education Store content.
  - Do not delete old rows; mark them archived so rollback is possible. Keep the
    storefront readers tolerant of both old and new shapes until verified.
  - Media: if the two libraries can safely share one table, point the legacy editor's
    image picker at the same media source and keep existing /api/admin/media URLs
    working. If not safe, leave it and report why.

Step D. Prove the boundary.
  - Add a check script (scripts/check-admin-boundary.mjs) that fails if any legacy admin
    field or API accepts product, price, stock, order, customer or shipping data.
  - Tests: migration idempotence, DB-wins rule, legacy API rejects product keys,
    collection ordering, empty-collection fallback.
  - Acceptance: the legacy /admin can no longer change what a product is called, costs,
    or whether it is in stock; the Store Admin is the only place that does.

----------------------------------------------------------------------
PHASE 1: Catalog becomes the single source of truth (biggest gap)
----------------------------------------------------------------------
- Product detail (/shop/product/[productId], /shop/buy/[productId]), the six accessory
  category pages and Cases & Protection: read name, price, compare-at price, images,
  variants, stock status, attributes and specs from the products tables (products,
  variants, images, categories, brands, attributes, price_history).
- Map DB fields onto the exact props the current components already accept so the UI does
  not change. Archived or inactive products must not render. An unknown ID returns the
  existing 404 behaviour.
- Stock: show in-stock / low-stock / out-of-stock from stock_movements totals. Block
  add-to-bag and buy-now for out-of-stock variants using the existing disabled states.
  Use the product's own stock.low_stock_threshold for the low-stock hint.
- Approved reviews (/store-admin/reviews) feed the rating and review count where the page
  already shows them. Hidden and rejected reviews never appear.
- Search (/search): keep it client-side, but build allSearchItems from server-fetched
  JSON of active products instead of the static registry. Education Store items stay as
  they are.
- Homepage product carousels: resolve products from the DB by ID, using the
  product_collections membership built in Phase 0.
- Acceptance: change a product's price, name, image or stock in /store-admin and the
  storefront shows the change on the next request. The charged amount still matches.

----------------------------------------------------------------------
PHASE 2: Orders, shipping and checkout settings
----------------------------------------------------------------------
- Shipping: read shipping_methods and free_shipping_over, and compute shipping
  server-side in /api/payu/initiate. Add it to the amount and show it in the existing
  checkout totals row (use the row that exists; do not redesign). If no active method
  exists, keep today's behaviour (no shipping charge).
- Respect shipping_enabled and pickup_enabled.
- Order numbering: use order prefix and starting number from settings instead of the
  hard-coded GDZ{time}{rand}, via a transactional counter (like receipt_counters). Keep
  txnid unique and keep old orders valid. Invoice reference uses the invoice prefix.
- auto_confirm and default_fulfilment_status: apply on payment success.
- auto_cancel_unpaid_hours: have /api/payu/reconcile cancel stale PENDING orders after
  the configured hours and restore stock.
- Payments settings: honour payu_enabled and payment_note on checkout. Only render a COD
  option if cod_enabled is true AND a COD order path exists. If COD is not built,
  implement a minimal COD order creation (status ACCEPTED, payment pending) behind the
  setting, defaulting off, without changing the layout.
- Return window: make the 7-day RETURN_WINDOW_DAYS configurable from settings, default 7.
  Add a setting and field only if one does not exist.
- Guest checkout, marketing opt-in and default customer group already work; do not
  regress them.

----------------------------------------------------------------------
PHASE 3: SKIPPED
----------------------------------------------------------------------
Business footer/cookie/favicon, store_pages, seo_pages, storefront login copy,
maintenance mode, analytics scripts and reCAPTCHA stay stored-only. Do not implement
them. Do not remove their admin screens.

----------------------------------------------------------------------
PHASE 4: Notifications actually send (no UI changes)
----------------------------------------------------------------------
- Add migration 0034 with a notification_outbox table (RLS on) and a small worker invoked
  from order status transitions, payment success and request updates.
- Honour the notification matrix (event x channel x audience), automated messages and
  email templates. Substitute only whitelisted variables (order number, customer name,
  total, tracking link). Escape all values.
- Provider clients: SMTP from the mail settings and MSG91/Twilio from env. If a provider
  is not configured, mark outbox rows SKIPPED and never block the order flow. Retry with a
  capped attempt count. Never log secrets or full PII.

----------------------------------------------------------------------
PHASE 5: Security and hardening
----------------------------------------------------------------------
- Make /api/payu/reconcile refuse requests when CRON_SECRET is unset (at least in
  production). Fail closed.
- Keep same-origin checks, rate limits and masked-PII rules.
- Confirm no new endpoint leaks cost, notes, audit data or other customers' data.

DELIVERABLES
1. The audit table from Phase 0 Step A, then the plan, then the code, phase by phase, in
   small reviewable commits.
2. Tests for: DB-vs-fallback behaviour, stock gating, shipping calculation, order
   numbering uniqueness under concurrent calls, the admin boundary, collection ordering,
   settings consumption and the outbox skip path.
3. An updated FEATURES.md: flip every item you wired from stored-only/static to live,
   update the evidence table (test count, route check, build) and the consumed-vs-stored
   table, and describe the new admin split (what /admin keeps, what moved).
4. A short before/after list of which admin setting now changes which storefront
   behaviour, and which fields were removed from the legacy admin and where they live now.

DEFINITION OF DONE
- An admin edit to a product, price, stock level, collection, shipping rate or
  notification setting is visible on the storefront without touching code.
- The legacy /admin contains only design and marketing content; nothing commercial can be
  edited there.
- Zero storefront route changes and zero visual diffs (verify with before/after
  screenshots of the homepage, a product page, the cart, checkout and /account).
- npm test, both check scripts, the new boundary check and npm run build all pass.
- With the database unreachable, every page still renders from its fallback defaults.