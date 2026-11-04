# Product options Phase 1 verification — 4 November 2026

The requested Phase 1 source repairs and documentation are complete. Existing shared-list imports, colour links and owner workflows were audited against PRODUCT_OPTIONS_FINAL_PLAN.md before editing. Work was performed in the main session, based on `0b1ae41`, and saved on the new `backup/phase1-shared-lists-20261104` branch. No database was contacted, and no migration, fixture SQL, reconciliation apply, provider probe or business-data write was performed.

The default suite passes **1,645 tests: 1,561 passed, zero failed, 84 skipped, zero cancelled**. PostgreSQL engine and authenticated application acceptance remain pending. The four original Phase 0 failures remain repaired under their original names; their explanations and repairs are retained in [the Phase 0 report](phase0-final-verification-20261104.md).

## Confirmed decisions

- Admins and owners may create models/colours inline on a product page. Owners alone rename, deactivate, reactivate and manage references; bulk paste and CSV import/export are owner-only. Device brand creation remains owner-only.
- Imports allow **2,000 data rows and 1 MB (1,000,000 UTF-8 bytes)**. CSV headers and blank paste lines do not count as data rows. BOM, headers and line endings count as bytes; JSON escaping has a separate transport bound.
- Price drops over 50%, rises over 100%, and prices below cost require confirmation, never a permanent block. This decision belongs to Phase 2; option pricing was not unlocked in Phase 1.

## Audit against Phase 1

The earlier shared-list commits already provided the substantial implementation. It was retained rather than rebuilt.

| Final-plan requirement | Earlier implementation | This continuation |
| --- | --- | --- |
| Owner-only management/bulk actions; admin inline create only | Guarded shared/metadata routes, independent store sessions, role-specific UI and narrow inline payloads existed. | Retained and verified role/draft behavior. No new price write path. |
| Owner add/rename/deactivate/reactivate/order and view product uses | Management and paginated uses existed, but the shared UI exposed uses during deactivation only. | Added direct GET-only paginated use review, close/retry behavior and draft preservation. |
| Paste preview with brand once or Brand, Model lines | Existing pure planner reports new/existing/near/invalid with row numbers; confirmation is separate. | Retained; raised the limit to 2,000 data rows. |
| UTF-8 CSV upload/preview | Existing strict decoder, BOM support, required headers, optional order/status and errors existed. | Accepts a full 1 MB file; header/blank/CRLF accounting is explicit. |
| Template/export/error report | Owner-only header-only template, list export and invalid/near CSV existed. | Retained; actual browser uploads and all three download workflows exercised. |
| Formula-cell protection on import and export | Formula-looking input cells are rejected; spreadsheet output cells are neutralized and quoted. | Retained existing protections and regressions; no unsafe cell evaluation. |
| Atomic apply, rate limit, same origin and one count-only audit | Transactional owner recheck, metadata gate, signed preview, strict audit and rollback seams existed. | One parameterized insert for up to 2,000 rows replaces per-row SQL round trips; forced insert/audit failures remain covered offline. SQL-engine proof is pending. |
| Re-import is a no-op | Existing rows and timestamps are untouched; a count-only batch no-op is audited. | Retained; replay/no-op and actual browser re-import verified. |
| Normalized duplicate prevention everywhere | NFKC/lowercase/punctuation normalization, same-brand model checks, inactive/exact duplicates and acknowledged near matches existed. | Indexes normalized saved names/hex once and keeps the five best distinct suggestions. Renaming an inactive model under an inactive brand now also checks near matches. |
| Explicit near-match confirmation | Inline/shared confirmation existed; an owner rename could retain stale suggestions after changing a field. | Field edits clear stale owner suggestions so confirmation approves only the latest unchanged name. |
| No seeded models or brands | Migrations contain no device seeds; legacy backfill no longer invents records; tests reject device seeding. | Retained. Browser props are synthetic and never persisted. No fixture database was created. |
| Colour name, uppercase six-digit hex, normalized-name/identical-hex duplicates | Colour validation, uniqueness and conflict reporting existed. | Colour UI now matches the server's 100-character bound; models remain 120. Six-digit uppercase hex rules retained. |
| Additive colour/link schema with RLS | Existing 0058 normalization and 0059 colour/link migrations enable RLS and preserve commerce identities/composite ownership. | No new migration and none applied. |
| Dry-run-first, idempotent legacy colour links | Existing reconciliation proposes normalized name/hex matches, reports conflicts and links without rewriting option/SKU/price/stock/history. | Retained; offline idempotence tests pass. No reconciliation command or Midnight NLU edit. |
| Deactivation keeps old options/orders/stock and warns with named uses | Existing publication guard, retained-identity rules and paginated confirmation existed. | Retained; direct uses added. Browser deactivation waits for explicit confirmation and lists named products. |
| Named swatches, accessible controls and preserved inline draft | Named hex swatches and draft/Enter/reload isolation existed; Phase 0 repaired the shared textarea label. | Editor fields now have exact labels/linked instructions. Scoped hint colour meets ≥4.5:1; measured minimum is 6.98:1. Stable textarea name/ID checks retained. |

## Limits and transaction details

`SHARED_IMPORT_MAX_ROWS` and `SHARED_IMPORT_MAX_BYTES` are shared by parsing, file decoding, UI messages and approval validation. The streamed JSON request is separately bounded to `6 * 1,000,000 + 65,536` bytes, allowing worst-case Unicode escaping plus the compact preview token and 2,000 row acknowledgements. Decoded import text still cannot exceed 1,000,000 UTF-8 bytes. The header and blank-line rules do not weaken byte counting.

