# Phase 5 — product simplification verification and usage guide

Date: 2026-11-04

Scope: **Phase 5 of `plannn.md`**, not the older coupon/database work also named phase5.

## Status and boundaries

Fresh offline regression run: **405 passed, 0 failed, 0 cancelled, 0 skipped**, across **40 distinct explicitly selected test files**. TypeScript and the three source authorization/boundary scanners passed. Fresh synthetic editor, catalogue workspace and commerce browser checks also passed, with no recorded browser/console errors or external/blocked request attempts. No demonstrated regression required source changes.

This establishes offline/injected and synthetic-client contracts, **not full deployed end-to-end acceptance**. Migrations 0055–0057 remain documented as unapplied; no live schema inspection was performed. No database connections, migrations, seeds, backfills, real stock changes, real purchases/payments, application build/dev server, commits or pushes were performed for this phase. Education Store, pricing gates, RLS and authentication were not changed.

The blanket `npm test` command was deliberately not run: it includes suites that can use hosted databases. Older `run-phase5-approved`/coupon runners are unrelated and excluded.

## 1. Offline regression command and result

Executed from the project root:

```sh
node --test tests/product-workflow.test.mjs tests/product-catalog-guidance.test.mjs tests/product-description.test.mjs tests/product-specifications.test.mjs tests/product-help.test.mjs tests/device-reference-manager.test.mjs tests/catalog-workspace.test.mjs tests/product-metadata-admin.test.mjs tests/product-draft.test.mjs tests/product-draft-route.test.mjs tests/product-content.test.mjs tests/product-content-route.test.mjs tests/catalog-revision.test.mjs tests/variant-identity.test.mjs tests/device-metadata.test.mjs tests/product-metadata-rules.test.mjs tests/variant-stock-rules.test.mjs tests/catalog-csv.test.mjs tests/catalog-metadata-csv.test.mjs tests/checkout-stock.test.mjs tests/reservation-rules.test.mjs tests/selected-variant-stock.test.mjs tests/option-checkout-resolution.test.mjs tests/customer-variant-inventory.test.mjs tests/storefront-selection.test.mjs tests/availability-selection-validation.test.mjs tests/purchase-ui-actions.test.mjs tests/cart-id.test.mjs tests/payu-db-pricing.test.mjs tests/checkout-client-quote.test.mjs tests/checkout-initiate-validation.test.mjs tests/checkout-selection-recovery.test.mjs tests/option-pricing.test.mjs tests/option-consumer-pricing.test.mjs tests/storefront-phase3.test.mjs tests/product-image-lock-order.test.mjs tests/product-list-stock.test.mjs tests/catalog-starter-setup.test.mjs tests/homepage-products.test.mjs tests/homepage-product-route.test.mjs
```

Exit **0**; **405 tests passed**, no failures/skips. Runner duration: 25,790.3063 ms. Output: `tmp/phase5-product-simplification-20261104/offline-tests.txt`.

These are fresh counts from one unique-file invocation. Do not add historical Phase 3/4 totals or overlapping supplemental runs to them.

Tests reuse pure helpers, injected SQL/transaction/payment seams, allowlisted route/module loaders and deterministic component hosts. They include successful and intentionally rejected writes. Expected logs such as synthetic infrastructure errors, coupon lookup failures, unverified fixture callbacks and rejected audit writes are negative-path assertions—not real service incidents. Node emitted `MODULE_TYPELESS_PACKAGE_JSON` warnings; no module-mode change was made to hide them.

## 2. Static checks

Executed:

```sh
npm run typecheck -- --incremental false
node scripts/check-store-admin-routes.mjs
node scripts/check-account-routes.mjs
node scripts/check-admin-boundary.mjs
```

Results:

- TypeScript: exit **0**, no diagnostics; incremental-cache output disabled.
- Store-admin route scanner: **115 routes guarded**.
- Account scanner: **21 API routes**, **11 session-guarded dynamic pages** passed.
- Admin boundary scanner: passed; website ownership/media whitelist and legacy commerce boundaries checked; Education Store left alone by its existing rule.

These are source scanners, not authenticated HTTP tests. Output is archived beside the offline log as `typecheck.txt`, `store-admin-routes.txt`, `account-routes.txt` and `admin-boundary.txt`. `offline-manifest.json` records the 40 explicit test paths and source hashes. Targeted `git diff --check` plus explicit Python checks for the two untracked Markdown files passed (no trailing whitespace or conflict markers); evidence: `document-checks.json`.

