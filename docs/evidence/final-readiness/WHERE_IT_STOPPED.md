# Final Readiness — Where It Stopped

**Date:** 2026-11-09 (Mon)
**Branch:** `traycer/radiant-raven` (tracking `origin/traycer/radiant-raven`)
**HEAD at stop:** see `git log -1` on this branch after this commit
**Context:** Continuation of final production-readiness work (5 tasks). Previous session completed Task 3 (`5427ad6 feat(notifications): add per-option checkout and POS stock alerts`). This session was focused on Task 1 (real authenticated browser E2E) and hit a blocking runtime issue.

## What was done (committed / present in this push)

- `next.config.ts`: added `serverExternalPackages: ['postgres']` to avoid dual-bundled `postgres` module state (suspected cause of pooled-connection stalls in the Next.js server during E2E).
- `package.json` / `package-lock.json`: added `playwright-core` devDependency (drives system Chrome; no bundled browser download).
- `scripts/e2e/seed-final-readiness.mjs`: idempotent tagged fixture seeder (tag `fr20261109` by default). Seeds store admin, customers A/B, test product/variants/stock. Password: `TestPassword123!`. Run with `node --env-file=.env.local scripts/e2e/seed-final-readiness.mjs`.
- `scripts/e2e/final-readiness-browser.mjs`: Playwright-core E2E runner (Task 1). Captures/aborts PayU gateway POST (no payment attempted). Writes screenshots/results to `docs/evidence/final-readiness/browser/`.
- `docs/evidence/final-readiness/browser/`: partial evidence from runs (`results.json`, `payu-gateway-post.json`, screenshots). **Latest `results.json` shows 9 passed / 12 failed** — the app became unresponsive/wedged during the run (timeouts on sign-in, cart/checkout, admin flows). An earlier run in the prior session had reached 15 passed / 6 failed before the stall investigation.
- `scripts/setup-e2e-data.mjs`, `scripts/test-conn.mjs`: untracked leftovers from earlier session (kept as-is; review before relying on them).

**Not committed (intentionally):** `scripts/e2e/_*.mjs` throwaway debug/probe scripts (`_probe-*`, `_db-*`, `_time-admin.mjs`, `_explore.mjs`, `_inspect-state.mjs`) created during stall investigation.

## Where it stopped (Task 1 — BLOCKED on runtime stability)

**Active problem:** The local Next.js app (production `npm run build` + `npm run start` on `localhost:3000`) intermittently **wedges/stalls** mid-E2E after certain navigations/aborted requests, causing widespread 45–90s timeouts. The last session investigated Supabase pooler/postgres bundling stalls; `serverExternalPackages: ['postgres']` was applied in `next.config.ts` but the full E2E had **not** been re-run to a clean pass after that fix + a fresh server restart.

**Known E2E script issues still to address (from carryover + observed failures):**
- Use `waitUntil: 'commit'` + `waitForLoadState('domcontentloaded')` patterns (partially applied as `gotoPage`) and stabilize waits around cart/checkout/admin navigations.
- Remove `?edit=1` param where inappropriate; keep `clickVisible()` for "Add to Bag"/"Pay Rs".
- Admin variant stock edit must go through product workflow inputs (`input[aria-label="Stock count for Midnight Black"]`, `input[aria-label="Warn below for Midnight Black"]`, "Save changes" → `/api/store-admin/catalog/products/draft`), not `VariantEditor`'s `In stock for <sku>`.
- Release leftover HELD reservation from earlier run order `GDZ001009` (customer A, variant `test_var_blk_fr20261109`) to avoid 409 `reservation_active` — prefer the app's own cancel path (`POST /api/store-admin/orders/{txnid}/cancel` as store admin); **do not hand-disable triggers**.
- Catalog snapshot caching (`unstable_cache`, 30s TTL, `revalidateCatalog` in `src/lib/storefront/catalog.ts`, `src/lib/catalog/storefront.ts`) can cause stale 404s after seeding.

