# Phase 5 — coupon visibility implementation and verification

Date: **2 November 2026**. Phase 5 only; Phase 6 not started.

## Current handoff

Implementation is complete in the working tree and approved isolated SQL tests
passed. **Live rollout and authenticated browser acceptance remain pending.**
Migration 0053 has not been applied to public/business tables. Existing unrelated
changes and older evidence below were preserved. No commit, push, live coupon
mutation, PayU call or notification send was performed.

- Added default-hidden public visibility plus separate discovery email/group
  assignments; existing redemption restrictions remain independent and combined
  AND. Defaults do not copy old restrictions into discovery grants.
- Admin forms/list/filter/export/bulk controls and help added. Create/update,
  duplication, generation and bulk visibility audit atomically and fail closed
  when audit fails; recipient addresses never enter audit snapshots.
- Customer selection/count share explicit discovery + eligibility and database
  clock checks, global enabled state and batched personal/global ledger counts.
  Safe DTOs retain only personal remaining uses/expiry/customer-facing details.
- Read-only census on `aws-0-ap-northeast-1.pooler.supabase.com` found **3 coupons**
  with none of the new columns. All three would default hidden on installation;
  no census writes were attempted.

## Exact verification evidence

| Verification | Result |
|---|---|
| Full offline suite | **1,103 tests, 1,021 passed, 0 failed, 82 skipped**, 0 cancelled; `.tmp-phase5-tests.txt` |
| Real Phase 5 SQL suite | **9 passed, 0 failed, 0 skipped**; `.tmp-phase5-sql-tests.txt` |
| Typecheck / production build | Both passed; `.tmp-phase5-typecheck.txt`, `.tmp-phase5-build.txt` |
| Route guards | 110 store-admin routes; 21 account API routes and 11 account pages passed |
| Commerce boundary / settings SELECT checker | Passed; Education Store untouched |
| Dependency audit | 0 vulnerabilities; `.tmp-phase5-audit.json` |
| Notification checker | User requested **skip for now**; blocked preview deletion was not retried, directory preserved |
| Legacy compatibility | Zero old admin references in settings; **failed** at media HTTP step because localhost:3000 was not running; `.tmp-phase5-legacy-compat.txt` |
| Browser acceptance | Not run; no browser dependency added and no live business data altered |
| Git | No new commit; dirty tree retained; `.tmp-phase5-git-status.txt` |

The focused coupon guard check initially failed because it required route-local
`writeAudit()` after audit was moved into service transactions. Updated the
assertion to check guarded service/audit delegation; the later full suite above
passed. The first inline SQL launcher refused before connecting due to target
parsing/manifest mismatch; the file-based runner matched the approved manifest
and the actual SQL run passed. Neither preliminary failure is SQL acceptance.

## Approved SQL scope and cleanup

The user explicitly approved test writes only on the host above inside newly
created `itest_phase5_coupon_visibility_approved`. The source-bound manifest is
`.tmp-phase5-run-manifest.json`.

- Committed inserts: users **2**, orders **2**, store_settings **1**, coupons **10**,
  coupon_redemptions **2**, store_admin_audit **6**.
- Committed coupon updates **5**; additional rolled-back coupon insert **1** and
  rolled-back coupon updates **3** for injected audit-failure paths.
- Local sequence advances: coupon_redemptions **2**, store_admin_audit **6**,
  coupon_targets **0**. Final row/sequence assertions passed.
- Built eight minimal local prerequisite tables, applied actual coupon migration
  0041 locally and actual visibility migration 0053 twice; RLS flags checked on
  all local tables. This is not a restricted-role RLS permission test.
- No public data reads/writes or public sequence advances by the fixture, no
  implicit app pool, no external effects; one connection. Existing schema would
  be refused. Cleanup removed only the schema created by this run and verified
  its absence.

## Decisions taken without an answer / remaining steps

No answer was needed for destructive or money-moving behavior: none introduced.
Conservative defaults: duplicates hidden and unassigned; legacy redemption
restrictions not copied into discovery assignments; guest/checkout email identity
policy unchanged. Existing assigned-by-restriction discovery is replaced by the
explicit opt-in model after migration.

