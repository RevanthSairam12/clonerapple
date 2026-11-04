# Tested and remaining database tests

**Updated: 2 November 2026**

## Phase A verification reconciliation — 2 November 2026

The latest Phase A offline rerun contains **1,249 tests: 1,167 passed, 0 failed,
82 skipped** (`.tmp-phaseA-reverify-tests.txt`). Focused Phase A regressions pass
**242/242 with no skips** (`.tmp-phaseA-reverify-focused.txt`). These run-local
skips do **not** mean the earlier isolated SQL work was never completed.

A read-only exact-name comparison against `.tmp-original-80-current-results.json`
found **79 of the latest 82 skipped registrations already have historical passing
SQL evidence**. The original index still records **80/80 passed**; the remaining
original Phase 2 registration has since been renamed and changed for Phase A.

| Relevant suite | Completed earlier evidence | Current Phase A interpretation |
|---|---|---|
| Original skipped registrations | **80 passed / 0 failed / 0 incomplete** | Preserve this result; do not restart the original batch merely because offline opt-ins are off. |
| Callback integration | **4 passed / 0 failed / 0 skipped**, `.tmp-approved-sql-Sx3K7K/results.json` | Earlier real SQL proof exists. Phase A subsequently changed payment integrity, persistence and lifecycle logic; no fresh current-source SQL rerun was performed by Phase A. |
| Shipping/order integration | **6 passed / 0 failed / 0 skipped**, `.tmp-approved-sql-dXUgYG/results.json` | Earlier real SQL proof exists. It is not a newly executed Phase A acceptance result. |
| Phase 2 documents | **15 passed / 0 failed / 0 skipped**, `.tmp-phase2-approved-rerun.log` | Earlier suite exercises active bill requests. Phase A retires that mutation and changes customer invoice visibility; the changed suite still needs fresh SQL acceptance. |
| Phase 3 metadata | **12 passed / 0 failed / 0 skipped**, `.tmp-phase3-fixed-retry.log` | Earlier passing evidence retained; no Phase A metadata rewrite. |
| Separate Phase 4 stock suite | Not completed by the original-80 follow-up | Separate from original 80; still pending in this accounting. |
| Separate Phase 5 coupon suite | **9 passed / 0 failed / 0 skipped**, `.tmp-phase5-sql-tests.txt` | Later completed evidence; older statements below that Phase 5 was untouched describe the original follow-up only. |

The two later suite registrations (Phase 4 and Phase 5), together with the changed
Phase 2 registration, are the **three exact-name nonmatches** among the current
82 skips. Do not add historical nested/pure counts to the latest offline count or
claim all 82 are untested. Earlier cleanup JSON for callback/shipping records the
same seven pre-existing namespaces; no SQL was executed during this reconciliation.
Historical approval is not fresh authorization for new database writes. Current
Phase A populated browser/provider acceptance also remains separate.

## Current status — original 80 skipped registrations

| Status | Registrations |
|---|---:|
| Passed | **80** |
| Ran but failed | **0** |
| No completed result | **0** |
| Total | **80** |
| Still need to pass | **0** |

These counts refer to the original skipped registrations in `.tmp-phase4-tests-final.txt`, not all nested tests or SQL statements. Enabling a parent registration can create many nested tests. A failed parent is not counted as passing merely because most children passed.

**Complete: all original 80 registrations have completed passing evidence.** The remaining suites ran sequentially with memory gates and read-only schema comparisons. All new fixture schemas were cleaned up; the same seven pre-existing schemas remain untouched. No public business writes, live migrations or real PayU/provider sends were performed by the SQL tests. The Next.js dev server remains stopped. Separate Phase 4 acceptance and Phase 5 are not completed by this result.

## Latest execution checkpoint

Updated 2026-11-02T14:17:59.507Z. Original registrations: **80 passed / 0 failed / 0 incomplete**.

Ordered completed evidence directories: `.tmp-approved-sql-Q1yE9n/results.json`, `.tmp-approved-sql-uXElvk/results.json`, `.tmp-approved-sql-ohazvI/results.json`, `.tmp-approved-sql-fQD7i9/results.json`, `.tmp-approved-sql-yjC715/results.json`, `.tmp-approved-sql-yC8061/results.json`, `.tmp-approved-sql-sJKtNG/results.json`, `.tmp-approved-sql-OzFZ42/results.json`, `.tmp-approved-sql-WvHjlU/results.json`, `.tmp-approved-sql-SzfUx4/results.json`, `.tmp-approved-sql-Sx3K7K/results.json`, `.tmp-approved-sql-dXUgYG/results.json`. The exact-name index is `.tmp-original-80-current-results.json`. Earlier failure narratives below are historical unless the current index still marks that registration failed. Passing file reruns supersede their older failure logs; they do not complete the separate Phase 4 acceptance suite.

