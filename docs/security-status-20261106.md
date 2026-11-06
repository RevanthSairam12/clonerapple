# Gadzio security remediation — final status

**Date:** 2026-11-06
**Audit:** 2026-11-06 Gadzio security audit (H-1…H-3, M-1…M-3, L-1…L-9, I-1…I-7)
**Re-verification:** [security-reverify-20261106.md](security-reverify-20261106.md)
**Accepted risks:** [security-known-risks-20261106.md](security-known-risks-20261106.md)
**Remediation plan for the two open accepted risks:** [security-roadmap-20261106.md](security-roadmap-20261106.md)
**Flows that need external services:** [staging-runbook-20261106.md](staging-runbook-20261106.md)
**Production environment settings:** [production-env-20261106.md](production-env-20261106.md)
**Browser-level XSS check:** [browser-xss-manual-20261107.md](browser-xss-manual-20261107.md)
**Replay of 0063-0067:** [scripts/replay-check.md](../scripts/replay-check.md)

Status vocabulary:

- **fixed** — the code or migration change is in this branch and re-verified.
- **documented** — informational; no code change is warranted. The reason is recorded.
- **accepted risk** — knowingly not fixed; interim controls are recorded and a plan exists.

---

## Findings

| ID | Severity | Topic | Status | Evidence |
|----|----------|-------|--------|----------|
| H-1 | High | `order_sale_state` ran with owner rights and was publicly readable | fixed | `migrations/0063_order_sale_state_security_invoker.sql`; commit `d2dfaca`; probe returns 401 |
| H-2 | High | Stored message bodies rendered as HTML; template lists writable by admin | fixed | `src/components/account/MessageBody.ts:11-16`; `OWNER_ONLY_LIST_KINDS` in `src/lib/store-admin/setting-lists.ts:409-412`; commit `391a70a` |
| H-3 | High | SMTP password could be sent to an admin-selected host | fixed | `mailHostAllowed` in `src/lib/notifications/providers.ts:71-83`; owner-only `mail_*` in `settings-rules.ts:734-736`; commit `d52faf5` |
| M-1 | Medium | Customer contact details visible to viewers; reveal unaudited | fixed | `src/lib/store-admin/masking.ts:12-46`; reveal owner-only and audited at `customers/[id]/reveal/route.ts`; commit `5fb5f6f` |
| M-2 | Medium | `cost_paise` and internal columns readable with the publishable key | fixed | `migrations/0064_products_column_grants.sql`; commit `e92163f`; probe returns 401 |
| M-3 | Medium | SVG uploadable and legacy SVG rows served inline | fixed | `src/lib/store-admin/media-rules.ts:8-16`; `src/app/api/media/[id]/route.ts:47-66`; commit `1bab13b` |
| L-1 | Low | Migration ledger listed through PostgREST | fixed | `migrations/0065_schema_migrations_lockdown.sql`; commit `107c794`; probe returns 401 |
| L-2 | Low | Order result page exposed items, delivery and timeline to non-owners | fixed | `src/components/orders/OrderResultPage.tsx:89,109,142,163`; commit `60e84f2` |
| L-3 | Low | Sign-up confirmed whether an address was registered | fixed | `src/lib/user-auth.ts:187-219`; commit `5fa41f5` |
| L-4 | Low | Theme colour could break out of the `<style>` block | fixed | `src/lib/website/theme-rules.ts:22-30`; read seam `src/app/layout.tsx:28-30`; commit `8837c0d` |
| L-5 | Low | CSP allowed `unsafe-eval` in production | fixed | commit `ddff3c9` |
| L-6 | Low | `X-Forwarded-For` trusted unconditionally, so per-IP limits were spoofable | fixed | `src/lib/platform/client-ip.ts:14-28`; commit `9689368` |
| L-7 | Low | Order result page distinguished missing / unknown / not-yours | fixed | single `Unavailable()` card, `OrderResultPage.tsx:27-48`; commit `c96d89f` |
| L-8 | Low | Archiving media left the storage object readable | fixed | `src/lib/store-admin/media.ts:170-219`; commit `8e28f75` |
| L-9 | Low | Expense receipts live in the public `media` bucket | **accepted risk** | [known risks](security-known-risks-20261106.md#l-9--expense-receipts-live-in-the-public-media-bucket-accepted-for-now); plan in [roadmap](security-roadmap-20261106.md) |
| I-1 | Info | App connects as the table owner, which bypasses RLS | **accepted risk** | [known risks](security-known-risks-20261106.md); plan in [roadmap](security-roadmap-20261106.md) |
| I-2 | Info | Bulk empty-table statement could wipe an immutable ledger | fixed | `migrations/0066_immutable_ledger_statement_guards.sql`; commit `d891446` |
| I-3 | Info | CMS tables use `using (true)` policies by design | documented | [known risks](security-known-risks-20261106.md) |
| I-4 | Info | Some older tables enable RLS in a later file than the one that creates them | documented | [known risks](security-known-risks-20261106.md); applied migrations stay immutable |
| I-5 | Info | Oversized multipart upload buffered before being refused | fixed | `src/app/api/store-admin/media/route.ts:57-63`; commit `f2642a0` |
| I-6 | Info | Viewers can see staff and customer names in list pages | documented | [known risks](security-known-risks-20261106.md); email and phone stay masked |
| I-7 | Info | `check-store-admin-routes.mjs` proves the guard, not the role | documented | role is pinned by `tests/security-role-matrix.test.mjs` |

### Findings raised by the re-verification

| ID | Severity | Topic | Status | Evidence |
|----|----------|-------|--------|----------|
| N-1 | Low | Table-level INSERT/UPDATE/DELETE/empty-table/REFERENCES/TRIGGER still granted on `products` to `anon`/`authenticated` | fixed | `migrations/0067_products_revoke_table_dml.sql`; commit `77f6273` |
| N-2 | Low | `PUT /api/store-admin/settings` missing from the role matrix | fixed | `tests/security-role-matrix.test.mjs`; commit `5ae3276` |
| N-3 | Info | Legacy `/api/admin/media/[id]` serves legacy bytea rows with a stored MIME, no `Content-Disposition` | documented | inert under its CSP; legacy panel, no action proposed |
| N-4 | Info | Every signed-in staff role can read `mail_host` / `mail_username` | documented | open question for the next panel review; no credential is exposed |
| RM-1 | Low | Role matrix omitted the settings write (same gap as N-2) | fixed | commit `5ae3276` |

**Totals:** 20 fixed · 6 documented · 2 accepted risk.

---

## Migrations

All five are applied and recorded in `schema_migrations`; `node scripts/check-security-db-state.mjs`
re-checks the state read-only.

| File | Finding | What it does |
|------|---------|--------------|
| `0063_order_sale_state_security_invoker.sql` | H-1 | `security_invoker = true` on the view; revokes `anon`/`authenticated` |
| `0064_products_column_grants.sql` | M-2 | Replaces the table-wide `SELECT` with a 30-column grant; withholds `cost_paise`, `updated_by`, `catalog_revision` and the other internal columns |
| `0065_schema_migrations_lockdown.sql` | L-1 | Enables RLS on `schema_migrations` and revokes the API roles |
| `0066_immutable_ledger_statement_guards.sql` | I-2 | Statement-level BEFORE trigger on six ledgers so a bulk empty-table statement fails |
| `0067_products_revoke_table_dml.sql` | N-1 | Revokes table-level `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` on `products`; grants nothing back |

All five are idempotent and guard on `to_regclass` / `pg_roles`, so they replay cleanly on a local
Postgres that has neither the Supabase API roles nor every table. The replay procedure is in
[scripts/replay-check.md](../scripts/replay-check.md).

---

## Remaining open items

| # | Item | Kind | Where it is tracked |
|---|------|------|---------------------|
| 1 | L-9: expense receipts in the public bucket | accepted risk, planned | [roadmap](security-roadmap-20261106.md#l-9) |
| 2 | I-1: `DATABASE_URL` connects as the table owner | accepted risk, planned | [roadmap](security-roadmap-20261106.md#i-1) |
| 3 | Live staff-session role matrix (viewer / admin / owner against a running instance) | NOT TESTED — no staff credentials used. The harness exists and was exercised against a local fixture, not a real deployment | `scripts/staging-verify.mjs` |
| 4 | Live SMTP allow-list refusal and delivery | NOT TESTED — no SMTP credentials | [staging runbook](staging-runbook-20261106.md) |
| 5 | Browser-level XSS rendering of message bodies and theme colours | **tested in a real browser** (9/9 on 2026-11-07 via `scripts/browser-xss-check.mjs`); the end-to-end editor→database path is NOT TESTED — needs a running instance | [browser-xss-manual-20261107.md](browser-xss-manual-20261107.md) |
| 6 | PayU sandbox: return-token expiry, duplicate webhook, payload shape | NOT TESTED — no sandbox credentials | [staging runbook](staging-runbook-20261106.md) |
| 7 | Storefront smoke test after the `products` grant change | NOT TESTED — needs a running instance | [staging runbook](staging-runbook-20261106.md) |
| 8 | Two-parallel-checkouts inventory race | NOT TESTED — needs a running instance with a seeded last unit | [staging runbook](staging-runbook-20261106.md) |
| 9 | Restore-and-replay of 0063-0067 | NOT TESTED — would need a scratch database | [replay-check.md](../scripts/replay-check.md) |
| 10 | N-4: whether every staff role should read `mail_host` / `mail_username` | open question | this document |

Items 3-9 are environment-bound: each needs a running instance, a scratch database, or third-party
credentials that were not available while this work was done. None is a known defect.