**To resume Task 1:**
1. Ensure a fresh prod server is running: `npm run build && npm run start` (after the `serverExternalPackages` change). Confirm `http://localhost:3000` responds quickly.
2. Re-seed if needed: `node --env-file=.env.local scripts/e2e/seed-final-readiness.mjs`.
3. Fix remaining E2E script issues above; re-run `node --env-file=.env.local scripts/e2e/final-readiness-browser.mjs` until all steps pass.
4. Write `docs/evidence/final-readiness/browser/README.md` summarizing `results.json` and screenshots.

## Task status (overall)

| Task | Status | Notes |
|---|---|---|
| 1. Real authenticated browser E2E | **IN PROGRESS / BLOCKED on app stability** | Seed + runner exist; latest run 9/12 pass/fail due to app wedging; postgres externalization applied but not validated end-to-end. |
| 2. Public HTTPS PayU sandbox verification | **BLOCKED / likely PARTIAL** | No public HTTPS staging deployment (tunnel stale). PayU hosted-page interaction needs merchant sandbox card creds. Can do simulator + callback hash/duplicate/invalid-signature checks only; label exactly what was/was not a real PayU sandbox payment. |
| 3. Per-option checkout/POS low-stock notifications | **DONE** | `5427ad6`. |
| 4. 50/100 concurrent staging load test | **BLOCKED (staging)** | No Vercel `bom1` staging deployment. A localhost run may be reported only as local, never as staging. Inputs: `docs/load-test-runbook.md`, `scripts/perf/node-staging-checkout.mjs`. |
| 5. Controlled production payment smoke-test procedure | **BLOCKED — awaiting explicit authorization for a real production payment.** | Procedure doc still to be written (`docs/cutover-plan.md` for prod/topology facts). Must stop at BLOCKED unless authorized. |

## Constraints / hazards (do not forget)

- **Never modify/push to `main`**; push only to `origin/traycer/radiant-raven`. Never print secrets/keys/DB URLs/tokens/PII.
- Immutable tables (triggers raise on UPDATE/DELETE): `order_status_history`, `stock_movements`, `store_admin_audit`, `payment_events`, `order_edit_logs`, `bill_requests`, `price_history`. Cascaded order deletes/movement deletes impossible — cleanup must cancel/anonymise and **report retained rows by design**. Do not hand-disable triggers.
- Tagged fixtures: `fr20261109` (this effort) and earlier aborted-run leftovers `e2e_test_20261108` — both must be included in final cleanup. Cleanup must be tag-scoped, FK-safe, report before/after counts, and only delete after evidence is saved. Never delete pre-existing business data.
- Staging env: `PAYU_ENV=test`, `APP_BASE_URL` stale trycloudflare tunnel, fresh Mumbai (ap-south-1) Supabase DB (6543/5432). Run scripts with `node --env-file=.env.local <script>`. **Do not print `DATABASE_URL_PORT`** (contains full connection string with password).
- Orders table has no `payment_status`; use `orders.status`, `total_paise`, `reservation_state`. Items in `order_items`.
- Required final checks before done: `npm test`, `npm run typecheck`, `npm run build`, `npm run check:store-admin-routes`, `check:account-routes`, `check:admin-boundary`, `check:field-help`, `check:links`, `node scripts/check-security-db-state.mjs`, `node scripts/verify-rls-consumer-tables.mjs`, `npm audit`, `git diff --check`.

## Next moves (in order)

1. Stabilize Task 1: fresh server restart with `serverExternalPackages` fix, release/cancel `GDZ001009` reservation via app path, patch E2E waits/locators, rerun to full pass, write `browser/README.md`.
2. Task 2: attempt simulator + callback hash/duplicate/invalid-signature/amount-mismatch checks; record redacted evidence under `docs/evidence/final-readiness/payu/`; label PARTIAL/BLOCKED precisely.
3. Task 4: run load scenarios locally if needed but label **local-only** (never staging) or report BLOCKED; save under `docs/evidence/final-readiness/load-tests/`.
4. Task 5: write controlled production payment smoke-test procedure; report **BLOCKED — awaiting explicit authorization**.
5. Run all required verification checks; write/run `scripts/e2e/cleanup-final-readiness.mjs` (tag-scoped, FK-safe, reports retained immutable rows).
6. Commit per task, push to `origin/traycer/radiant-raven`, produce final report table + git log/status/branch/remotes.