## Results by file

All files below are under `tests/`. The three count columns refer only to the original 80 registrations.

| Test file | Passed | Failed | No completed result |
|---|---:|---:|---:|
| `phase2-documents-integration.test.mjs` | 1 | 0 | 0 |
| `phase3-metadata-integration.test.mjs` | 1 | 0 | 0 |
| `coupon-db-integration.test.mjs` | 17 | 0 | 0 |
| `coupon-order-integration.test.mjs` | 5 | 0 | 0 |
| `flash-sale-reconcile-integration.test.mjs` | 12 | 0 | 0 |
| `flash-sale-reservation-integration.test.mjs` | 8 | 0 | 0 |
| `inventory-controls.test.mjs` | 1 | 0 | 0 |
| `late-payment-stock-integration.test.mjs` | 3 | 0 | 0 |
| `maintenance-integration.test.mjs` | 1 | 0 | 0 |
| `notifications-enqueue-integration.test.mjs` | 2 | 0 | 0 |
| `notifications-outbox-integration.test.mjs` | 2 | 0 | 0 |
| `order-cancel-stock-integration.test.mjs` | 1 | 0 | 0 |
| `order-stock-integration.test.mjs` | 1 | 0 | 0 |
| `pos-entered-prices.test.mjs` | 4 | 0 | 0 |
| `reports-correctness-integration.test.mjs` | 2 | 0 | 0 |
| `sale-admin.test.mjs` | 2 | 0 | 0 |
| `sale-boundary-display.test.mjs` | 3 | 0 | 0 |
| `sale-price-entry.test.mjs` | 1 | 0 | 0 |
| `sale-pricing.test.mjs` | 1 | 0 | 0 |
| `staff-accounts-integration.test.mjs` | 1 | 0 | 0 |
| `stock-behaviour.test.mjs` | 1 | 0 | 0 |
| `payu-callback-integration.test.mjs` | 4 | 0 | 0 |
| `shipping-order-integration.test.mjs` | 6 | 0 | 0 |
| **Total** | **80** | **0** | **0** |

### Completed expanded suites

- Phase 2: **15 passed, 0 failed, 0 skipped**, including nested invoice/refund transaction tests and the pure manifest test. Evidence: `.tmp-phase2-approved-rerun.log`.
- Repaired Phase 3: **12 passed, 0 failed, 0 skipped**, including nested metadata/duplicate service tests and the pure manifest test. Evidence: `.tmp-phase3-fixed-retry.log`.
- Reports repaired rerun: **85 passed, 0 failed, 0 skipped**, `.tmp-approved-sql-yjC715/results.json`. The original independent 20-unit stock assertion is unchanged. Both original parent registrations pass.
- Other completed per-file expanded totals are saved in `.tmp-approved-sql-Q1yE9n/results.json`. Do not add overlapping/pure/nested counts and label the result “80 database tests.”

## Original nine failures — all now have passing rerun evidence

### `flash-sale-reconcile-integration.test.mjs` — five former failures now passed

1. `lazy expiry: a checkout frees a sold-out unit when the cron is down`
2. `lazy expiry: a hold that has not expired is never taken by another checkout`
3. `lazy expiry: the failure grace is released but the order stays FAILED`
4. `lazy expiry: an unresolved payment keeps PROCESSING and is queued for the worker`
5. `lazy expiry: two buyers racing a stale hold produce exactly one order`

Former errors included `cannot call jsonb_to_recordset on a non-array` and zero race winners. All five now pass after explicit JSON-array binding. Full file: **12 passed, 0 failed, 0 skipped**. Cleanup inspection matches the pre-run baseline: the same seven pre-existing schemas, no additional namespaces.

Passing evidence: `.tmp-approved-sql-uXElvk/flash-sale-reconcile-integration.log` and `results.json`. Cleanup evidence: `.tmp-db-resume-after-reconcile.json`. Historical failure evidence: `.tmp-approved-sql-Q1yE9n/flash-sale-reconcile-integration.log`.

### `flash-sale-reservation-integration.test.mjs` — former failure now passed

6. `one unit: a fresh checkout claims it, expiry releases it, and stock is re-checked`

Former non-array JSON error is resolved by explicit JSON-array binding. Completed rerun: **8 passed, 0 failed, 0 skipped**; `.tmp-approved-sql-ohazvI/results.json`. Cleanup `.tmp-db-resume-after-reservation.json` matches the seven-schema baseline.