Before live rollout: backup, refresh the census, approve/apply 0053 separately
without accidentally applying unrelated pending migrations, then explicitly
configure public/assigned coupons. Perform the two-customer manual checklist in
`FEATURES.md`. No new environment variables. Notification preview regeneration
and local-server compatibility retry remain deferred. Do not claim fully deployed
Phase 5 or a clean git tree. The file map and full release/manual notes are in
`FEATURES.md` under Phase 5.

---

# Phase 2 — implementation and verification handoff

Date: **2 November 2026**. Scope: receipts, refunds and invoices only.

## State of completion

Implementation is in the working tree. **Phase 2 acceptance remains incomplete**:
real PostgreSQL transaction/concurrency tests and authenticated manual flows have
not run. No production migrations, real order mutations, PayU calls or message
sends were performed for verification. Do not interpret mocked tests, a successful
build or skipped DB tests as real SQL acceptance evidence.

The final local regression run: **958 tests, 879 passed, 0 failed, 79 skipped,
0 cancelled**. Legacy DB harnesses now require `RUN_LEGACY_DB_TESTS=1` before
loading local environment configuration or constructing DB clients. They remain
disabled; some old fixture defaults may still refer to public sequences and must
be separately reviewed before enabling those tests.

## Confirmed decisions

- Before shipment use **Bill / Payment receipt — invoice follows on shipment**.
  Preserve the existing non-GST business wording, with no invented tax logic.
- Permanent invoices are assigned at shipment (`ON_THE_WAY`) or new POS direct
  delivery, not on GET. Payment-proof eligibility is a separate policy check.
- Preserve all unrelated dirty work. No commits, resets, branch changes or cleanup
  of pre-existing files. The working tree is deliberately **not clean**.
- Use the configured DB only inside an explicitly approved private throwaway
  schema. Target selection was not blanket approval to write.
- No historical invoice backfill or fabricated issue dates. Existing shipped/POS
  orders without saved issuance metadata are clearly labelled legacy documents.

## Decisions taken without an answer / conservative deferrals

The user approved an interim SQL fixture manifest. The final review corrected the
number of **additional rolled-back `refund_requests` inserts from 1 to 2**. No
expanded write approval was obtained. At continuation the user requested no further
questions, so database writes were deferred rather than expanding consent.
**No Phase 2 SQL fixture was created; no cleanup execution is claimed.**

The finalized preflight manifest (reasoned expectations, NOT observed DB results):

- Hostname: `aws-0-ap-northeast-1.pooler.supabase.com`.
- Only schema: `itest_phase2_documents_approved` (19 local tables).
- Public table writes: **0**; public sequence advances: **0**.
- Committed inserts, total **109**:

| Table | Rows |
|---|---:|
| users | 5 |
| store_admins | 1 |
| store_settings | 2 |
| orders | 21 |
| order_status_history | 1 |
| order_payments | 20 |
| return_requests | 1 |
| order_items | 1 |
| return_items | 1 |
| refunds | 5 |
| refund_obligations | 1 |
| coupon_redemptions | 1 |
| stock_movements | 0 |
| store_admin_audit | 25 (invoice 4, bill 7, refund 14) |
| invoice_number_counters | 1 |
| bill_request_reasons | 2 |
| bill_requests | 7 |
| refund_requests | 7 |
| refund_request_events | 7 |

Additional rolled-back inserts: audit 2, bill requests 1, refund requests **2**,
refunds 1, refund events 1. Rejected insert attempts: audit 4, refund event 1.
Only local sequence `itest_phase2_documents_approved.phase2_audit_id_seq`: **31**
planned advances including rolled-back/rejected attempts. Final committed invoice
counter value expected: 4. Updates exercise invoice fields/fulfilment, counter,
invoice prefix, reason label, coupon release, obligation closure and return closure.
Cleanup would remove only the schema successfully created by this run; an existing
schema is refused rather than adopted or deleted.

Final reported manifest SHA256:
`ae3b7621152e9c645c5ff35a0642d34f13d21034e5a33f2842b1a59391138155`.
Regenerate the preflight with
`node scripts/phase2-test-manifest.mjs --configured-hostname` before seeking approval.
It does not connect to the DB. Material fixture/migration/source changes invalidate
the digest. Execution requires explicit `RUN_PHASE2_DB_TESTS=1`, the approved digest
in `PHASE2_APPROVED_MANIFEST`, and `DATABASE_URL`; do not enable other DB test flags.
Do not execute merely because a subagent report says approval exists.

