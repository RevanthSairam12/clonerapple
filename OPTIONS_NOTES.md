# Product options implementation notes

## Phase 2 — options, price and stock (2026-11-05)

The lock named in the Phase 1 notes is gone. Option pricing is editable and audited on both write paths:

- `src/lib/store-admin/catalog-crud.ts#upsertVariant` no longer rejects an override change. It saves the identity, then calls `updateVariantPricingUsing` in the same transaction.
- `src/lib/store-admin/product-draft.ts` no longer throws `Option price writes remain disabled…`. The draft loop calls the same helper, so the single-option route and the product draft share one price path.
- `updateVariantPricingUsing` validates the sale pair, appends paired `price_history` rows (one per moved field, both carrying old/new regular **and** sale values under one `change_group`), and writes `catalog.variant.price` through `strictMetadataAudit`.
- A drop over 50%, a rise over 100%, or a price below cost returns a confirmation message. Without `confirmLargeChange`/`confirmLargePriceChanges` the save rolls back with that message; with it the save proceeds and returns the message as a warning. It is never a permanent block.
- Migration `0060_product_options_pricing.sql` adds `products.sell_by`, `products.sku_pattern`, the paired sale columns and `change_group` on `price_history`, an option history index, and `product_images.colour_id` plus its index. It is additive; it was **not applied** in this session.

Editor changes (`src/components/store-admin/ProductWorkflow.tsx`):

- A `Sell by` choice (one item, colour, model, model and colour, another option) plans rows through `src/lib/store-admin/options-table-rules.ts`. Only missing rows are proposed, capped at 60 per generation, and new rows start inactive with zero stock and a suggested SKU.
- One table shows Model or option, Colour, SKU, Price, Sale, Stock, Active, History and Remove. Price and sale are editable; blank means the product price. A blank on a row that previously had an override sends an explicit clear, so untouched rows write no history.
- Fast entry fills one price, sale or stock value into every active sellable row, or a different price for each colour into only the rows with that colour. Row warnings are plain words and never block a draft save.
- The Stock step flags an options product that still keeps one shared stock count with a **Needs review** notice. It is a flag only: the existing explicit variant-inventory activation and transfer guard are unchanged, and no stock is split automatically.
- Photos can be assigned to a shared colour. Colour photos are forced to the gallery role; primary and hover stay product-wide. A colour with no photo uses the default gallery.
- A large option price change asks for confirmation before the request leaves the browser.
- `product-duplicate.ts` now copies the product, its attributes, chosen models, colour links and photos. Copied options get new SKUs and combination keys; stock stays at zero and no price history is copied.

Verification: `npm test` **1,654 tests / 1,570 passed / 0 failed / 84 skipped**; typecheck, production build, store-admin route guard (122 routes), account guard, admin boundary all pass; `npm audit` zero vulnerabilities; `git diff --check` clean apart from LF/CRLF advisories. `check:notifications` remains **3 passed / 5 failed** because mail and SMS are not configured; no message was sent. New tests: `tests/options-table-rules.test.mjs` plus updated draft/workflow/duplicate expectations. No migration, fixture or business-data write was performed. Report: `docs/phase2-options-table-20261105.md`.

Historical Phase 1 results are in [Phase 1 shared-list verification](docs/phase1-shared-lists-20261104.md): 1,645 tests, 1,561 passed, 0 failed, 84 skipped; typecheck, production build and the component browser matrix pass. Imports now accept 2,000 data rows and 1,000,000 UTF-8 bytes. The accepted static fallback prices are ₹3,509 and ₹879; Midnight NLU was left alone. [DISPOSABLE_DB_RUNBOOK.md](DISPOSABLE_DB_RUNBOOK.md) documents every skipped-test connection and approval requirement. No database was contacted during this Phase 1 continuation. Backup branch: `backup/phase1-shared-lists-20261104`. Earlier checkpoints below are historical; PostgreSQL engine and authenticated application acceptance remain pending.

