# Product options Phase 5 — one option's stock, order and price — 5 November 2026

**Implemented and verified, including the database acceptance suite (3/3 pass on the
approved session-pooler target).**

## Done-when scenario

Buy the last red iPhone 16: the red option's stock goes down by one and the blue
option's does not move. Pay — the order keeps its hold and nothing is deducted a second
time. Fail, cancel or abandon the payment — the unit comes back once, and a duplicate or
late callback can never give it back twice. Receive a payment after expiry — the order
takes back exactly the units its release ledger returned. Return one unit after a
five-unit claim — only the option sold is restocked, and only up to what was sold. Edit
the option's price afterwards — the order already placed keeps the price it was charged
and its coupon hold, its reservation and its stock row are untouched; the next buyer pays
the new price. Every stock number in store admin then equals what `stock_movements` says.

## What the admin now shows

### 1. Stock screen — one line per sellable identity

`listStockOverview` already emitted one row per purchasable option. The screen now says
so: the header distinguishes *products* from *stock lines* and marks the list as "one per
option" when they differ; each row carries the option's SKU and model/option label, and
the first row of each product carries the product total (`Product total: X in stock · Y
available`) summed only over tracked, non-legacy identities. Stat notes read *Stock lines
checkout checks* and *Products or options at or below the warning level*.

### 2. Stock detail — totals, options and the movement trail

The product stock page (unchanged query, verified) shows variant-mode totals, a **Stock
per option** table with on-hand/reserved/available/threshold per option, the product-level
controls only for product-mode products, and a movement history whose `Option` column
names the model and option for every ledger line (`getStockDetail` joins
`product_variants` and `device_models`).

### 3. Low-stock screen and both reports

`listLowStock` returns one row per tracked identity with its own count and threshold, the
model/option label and its SKU; the page copy, counters ("Items with stock limits") and
table header ("Product or option") now match. The Stock and Low-stock reports were already
built from `INVENTORY_REPORT_CTE` (one row per product or purchasable option); their
`howCalculated` and `description` text now say so instead of describing products only.

### 4. Price history per option

The product price-history query joins `product_variants` and `device_models`, so each
entry shows the stored model/option label and the option SKU next to the old/new regular
and sale prices, change group, kind and actor. A rename later does not rewrite history:
the stored row is shown first, the live variant only fills a gap.

### 5. Orders, packing slip and invoice

The orders list quick view (`item_summary`), the order detail item list, the packing slip
and the invoice all name the model and colour that were sold, through the order-time
snapshot columns added in 0061 and `optionSnapshotLabel` ("iPhone 16 · Red"). Old orders
keep their stored `variant_label`; nothing is backfilled. POS writes the same snapshot
(model id/name, colour id/name/hex, photo) and keeps a pre-0061 fallback insert.

## What did not change

- **Per-option low-stock notifications are not queued.** Only the product-level
  `stock/[productId]/adjust` route calls `queueNotification`; option adjustments through
  product-draft/variant-inventory do not. This is a known limitation, recorded here rather
  than half-wired in this phase.
- Price editing on the Sale page stays off (the PayU flow reads database prices, but the
  Sale page bulk editor still applies product defaults only); option price editing goes
  through the audited `updateVariantPricingUsing` path.
- No migration, seed, backfill or data write was performed. No existing order, stock row,
  SKU, variant, price or audit row was altered.

## Tests

### Offline — `tests/phase5-option-admin-surfaces.test.mjs` (9 tests, all pass)

- `optionSnapshotLabel`/`optionSnapshotColour` behaviour, including the legacy fallback
  and hex validation.
- Orders list aggregates `variant_device_model_name`/`variant_colour_name` per line, in
  line order; order detail maps them through `optionSnapshotLabel`; both documents are
  built from `getOrderDetail`, and the packing slip and `OrderDocument` render the label.
- POS reads the model/colour joins, probes `information_schema.columns` for
  `variant_colour_id`, writes all snapshot columns and keeps the legacy insert.
- Stock overview skips the legacy bucket for totals and reports product totals; stock
  detail labels options and movements through `device_models`; low-stock labels and the
  page copy are per option.
- The Stock and Low-stock report definitions describe per-option rows.
- Price history joins variants and models and keeps the stored label/SKU first.
- `returns.ts` builds per-variant restock lines from `order_items`; the cap lives in
  `restoreSoldStock` through `restoreableQuantity`.