Evidence: `.tmp-approved-sql-Q1yE9n/flash-sale-reservation-integration.log`.

### `inventory-controls.test.mjs` — former failure now passed

7. `tracking on without a stock row needs an opening count and records it`

Verified missing fixture audit-table dependency: after adding only the local audit relation, the original opening-count assertion and added audit snapshot assertions pass. Completed file: **3 passed, 0 failed, 0 skipped**, `.tmp-approved-sql-fQD7i9/results.json`. Cleanup `.tmp-db-resume-after-inventory.json` matches baseline.

Evidence: `.tmp-approved-sql-Q1yE9n/inventory-controls.log`.

### `reports-correctness-integration.test.mjs` — former failed parent now passed

8. `reports match independent calculations on a known dataset`

Former failed child: `stock report | on hand, reserved, available, value at cost and retail` (13 vs 20). Resolved using the user-selected product-balance contract, without changing the independent expectation. Completed rerun **85/85 passed**, `.tmp-approved-sql-yjC715/results.json`; cleanup `.tmp-db-resume-after-reports.json` matches baseline.

Evidence: `.tmp-approved-sql-Q1yE9n/reports-correctness-integration.log`.

### `sale-boundary-display.test.mjs` — former failure now passed

9. `a sale window that has not started yet is off on the first request`

Historical connection timeout was followed by a completed passing rerun (no sale-rule change): `.tmp-approved-sql-yC8061/results.json`. It now has passing evidence; the timeout was never counted as a pass.

Evidence: `.tmp-approved-sql-Q1yE9n/sale-boundary-display.log`.

## Original fourteen incomplete registrations — all now passed

All six files below now have completed passing results and per-file `cleanup.json` matching the baseline:

| File | Expanded passes | Evidence directory |
|---|---:|---|
| sale-price-entry | 15 | `.tmp-approved-sql-sJKtNG` |
| sale-pricing | 18 | `.tmp-approved-sql-OzFZ42` |
| staff-accounts-integration | 1 | `.tmp-approved-sql-WvHjlU` |
| stock-behaviour | 12 | `.tmp-approved-sql-SzfUx4` |
| payu-callback-integration | 4 | `.tmp-approved-sql-Sx3K7K` |
| shipping-order-integration | 6 | `.tmp-approved-sql-dXUgYG` |

Each directory contains `results.json` and the file's SQL log. Expanded totals are not original-registration totals.

### `sale-price-entry.test.mjs` — 1

- `a decimal sale price is stored exactly and history records the paise`

The historical batch was interrupted before a result. A fresh rerun now passes with cleanup verified: `.tmp-approved-sql-sJKtNG/results.json` and `cleanup.json`. No pre-existing interrupted schema was adopted or removed.

### `sale-pricing.test.mjs` — 1

- `sale price writes append marked history rows and require a lower price`

### `staff-accounts-integration.test.mjs` — 1

- `real staff removal frees email, revokes sessions and preserves immutable history`

### `stock-behaviour.test.mjs` — 1

- `click-time availability reads stock and the sale switch on one clock`

### `payu-callback-integration.test.mjs` — 4

- `concurrent duplicate callbacks pay once with one history and stock claim`
- `failure then late capture reclaims stock, stale failure cannot downgrade paid`
- `gateway id cannot pay two orders; signed mismatches cannot pay`
- `timeline migration enforces append-only rows and RLS`

### `shipping-order-integration.test.mjs` — 6

- `canonical ₹50/₹999 policy covers examples and threshold boundaries`
- `no-coupon shipping changes return TotalChangedError and roll back stock/order/history`
- `sale activation changes the authoritative subtotal and returns a complete 409 payload`
- `percent coupon discounts the sale-priced subtotal before shipping`
- `free-shipping coupon overrides the configured charge and preserves the order history snapshot`
- `successful orders retain immutable shipping even when current settings change`

## Repairs already made

- Shared fixture helper adds Phase 4 inventory/variant snapshot columns **only inside copied temporary tables**; it does not apply migration 0052 to the live schema.
- Phase 3's minimal fixture now includes the empty local `product_variants` relation required by metadata validation. Its repaired SQL suite passes, including final row/sequence counts.
- Reports, shipping and availability fixtures include empty local variant/device/type relations required by the current queries.
- Coupon, notification, staff, reports, shipping, availability and PayU fixtures use owned-schema cleanup, local serial rebinding and local RLS. Initial connections fail closed rather than falling back to public.
- Additional pure isolation regression checks cover additive fixture columns and hardened fixture clients.
- Existing business assertions were preserved. All nine original failures now have passing rerun evidence; all fourteen originally incomplete registrations also now have passing evidence.