## Historical Phase 0 audit

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

## Current decisions confirmed by the user — 2026-11-04

1. **Inline creation: yes.** Store admins and owners may create models/colours inline. Owners alone rename, deactivate, reactivate and manage; bulk paste and CSV import/export are owner-only. Brand creation remains owner-only.
2. **Import size: 2,000 data rows and 1 MB (1,000,000 UTF-8 bytes).** This supersedes the earlier 500-row/256-KB decision. CSV headers and blank paste lines do not count as data rows; BOM, headers and line endings count as bytes. JSON escaping has a separate streamed transport bound.
3. **Large price changes: yes.** Require confirmation, never a permanent block, for a drop over 50%, rise over 100%, or price below cost. This is recorded for Phase 2; Phase 1 does not unlock option pricing.

## Historical Phase 0 verification results and remaining gates

- `npm test`: authoritative runner summary **1,532 tests; 1,445 passed; 4 failed; 83 skipped; 0 cancelled**. An earlier draft count incorrectly counted the repeated failure recap; this summary supersedes it. Failed source assertions: `tests/payment-recovery.test.mjs:85` and `tests/stock-behaviour.test.mjs:230,262,319`. Their runtime significance is not yet resolved; no test was weakened or product code changed. Evidence: `.tmp-phase0-tests.txt`.
- Typecheck and production build passed; existing external-lockfile warning retained.
- All six check scripts were run: store-admin guards (115), account guards (21 APIs/11 pages), admin boundary, settings lists and legacy media compatibility (2/2) passed; notification readiness **3 passed / 5 failed**, no message sent. Provider setup and matrix remain incomplete.
- Read-only catalogue parity exits 2: the static `Midnight Black` colour has no matching database variant; two prices drift and other spec/name differences are reported. No repair was applied. Evidence: `.tmp-phase0-catalog-parity.txt`.
- `npm audit`: zero vulnerabilities. `git diff --check`: no whitespace errors, line-ending warnings only.
- Local source backup exists; public remote push awaits explicit approval. Existing temporary evidence is retained locally. Phase 0 is **not fully done** until its remote-backup requirement is resolved. Phase 1 has not started.
- Database-backed fixtures were not run. General database access does not select/approve an exact disposable write target; obtain target hostname, fresh row counts and explicit scope approval before writes. No production migration or business data write was attempted.

## Historical Phase 1 implementation checkpoint (2026-11-04)

**Code implemented; not deployed or fully accepted.** No migration, fixture, seed, reconciliation apply, business-table write, commit or public push was performed in Phase 1. Phase 2 has not started. The Phase 0 statements above describe the earlier audit, not the current source capability.

### Implemented scope