- A price edit's body writes only `product_variants`, `price_history` and the audit row —
  no `orders`, `order_items`, `coupon_redemptions`, `stock`, `stock_movements` or
  `reservation_state` write appears in it.
- The Sale page lists a row per option with the option's own price and stock.

### Database — `tests/phase5-option-lifecycle.test.mjs` (3 tests, all pass)

Gated by `RUN_LEGACY_DB_TESTS=1` and a session (not 6543) `DATABASE_URL`. Each test
creates its own throwaway `itest_*` schema with `create table … (like public.x including
all)`, rebinds serial defaults, enables RLS on every copied table, pins `search_path`, and
drops the schema in `finally`. Nothing in `public` is read or written.

The first real run exposed two fixture requirements the offline skip could not: the copied
`store_admins` needs `email` and `password_hash` (seeded with a fixture-only address and a
non-credential hash), and the authoritative sale read needs the single `sale_settings`
`default` row. Both are now seeded; the production code was not changed.

1. **One option through its whole life** — claim, PAY in place (no second deduction),
   duplicate PAY, FAILED release, duplicate FAILED, cancel-after-failure no-op, CANCELLED
   release, expiry release and duplicate expiry, late capture reclaiming exactly the
   released unit, duplicate late capture, then a five-unit return capped to the one unit
   sold. After every step the sibling option's stock is asserted unchanged, and at the end
   each stock row must equal its opening count plus `stock_movements`. The admin reads
   (`listStockOverview`, `getStockDetail`, `listLowStock`) are then exercised inside the
   fixture: per-option rows, product totals, labelled movements and low-stock rows.
2. **Two buyers of the last unit of one option** — two connections race; exactly one order
   is created, the loser gets `InsufficientStockError` (`insufficient_stock`), one sale
   movement exists, and a purchase of the sibling option afterwards succeeds.
3. **Price edit isolation** — the displayed price is read from the database, the order is
   created at it, and a `RESERVED` coupon redemption is recorded for the order. After
   `updateVariantPricingUsing` the line price, order total, redemption, reservation and
   stock/ledger are unchanged; the option override is 90000, one `price_history` row with
   a `pcg_` change group exists, the next database price read is 90000, and the next order
   is charged 90000.

## Measured

| Check | Result |
| --- | --- |
| Full `npm test` (DB opt-ins disabled) | **1,718 tests / 1,631 pass / 0 fail / 87 skipped / 0 cancelled** |
| New offline suite | 9/9 pass |
| New database suite, `RUN_LEGACY_DB_TESTS=1` | **3/3 pass** — full life 74.97 s, last-unit race 38.09 s, price edit 37.38 s |
| `npm run typecheck` | Passed |
| `npm run build` | Passed (existing external-lockfile warning retained) |
| Store-admin route guard | Passed: 122 routes |
| Account guard / admin boundary | Passed: 21 APIs and 11 pages; admin boundary OK |
| `check:notifications` | **3 pass / 5 fail**, unchanged: SMTP/SMS not configured and the staff-email/customer-SMS matrix cells are off; no message sent |
| `npm audit` | 0 vulnerabilities |

**Database run target (approved):** host `aws-0-ap-northeast-1.pooler.supabase.com`,
session pooler port 5432. Before the run: products 15, product_variants 36, stock 15,
stock_movements 27, orders 51, order_items 49, coupons 3, coupon_redemptions 4. After the
run the same public counts were re-read unchanged, and the schema list shows no new
throwaway schema — every `itest_*` schema the suite created was dropped. Seven old
throwaway schemas (`fs_*`/`itest_*`) remain from earlier approved runs and are unrelated.

## Known limitations

- Option-level low-stock notifications are not queued (product-level only).
- The Sale page's bulk percent still applies product defaults, never option prices.
- The database suite proves the engine, the order transitions and the admin reads inside
  its own schemas. It is not an authenticated browser flow (no store-admin session, no
  HTTP route) and it does not exercise the PayU callback route end to end; those remain
  covered by the existing offline route tests.

## File map

- `src/lib/store-admin/{catalog.ts,catalog-crud.ts,report-rules.ts,orders.ts,order-channel.ts}`
- `src/app/(store-admin)/store-admin/(protected)/{stock/page.tsx,low-stock/page.tsx}`
- `src/lib/store-admin/{pos.ts,returns.ts,order-documents.ts}` (verified, unchanged)
- `tests/phase5-option-admin-surfaces.test.mjs` (new)
- `tests/phase5-option-lifecycle.test.mjs` (new)