## 3. Synthetic browser verification

All three drivers exited **0**, with no execution failures, browser/console errors or blocked/external request attempts:

| Fixture | Fresh result | Viewports | Fresh screenshots |
|---|---|---|---|
| Product editor | 3/3 viewport runs; 39 completed check groups | 1440, 768, 390 px | 36 |
| Catalogue workspace | 2/2 viewport runs; 12 completed check groups | 1440, 390 px | 6 |
| Storefront/checkout | **48/48 scenarios**, 0 failed/skipped | 1440, 768, 390 px | 21 |

Check groups, viewport runs and commerce scenarios are different units; they are not one uniform test total. There are **63 fresh screenshots**. Existing tests cover inline model creation/draft preservation, local specifications, reviewed combinations, revisions/replacement stock and catalogue navigation; commerce covers explicit variants, price review, cumulative demand, failed/stale actions, bag quantity, Buy Again and checkout conflicts.

Executed sequentially from the project root (drivers used the installed Python executable at `C:/Users/Abcom/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe`, with `-I`):

```sh
node scripts/product-admin-ui-fixture.mjs --port 43357
python -I scripts/product-admin-ui-browser.py --port 43357
node scripts/catalog-workspace-fixture.mjs --port 43358
python -I scripts/catalog-workspace-browser.py --port 43358
node scripts/commerce-browser-fixture.mjs --port 0
python -I scripts/commerce-browser.py --port 58393
```

Ports 43357/43358 were checked unused before starting; commerce received OS-assigned 58393. Only the three owned fixture processes were terminated after their drivers completed. Windows termination exit 1 in provenance denotes intentional server shutdown, **not a failed browser test**. All processes were waited; all three ports passed unused-bind checks afterward. No unrelated listener was stopped.

Fresh evidence root: `tmp/phase5-product-simplification-20261104/browser/`:

- `product-admin-ui/results.json`, `catalog-workspace/browser-results.json`, `commerce/results.json` and screenshots in their respective directories.
- `execution-summary.json`, `toolchain-provenance.json`, `final-port-checks.json`, `evidence-manifest.json`.
- Per-fixture `run-provenance.json`: exact executable argv/PIDs, UTC timestamps, source/artifact hashes, no-drift verification, stop details and stale-artifact exclusions. Commerce also supplies `build.json` with module hashes/import allowlist/aliases/CSS sources.

Existing prior evidence was inspected, copied without deletion and hash-verified under `tmp/phase5-product-simplification-20261104/prior-browser-evidence/` before reuse of fixture output paths. Historical failure screenshots remain preserved, but are not counted as new failures or included in the fresh captures. Editor/commerce compiles reused byte-identical bundles without changing mtimes; exact used bundles were separately copied and hash-verified, disclosed in `compiled_bundle_captures`. Workspace bundles were freshly emitted. No source drift was found in application sources, helpers or the six fixture/driver scripts during any run.

Installed toolchain: Node 24.18.0, Python 3.11.15, Playwright 1.61.0 with Chromium, Next 16.4.3, React 19.2.4 and TypeScript 5.9.3. Nothing was installed.

**Limits:** these real components are transpiled/hydrated in synthetic loopback hosts, not authenticated Next routing/server integration. Admin fixtures use real admin CSS plus fixture utilities; commerce compiles Tailwind for explicit fixture sources and aliases navigation/footer/trust/recommendations/refresh. Saves, auth/address, catalogue/availability and checkout conflict responses are in-memory doubles. Backend imports/external requests are guarded; commerce blocks native gateway forms and retains CSP `form-action 'none'`. Synthetic `source=db` is not proof of a DB read. No reservation/payment/account backend was reached.

## 4. Coverage against `plannn.md` §8