- Reused device brands/models and existing metadata fence, publication checks, revision fanout, strict transactional audit and separate store-admin identities. Added owner model/colour management, named paginated uses, explicit deactivation and near-match confirmation, shared colours navigation and create-only inline access for admins. Brand creation remains owner-only. Inline creation preserves the product draft and existing selections, never auto-selects a reference or refreshes the product page. Shared colours are reference-only until later option binding.
- Prepared additive `0058_shared_catalogue_normalization.sql` and `0059_shared_colours.sql`. New colour and immutable variant-colour link tables enable RLS without public policies. The composite FK enforces product/variant ownership. Linking does not rewrite retired variants, option labels, SKUs, prices, stock or history. Neither migration was applied.
- Added pure CSV/paste planning, streamed fatal UTF-8 JSON body reading, 500 data-record/262,144-byte limits, exact/inactive duplicate checks, bounded near matching, explicit acknowledgments, safe template/export/error CSV and owner-only atomic confirmation. Header and blank-paste-line accounting is explicit. Both input text and the entire JSON request (escaping/envelope/token included) must fit the byte limit; near-limit files may need smaller batches.
- Preview is read-only. A ten-minute HMAC approval binds actor, hashed session, exact input, target, snapshot and row-decision digests. Apply rechecks owner, metadata fence, target/snapshot and decisions before inserts, with one count-only strict audit including batch no-ops. Existing rows/timestamps are not updated by re-import. The maximum-500-row regression exposed oversized raw decision arrays; signed SHA256 digests now keep tokens bounded.
- Signing and rate limits are process-local. Restarts or requests routed to another process require a new preview; throttles are not distributed quotas. Multi-worker deployment needs a shared signing facility or suitable routing before rollout.
- New selections/reactivations/conversions remain active-reference-only. Already-active, purchasable, non-retired saved options may retain inactive models only with same-product unarchived mappings and the existing commerce/stock guards. Publication still rejects products lacking active compatibility or qualifying retained options. Both legacy and shared model management use the same publication guard; failed validation rolls back before audit.
- Use pagination now sorts by exactly the cursor expression, avoiding skipped prefix product IDs such as `p`/`p-2`.
- Removed legacy backfill proposals that invented device brands/models. Backfill resolves existing owner-created records only and reports missing/ambiguous references; it was not executed.
- Prepared read-only inspection and dry-run-first colour reconciliation. Apply requires explicit target/schema/manifest/fresh digest/owner approval and only appends unambiguous links plus revision/audit effects. No colours are created automatically; no reconciliation was applied.

### Normalization contract and pending PostgreSQL proof

Normalization is NFKC, per-codepoint Unicode lowercase, then Unicode Letter/Number filtering. For example Greek `ΟΣ` becomes `οσ`, deliberately not contextual whole-string lowercase `ος`. Migration 0058 embeds Node Unicode 17 lowercase mappings and explicit character ranges, avoiding locale-sensitive database lower/alnum. Real PostgreSQL parsing, NFKC version parity, collision/index/FK/trigger/RLS behavior, concurrency, rollback and revision/idempotence acceptance remain unverified until an approved disposable write target is supplied. The offline PostgreSQL parity test is skipped, not passed.

### Read-only target evidence

`node --env-file=.env.local scripts/inspect-shared-catalogue.mjs` completed read-only against hostname `aws-0-ap-northeast-1.pooler.supabase.com`, schema `public`: 15 products, 36 variants, 1 brand and 1 model; no reported normalized brand/model collisions or invalid model parents. Colour/link tables and new indexes/triggers are absent, as expected before applying 0058–0059. Missing tables have null counts, not zero rows. Evidence: `.tmp-options-phase1-preflight.json`. This is inspection, not authorization to write to this target.

### Verification evidence

- Final full suite: **1,621 tests; 1,533 passed; 4 failed; 84 skipped; 0 cancelled**. Evidence `.tmp-options-phase1-tests-complete.txt`. The four failures remain the Phase 0 payment-recovery and stock-behaviour source assertions; their runtime significance is unresolved. No baseline test was weakened to conceal them. The extra skip is explicit PostgreSQL normalization parity. New review-fix service/metadata suite: 31/31 passed.
- Final post-review `npm run typecheck` and `npm run build` both passed (exit 0); build generated 25 static pages. Evidence `.tmp-options-phase1-typecheck-complete.txt` and `.tmp-options-phase1-build-complete.txt`. The existing external-lockfile warning remains.
- All six check scripts ran. Account guards, admin boundary, settings lists and store-admin guards passed (122 routes). Notifications: 3 passed/5 failed, no message sent. Catalogue parity still exits 2 for missing `Midnight Black` plus two price/spec drifts. Fresh legacy compatibility exits 1 at local media HTTP check (the old checker captured no exception category; app availability was not established); its read-only stored-reference scan found zero old-admin references. An older pass is not current acceptance. Evidence `.tmp-options-phase1-check-results-verified.json` and associated logs.
- `npm audit --json`: zero vulnerabilities. `git diff --check`: no whitespace errors, LF/CRLF advisories only. Git log/status captured; work remains uncommitted on the existing backup branch, with unrelated prior temporary files preserved.
- Synthetic browser at 1440/768/390 completed owner inline model, admin create-only colour, Enter/draft/reload/conflict and existing product-edit flows, with zero captured console errors/external requests and no stray page overflow. **Overall failed at all three widths**: timeout locating Shared-list input in the owner-colour workflow. Thus bulk preview/apply/near/deactivation browser acceptance is unverified. Screenshots were visually inspected for the mobile inline-colour and failed owner-import states; this does not override the failed runner. Evidence `tmp/product-admin-ui-20261103/results.json`. These are memory-only component fixtures, not authenticated Next/database acceptance.
- Fixture servers on ports 43129/43130 may remain. Old process cleanup was denied because ownership was unproven; no workaround attempted. The fresh task handle was unavailable when stopping it. Cleanup remains pending; no process was killed by PID.

