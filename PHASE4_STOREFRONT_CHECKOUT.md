# Phase 4 — storefront and checkout

Date: 2026-11-04

Scope: Phase 4 of `plannn.md`, not the older stock-engine plans/tests also named phase4.

## Implemented

- Added explicit fresh reads to the existing public catalogue summary endpoint. Purchase validation bypasses cross-request catalogue caches, requires a readable managed catalogue and sale decision, and never authorizes a managed selection using outage/static fallback. Ordinary storefront rendering fallback remains unchanged.
- Shared exact-selection helper validates current integer-paise prices and affirmative quantity availability. Parent minimums, labels, historical SKUs and sibling options cannot substitute for an explicit variant ID.
- Cart additions are awaited and validate the prospective whole bag, including existing quantities and display lines sharing parent inventory. Quantity/line bounds, mutation generations, synchronous source updates and selection cancellation prevent stale overlapping additions. Only successful commits open the bag or announce success.
- Changed prices stop for explicit review and a new customer action; current price/strike-throughs replace stale display values without blindly repeating the addition.
- Both PDPs, quick-add cards, recommendations and reorder controls use the shared purchase contract. Pending/selection/unmount guards prevent duplicate or stale success feedback/navigation. Selected variant labels replace unrelated hidden colour metadata.
- Case compatibility displays the complete supplied device list with neutral wording. Compatibility does not generate commerce selections or stock pools.
- Buy Again projects current inventory mode and sends variant products to Choose options. It rechecks refreshed mode rather than adding a variant product's parent or substituting a historical/replacement option.
- Authoritative payment catalogue eligibility now matches active/nondeleted category visibility and rejects normal-mode unavailable parent products with absent or explicitly untracked stock. Existing tracked-stock and sale semantics remain intact.
- Checkout rejects malformed supplied variant IDs and oversized carts before order creation. Exact eligible lookup misses return typed `409 selection_unavailable`, including when a coupon is supplied, rather than generic not-found failures. Unrelated infrastructure errors retain their prior failure paths.
- Checkout selection conflicts preserve the bag, invalidate stale price recovery, block payment resubmission and offer Review bag / Choose options. Existing exact-line `price_changed` review remains supported. Stale A→B→A responses cannot initiate gateway forms.
- Added offline lifecycle regressions: stale source versus explicitly selected replacement, immutable JSON/normalized order snapshots, retired-identity release, mixed-line expiry, exact late-capture reclaim, all-or-none refusal/refund obligation and replay safety.

## Verification

### Explicit offline regression suite

```sh
node --test tests/storefront-selection.test.mjs tests/availability-selection-validation.test.mjs tests/purchase-ui-actions.test.mjs tests/cart-id.test.mjs tests/payu-db-pricing.test.mjs tests/variant-stock-rules.test.mjs tests/checkout-stock.test.mjs tests/reservation-rules.test.mjs tests/checkout-client-quote.test.mjs tests/customer-variant-inventory.test.mjs tests/option-checkout-resolution.test.mjs tests/checkout-initiate-validation.test.mjs tests/checkout-selection-recovery.test.mjs tests/selected-variant-stock.test.mjs tests/variant-identity.test.mjs tests/option-pricing.test.mjs tests/option-consumer-pricing.test.mjs tests/storefront-phase3.test.mjs
```

**178 passed, 0 failed, 0 skipped.** Output: local temporary `gadzio-phase4-final-offline.txt`. Includes the final fresh-reader coverage and 7 real-component purchase handler/hook tests.

An earlier supplemental run:

```sh
node --test tests/purchase-ui-actions.test.mjs tests/storefront-selection.test.mjs tests/availability-selection-validation.test.mjs
```

**19 passed, 0 failed, 0 skipped** (7 purchase UI tests plus 12 overlapping selection/cart/route tests). Do not add overlapping suite totals together. Output: local temporary `gadzio-phase4-ui-actions.txt`.

These use pure helpers, allowlisted module loading, injected transaction/payment doubles or synthetic hook hosts. Expected negative-path logs include synthetic infrastructure failures, rejected audit writes and unverified payment responses; they are fixture assertions, not live gateway calls. Node emitted module-type warnings; package module mode was not changed.

### Static checks

- `npm run typecheck`: passed after caller spread/fixture typing corrections.
- Account guard checker: 21 API routes and 11 pages passed.
- Admin content boundary checker: passed.
- Store-admin route checker: all 115 routes guarded.
- Targeted tracked whitespace checks: passed; Git line-ending conversion warnings are informational.

### Synthetic browser evidence

**48/48 scenarios passed**, 0 failed/skipped, at **1440, 768 and 390 px**. No console/page errors or blocked/external requests. Covers both PDPs, explicit selection, repeated demand, fresh sale-price review, failed reads, selection changes during pending Add/Buy Now, shared-pool demand, cart quantity rejection, Buy Again routing and checkout selection conflicts without bag clearing or gateway forms.

Final commands:

```sh
node scripts/commerce-browser-fixture.mjs --port 0
python -I scripts/commerce-browser.py --port 49802
```

Artifacts: `tmp/commerce-browser-fixture/results.json`, `build.json` and screenshots in that directory. The final fixture was rebuilt after UI edits froze; all 22 source hashes matched after the browser run. Its newly started server was stopped, and its port refused connections afterward. Earlier failure screenshots remain as historical debugging artifacts; final `results.json` is the authoritative run.

This fixture is separate from the authenticated Next application, binds loopback only, rejects backend imports, intercepts API requests in browser memory, blocks external requests and disables native gateway form submission/CSP form actions. Header/footer/trust/recommendations/refresh are test aliases. Synthetic responses establish client contracts, not deployed backend behavior.

### Corrected verification failures

- Intermediate source-based tests expected old PDP helper/state declarations; updated assertions to the shared validated purchase contract and added behavioral handler coverage.
- Intermediate typecheck caught an untyped fixture callback and duplicate price fields before an authoritative spread in recommendation callers. Corrected; final typecheck passed.
- Initial browser fixture runs exposed observer timing and Playwright string-predicate/CSP issues in the test harness. Fixed waits without relaxing CSP. Final results are recorded separately below once available.

## Deployment and acceptance limits

**Migrations 0055–0057 remain unapplied.** No database connections, migrations, seeds/backfills, live inventory changes, real purchases/payment requests, commits or pushes were performed for this phase. Education Store, existing price-write gates and historical inventory movement records were not changed.

Historical stock release/reclaim continues using original ledger identities, not today's compatibility or replacement eligibility. Checkout decrements stock when reserving; verified payment consumes that reservation without a second decrement. Failure release honors the configured grace period.

Offline tests do not prove real PostgreSQL predicates, constraint/RLS acceptance, rollback/locking/concurrency, deployed auth/cache behavior or gateway outcomes. Separately authorized Phase 5 integration acceptance is still required. The pre-existing one-active-checkout-per-account precheck remains non-atomic and is a concurrency follow-up, not a guarantee established here.
