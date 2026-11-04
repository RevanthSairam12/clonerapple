# Product options Phase 0 notes

**Date:** 2026-11-04
**Scope:** read-only audit against `PRODUCT_OPTIONS_FINAL_PLAN.md`. No migration, seed, backfill, business-table write, or real-database fixture was applied.

## Safety and repository state

- Working branch: `newbranchadminall`, ahead of `origin/newbranchadminall` by 98 commits.
- The worktree was already dirty before this audit: 546 changed/untracked path entries, including prior phase implementation files, temporary evidence, migrations 0047–0057, and product-option related source/tests. The pre-existing source, scripts, migrations and tests (411 paths) were preserved in local safety commit `77c7dcf` on `backup/product-options-phase0-20261104`. No product implementation was changed by this audit. No destructive git command or reset was used. Temporary evidence and `.qoder/` remain untouched and uncommitted.
- The GitHub remote is publicly readable (anonymous API status 200). Push is deferred pending explicit confirmation of public publication. A staged-file scan found no matches for configured secret values. This is a limited local scan, not a certification of the repository's entire history. `gh` is not installed; repository visibility was checked with a read-only HTTPS request.
- `PRODUCT_EDITOR_FINISH.md` is absent, so its referenced F0/F2/F3 details could not be read. `PRODUCT_OPTIONS_SIMPLE_PLAN.md` is also absent; nothing needed deleting. The final plan's explicit safety, disposable-database acceptance and rollout requirements remain the controlling requirements.
- `.env.local` is ignored and not tracked. Database host was inspected without printing credentials: `aws-0-ap-northeast-1.pooler.supabase.com`.
- Read-only scripts completed with no writes: product schema preflight, variant inventory census, disposable-schema census, route guard check, and admin-boundary check.
- Existing scripts report 115 store-admin routes guarded and the admin-boundary check passed. The disposable-schema census found existing `itest_*`/`fs_*` namespaces; this audit did not adopt or delete them.

## Database and migration state

The read-only migration census found migrations `0001_admin_foundation.sql` through `0057_catalog_edit_revision.sql` applied, including 0055, 0056 and 0057. No migration was run in this phase.

The read-only product preflight found all expected Phase-B columns and indexes present, including `products.catalog_revision`, variant retirement/identity columns, and the live/semantic uniqueness indexes. Reported conflict groups were zero for live option labels, semantic identities, product slugs, option SKUs, commerce combinations, active options missing identity, and live image roles.

Current aggregate business-data census (counts only):

| Area | Result |
|---|---:|
| Products | 15 total; 15 active; 0 deleted |
| Product variants | 36 total; 36 active; 1 purchasable; 36 with hex; 0 with model; 3 price overrides; 0 sale overrides |
| Device catalogue | 1 brand/1 active brand; 1 model/1 active model; 0 product-device links |
| Product images | 23 total/live; 13 primary; 0 hover |
| Price history | 89 rows; 4 variant-linked; 21 regular; 68 sale-related |
| Stock | 15 parent rows; 0 variant rows; 4 tracked |
| Order items | 49 rows; 0 variant-linked; 0 SKU snapshots; 0 variant-label snapshots |
| Product facets | 37 total; 7 model-like; 0 colour-like |
| Active checkout reservations | 8 |

The inventory census identified one existing product with three active variants and a tracked parent balance as an allocation candidate, but proposed no split and made no write.

## Existing schema and services

### Variants/options

- `migrations/0011_store_catalog.sql` creates `product_variants` with `option_name`, `option_value`, `option_hex`, nullable `price_paise_override`, global `sku`, active/sort fields; it also creates append-only `price_history`, parent/variant-capable `stock`, and immutable `stock_movements`.
- `migrations/0039_sale_pricing.sql` adds product and variant `sale_price_paise` and price-history `price_kind`.
- `migrations/0051_product_types_compatibility.sql` adds `device_brands`, `device_models`, and product compatibility links. `migrations/0052_variant_inventory.sql` adds `inventory_mode`, `is_purchasable`, `device_model_id`, `combination_key`, and order/stock ownership constraints. `migrations/0055_variant_identity_retirement.sql` adds stable option identity/retirement and immutable saved commerce identity rules.
- `src/lib/store-admin/catalog.ts` reads product, option, stock and price-history DTOs. `src/lib/store-admin/catalog-crud.ts` creates products, changes parent pricing, upserts/archives variants and appends history/audit data. `src/components/store-admin/VariantEditor.tsx` displays option rows, SKU/model/combination identity and per-option stock.
- The option-price write is intentionally still closed: `VariantEditor` omits editable price fields and `upsertVariant` rejects any override change (`Variant price writes remain disabled until the authoritative checkout price gate is approved`). This conflicts with the final plan's unlocked option prices.
- Parent and option pricing already resolve through `src/lib/storefront/pricing.ts`; option regular/sale prices are read by `src/lib/catalog/storefront.ts`, and PayU reads authoritative database pricing through `src/lib/payu/db-pricing.ts`/`src/lib/payu/db-catalog.ts`. The admin lock has not yet been safely removed because the current implementation still needs a complete audited option-price write path and acceptance proof.
- Existing price history is append-only and has `variant_id`, `old_price_paise`, `new_price_paise`, `price_kind`, actor/time/reason. It does not yet provide the final plan's old/new regular-plus-sale pair in one option change record or a complete option price-history UI.