### Planning assumptions, not measured guarantees

User selected up to five editors, approximately 20 reads per write, peak five catalogue requests/second; daily backup target RPO 24h/RTO 4h; 99.5% monthly availability. Ordinary action latency targets p50 300ms/p95 1s/p99 2s; 500-row preview/apply p50 1s/p95 3s/p99 5s. Store owner decides rollout pauses. Backup capability, latency and availability have not been verified.

**Stop boundary:** Phase 1 database/authenticated/full browser acceptance remains open, public publication remains unapproved, and Phase 2 is not authorized by this report. No price unlock, unified options table, colour galleries, customer selector redesign or Education Store change was made.

## Historical Phase 1 repair rerun (2026-11-04)

- Reproduced the four failures: focused baseline 19 total / 14 passed / 4 failed / 1 skipped. Exploration traced obsolete source shapes: `selectionConflict` supplements the reservation/payment blockers, detail actions delegate to fresh exact-selection/cart policy, and payment resolution now distinguishes variant inventory and untracked parents. No production guard was reverted. Permission-system denial blocked reassignment to implement stronger actual-handler/detail tests and the explicit shared-textarea label fix. The denial was not bypassed; the four tests and failed browser acceptance remain open.
- Fixed independent diagnostic reporting: known case-spec labels use storefront `normaliseKey`; collisions stay visible; unequal values and real catalogue discrepancies stay reported. Fresh parity exit 2: missing `Midnight Black`, extra `Midnight NLU`; two price drifts 349900/350900 and 79900/87900 paise. No business-data adjustment or rename was guessed. Owner choice and identity/SKU/order/reservation/stock provenance must precede any repair.
- Legacy checker now requires explicit credential-free loopback HTTP origin, uses a read-only database session and aggregates sanitized transport/HTTP/cancellation categories. It never follows redirects. The old exception proves neither app unavailability nor damaged data; prior wording is corrected. Fresh invocation without an established safe app target refuses before database access (exit 1); authenticated/live HTTP acceptance is still pending, not passed by synthetic tests.
- Added `--no-provider-probe` for saved notification-setting diagnostics; this blocks `--send-to`, makes no SMTP connection and keeps skipped verification a failed readiness gate. New previews only at `tmp/notification-options-repair-20261104-r1/`. Fresh result **3 pass / 5 fail**, **102 templates rendered**, no provider probe/message. Provider/credential/sender/matrix changes require owner decisions; no informational exit override was used.
- Fresh diagnostic/legacy regressions **18/18 passed**, none skipped. Full suite **1,633 total / 1,545 passed / 4 failed / 84 skipped / 0 cancelled**. Typecheck/build passed; 25 static pages; existing external-lockfile warning. Route/account/boundary/settings checks passed (122 guarded store-admin routes); audit zero vulnerabilities. Final post-fixture logs `.tmp-options-repair-tests-final.txt` (exit 1), `.tmp-options-repair-typecheck-final.txt` / `.tmp-options-repair-build-final.txt` (both exit 0), other `.tmp-options-repair-*.txt` and `.tmp-options-repair-audit.json` supersede earlier results for these checks. Final whitespace check passed; git log/status captured. Business writes, migrations, fixtures, commits and pushes remain unperformed.
- Replaced the unconditional PostgreSQL placeholder with a real opt-in integration path: `tests/helpers/shared-list-fixture.mjs`, `tests/shared-list-integration.test.mjs`, `scripts/shared-list-test-manifest.mjs`; added only transaction-injectable preview/apply/save seams to the existing service, keeping production wrappers/global pool unchanged. Offline focused result **28 total / 27 passed / 0 failed / 1 genuine PostgreSQL skip**. No database client constructed or DB assertion executed. Dedicated target variable only, exact target/code/runtime/TLS/operation hash approved before driver import, schema-only search path, no public defaults/FKs/sequences; refuses existing `itest_shared_lists_v1`; cleanup only with this run's ownership marker.
- Prepared fixture bounds (not executed counts): default max 1 connection / 32 operations / 26 committed rows / 8 rolled-back rows / 11 rejected inserts / 9 audit-sequence advances; separately approved race max 2 / 33 operations / 28 committed rows / 10 sequence advances. Committed updates products 12, colours 3, models 1; at most 4 rolled-back product trigger touches. Source changes invalidate approval. Generate a future exact-target manifest using securely supplied `SHARED_LIST_DATABASE_URL` and `node scripts/shared-list-test-manifest.mjs` (optional `--race`); this pure command does not connect and is not execution approval. No configured real target was adopted. Owner/schema flag tests do not prove non-owner RLS/session isolation; authenticated app acceptance and full production-schema/privilege equivalence remain pending.
- The user's conditional advancement request is not satisfied: all-clear still requires the blocked local fixes plus actual browser, separately approved PostgreSQL and authenticated acceptance and unresolved business/provider readiness. Phase 2 has not started.