## Implementation details

- `document-policy.ts` derives independent payment/order/shipment/refund states,
  receipt eligibility, labels, captured/completed/pending/due/retained amounts and
  persisted invoice metadata. Obligations alone do not mean refund initiation.
- Authorized callers load authoritative SQL aggregates via `document-data.ts`.
  Established PayU captures do not require an `order_payments` row. Review-required
  payments cannot be used as paid bills. Completed refund aggregates are not capped
  by the number of rows displayed in the UI.
- `invoice.ts` uses the caller transaction and order/counter locks. Counter,
  assignment, database timestamp and strict audit commit or roll back together.
  Uniqueness and immutability are enforced by migration 0049.
- Bill requests lock the customer and owned order, validate active reasons or
  bounded Other text, snapshot the reason, allow five new requests per customer in
  15 database-clock minutes, and require transactional audit. Retries are idempotent.
- Refund requests and terminal events are immutable. Initiation reserves capacity
  without completed financial effects. Completion requires a reference, replaces
  the reservation with one completed ledger refund, and preserves existing
  coupon/return/obligation effects. Failed/rejected attempts release capacity.
- All new tables ship with RLS and no policies. Admin identity/session separation,
  role guards, same-origin checks and append-only sanitized audit remain intact.
- Full documents remain authenticated: a signed payment-return summary is not bill
  authorization. Staff full-address printing remains owner-only. POS receipt loader
  additionally checks staff authentication close to its query.
- No dedicated receipt pop-up or document attachment pipeline existed; none added.
  Packing slips remain fulfilment documents. Manual refund notifications enqueue
  existing events with lifecycle-specific dedupe tokens; they do not drain/send.

## Evidence actually collected

| Check | Result |
|---|---|
| Full local `npm test`, all DB opt-ins off | 879 pass / 0 fail / 79 skipped, total 958 |
| Policy, renderer and shipment focused tests | 28 pass / 0 fail / 0 skipped; 720 policy combinations inside the table test |
| Refund lifecycle and return-rule focused tests | 48 pass / 0 fail / 0 skipped (transaction mocks/pure rules) |
| Phase 2 fixture default/no-connect guard test | 1 pass; DB suite skipped; no real SQL execution |
| Typecheck | Pass |
| Production build | Pass; Next 16.4.3; warning about ignored outside-repo lockfile |
| Account route checker | Pass, 21 APIs and 11 pages |
| Store Admin route checker | Pass, 105 routes |
| Commerce/CMS boundary checker | Pass; Education Store exempt and unchanged |
| Settings checker (read only) | Fails: `bill_request_reasons` missing because 0049 is unapplied; existing settings readable, 114 notification cells |
| Legacy compatibility checker (read only + local HTTP) | 0 saved old references in each of 3 integration sources; 2/2 legacy media routes resolve, 0 shared rows available |
| Offline notification checker | 102 templates render; summary 1 pass / 4 readiness failures or unverified checks; no SMTP/DB connection, no send |
| Full `npm audit` | 0 vulnerabilities |
| Production-server unauthenticated smoke | Customer receipt and staff invoice: 307; customer bill POST and staff refund-resolution POST: 401; all 4 expected |

The final regression repaired stale renderer mocks and a stock-button assertion
that omitted the already-existing active-reservation gate. Checkout source behavior
was not changed for that assertion; disabled and aria-disabled still require the
stock, payment, coupon, submission and reservation gates.

Not verified: real SQL triggers/concurrency/rollback/cleanup; authenticated customer
and staff browser workflows; actual shipment/POS API end-to-end invoice issuance;
real provider delivery/SMTP; PayU round trip; any remote deployment. The real SQL
suite exercises transaction seams, not a claim of full API/browser coverage.

## Release / migration procedure (not executed)

1. Take a backup; review the actual migration ledger and all outstanding SQL.
2. Apply existing prerequisites in order, including 0047/0048 where outstanding,
   then **0049_order_documents.sql**, **0050_refund_lifecycle.sql**. No other task's
   migrations are implicitly approved here. The runner applies every pending file;
   never invoke it simply to test Phase 2.