### Device models and brands

- Shared tables and indexes are in `0051_product_types_compatibility.sql`; models have stable IDs, brand, name, sort order, active state and timestamps. There is no model seed in the audited migrations.
- Store Admin screen: `src/app/(store-admin)/store-admin/(protected)/device-models/page.tsx`, backed by `src/lib/store-admin/product-metadata.ts`, `MetadataReferenceManager.tsx`, and the guarded metadata API `src/app/api/store-admin/catalog/metadata/[kind]/route.ts`.
- Current management is owner-oriented create/edit/reference management. The final plan still needs owner rename/deactivate/reactivate/use reporting, bulk paste and CSV import/export preview/confirm/error reports, normalized duplicate/near-match handling, bounded rate limiting, atomic batch application and explicit proof that no model/brand is invented. The present metadata API does not yet implement that bulk workflow.
- Current product editor reads selectable model references and compatibility mappings, but the final model × colour option catalogue is not implemented. Existing database rows have one model and no product-device links in the audited data.

### Colours and photos

- Existing colours are free-form `product_variants.option_value` plus optional `option_hex`; there is no shared `colours` table in the applied migrations and no colour/hex migration link or dry-run reconciliation script.
- `product_images` belongs only to a product (`product_id`, URL, alt, role, order). No applied column links an image to a colour or variant; no per-colour gallery switching exists.
- `src/lib/catalog/storefront.ts` projects variant option values into colour swatches only when the product has no explicit colours JSON. `src/components/shop/CommerceVariantSelector.tsx` renders one combined model/specification select, not the required model-first then colour selector. There is no colour-photo attachment/order/fallback workflow.

### Product editor, stock and identity

- Product creation/editing is sectioned through `src/components/store-admin/ProductWorkflow.tsx`, `ProductCreateForm.tsx`, `ProductEditor.tsx`, and `VariantEditor.tsx`. Price, options, stock and metadata are separate controls; the final one-table `Sell by` workflow is not present.
- Existing `inventory_mode` supports product or variant inventory. Variant stock rows and append-only movements are supported by `variant-inventory.ts`, `variant-inventory-rules.ts`, and the guarded variant-inventory API. Current data has no variant stock rows. Parent stock is still present even for the identified variant allocation candidate, so the final plan's no-double-counting setup/review remains incomplete.
- Saved SKU/commerce identity retirement and archive/replace protections exist in `0055`, `variant-identity.ts`, and `catalog-crud.ts`. Existing orders are designed to retain stable snapshots, but current census shows no order item variant snapshots, so end-to-end populated proof remains outstanding.
- Draft revision/conflict handling is present through `0057_catalog_edit_revision.sql`, `catalog-revision.ts`, and the draft workflow. The final table's generated-row cap, missing-only combination generation, bulk spreadsheet entry, and duplicate-product option/photo semantics remain incomplete.

### Storefront, filters, search and checkout

- Shared price resolution is in `src/lib/storefront/pricing.ts` and used by database catalogue projection, cart/checkout/PayU paths. Variant prices are projected for purchasable variants. Focused tests exist for selected-variant pricing and checkout, but real PostgreSQL/concurrency and populated order-snapshot acceptance remain pending.
- Availability rules in `src/lib/storefront/availability-rules.ts` correctly encode normal-mode blocking and sale-mode UI non-blocking; `CommerceVariantSelector.tsx` disables unavailable rows in normal mode. The selector is still a single combined option and does not implement the final model/colour states or exact colour photo snapshots.
- Category configuration currently reads product facets/attributes. `src/lib/catalog/storefront.ts` projects model compatibility/attributes, but there are no shared-colour filter values/counts built from active option rows, no combined model+colour URL filter flow verified, and no colour-filter card photo behavior.
- Search references product names/facets/keywords through the shared storefront refs. Model names are not yet guaranteed to be searched from the option catalogue as required.
- Cart/checkout/PayU use the selected variant identity where configured, and stock rules are variant-aware. However, the database census shows no variant-linked order lines or SKU/label snapshots, so the required exact-option/photo order proof is not complete. The final plan's per-colour photo snapshot is not implemented.

