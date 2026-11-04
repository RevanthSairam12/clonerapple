# Phase 0 final verification — 4 November 2026

The four original failures are repaired and pass under their original test names. The fresh default full suite ran **1,639 tests: 1,555 passed, 0 failed, 84 skipped**. All work was performed in the main session. The backup branch is `backup/phase0-final-verification-20261104`.

The suite has six more cases than the earlier 1,633-test report: three checkout reservation-response cases, two detail-page purchase-action cases, and one stable shared-input label case. None of the four failing tests was deleted or skipped. The database opt-in flags were left unset.

## The four failures and their fixes

| Original test name | Why the old assertion failed | Repair and verification |
| --- | --- | --- |
| an active reservation stops checkout before the gateway form and exposes only a validated link | Its source regex required exactly `isSubmitting || activeReservation`; checkout now also blocks on `selectionConflict`. | Replaced the source assertion with execution of the real CheckoutForm handlers through an allowlisted offline fixture. Valid and hostile status URLs both preserve the bag, disable payment and aria-disabled, prevent repeat initiate requests, and never create or submit a gateway form, even when the 409 contains gateway fields. Only the validated relative status path or account fallback is rendered. |
| detail pages render the shared rule and re-check on click | It required the removed `availability.refresh()` call and boolean result; the current flow verifies exact selections with `verifySelections()` and delegates Add to authoritative cart validation. | Updated the wiring assertions to the current exact-selection APIs. Additional behavioral tests execute both ProductDetailPage and AccessoryDetailPage: an unselected/failed exact option cannot add or navigate, a sale cannot bypass refusal, and a changed price requires another explicit press. |
| bag, checkout and listings all use the shared stock rule | Its exact disabled-expression regex omitted the newly added `Boolean(selectionConflict)` blocker. | Updated the assertions to require each of the six independent blockers in both disabled and aria-disabled. Checkout behavioral tests also prove reservation and exact-selection conflicts disable payment, preserve the bag and block repeated payment submission. |
| normal-mode availability fails closed in the payment resolver | It looked for obsolete `hasStockRow` logic. The resolver now distinguishes product inventory from variant inventory and treats absent or explicitly untracked parent rows consistently. | Replaced the obsolete source predicate with real resolver calls through an injected SQL boundary: normal mode rejects absent/untracked parents marked unavailable; available parents and sale mode resolve; tracked parents and exact variants defer to the final locked stock claim. The exact-identity claim and independence from the display sale switch remain guarded. |

Test locations: [payment-recovery](../tests/payment-recovery.test.mjs), [stock-behaviour](../tests/stock-behaviour.test.mjs), [purchase-ui-actions](../tests/purchase-ui-actions.test.mjs), [checkout-selection-recovery](../tests/checkout-selection-recovery.test.mjs), [option-checkout-resolution](../tests/option-checkout-resolution.test.mjs). The shared offline harnesses are [checkout-component-fixture](../tests/helpers/checkout-component-fixture.mjs) and [payment-catalog-fixture](../tests/helpers/payment-catalog-fixture.mjs); neither opens an application database connection or submits a payment.

## Shared-input accessibility repair

[SharedListManager](../src/components/store-admin/SharedListManager.tsx) gives the textarea a stable React useId ID and an explicit sibling label whose htmlFor points to that ID. Entered text is outside the label, so it cannot become part of the accessible name. The instructions have their own linked aria-describedby ID.

The component test still requires the exact label “Shared-list input”, stable IDs across edits and distinct IDs across model/colour managers. The headless browser uses the exact textbox accessible name and verifies it, its description, its ID and its value after typing, replacing, clearing and rerendering. The check passed at 1440, 768 and 390 pixels. No accessibility assertion was relaxed.

## Read-only catalogue parity

The report compared 12 static products with 15 database products. Nine static products match; three have differences. Both price differences named in the request are confirmed.

