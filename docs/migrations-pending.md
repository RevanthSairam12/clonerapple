# Migrations 0055–0061 — applied 5 November 2026

These seven files carry the Phase 2 and Phase 3 options work. All of them are
now **applied** to the live database this code talks to. This file is kept as
the record of the target, the approval and the verification; the historical
"what breaks without it" notes below describe the pre-application state.

## Applied run — 5 November 2026

- **Target:** Supabase project `ttzfovaadeyynggnypru`, session pooler
  `aws-0-ap-northeast-1.pooler.supabase.com:5432`, database `postgres`.
  Credentials were never printed.
- **Approved:** the user approved applying the pending files to that exact
  target after being shown the hostname, the `schema_migrations` contents and
  the row counts below.
- **Preflight (`schema_migrations`):** 55 rows. `0055_variant_identity_retirement.sql`,
  `0056_product_content_revisions.sql` and `0057_catalog_edit_revision.sql`
  had already been applied on 2026-11-03. The actually pending files were
  **0058, 0059, 0060, 0061**.
- **Row counts before the run:** products 15, product_variants 36,
  order_items 49, device_brands 1, device_models 1; `colours` and
  `product_variant_colours` absent.
- **Command:** `npm run db:migrate` (the runner skips applied files and sends
  each file as one implicit transaction). It reported:
  `applying 0058… done`, `0059… done`, `0060… done`, `0061… done`.
- **No rehearsal on a copy was performed.** The preflight above plus the
  additive/`if not exists` shape of the four files were the basis for approval.
  No seed, backfill or fixture SQL was run.

### Verified after the run (read-only)

| Check | Result |
| --- | --- |
| `schema_migrations` | **59 rows**, with 0058, 0059, 0060 and 0061 recorded |
| `colours`, `product_variant_colours` | created, **RLS enabled** on both |
| `order_items` new columns | `variant_device_model_id`, `variant_device_model_name`, `variant_colour_id`, `variant_colour_name`, `variant_colour_hex`, `image_url`, `image_alt` present |
| `products` new columns | `sell_by`, `sku_pattern` present |
| `price_history` new columns | `old_sale_price_paise`, `new_sale_price_paise`, `change_group` present |
| `product_images.colour_id` | present |
| `shared_catalogue_key(text)` | present |
| Indexes | `device_brands_shared_name_unique`, `device_models_shared_name_unique`, `colours_shared_name_unique`, `colours_hex_unique`, `idx_price_history_variant`, `idx_product_images_colour` |
| Triggers | `protect_variant_colour_reference`, `catalog_revision_variant_colours`, `catalog_revision_shared_colour` |
| Row counts after | products 15, product_variants 36, order_items 49, device_brands 1, device_models 1 — **unchanged**; 0 order items carry a snapshot because no new order was placed |

Offline verification after the migration: `npm test` **1,693 tests / 1,609
passed / 0 failed / 84 skipped**; typecheck and production build pass; 122
store-admin routes, 21 account APIs/11 pages and the admin boundary pass;
`npm audit` 0 vulnerabilities; `git diff --check` clean (LF/CRLF advisories
only). The 84 skipped tests need a disposable PostgreSQL target and were not
run (see `DISPOSABLE_DB_RUNBOOK.md`); the live database was used only for the
migration itself and the read-only checks above.

The order below is the only supported order: 0059 uses functions created by
0057 and 0058, 0060 references the `colours` table created by 0059, and 0058's
function must exist before 0059 can build its unique index.

| # | File | Adds | Depends on |
| --- | --- | --- | --- |
| 0055 | `0055_variant_identity_retirement.sql` | `product_variants.option_identity`, `product_variants.retired_at`, retired-must-be-inactive check, option-identity format check, unique live-option index, unique semantic-identity index, identity-immutability trigger. | 0052 |
| 0056 | `0056_product_content_revisions.sql` | `product_content_revisions` table (RLS enabled, no policies), revision index, immutable trigger. | products, store_admins |
| 0057 | `0057_catalog_edit_revision.sql` | `products.catalog_revision`, revision guard trigger, `touch_product_catalog_revisions()` and child-touch trigger helpers. | products |
| 0058 | `0058_shared_catalogue_normalization.sql` | `shared_catalogue_key(text)` function, duplicate pre-check, unique indexes on `device_brands(name)` and `device_models(brand_id,name)`. | device_brands, device_models |
| 0059 | `0059_shared_colours.sql` | `colours` table (RLS enabled, no policies) and `product_variant_colours` table (RLS enabled), colour/reference triggers, colour indexes. | 0057, 0058, product_variants |
| 0060 | `0060_product_options_pricing.sql` | `products.sell_by`, `products.sku_pattern`, `price_history.old_sale_price_paise` / `new_sale_price_paise` / `change_group`, variant history index, `product_images.colour_id` + index. | 0059 |
| 0061 | `0061_order_item_option_snapshot.sql` | `order_items.variant_device_model_id`, `variant_device_model_name`, `variant_colour_id`, `variant_colour_name`, `variant_colour_hex`, `image_url`, `image_alt` — plain text snapshots, no foreign keys. | order_items |