## End-to-end status against Phase 0 questions

| Capability | Status | Evidence / gap |
|---|---|---|
| Per-option price in cart | Partial | Resolver and selected variant plumbing exist; populated DB/order evidence absent. |
| Per-option price in checkout/PayU amount | Partial/implemented in code | `pricing.ts`, `payu/db-pricing.ts`, selected-variant tests; requires real DB and callback proof. |
| Per-option stock claim/release | Partial/implemented in code | Variant inventory/reservation services exist; current real data has no variant stock rows; concurrency proof pending. |
| Model-specific variants | Partial | Schema and identity support exist; only one purchasable variant and zero model-linked variants/links in current data; customer UI is combined selector. |
| Retirement and replacement | Implemented in code, not populated acceptance | Migration 0055 and archive paths exist; no real replacement/order snapshot proof. |
| Availability endpoint per variant | Implemented in code, limited acceptance | `src/app/api/catalog/availability/route.ts` and availability services expose variant state; real populated variant test pending. |

## Gaps against the final plan

1. Phase 1 shared colours, colour migration/linking, bulk model/colour import/export and duplicate prevention are missing.
2. Phase 2 unified one-table editor, unlocked option price/sale editing, paired history/audit semantics, large-change confirmation, per-colour photos, generated-row cap and duplicate-product behavior are missing or partial.
3. Phase 3 two-step model/colour selector, per-colour gallery and exact colour photo snapshots are missing.
4. Phase 4 model/colour category filters/counts, URL state and model-aware search are missing or partial.
5. Phase 5 needs real populated variant stock/order/refund/POS/report proof and concurrency checks.
6. Phase 6 disposable database rehearsal, authenticated browser acceptance and rollout/owner guide are not done.

## Phase plan retained

- Phase 0: preserve this audit and the user's three decisions; keep the existing work secured in local safety commits and resolve confirmation for the public remote backup. Report the four failing tests without changing product code.
- Phase 1: add shared colours and owner bulk workflows; extend model catalogue safely without inventing data; add dry-run colour reconciliation and tests.
- Phase 2: implement the unified options table and audited option price/history/photo workflows while retaining immutable identities and existing inventory engine.
- Phase 3: implement exact two-step selector, per-colour gallery and order snapshots.
- Phase 4: build bounded indexed model/colour filters and search.
- Phase 5: exercise exact option stock/order/refund/POS behavior in an approved disposable database.
- Phase 6: rehearse migrations, run authenticated browser proof, write guide and rollout evidence.

## Decisions confirmed by the user — 2026-11-04

1. **Inline creation: yes.** Store admins may create models/colours inline; owners alone rename, deactivate and manage them.
2. **Import size: 500 rows and 256 KB.** Enforce both bounds for paste and CSV; document byte/header accounting explicitly in Phase 1.
3. **Large price changes: yes.** Require confirmation (never a block) for a drop over 50%, rise over 100%, or price below cost.

## Phase 0 verification results and remaining gates

- `npm test`: authoritative runner summary **1,532 tests; 1,445 passed; 4 failed; 83 skipped; 0 cancelled**. An earlier draft count incorrectly counted the repeated failure recap; this summary supersedes it. Failed source assertions: `tests/payment-recovery.test.mjs:85` and `tests/stock-behaviour.test.mjs:230,262,319`. Their runtime significance is not yet resolved; no test was weakened or product code changed. Evidence: `.tmp-phase0-tests.txt`.
- Typecheck and production build passed; existing external-lockfile warning retained.
- All six check scripts were run: store-admin guards (115), account guards (21 APIs/11 pages), admin boundary, settings lists and legacy media compatibility (2/2) passed; notification readiness **3 passed / 5 failed**, no message sent. Provider setup and matrix remain incomplete.
- Read-only catalogue parity exits 2: the static `Midnight Black` colour has no matching database variant; two prices drift and other spec/name differences are reported. No repair was applied. Evidence: `.tmp-phase0-catalog-parity.txt`.
- `npm audit`: zero vulnerabilities. `git diff --check`: no whitespace errors, line-ending warnings only.
- Local source backup exists; public remote push awaits explicit approval. Existing temporary evidence is retained locally. Phase 0 is **not fully done** until its remote-backup requirement is resolved. Phase 1 has not started.
- Database-backed fixtures were not run. General database access does not select/approve an exact disposable write target; obtain target hostname, fresh row counts and explicit scope approval before writes. No production migration or business data write was attempted.
