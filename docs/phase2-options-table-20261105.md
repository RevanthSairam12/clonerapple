# Product options Phase 2 verification — 5 November 2026

Phase 2 of PRODUCT_OPTIONS_FINAL_PLAN.md replaces the separate price, options and stock steps with a single **Options, price and stock** table, unlocks audited per-option pricing, links photos to colours, adds fast entry and sell-by modes, and defines duplicate-product behaviour. Work was performed on `backup/phase1-shared-lists-20261104`, based on `15d8044`.

No database was contacted. No migration was applied, no fixture or seed SQL was written, and no real business table was modified. The full suite, typecheck, production build, route/account/boundary checks, `npm audit` and `git diff --check` were run locally.

## Done criterion

> I can create the "red = 100, black = 120" case with a stock number and photos for each colour on one page, save, reopen it unchanged, and see every price change in its history.

Covered by implementation and by offline UI/logic tests:

- One page: the Price step now renders a single table with model/option, colour, SKU, price, sale, stock, active, history and remove per row. Bulk fill, per-colour price fill, the sell-by row generator and the legacy generator all write into that table.
- Per-colour price: **Fill several rows at once → Set these prices** fills only the active rows that carry that colour. Blank boxes are left untouched.
- Per-colour photos: each photo has an optional colour; choosing one forces the gallery role, and a colour with no photos falls back to the product default gallery.
- History: option price changes write paired `regular` and `sale` rows to `price_history` under one `change_group`, visible in the row's History disclosure.
- Save/reopen: `sell_by`, `sku_pattern`, photo `colour_id`, option regular/sale prices and per-option stock all round-trip through the draft endpoint and `getCatalogProduct`.

Reopening against a real database and an authenticated browser session remain unverified; see **Pending gates**.

## Confirmed decisions

- **Price editing is unlocked for options.** This is permitted because PayU already reads prices from the database (`src/lib/payu/db-pricing.ts`), satisfying the AGENTS price-write gate. Product and option prices are both server-resolved by `resolveEffectivePrice`.
- **Large changes confirm, never block.** A drop over 50%, a rise over 100%, or a price below cost returns a confirmation message. The UI asks, then resubmits with `confirmLargePriceChanges`/`confirmLargeChange`. Nothing is silently rejected.
- **Untouched rows write no history.** The draft sends `pricePaise`/`salePricePaise` only when the row had a saved override or the value actually changed; clearing sends `null`. An unchanged save produces zero `price_history` rows.
- **Saved commerce identity is immutable.** SKU, combination key and option identity cannot change on a saved variant; the UI offers archive-and-replace instead, preserving the retired row and its history.
- **Option sales are independent.** An option with its own regular price does not inherit the product sale; it needs its own sale price. Option sales apply only while sale mode is on.
- **Duplicate copies content, never stock or history.** A duplicated product copies sell-by/SKU pattern, photos with colour links, and variants with fresh deterministic identities and SKUs. Opening stock is not copied, no opening `price_history` row is written, and the audit records `stockCopied: false, priceHistoryCopied: false`.

## What changed