3. New seed writes are one invoice counter row (`on conflict do nothing`), not a
   historical order migration. New request/reason/lifecycle tables start empty;
   Other is offered by code. Configure additional reasons through the guarded UI.
4. Do not expose the new pages/actions against an unmigrated database. Authoritative
   loaders depend on the new columns/tables. Re-run the read-only settings checker.
5. Obtain approval for the finalized test manifest and run the isolated SQL suite;
   verify actual row counts and cleanup, not just expected counts in this file.
6. Complete the authenticated manual checklist below on test orders in a safe test
   environment, then repeat build/boundary checks before release.
7. No new app secrets/environment variables are introduced. Keep existing database,
   authentication and PayU configuration secret. Test flags default off.
8. On a release issue, stop invoice/refund writes and use a reviewed forward fix.
   Do not delete issued references, reduce counters, delete refund/audit history,
   disable RLS, or revert to code that bypasses pending-refund reservations.

## Phase 2 manual acceptance checklist — pending

- [ ] Pending, verifying/review, failed and payment-cancelled orders: direct receipt,
      customer detail, staff invoice and POS/document surfaces show no paid bill.
- [ ] Paid unshipped active order: owner sees Request bill, submits an active reason
      or valid Other, then sees provisional wording; another customer is denied.
- [ ] Repeat request is idempotent; invalid/inactive reasons and blank/overlong Other
      are rejected. Six new requests in 15 minutes trigger the durable limit.
- [ ] Staff sees the stored reason snapshot; editing the reason later does not alter it.
- [ ] Mark an eligible order ON_THE_WAY: one permanent invoice appears with SQL issue
      time. Retry/concurrency and prefix edits never renumber it.
- [ ] A failed shipment transaction leaves no issued invoice/counter gap/audit leak.
- [ ] Cancel after issue: invoice identity/time remain and current stamp is Cancelled,
      not Paid. Captured history remains true; outstanding obligation alone is not
      shown as a refund transfer already initiated.
- [ ] Initiate partial/full manual refund: Refund Initiated, pending amount separate
      from completed totals; no premature coupon/return/obligation closure.
- [ ] Completion without a reference fails for every method. Completion with a
      reference shows Refund Successful (partial/full) and correct retained amount.
- [ ] Duplicate completion/concurrency does not duplicate refund/audit/financial
      side effects; initiated plus completed amounts cannot exceed capture/return cap.
- [ ] FAILED/REJECTED terminal events release reservation capacity; new request works.
- [ ] POS sale allocates permanent invoice distinct from receipt number; zero total
      says No payment required; void is not a paid receipt. Legacy POS has no invented
      permanent invoice number/date.
- [ ] Customer/staff print views agree; packing slip carries cancellation warnings;
      no address leakage in signed result summaries or to lower-privilege staff.

## Deferred Phase 1 findings — not fixed by Phase 2

Inspection identified remaining prerequisite risks. This is not a certification of
Phase 1 or a request to silently widen the current task:

- Raw PayU callback/verification responses are still persisted on existing paths.
- Reconcile/legacy reconcile scripts do not uniformly share every callback-policy
  check; `scripts/reconcile-orders.mjs` directly mutates payment on its legacy path.
- Some payment timestamps still use the application clock.
- Guest result access is weaker than the phase document's signed-link-only wording.
- Cancel processing can classify a gateway failure before user cancellation.

Phase 2 relies on the existing authoritative `PAID` settlement history; it does not
retroactively reverify historical captures. Review/fix and test these Phase 1 paths
before claiming complete payment-release readiness.

## Tax and next phases

Existing non-GST wording is retained. An accountant may require a credit note for
an issued invoice later cancelled/refunded, depending on applicable tax/accounting
rules; no credit-note feature or GST opinion is supplied here. Phases 3–6 (product
attributes/compatibility, variant stock, coupon visibility and release E2E) were not
started. Stop at this Phase 2 handoff.

## Git handoff

Branch: `newbranchadminall`. No commits created; latest commit remains
`db0b28a` (pre-existing). The tree contains extensive pre-existing tracked changes
and untracked files plus this implementation. Nothing was reset, staged or pushed.
Use actual `git status --short` rather than assuming a clean state or attributing the
whole branch diff to Phase 2.