## Current follow-up repairs — offline and targeted SQL verified

- `src/lib/payu/orders.ts`: all three reservation identity recordsets now bind ordinary arrays through `tx.json(...)`, avoiding pre-stringified JSON inputs. Reconcile SQL rerun passed 12/12 and reservation rerun passed 8/8, resolving all six flash-sale failures.
- `tests/inventory-controls.test.mjs`: added the missing fixture-local `store_admin_audit` table and assertions that the opening balance commits with its audit snapshot. Strict application auditing remains enabled.
- **User-selected reporting contract:** recorded product-level balances count even when tracking is off; retained legacy parents and untracked variants remain excluded from variant sellable totals. The original 20-unit independent assertion is preserved. Report rows, totals and stock CSV display were aligned, with mixed-bucket regression coverage added.
- `scripts/run-approved-legacy-tests.mjs`: explicit spec reporter, session-port validation, completion/error recording and stop-on-failure behavior. Reconciliation now requires completed log summaries and invalidates older passing evidence when a latest file attempt is incomplete. Pure parsing helpers live in `scripts/db-test-evidence.mjs`.
- New focused regressions: `tests/checkout-reservation-json.test.mjs` and `tests/db-test-evidence.test.mjs`; mixed report/CSV checks added to `tests/phase4-report-csv-documents.test.mjs`.
- Tracked application/fixture whitespace check passed (LF/CRLF notices only). After another request to continue, available RAM measured **945–1,152 MB**, below the approved approximately 1.5 GB start threshold; no Node processes survived.
- Bounded read-only preflight completed: **7 pre-existing temporary schemas** remain, with **6 other database sessions / 0 active** at inspection. Their names and object counts are recorded in `.tmp-db-resume-preflight.json`. No existing namespace was adopted or dropped; a shared database owner does not prove ownership by this run.
- Pure evidence reconciliation reproduced **57 passed / 9 failed / 14 incomplete**; evidence: `.tmp-db-resume-reconciled.json`. Its exit code 1 correctly indicates the original 80 are not complete.
- `node --check` passed sequentially for the runner, reconciler, evidence parser, read-only inspector and four touched/new test files. This checks JavaScript syntax only, not business behavior or TypeScript.
- On the next retry, RAM cleared the start threshold (**1,733 MB**, later **2,510 MB**). Focused offline checks passed: **30 passed / 0 failed / 0 skipped**, evidence `.tmp-db-resume-focused-retry.log`. The first attempt had one new CSV-test harness error (catalogue parser incorrectly used for stock CSV), corrected without changing business assertions; initial evidence `.tmp-db-resume-focused.log`.
- Typecheck passed with a bounded 1 GB heap: `.tmp-db-resume-typecheck-retry.log`. The first 384 MB heap attempt exhausted its deliberately restricted V8 heap (exit 134), not a completed typecheck: `.tmp-db-resume-typecheck.log`.
- Refreshed read-only schema baseline: `.tmp-db-resume-before-tests.json`.
- The permission layer initially denied the flash-sale reconcile launch. The user then explicitly authorized isolated SQL tests (creation, fixture writes and cleanup within newly owned `itest_*` / `fs_*` schemas only), and the first `flash-sale-reconcile-integration` rerun started sequentially. No bypass was attempted. Its completed passing result updates the original accounting to **62/4/14**. The same seven pre-existing schemas remained after cleanup.

## Additional current verification

- Final full offline regression: **1,079 tests, 998 passed, 0 failed, 81 expected skips**, `.tmp-db-resume-full-offline-final.log`. This includes the added evidence-order regression. This is not the original-80 SQL accounting.
- Current typecheck: passed, `.tmp-db-resume-final-typecheck.log`.
- Final evidence audit: all **80 unique original names passed**; latest completed results across 21 legacy files have **238 expanded passes / 0 failures / 0 skips**. Phase 2/3 evidence is reconciled separately; do not relabel 238 as the original denominator.
- Final cleanup: `.tmp-db-resume-final-cleanup.json` matches `.tmp-db-resume-before-tests.json`: **0 new leftovers**, seven pre-existing schemas left intact. All seven continuation files also have individual `cleanup.json` evidence.
- Whitespace: `git diff --check` passed (line-ending notices only).
- Store-admin guards: all **109** passed; account guards: **21 APIs / 11 pages** passed; admin boundary passed.
- Notification diagnostic: **3 passed / 5 failed**, all readiness/configuration checks (missing SMTP configuration, SMS disabled, no staff-email/customer-SMS cells enabled). No messages sent and no provider configuration changed. This diagnostic is not one of the original 80 tests.