## What would break on a database without each one (historical)

### Without 0055

Code selects `option_identity` and/or `retired_at` in:

- `src/lib/store-admin/catalog.ts` — product detail load (and therefore the
  editor page `store-admin/products/[id]`).
- `src/lib/store-admin/product-draft.ts`, `catalog-crud.ts`,
  `variant-identity.ts`, `variant-inventory.ts`, `product-duplicate.ts`,
  `product-metadata.ts`, `catalog-starter-setup.ts`, `pos.ts`.
- `src/lib/catalog/storefront.ts`, `src/lib/storefront/availability-server.ts`,
  `src/lib/payu/db-catalog.ts`, `src/lib/catalog/colour-reconciliation.ts`.

Broken screens/APIs:

- Store admin product detail and editor: `GET /store-admin/products/[id]`.
- Product save: `POST /api/store-admin/catalog/products/draft`.
- Variant save/retire: `POST /api/store-admin/catalog/products/[id]/variants`.
- Publish/compatibility checks and shared-list metadata saves.
- Storefront product pages and availability APIs (`src/app/api/…availability`).
- Checkout price resolution (`src/lib/payu/db-catalog.ts`).
- Store admin POS screens and `POST /api/store-admin/pos/*`.
- Product duplicate and catalogue starter setup.

The product **list** page still loads; its query does not read these columns.

### Without 0056

- Any product draft save that writes content revisions fails:
  `saveProductDraft` → `POST /api/store-admin/catalog/products/draft`.
- Content history/restore screens (`productContentHistory`, restore caller).
- Description edits made through the product editor.

### Without 0057

- Product detail load and editor (selects `catalog_revision`).
- Every draft save and variant save (optimistic revision check and the
  `products` guard trigger is also part of the same file).
- Any child write expected to advance the revision (colours, variant colours).
- Product list still loads: `catalog_revision` is not selected there.

### Without 0058

- No runtime code calls `shared_catalogue_key`; the visible breakage is at the
  data layer: brand/model names can be duplicated with different casing or
  spacing, and 0059 cannot be applied because its `colours` unique index uses
  the function. Applying 0059 first will fail.

### Without 0059

- Product detail and editor (selects `colours` and `product_images.colour_id`,
  reads `product_variant_colours`).
- Product draft save that persists a colour or colour-linked photo.
- Shared lists screen: creating/editing colours (`shared-lists.ts` reads
  `colours`), and the colour picker in Basics.
- Duplicate product (copies colour links).
- Any migration after 0059 that references `colours` (0060).

### Without 0060

- Product detail and editor: `sell_by`, `sku_pattern`, `colour_id` on photos,
  and the `old_sale_price_paise` / `new_sale_price_paise` / `change_group`
  columns of price history are all selected.
- Product save: writes `sell_by`, `sku_pattern` and photo `colour_id`; option
  price changes write the sale pair and `change_group`.
- Price history display falls back to the older shape only if the code is
  reverted; with this code the query fails instead.
- Duplicate product (copies sell-by and SKU pattern).
- Product list and storefront are unaffected (they do not select these
  columns).

### Without 0061

- Nothing fails. `createOrder` probes `information_schema.columns` for
  `order_items.variant_colour_id` and falls back to the previous insert, so
  checkout and payment keep working.
- New orders do not store the model, colour or photo snapshot. Their receipt,
  invoice, order detail and store-admin order show the live catalogue/row label
  instead; renaming an option or replacing a photo can therefore change how an
  old order reads until 0061 is applied and new orders are written.
- The storefront and bag are unaffected.

## Rehearsal on a copy of the real data

Never rehearse on the live database. Use a disposable database or a restore of
a recent backup; confirm the host and row counts before touching it.

1. **Pick the target.** State the hostname and the current row counts for
   `products`, `product_variants`, `orders`, `price_history`, `stock` and
   `store_admins`. Get explicit approval for that exact target.
2. **Record the starting point.** On the copy, run
   `select filename from schema_migrations order by filename;` and keep the
   list. It must end at 0054 (or the last applied migration) before rehearsal.
3. **Rehearse 0055–0057 first.** Apply one file at a time with
   `node scripts/migrate.mjs` (it records each file and skips applied ones).
   After each file, run a read-only smoke query:
   `select count(*) from product_variants;` and
   `select count(*) from products where catalog_revision < 0;`.
   A duplicate live option or a duplicate brand/model name makes 0055 or 0058
   fail; resolve data first on the copy and record the fix, never on live.