## Phase 3 — interrupted implementation handoff (2 November 2026)

**Incomplete and unverified; do not deploy this partial implementation.**

Step 0 and the implementation plan were completed and the plan was approved.
Read-only database inspection observed 15 nondeleted products, 6 categories,
7 attribute definitions, 40 values, 6 products with 7 explicit model facets,
9 products without model facets, and 0 covering all category model options.
One category-facet mismatch heuristic: `test-item-xyz999`, `cases-protection`,
attribute `type`; exact wrong-type classification requires reviewed mappings.
The case PDP independently injects eight hard-coded iPhone options, and static
merge fallbacks restore models after an authoritative empty DB selection.

Implementation stopped when the admin UI agent received **HTTP 403,
`authentication_failed`, `insufficient balance`**, with the message
`Please run /login`. Other implementation agents were stopped immediately.
No retries, configured-database writes, migration application, historical
backfill, commits, or pushes were performed.

Partial work exists in `0051_product_types_compatibility.sql`,
`src/lib/catalog/product-metadata-rules.ts`,
`src/lib/store-admin/product-metadata.ts`, product creation validation/service,
new metadata admin components/routes, CSV modules/tests and storefront loaders/
merge modules. These edits are not a completed integration. Existing update and
attribute endpoints still need shared publication validation; duplicate support,
reviewed migration planner, SQL fixture/approval manifest, route-check updates,
full form/page wiring, PDP/filter/search completion and documentation remain to
be finished. Inspect actual diffs before continuing; agents were interrupted
mid-work and no final test reports were received.

No Phase 3 full test, typecheck, build, all-check-script or audit evidence was
collected. The working tree remains deliberately dirty. Previous Phase 2 evidence
above is not evidence for these new changes. Approved plan:
`C:/Users/Abcom/.claude/plans/temporal-pondering-kettle.md`.

## Phase 3 — resumed implementation and verification (2 November 2026)

This supersedes the interrupted implementation status immediately above.
**Implementation is integrated; Phase 3 is not fully accepted or deployed.**
Real SQL and browser round trips remain pending. The user requested continuation;
that was not treated as approval for database writes. No configured-database writes,
DDL application, backfill apply, commits or pushes occurred. Phases 4–6 were not started.

### Implemented

- Migration 0051: six new private RLS tables for category-linked types, ordered
  attribute sets, device brands/models, explicit product/device joins and old-value
  history; nullable product classification/review timestamp; PAV archival; composite
  category/type FK. Only the overly broad legacy PAV public-read policy is removed.
  No historical product assignments are performed by schema installation.
- Shared parser/rules/transactional service covers create, update/publication,
  attribute clear/restore, CSV and draft duplication. Required false/zero are valid;
  enum/type validity is checked again at publication. Advisory locking serializes
  metadata/reference mutations. Global attribute key/type changes are blocked for
  mapped definitions; active mappings block definition archival, and option removal
  shares the gate. New metadata mutations require a successful transactional audit.
- Owner-managed reference UI; category/type-scoped create/edit fields; manual grouped
  searchable device picker; no automatic selections; category/type-change warnings;
  out-of-scope values retained/read-only; explicit archival/restoration; independent
  compatibility and general metadata review filters. Inactive saved type may remain
  on a draft without attribute edits; it cannot satisfy publication.
- CSV includes explicit type/model/typed-value columns and omission/empty semantics.
  Duplicate copies retained metadata into a new draft, not inventory/order state.
  Gallery images and colour variants are not currently duplicated.
- Batched storefront projection, authoritative empty metadata, no hardcoded case
  model universe/default, projected category filters and shared search summary.
  Outage fallback suppresses managed metadata; missing schema is a deployment error.
  This code must not be deployed before authorized schema readiness.

### Actual verification

- Final full regression (after final compatibility filter adjustment): **1,024 tests,
  944 passed, 0 failed, 80 skipped, 0 cancelled**. No DB write opt-ins enabled.
- Focused metadata/rules/admin/backfill/sale-entry regression: **100 tests, 99 pass,
  0 fail, 1 legacy DB skip**. Additional authored SQL suite is default-off.