## Other verification completed

| Check | Result | Evidence |
|---|---|---|
| Full offline regression after fixture repairs | **1,072 tests: 991 passed, 0 failed, 81 skipped** | `.tmp-fixture-repair-offline.log` |
| Pure isolation checks | **11 passed, 0 failed, 0 skipped** | `.tmp-isolation-repair-final.log` |
| Typecheck | Passed | `.tmp-fixture-repair-typecheck.log` |
| Production build | Passed; existing external-lockfile warning remains | `.tmp-fixture-repair-build.log` |
| Store-admin route guards | All **109** guarded | Console check completed |
| Account guards | **21** APIs and **11** pages passed | Console check completed |
| Admin commerce boundary | Passed | Console check completed |
| Dependency audit | **0 vulnerabilities** | `.tmp-fixture-repair-audit.json` |
| Whitespace check | Passed; LF/CRLF notices only | `.tmp-fixture-repair-whitespace.log` |
| Completed Phase 2/3 fixed-schema cleanup | Read-only check found **0** remaining schemas | `.tmp-fixed-phase-cleanup.json` |

The offline 81 skips are the original 80 plus the separate new Phase 4 stock integration suite. Offline skips are not passes and do not negate independently observed SQL results.

## Safety and future reruns

1. **No remaining original-80 tests need resumption.** All have completed passing evidence; do not restart batches unnecessarily.
2. Unknown/pre-existing fixture namespaces must not be adopted or dropped. The seven observed before these runs remain untouched; all namespaces created by the resumed runs were cleaned up.
3. Approved target was **`aws-0-ap-northeast-1.pooler.supabase.com`**, using the session connection. Authorization covered newly owned `itest_*` / `fs_*` fixture writes and cleanup only—not public business writes, deployment or live migrations.
4. For future requested reruns, reuse one-file sequential execution, memory/resource checks, local serial/RLS isolation and pre/post read-only schema checks. No real PayU/provider sends; never print credentials.
5. Reconcile original names through `scripts/summarize-original-db-tests.mjs`, supplying evidence oldest to newest. `scripts/checkpoint-db-tests.mjs` updates the status/index; `scripts/complete-remaining-db-tests.mjs` wraps allowlisted per-file runs with resource/cleanup gates. Unexpected failures or leftovers stop subsequent files.

## Evidence index

- Final full offline regression: `.tmp-db-resume-full-offline-final.log` (998 passed, 0 failed, 81 expected skips).
- Final typecheck: `.tmp-db-resume-final-typecheck.log` (passed).
- Evidence parser/order checks: `.tmp-db-resume-evidence-final.log` (3 passed).
- Final cleanup: `.tmp-db-resume-final-cleanup.json` (baseline unchanged).
- Completed continuation results and per-file cleanup: seven directories listed under “Original fourteen incomplete registrations”; sale-boundary `.tmp-approved-sql-yC8061` also passed.
- Completed repaired reconcile run: `.tmp-approved-sql-uXElvk/results.json` (12/12); cleanup `.tmp-db-resume-after-reconcile.json` matches baseline.
- Focused offline checks: `.tmp-db-resume-focused-retry.log` (30/30); typecheck `.tmp-db-resume-typecheck-retry.log` (passed).
- Latest read-only resumption preflight: `.tmp-db-resume-preflight.json` (seven pre-existing schemas left untouched).
- Reconciled historical evidence on resumption: `.tmp-db-resume-reconciled.json` (57/9/14 unchanged).
- Exact original-name outcomes (all 80): `.tmp-original-80-current-results.json`.
- Original registrations mapped to files: `.tmp-original-80-map.json`.
- Completed sequential per-file results: `.tmp-approved-sql-Q1yE9n/results.json`.
- Per-file SQL logs: `.tmp-approved-sql-Q1yE9n/*.log`.
- Phase 2 evidence: `.tmp-phase2-approved-rerun.log`.
- Repaired Phase 3 evidence: `.tmp-phase3-fixed-retry.log`.
- Broader implementation notes: `PHASES_NOTES.md` and `FEATURES.md`. Their earlier “SQL in progress” follow-up text predates the memory stop; this document records the latest status.

## Not included in the original 80

`tests/phase4-stock-integration.test.mjs` is a separately gated new suite. It has not run in this follow-up and must not be counted among the original 80. Phase 4 overall acceptance (including its separate SQL/browser checks) is not complete. **Phase 5 remains untouched.** No commit or push was made.