| Product ID | Option names | Field | Static value | Database value |
| --- | --- | --- | --- | --- |
| iphone18pro-max-clear-magsafe | Diamond Clear in both | Base price | ₹3,499 (349,900 paise) | **₹3,509 (350,900 paise)** |
| cpc-gadzio-silicone-organizer | Black, Navy, Sand in both | Base price | ₹799 (79,900 paise) | **₹879 (87,900 paise)** |
| iphone17-silicone-black | Midnight Black | Option presence | Present | Missing |
| iphone17-silicone-black | Midnight NLU | Option presence | Absent | Present |

For iphone17-silicone-black, the complete static list is Midnight Black, Storm Blue, Plum Violet, Soft Mint, Indigo Denim, Blush Pink, Stone Gray. The complete active database list is Midnight NLU, Storm Blue, Plum Violet, Soft Mint, Indigo Denim, Blush Pink, Stone Gray. Its base price matches at ₹3,499.

The compare-at value on iphone18pro-max-clear-magsafe is informational: no static counterpart versus ₹5,000 (500,000 paise) in the database.

Database-only Store Admin products are also informational:

| Product ID | Active database option names | Static value | Database name / base price |
| --- | --- | --- | --- |
| test-2026 | None | No static product | test 2026 / ₹1,500 |
| test-item-xyz999 | 189, 188, 1899 | No static product | TEST-ITEM-XYZ999 / ₹99 |
| test-product | None | No static product | Test Product / ₹1,654.98 |

### Midnight NLU variant provenance

| Field | Database value |
| --- | --- |
| Product ID | iphone17-silicone-black |
| Variant row ID | iphone17-silicone-black-c-0-midnight-black |
| SKU | NEWPLOO |
| Option name / saved value | Colour / Midnight NLU |
| Hex | #1d1d1f |
| Active / purchasable / retired | true / true / not retired |
| Product inventory mode | product |
| Variant price override | NULL |
| Exact variant stock row | **Absent**; on_hand, reserved, available and track_inventory are NULL |
| Distinct orders referencing this exact variant ID | **0** |
| Exact stock movements / active exact order reservations | 0 / 0 |
| Product stock row | on_hand 0; reserved 0; available 0; track_inventory false |
| Product orders with NULL variant_id | **7**; cannot be attributed to this exact variant |
| Active product-level held reservations | 0 |

These are SELECT-only snapshots. The detailed provenance query used a repeatable-read, read-only transaction. No saved option, price, stock or order was changed.

### Proposed safe fix — not applied

1. Reload the current catalogue revision before a later authorized save. Archive the existing Midnight NLU commerce identity through the owner workflow while retaining its row ID, SKU, saved label and all historical relationships.
2. Create a new replacement labelled Midnight Black with a new server-issued ID and a distinct, owner-confirmed SKU, linked to the source via replacesVariantId. Leave price overrides unset; do not guess or write a price.
3. Start the replacement inactive with tracked zero stock. Activation and any opening count require explicit confirmation of new units. Preserve the current product inventory mode and parent stock pool; do not copy or allocate stock automatically.
4. Keep all historical orders and old identities intact and write the required sanitized audit through the normal privileged workflow.

No archive, replacement, rename, price update, stock write or migration was performed.

## Skipped tests

[All 84 exact names, grouped by recorded reason](phase0-skipped-tests-20261104.md):

| Group | Skipped |
| --- | ---: |
| Legacy database integration | 68 |
| PayU callback integration | 4 |
| Phase 2 catalogue integration | 1 |
| Phase 2 documents integration | 1 |
| Phase 3 metadata integration | 1 |
| Phase 4 stock integration | 1 |
| Phase 5 coupon integration | 1 |
| Shared list PostgreSQL acceptance | 1 |
| Shipping order integration | 6 |
| Total | **84** |

