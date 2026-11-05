# Pending migrations 0055–0060

Written 5 November 2026 for the Phase 2 options work. These six files exist in
`migrations/` but are **not applied** to the database this code talks to. Until
they are applied, parts of the store admin, storefront, checkout and POS fail
with SQL errors (`column ... does not exist` / `relation ... does not exist`).

They are additive. The order below is the only supported order: 0059 uses
functions created by 0057 and 0058, 0060 references the `colours` table created
by 0059, and 0058's function must exist before 0059 can build its unique index.

Do not apply any of them without explicit approval of the exact target database
and its current `schema_migrations` contents.

| # | File | Adds | Depends on |
| --- | --- | --- | --- |
| 0055 | `0055_variant_identity_retirement.sql` | `product_variants.option_identity`, `product_variants.retired_at`, retired-must-be-inactive check, option-identity format check, unique live-option index, unique semantic-identity index, identity-immutability trigger. | 0052 |
| 0056 | `0056_product_content_revisions.sql` | `product_content_revisions` table (RLS enabled, no policies), revision index, immutable trigger. | products, store_admins |
| 0057 | `0057_catalog_edit_revision.sql` | `products.catalog_revision`, revision guard trigger, `touch_product_catalog_revisions()` and child-touch trigger helpers. | products |
| 0058 | `0058_shared_catalogue_normalization.sql` | `shared_catalogue_key(text)` function, duplicate pre-check, unique indexes on `device_brands(name)` and `device_models(brand_id,name)`. | device_brands, device_models |
| 0059 | `0059_shared_colours.sql` | `colours` table (RLS enabled, no policies) and `product_variant_colours` table (RLS enabled), colour/reference triggers, colour indexes. | 0057, 0058, product_variants |
| 0060 | `0060_product_options_pricing.sql` | `products.sell_by`, `products.sku_pattern`, `price_history.old_sale_price_paise` / `new_sale_price_paise` / `change_group`, variant history index, `product_images.colour_id` + index. | 0059 |

## What breaks on a database without each one

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

- No migration has been applied by this work.
- No seed, backfill or fixture SQL was run.
- `scripts/review-product-options.mjs` has only been run in its refusal paths
  (missing acknowledgement, unsafe host); it has not contacted a database.