## Phase 1 main-session completion — 2026-11-04

The [current report](docs/phase1-shared-lists-20261104.md) compares every Phase 1 requirement with the earlier commits. Existing imports, colour links, owner workflows, formula protections, atomic/no-op audit behavior and no-seed rules were retained. Repairs cover the confirmed limits, JSON transport allowance, bounded duplicate planning, one parameterized batch insert, direct paginated product-use review, inactive-brand rename suggestions, stale near-match confirmation, colour length consistency and readable field instructions.

Final default suite: **1,645 total / 1,561 passed / 0 failed / 84 skipped / 0 cancelled**. Typecheck/build pass; 25 static pages; 122 store-admin APIs, 21 account APIs and 11 account pages pass their guards. Admin boundary and dependency audit pass (zero vulnerabilities). Component browser flows pass at 1440/768/390 with no console errors or external requests; measured instruction contrast is at least **6.98:1**. The original four Phase 0 failures remain repaired under their original names.

The offline notification diagnostic renders 102 templates and returns **1 passed / 4 failed** because database/settings/provider checks are deliberately unavailable. This does not supersede the earlier saved-setting readiness measurement of 3 passed / 5 failed. Live parity, settings-table and legacy-media reads were not rerun. The two accepted prices now match the recorded database snapshot in static pages and fallback search/bag references; no saved option, price or Midnight NLU database row was edited.

The [disposable PostgreSQL runbook](DISPOSABLE_DB_RUNBOOK.md) covers Docker, installed Windows and a separate hosted instance, restricted role privileges, all 57 migrations, session/TLS environment variables, exact commands and approval scopes for all 84 skips. It was not executed; all 15 PowerShell blocks parse successfully. Database-engine normalization/rollback/constraints/RLS/race and authenticated owner/admin/viewer acceptance remain pending. Signing/throttling remains process-local and needs deployment consideration.

Work is saved on `backup/phase1-shared-lists-20261104` in logical commits. No action was denied; sandbox restrictions on test/build workers required approved escalation. No migration, database fixture, provider probe/send or business-data write was performed. Stop at Phase 1 and await the user's next instruction.