All 84 require PostgreSQL session connections for isolated schema creation and fixture writes. The shared-list fixture requires its dedicated SHARED_LIST_DATABASE_URL and exact target/code manifest; the other groups use DATABASE_URL plus their respective opt-in flags and approvals. A read-only catalogue connection is available in this session; it does not authorize running the write fixtures.

## Fresh verification results

| Check | Result |
| --- | --- |
| Full suite, same tests/**/*.test.mjs glob as npm test | **1,639 total; 1,555 passed; 0 failed; 84 skipped** |
| Focused repair/accessibility group | 56 total; 55 passed; 0 failed; 1 existing database skip |
| Diagnostic / legacy-media / notification-exit regression group | 18 passed; 0 failed; 0 skipped, included in the fresh full suite |
| PostgreSQL fixture offline group | 27 passed; 0 failed; 1 live PostgreSQL acceptance skip, included in the fresh full suite |
| npm run typecheck | Passed |
| npm run build | Passed |
| Store-admin route guards | Passed: all 122 routes |
| Account guards | Passed: 21 API routes and 11 pages |
| Admin boundary | Passed; Education Store remains deferred |
| Settings tables | Passed: readable |
| npm audit | Passed: 0 vulnerabilities |
| Whitespace | Passed |
| Headless product-admin browser fixture | Passed at 1440 / 768 / 390 pixels; no console errors or external requests |
| Notifications, no-provider-probe mode | **3 passed / 5 failed**, 102 templates rendered |
| Catalogue parity | **Failed (exit 2)**: missing Midnight Black, extra Midnight NLU and the two price differences above |
| Live legacy-media gate | **Passed: 2/2 legacy routes resolved**; 0 shared rows, 0 HTTP failures, 0 transport failures, 0 response-body cancellation failures |

Notification failures are: email is not configured for SMTP; SMS sending is off; the SMTP connection check was deliberately unperformed in diagnostic-only mode; no staff email matrix cells are on; no customer SMS matrix cells are on. No provider connection/probe or message was attempted, and no provider was enabled.

The live media check used the freshly built application at a loopback origin. The first preflight refused startup because the hosted pooler ignored the read-only startup GUC. The successful verifier instead pinned a real SQL wrapper that encloses every application tagged query in BEGIN READ ONLY and refuses unsafe/file/transaction/reserve entry points. The database reported transaction_read_only=on before application startup. Redirects were manual and response bodies were cancelled; remote CDN bytes and live shared-media routes were not exercised.

Authenticated application acceptance and the 84 opt-in PostgreSQL write tests remain pending. The browser fixture uses synthetic identities and memory-only saves; it does not establish authenticated production-browser acceptance.

## Permission denials and refusals

- Initial `git switch -c backup/phase0-final-verification-20261104` failed because .git/refs/heads/backup/phase0-final-verification-20261104.lock could not be created: Permission denied. The approved escalated retry succeeded.
- Initial `node --test` run of payment-recovery, stock-behaviour, purchase-ui-actions, option-checkout-resolution, checkout-selection-recovery and shared-list-ui was denied when Node spawned its test workers: spawn EPERM. The approved retry succeeded; the final focused and full suites passed.
- Initial `git ls-remote --heads origin refs/heads/backup/phase0-final-verification-20261104` failed because the sandbox proxy could not connect to github.com:443. The approved escalated retry succeeded and confirmed that the remote backup branch did not exist.
- Windows denied `Get-CimInstance Win32_Process` metadata checks for this session's verifier PIDs 5996 and 28568 before cleanup. The approved escalated retry checked each command line and successfully stopped both owned verification servers.
- Two read-only application startup preflights refused to start while the pooler reported read-only off. These were application verifier refusals, not permission-system rejections. Explicit read-only transactions corrected the verification target and the live media gate passed.

Generated .tmp-* diagnostics and database fixture snapshots, tmp/ browser/previews and machine-local .qoder permissions are ignored. The backup preserves all source changes, migration files, scripts, regression tests and these redacted verification reports.