| Area | Change |
| --- | --- |
| `src/lib/store-admin/options-table-rules.ts` (new) | Pure rules shared by UI and server: sell-by row generation, missing-row detection, row warnings, effective option price, SKU pattern, large-change classification, tri-state price parsing. |
| `src/components/store-admin/ProductWorkflow.tsx` | Rebuilt the Price step: sell-by selector, SKU pattern, other-option entry, missing-row preview, bulk fill, per-colour price fill, unified editable table with warnings, history and archive-and-replace. Photos gained a colour selector. Stock step flags options on shared stock as **Needs review**. |
| `src/lib/store-admin/product-draft.ts` | Removed the option-price lock. `updateVariantPricingUsing` now validates sale price, applies the large-change confirmation, writes paired history rows with a `change_group`, and audits `catalog.variant.price`. Persists `sell_by`, `sku_pattern` and photo `colour_id`. |
| `src/lib/store-admin/catalog-crud.ts` | Variant create/update delegates pricing to `updateVariantPricingUsing` and returns `warnings`; `ProductDraftError` maps to `not-found`/`conflict`/`invalid-input`. |
| `src/lib/store-admin/catalog-crud-rules.ts` | Tri-state option price/sale parsing, `confirmLargeChange` boolean validation. |
| `src/lib/store-admin/catalog.ts` | Detail now carries `sellBy`, `skuPattern`, `colours`; images carry `colourId`; price history carries `variantId`, old/new sale prices and `changeGroup` (50 rows). Added `listColourOptions()`. |
| `src/lib/store-admin/catalog-rules.ts` | Image input accepts and validates an optional shared `colourId`. |
| `src/lib/store-admin/product-draft-rules.ts` | Draft accepts `confirmLargePriceChanges`; primary/hover photos cannot carry a colour. |
| `src/lib/store-admin/product-duplicate.ts` | Copies sell-by/SKU pattern, colour-linked photos and fresh variant identities; no stock, no price history. |
| `src/app/(store-admin)/store-admin/(protected)/products/new/page.tsx` | Loads shared colours for the photos step. |
| `src/app/api/store-admin/catalog/products/[id]/variants/route.ts` | Returns pricing `warnings` alongside the saved variant. |
| `migrations/0060_product_options_pricing.sql` (new, unapplied) | Adds `products.sell_by`, `products.sku_pattern`, `product_images.colour_id`, `price_history.old_sale_price_paise`/`new_sale_price_paise`/`change_group` and indexes. Additive only; no new tables, so no new RLS surface. |
| Tests | New `tests/options-table-rules.test.mjs` (7 tests). Rewrote the option-price lock assertions in `product-draft`/`product-workflow` to assert audited unlocked pricing, large-change confirmation and identity immutability. Updated duplicate content/metadata tests and the UI fixture. |

`price_history` was extended rather than duplicated: the paired sale columns and `change_group` keep every existing reader and the immutability trigger intact, and the existing `price_kind in ('regular','sale','sale_cleared')` check is reused.

## Verification (real results)

| Check | Result |
| --- | --- |
| `npm test` | **1,654 tests: 1,570 passed, 0 failed, 84 skipped, 0 cancelled** |
| Targeted `product-workflow` + `options-table-rules` + `product-draft` | **42 passed, 0 failed** |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm run check:store-admin-routes` | **122 routes guarded** |
| `npm run check:account-routes` | **21 API routes and 11 pages** pass |
| `npm run check:admin-boundary` | Passed |
| `npm audit` | **0 vulnerabilities** |
| `git diff --check` | Clean (LF/CRLF advisories only) |
| `npm run check:notifications` | 3 passed, 5 failed — all environmental (no SMTP/SMS, staff/customer SMS cells off). No message was sent. |

## Deviations from the plan

1. **Parent stock is not auto-hidden for option products.** The existing explicit variant-inventory activation and parent-to-variant transfer guard is retained so stock accounting is never inferred or split automatically. Instead, the Stock step now shows a **Needs review** notice whenever a product has options but keeps shared stock. Nothing changes until the person chooses option stock and saves.
2. **No spreadsheet paste or keyboard-navigation grid.** Fast entry is provided by bulk fill, per-colour price fill, sell-by generation and the reviewed-combination preview. A paste grid can be added on top of the pure `options-table-rules` functions without touching the server.
3. **Media attachment/upload is not integrated.** Photos are still entered as a public URL or `/media/...` path; the colour link works for either.
4. **Sale clearing records `new_price_paise = 0`.** This follows the existing `price_history` constraint; `price_kind = 'sale_cleared'` distinguishes it from a real zero price.

## Pending gates

- **Migration 0060 is unapplied.** 0058/0059 also remain unapplied on the connected database. Applying any of them requires explicit approval of the exact target host and row counts.
- **Code and migration 0060 must ship together.** The detail query reads `products.sell_by`, `products.sku_pattern`, `product_images.colour_id` and the new `price_history` columns, and the draft writes them. Against a database without 0060, opening or saving a product would fail; the offline tests do not exercise real SQL.
- **No database integration run.** PostgreSQL-backed option-pricing, history and duplicate tests are part of the 84 skipped tests; they need a disposable, approved database.
- **No authenticated browser acceptance.** UI behaviour is verified by rendering the real components in the offline fixture, not by a signed-in store-admin session against a live database.
- **Notification checks** fail only on missing provider configuration.