- Earlier full run had 916 pass, 2 fail, 79 skip. The failures were sale-price CSV
  fixture rows supplying included metadata columns as ambiguous blanks. Fixtures
  now explicitly supply `null`, `[]`, `{}`; production blank rejection is unchanged.
- Typecheck and production build pass. Final build retains the informational
  outside-repository lockfile warning; no root config change was made for it.
- Every check script run in safe mode: Store Admin **108 guarded routes**; customer
  **21 APIs + 11 pages**; CMS boundary pass; settings all readable with **114**
  notification cells; saved legacy reference counts **0**, media resolution **2/2**.
  Settings readiness is now newer than Phase 2's missing-0049 observation; this
  session did not apply 0049 or attribute its appearance to this work.
- Offline notifications: **1 pass, 4 fail** (102 templates render; offline DB and
  provider readiness not verified). No mail/SMS send or SMTP login performed.
- `npm audit`: **0 vulnerabilities**. `git diff --check`: no whitespace errors,
  only line-ending notices. No installed Playwright found; no dependency added.
- SQL acceptance remains **not run**, not passed: private fixture preconnection
  guard passes and the real suite is skipped. Actual create/edit/reload/CSV/browser
  persistence and concurrency are not certified by pure/render/mock tests.

### Read-only historical migration report

Host: `aws-0-ap-northeast-1.pooler.supabase.com` (session port 5432).
Two read-only snapshots produced digest
`ade18124dd59b65d9f669f62096c57fc07b896512a1dc08731d81ed8956cb24e`.
0051 is absent: **49 missing schema items**, no existing new-table RLS-disabled
entries, **0 conflicts**. This pre-schema report cannot authorize apply.

| Table | Proposed inserts | Proposed updates |
|---|---:|---:|
| product_types | 7 | 0 |
| product_type_attributes | 18 | 0 |
| device_brands | 1 | 0 |
| device_models | 7 | 0 |
| product_device_models | 7 | 0 |
| products | 0 | 12 |
| store_admin_audit | 1 | 0 |
| product_attribute_values / product_attribute_history | 0 | 0 |

Exact compatibility: `iphone18pro-max-clear-magsafe` → iPhone 18 Pro Max and iPhone
18 Pro; `iphone17-silicone-black` → iPhone 17; `mc-gadzio-silicone-17promax` → iPhone
17 Pro Max; `mc-gadzio-clear-17pro` → iPhone 17 Pro; `ac-gadzio-silicone-pro3` →
AirPods Pro 3; `ac-gadzio-silicone-pro2` → AirPods Pro 2. Thus seven distinct models
and seven joins across six products, all Apple. Broad phrases are not expanded.
Unknown type review: `test-2026`, `test-item-xyz999`, `test-product`; the second has
unrecognized explicit model evidence. Exactly **10** unrelated PAVs are preserved:
six known products' model values and test-item-xyz999 brand/material/model/type.
No raw values or personal details are printed. Existing deliberate empty review
and manual joins remain authoritative. Repeat-plan simulation is idempotent.

### Private SQL approval manifest — NOT EXECUTED

Generate without connecting:
`node scripts/phase3-test-manifest.mjs --configured-hostname`.
Current bound source digest:
`ac795b3cc93f950cd7495d525444a635e07eca097773a757b0eeb5f0b1d30c28`.
Any bound source modification invalidates it; regenerate before approval.
Same hostname as above. New schema: `itest_phase3_metadata_approved`, max **1**
connection, schema-only search_path, refuse an existing schema. Actual migration
0051 is applied only inside this throwaway fixture. Cleanup removes only the schema
created by that test run. Public business-data reads/writes/sequence advances: **0**.

| Table | Committed inserted rows | Rolled-back inserted rows | Rejected INSERT attempts |
|---|---:|---:|---:|
| users | 0 | 0 | 0 |
| store_admins | 1 | 0 | 0 |
| categories | 2 | 0 | 0 |
| attributes | 6 | 0 | 0 |
| attribute_options | 2 | 0 | 0 |
| products | 3 | 1 | 0 |
| product_attribute_values | 8 | 4 | 2 |
| store_admin_audit | 7 | 3 | 1 |
| price_history | 1 | 1 | 0 |
| stock_levels / stock_movements / stock_reservations (each) | 0 | 0 | 0 |
| product_types | 3 | 0 | 4 |
| product_type_attributes | 5 | 0 | 1 |
| device_brands | 2 | 0 | 0 |
| device_models | 3 | 0 | 1 |
| product_device_models | 2 | 1 | 2 |
| product_attribute_history | 3 | 3 | 0 |