| Required behavior | Fresh offline evidence | Acceptance limit |
|---|---|---|
| Create without advanced Catalogue Data | `product-workflow`, `product-metadata-rules`: explicit untyped publication and no setup requirement | No live aggregate save/publication |
| Existing structured attributes | `product-metadata-admin`, `product-metadata-rules`, `product-catalog-guidance`, `catalog-metadata-csv` | Real DB compatibility/transaction acceptance deferred |
| Inline device creation | `device-reference-manager`, `product-catalog-guidance`, `product-workflow`: explicit selection, draft retention, dirty/busy/uncertain outcomes | No live authenticated shared-record creation |
| Multiple devices/colours | `product-workflow`: exact mappings, explicit semantic identity and reviewed candidates | Synthetic combinations, not verified real product fit |
| Duplicate generation prevention | `product-workflow`, `variant-identity`, `catalog-metadata-csv`: stable model/value identity and duplicate refusal | Actual unique constraints/races deferred |
| Shared stock across compatible devices | `storefront-selection`, `checkout-stock`, `option-checkout-resolution`: parent-key aggregation | No real row locks/concurrent DB demand |
| Separate model-specific variant stock | `variant-stock-rules`, `selected-variant-stock`, `customer-variant-inventory`, `product-list-stock` | SQL doubles/service contracts, not SQL execution |
| Archive and replace | `product-workflow`, `variant-identity`: new ID/SKU/key, inactive tracked zero stock, no inherited holds | Actual 0055 constraints/FKs deferred |
| Existing order history after replacement | `selected-variant-stock`: unchanged JSON/normalized snapshots and original-identity movement release/reclaim | No deployed account/order-history read |
| Payment failure and reservation release | `reservation-rules`, `checkout-stock`, `selected-variant-stock`: grace/expiry, original ledger IDs, replay safety | Injected verified/unverified responses, not PayU |
| Concurrent purchases | `storefront-selection`: overlapping client mutation cancellation; stock helpers model exact aggregation/guarded claims | **Real PostgreSQL concurrency is unverified**; one-active-checkout-per-account precheck remains non-atomic |
| Inactive/zero-stock choices | `option-pricing`, `option-checkout-resolution`, `availability-selection-validation`, `selected-variant-stock` | Real query predicates/locks deferred |
| Product edits after publication | `catalog-revision`, `product-draft`, `product-draft-route`, `storefront-phase3`, `storefront-selection`: stale revision, post-commit cache failure and exact fresh selection | No deployed cache/auth session acceptance |
| Existing catalogue compatibility | `device-metadata`, `product-metadata-admin`, `product-description`, `product-content`, `catalog-csv` | No production-data migration acceptance |
| Complete admin → publish → customer selection → payment → stock → history chain | Separate editor, customer and lifecycle seams exercised | **Not a single authenticated deployed end-to-end run**; cannot mark that full chain accepted |

Homepage placement is additionally covered by `homepage-products` and `homepage-product-route`: ordered reference-only slots, current catalogue projections, unavailable selection handling, owner/same-origin checks and homepage revalidation.

## 5. Failures, changes and user guide

- Fresh 40-file offline run: **no failures**; no retry needed.
- TypeScript/source guards: **no failures**.
- Fresh browser runs: **no failures**, no retry or fixture correction needed.
- No new production defect has been demonstrated by those checks; no production source/test behavior was changed to obtain these passes.
- Updated [PRODUCT_CATALOG_FLOW.md](PRODUCT_CATALOG_FLOW.md) with the simplified six-step workflow, owner-only central/inline device creation, explicit compatibility, shared versus variant stock examples, immutable identities/replacements, uncertain-save handling and website placement/update behavior.
- Corrected stale documentation that required a product type/mapping for ordinary creation/publication, while retaining valid optional advanced reference/dependency guidance.
- Product options remain price-read-only. Guide distinguishes canonical ID-based product URLs from catalogue slug fields, and publishing from separate Website Content/collection placement.

## 6. Deferred deployment/integration acceptance

The existing separately approved disposable-database procedure is in [PHASE2_CATALOG_DEPLOYMENT.md](PHASE2_CATALOG_DEPLOYMENT.md). It requires an exact manifest/target approval and does not inherit authorization from this testing task.

Not run/not proven:

- Actual migration SQL, constraints/triggers/RLS, FK/index acceptance, rollback and two-connection locking/races.
- Production data compatibility, grants, pooler capacity or rollout/recovery.
- Full real aggregate product draft/CSV transactions and authenticated HTTP owner/admin/viewer sessions/cookies.
- Deployed catalogue invalidation and customer open-tab behavior.
- Real PayU initiation/verification/callbacks, refunds or external notifications.
- Fully integrated admin creation → publication → real payment → historical account display.

The pre-existing one-active-checkout-per-account precheck is **not atomic**. Exact stock locking is a separate protection; this phase does not claim the account policy is concurrency-safe.

**Conclusion:** offline acceptance can pass while deployment/database/gateway acceptance remains deferred. Neither the guide nor passing synthetic tests authorizes a migration or a real business transaction.