4. **Rehearse 0058–0059 together.** 0058 must succeed before 0059. If 0058
   reports duplicates, list the affected tables and counts only; do not rename
   or merge real rows without an approved data plan.
5. **Rehearse 0060.** After it, confirm:
   `select count(*) from products where sell_by not in ('single','colour','model','model_colour','other');`
   returns 0, and `select count(*) from product_images where colour_id is not null and colour_id not in (select id from colours);`
   returns 0.
5b. **Rehearse 0061.** It only adds nullable columns to `order_items`. After
   it, confirm `select count(*) from order_items where image_url is not null;`
   returns 0 on existing data (no row was rewritten), then place one test order
   through the checkout path and confirm its snapshot columns are populated.
   Read `docs/phase3-customer-options-20261105.md` for what the columns mean.
6. **Run the read-only review** against the copy only:

   ```sh
   REVIEW_PRODUCT_OPTIONS=read-only node scripts/review-product-options.mjs
   ```

   It refuses any host that is not localhost or clearly test/staging/sandbox/dev,
   opens a read-only transaction and prints counts only.
7. **Walk the screens against the copy** with a store admin account:
   product list → product detail → editor (all six sections) → save and reopen
   unchanged → price history shows **Sale cleared** where a sale was removed →
   a viewer account sees the read-only table → storefront product page →
   checkout price lookup → POS option lookup.
8. **Roll back by restoring the copy.** These migrations are additive; there is
   no down migration and none should be written. The live database is only
   touched after the rehearsal and a fresh backup, with an explicit approval of
   the exact target.

## Current status

- Migrations 0055–0061 are **applied**; the record is in the "Applied run — 5 November 2026"
  section above.
- Migrations **0069, 0070, and 0071** are **applied** to the test database; details below.
- No seed, backfill or fixture SQL was run on live catalog tables.
- `scripts/review-product-options.mjs` has only been run in its refusal paths
  (missing acknowledgement, unsafe host); it has not contacted a database.
- No order has been placed since 0061 was applied, so no `order_items` row
  stores an option snapshot yet. That is expected, not a failure.

---

# Migrations 0069–0071 — Spin and Win (applied 13 November 2026)

These three additive migration files add the Spin and Win schema, cooldown controls, and home popup controls. All three are **applied** to the configured test database.

## Applied run — 13 November 2026

- **Target host (hostname only):** `aws-0-ap-south-1.pooler.supabase.com` (`port 5432` session pooler via `DATABASE_MIGRATION_URL` for `npm run db:migrate`; runtime app uses `port 6543` transaction pooler). **Yes — this is the test project** (per `PROMO_NOTES.md`: `products`: 7, `orders`: 23, `users`: 1, `coupons`: 0, `store_admins`: 1). Credentials and project identifiers are never printed.
- **Command:** `npm run db:migrate` (skipping `0001`–`0068`, applying `0069`, `0070`, `0071` in order).

| # | File | Applied at (UTC) | Adds | RLS & safety |
| --- | --- | --- | --- | --- |
| 0069 | `0069_spin_wheel.sql` | `2026-11-13T08:49:26.223Z` | `spin_wheel_settings` (singleton row `'default'`), `spin_wheel_segments` (2..12 slices), `spin_wheel_segment_daily_counts` (`(segment_id, store_day)` primary key), `spin_wheel_spins` (`unique (user_id, store_day)`, `ip_hash` index), `coupons.source` (`admin` / `spin_wheel`), `spin_win` event in `notification_outbox` check + 6 `notification_channel_settings` rows | **RLS enabled** with no public policies on all four new tables (`DATABASE_URL` server-only). |
| 0070 | `0070_spin_wheel_cooldown.sql` | `2026-11-13T10:26:20.591Z` | `spin_wheel_settings.reward_cooldown_mode` (`disabled` / `until_coupon_expires` / `custom_days`, default `until_coupon_expires`), `reward_cooldown_days` (`1..365`, default `7`), `show_next_spin_countdown` (`boolean`, default `true`) | `spin_wheel_settings` already has RLS enabled from `0069`. |
| 0071 | `0071_spin_wheel_popup_controls.sql` | `2026-11-13` (post-0070 run) | `spin_wheel_settings.popup_enabled` (`boolean`, default `true`), `popup_delay_seconds` (`0..120`, default `10`), `popup_require_scroll` (`boolean`, default `true`), `popup_mobile_floating_button` (`boolean`, default `true`) | `spin_wheel_settings` already has RLS enabled from `0069`. |