Local sequence advances: audit **11** (7 committed + 3 rolled back + 1 rejected),
history **6** (3 + 3), price history **2** (1 + 1). Declared updates include PAV
archive/restore, classification, publication and compatibility review timestamps.
Expected counts are authored assertions, **not observed SQL results**. SQL coverage
uses service transaction seams and duplicate; owner/global-pool wrappers, real CSV
persistence and races remain excluded. Role/origin are tested separately with mocks.

### Decisions taken without another answer / remaining release gates

Conservative default: do not write to the configured DB, install schema, apply
historical changes, enable legacy DB suites, add browser dependencies or commit.
Separate explicit approval is still required after reviewing the current host and
manifest counts for SQL tests. Schema installation and fresh post-schema historical
backfill are two further approvals, not implied by test approval.

`FEATURES.md` contains the file map, rollout/forward-fix order and manual checklist.
Do not run the blanket migration runner as a test or claim a clean tree. Latest
commit remains pre-existing `db0b28a`; recent log also includes `24c2f47`, `fa9cde3`,
`7abe143`, `65cdb2b`. The status snapshot contains **151 tracked modified paths**
and **87 untracked paths**, including pre-existing work and local evidence files;
these are not all Phase 3 changes. Nothing was reset, staged or pushed.

## Database-test permission and real SQL follow-up — 2 November 2026

User explicitly authorized: “run im giving full permission to run database tests”.
This supersedes the test-approval deferral above, not live deployment/backfill gates.
Target hostname: `aws-0-ap-northeast-1.pooler.supabase.com`. Phase 2/3 manifest
digests/counts were regenerated before execution and matched the documented plans.

Actual completed runs:
- Phase 3: **12 pass, 0 fail, 0 skip** (10 nested real SQL checks, parent and pure
  guard test). Actual 0051 installed only inside `itest_phase3_metadata_approved`;
  all row/sequence counts matched, strict audit/caller rollback and draft duplicate
  passed. Runtime about 523 seconds. Intentional audit failure prints a sanitized
  warning; the corresponding rollback assertion passes.
- Phase 2: **15 pass, 0 fail, 0 skip**. Real invoice/bill/refund service SQL,
  independent-session races, rollback and final count checks passed. About 147 seconds.
- Read-only cleanup verification: both approved fixed fixture schemas absent (**0**).
- Safe legacy allowlist (coupon DB, notification enqueue/outbox, reports, staff,
  stock behavior): **120 pass, 0 fail, 0 skip**; includes non-DB tests in these files.
- Payment callback and shipping/order SQL batch: **10 pass, 0 fail, 0 skip**;
  gateway verifier/delivery remain mocked, no PayU/provider calls.
- Sale boundary after adding actual 0051 to its local fixture: **10 pass, 0 fail,
  0 skip**, including three formerly gated database cases.
These are separate overlapping batches, not a new unique full-suite total.

Isolation review identified an additional legacy fixture batch with **40 gated
registrations** (corrected from the initial estimate of 39). Copied serial defaults
through `LIKE ... INCLUDING ALL` can still reference public sequences; schema-only
search_path does not redirect a stored sequence reference. These were not run in
that unsafe state. Test-only fixture hardening now rebinds copied defaults to local
owned sequences before inserts, protects cleanup ownership, pins implicit service
DB access to the fixture, and starts connections with fail-closed `pg_catalog`
search_path. New fixture tables enable RLS locally. Retired waitlist contracts,
reconcile payment-event and POS invoice prerequisites are provided locally rather
than depending on deployment state. Sale-boundary now uses the same owned-schema
lifecycle. Payment/shipping teardown also gained ownership guards. No business
schema change.