Batch insertion remains inside the existing transaction, metadata lock, owner recheck and strict audit. Models/colours are inserted through postgres's parameterized records helper; nothing is interpolated as SQL text. Re-import issues no insert or update to existing reference rows. Source changes invalidate any earlier shared-list database fixture manifest; generate and approve a fresh one for a disposable target.

Preview signing and throttling remain process-local. Restarting or routing to another process requires a fresh preview. Multi-worker rollout needs appropriate signing/routing and throttle design; no measured production latency or SQL workload guarantee is claimed.

## Accepted static prices

These are the user's accepted values from the recorded Phase 0 database snapshot, not a fresh live query.

| Product ID | Recorded option names | Static before | Static now | Recorded database value |
| --- | --- | ---: | ---: | ---: |
| iphone18pro-max-clear-magsafe | Diamond Clear | ₹3,499 | **₹3,509** | ₹3,509 / 350,900 paise |
| cpc-gadzio-silicone-organizer | Black, Navy, Sand | ₹799 | **₹879** | ₹879 / 87,900 paise |

[Fallback regressions](../tests/storefront-catalog.test.mjs) verify both product-page values and search/bag references in paise/display form. Database prices and saved options were not edited. `iphone17-silicone-black` still has the recorded Midnight Black versus Midnight NLU option difference; the owner will fix that in admin. Its row was left alone. Live catalogue parity was not rerun or claimed to pass.

## Final verification

Tests/build ran with database connection strings and provider credentials explicitly empty and every database write opt-in set to zero. The build verified that Next's environment loading could not repopulate those values from `.env.local`.

| Check | Result | Local evidence |
| --- | --- | --- |
| Full npm test | **1,645 total / 1,561 passed / 0 failed / 84 skipped / 0 cancelled** | `tmp/phase1-verification-20261104/test-r4.json` and stdout log |
| Typecheck | Passed | `typecheck-r3.json` |
| Production build | Passed; 25/25 static pages | `build-r3.json`, stdout/stderr logs |
| Store-admin route guard | Passed; 122 routes | `store-admin-r1.json` |
| Account guard | Passed; 21 APIs / 11 pages | `account-r1.json` |
| Admin boundary | Passed | `boundary-r1.json` |
| Dependency audit | Zero vulnerabilities | `audit-r1.json` |
| Whitespace | Passed for worktree and staged diffs | `git diff --check` / `git diff --cached --check` |
| Component browser | Passed at **1440 / 768 / 390**; zero console errors and external requests; minimum instruction contrast **6.98:1** | `tmp/phase1-browser-20261104-r2/results.json` and screenshots |
| Offline notifications | 102 templates rendered; **1 passed / 4 failed**; no DB/settings read or provider probe/message | `notifications-r1.json`, fresh `tmp/phase1-notifications-20261104-r1/` previews |
| Settings tables / live parity / live legacy media | Not rerun: their application/database reads are outside this continuation's no-live-database constraint. | Phase 0 evidence is historical, not a new result. |
| PostgreSQL/authenticated acceptance | Pending; 84 skipped registrations are not passes. | [Skipped-test index](phase0-skipped-tests-20261104.md) and [runbook](../DISPOSABLE_DB_RUNBOOK.md) |

Except for the browser and notification directories named in the table, evidence paths are under `tmp/phase1-verification-20261104/`. Generated logs/downloads/screenshots remain local and ignored. The external `C:\Users\Abcom\package-lock.json` warning is unchanged; no external file was edited.

The browser drives real components and the admin stylesheet through synthetic props and mocked data/auth imports. It covers model paste, CSV upload/preview/confirm, template/export downloads, colour error report, repeat no-op, near acknowledgement, direct GET uses, deactivation, roles and product drafts. It is not authenticated Next persistence or SQL proof. Screenshots were inspected; computed foreground/background contrast is retained in the results.

The initial sandbox launches of the suite and build could not spawn Node workers (`spawn EPERM`). Approved escalation ran the same connection-disabled jobs successfully. The sandbox launch results (`test-r3`, `build-r2`) are retained and do not count as application test failures. Git's initial remote lookup also failed at the restricted proxy; an approved read-only rerun confirmed the new branch name was unused. Protected Git metadata writes used execution clearance. No action was denied and no restriction was bypassed. The owned loopback browser-fixture server was stopped after verification.

Offline notification failures mean database settings and real delivery readiness are unavailable in this deliberate offline mode. They do not replace the earlier saved-setting measurement of 3 passed / 5 failed. No readiness flags were overridden.

## Disposable database documentation and stop boundary

[DISPOSABLE_DB_RUNBOOK.md](../DISPOSABLE_DB_RUNBOOK.md) covers a local Docker instance, installed PostgreSQL on Windows and a separate hosted instance; the SQL for a non-superuser/NOBYPASSRLS role with CREATE ON DATABASE; plain-PostgreSQL prerequisites; all 57 migrations; secure session/TLS variables; exact-target checks; six manifests; the legacy/callback/shipping scopes; exact test commands for every skipped group; and cleanup limitations. All 15 PowerShell blocks parse successfully. The runbook was not executed.

The 84 skipped registrations group as **68 legacy + 4 callbacks + 6 shipping + 6 manifest-approved parent tests**. Every group needs a disposable session connection and its own write approval. Enabled parent tests register additional nested assertions, so the eventual total grows beyond those 84 registrations. Manifest generation alone is not approval.

Real PostgreSQL normalization/index/FK/trigger/RLS/rollback/revision/concurrency proof, authenticated owner/admin/viewer application acceptance and rollout remain pending. No live target was selected. Phase 1 source/documentation work stops after the backup; Phase 2 awaits the user's next instruction.
