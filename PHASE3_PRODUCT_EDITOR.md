# Phase 3 — product editor implementation and verification

Date: 2026-11-04

## Implemented

- Central **Store Admin → Device models** screen reuses existing device references and management APIs. All store roles can browse; only owners can create/edit shared records.
- New device references use create-only POST with server-issued IDs. Saved model brands stay locked. Raw model status and effective parent-brand eligibility are distinguished.
- Inline model and optional brand creation preserve the product draft and do not select compatibility, create variants or switch inventory mode. Inputs stay mounted across wizard steps; unfinished reference inputs block product saves until created or reset. Busy and uncertain outcomes prevent unsafe retries.
- Optional classification/mapped attributes are under Advanced. Ordinary untyped products need no global attribute setup. Existing attributes, archived values and compatibility requirements remain supported.
- Basics and Description edit the same canonical specification sections, retaining IDs, ordering, hidden sections and other description types. Untouched legacy-converted content is omitted from unrelated saves.
- Combination generation previews unselected candidates. Only explicitly reviewed physical combinations become sellable draft rows. Semantic deduplication uses stable model IDs and normalized option identities; saved labels are not renamed automatically.
- Retired variants are read-only and omitted from writes. Saved non-null SKUs stay locked, including display-only rows. Explicit replacement starts inactive with a new identity/SKU and tracked zero stock; unknown semantic values require explicit input. Nonzero replacement receipts require confirmation, not inherited source stock.
- Shared product stock and individual variant stock are explicit. Compatibility alone does not switch modes. Parent transfers and confirmed new receipts are separate; transfer quantities cannot also become opening destination stock. Pending count corrections/receipts must be resolved separately. Existing variant mode never falls back to parent stock.
- Existing-product saves send the loaded integer expectedRevision. Revision conflicts retain the draft; successful saves lock stale local identities until authoritative remount. Network, malformed success and server-uncertain outcomes prevent blind replay.

## Verification results

### Offline editor suite

Command:

```sh
node --test tests/product-workflow.test.mjs tests/product-catalog-guidance.test.mjs tests/product-description.test.mjs tests/product-specifications.test.mjs tests/product-help.test.mjs tests/device-reference-manager.test.mjs tests/catalog-workspace.test.mjs tests/product-metadata-admin.test.mjs
```

**84 passed, 0 failed, 0 skipped.** Includes the final regression that rejects staged destination-count changes during parent transfers instead of silently dropping them.

### Inspected offline backend/commerce regression suite

Command:

```sh
node --test tests/product-draft.test.mjs tests/product-draft-route.test.mjs tests/product-content.test.mjs tests/product-content-route.test.mjs tests/catalog-revision.test.mjs tests/variant-identity.test.mjs tests/device-metadata.test.mjs tests/product-metadata-rules.test.mjs tests/variant-stock-rules.test.mjs tests/catalog-csv.test.mjs tests/catalog-metadata-csv.test.mjs tests/checkout-stock.test.mjs tests/reservation-rules.test.mjs tests/selected-variant-stock.test.mjs tests/option-checkout-resolution.test.mjs tests/customer-variant-inventory.test.mjs
```

**143 passed, 0 failed, 0 skipped.** SQL transaction doubles/pure functions, not hosted database acceptance.

### Static checks

- `npm run typecheck`: passed.
- `node scripts/check-store-admin-routes.mjs`: all **115** store-admin routes guarded.
- Targeted tracked `git diff --check` and explicit whitespace/conflict-marker checks covering the new untracked editor files: passed. Git emitted line-ending conversion warnings, not check failures.

### Synthetic browser checks

- Product editor: passed at **1440, 768 and 390 px**. Exercises six-step create/edit, inline model creation, Enter isolation, wizard draft retention, explicit compatibility, synchronized specifications, opt-in combinations, confirmed receipt/untyped publication payload, shared stock, replacement, conflicts and role restrictions.
- Catalogue workspace: passed at **1440 and 390 px**, including mounted drafts, filters, tabs, optional management links/new tabs and reference reload without losing the product draft.
- No browser console errors or external requests in either fixture run.
- Fixtures bind loopback only, reject backend imports and intercept writes in memory; they do not start the authenticated application or call its database/payment services.
- Final product run used port 43137 because 43127 was already occupied; the existing listener was not terminated. The newly started final fixture was stopped afterward.
- Local evidence: `tmp/product-admin-ui-20261103/results.json` and `tmp/catalog-workspace-20261103/browser-results.json`, with screenshots in those directories. Directory names are retained from the existing fixture scripts.

## Deployment and remaining scope

**Migrations 0055–0057 remain unapplied.** No migrations, seeds, backfills, production writes, real inventory activation, payment calls, commits or pushes were performed for this phase. See `PHASE2_CATALOG_DEPLOYMENT.md` for migration/recovery boundaries and separately approved real-database verification.

These results establish source/UI behavior under synthetic data, not authenticated deployed-app behavior, PostgreSQL constraint/locking/RLS acceptance, real stock concurrency, storefront checkout or PayU callback correctness. Phase 4 storefront/checkout implementation and separately authorized Phase 5 deployment/integration acceptance remain outside this phase. Existing price-write gates and Education Store were not changed by this phase.