**Execution blocker after compaction:** the attempted remaining SQL batch was denied
by the execution permission guard before it ran. The guard requires fresh explicit
approval naming `aws-0-ap-northeast-1.pooler.supabase.com` and the isolated temporary
schema writes; it did not accept approval recorded only in compacted context. No
retry through alternate tools or agents was made. Therefore the 40-test remaining
batch, the hardened sale-boundary SQL rerun, and the consolidated all-opt-in suite
are **not executed**, not passing. Earlier completed SQL results above remain valid
for their executed revisions. Final database-disabled regression evidence follows
below. No live migrations or historical backfill were authorized or applied.

Final checks after fixture hardening:
- Entire suite with all five DB opt-ins disabled and `DATABASE_URL` explicitly
  empty: **1,034 tests, 954 passed, 0 failed, 80 skipped, 0 cancelled**. Runtime
  about 102 seconds. The opt-in registration skips here do not undo the separately
  completed SQL results; this is not an all-enabled SQL run.
- Dedicated final pure isolation suite: **10 passed, 0 failed, 0 skipped**,
  including sale-boundary lifecycle source coverage; no DB connection.
- `npm run typecheck`: passed. Changed fixture syntax checks and
  `git diff --check`: passed (normal LF/CRLF notices only).
- Evidence: `.tmp-db-followup-offline-full.log`,
  `.tmp-db-isolation-pure-final.log`, `.tmp-db-followup-typecheck.log`,
  `.tmp-db-followup-whitespace.log`, and earlier SQL batch logs.
- Latest commit remains `db0b28a`; dirty status snapshot: **151 tracked modified
  paths, 91 untracked paths**, including preexisting work and evidence. No staging,
  reset, commit or push. Browser acceptance and live 0051/backfill remain pending.

## Original 80 skipped registrations — current-source rerun, 2 November 2026

This follow-up supersedes historical test evidence only for the revisions actually
executed here; it does not declare Phase 4 complete or authorize Phase 5.

- Original reference: `.tmp-phase4-tests-final.txt` (80 skipped registrations).
  Nested suites expand when enabled; registration totals are not SQL row counts.
- Explicit user approval covers Phase 3's revised fixture manifest and the dynamic
  remaining-test scope on `aws-0-ap-northeast-1.pooler.supabase.com`: owned temporary
  `itest_*`/`fs_*` schemas, their synthetic rows/local sequences/DDL and owned cleanup.
  No public business-table writes, live migration/allocation, PayU call or real
  notification send is included.
- Fixed fixture drift without changing business tables: copied products, variants
  and order lines receive additive Phase 4 columns locally; metadata joins use
  empty local dependency tables. Phase 3's minimal fixture adds an empty local
  `product_variants` contract. These fixture shims are not actual-0052 constraint
  or RLS-role authorization proof.
- Hardened coupon, reports, notification, staff, availability, shipping and PayU
  fixtures delegate to owned schema cleanup and local serial rebinding/RLS; clients
  start fail-closed. All original business assertions remain in place.
- Phase 2: **15 passed, 0 failed, 0 skipped**, evidence
  `.tmp-phase2-approved-rerun.log`.
- Repaired Phase 3: **12 passed, 0 failed, 0 skipped**, evidence
  `.tmp-phase3-fixed-retry.log`; final row/sequence counts match the manifest.
  Earlier failed attempts are superseded, not silently reported as passes.
- Full offline regression: **1,072 tests; 991 passed, 0 failed, 81 skipped**,
  `.tmp-fixture-repair-offline.log`. The 81st skip is the new separate Phase 4 suite,
  which is not part of the original 80 and was not enabled for this follow-up.
- Pure fixture isolation: **11 passed, 0 failed, 0 skipped**. Typecheck, production
  build, all 109 store-admin route guards, 21 account API/11 page guards and the
  admin commerce boundary passed. Build retains the existing ignored external
  lockfile warning.
- Fresh read-only verification found **0** remaining Phase 2/3 fixed fixture
  schemas (`.tmp-fixed-phase-cleanup.json`). Dependency audit: **0 vulnerabilities**
  (`.tmp-fixture-repair-audit.json`).
- Remaining SQL run is in progress; no overall all-80 success is claimed yet.
  `scripts/summarize-original-db-tests.mjs` reconciles each original skipped name
  against completed evidence rather than adding overlapping batch totals.
