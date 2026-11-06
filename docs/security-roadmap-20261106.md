# Security roadmap — plan for the two accepted risks

**Status: plan only. Nothing in this document has been implemented.** No migration, route or grant was
added for either item.

Both entries are accepted risks recorded in
[security-known-risks-20261106.md](security-known-risks-20261106.md). This page is the concrete path off
them: the steps, the migration each needs, the rollback, how to test it, and the risk of doing it.

Read with [security-status-20261106.md](security-status-20261106.md) for the current state and
[scripts/replay-check.md](../scripts/replay-check.md) for how a new migration is rehearsed.

---

## L-9 — expense receipts in the public `media` bucket

### What is true today

- The `media` Storage bucket is **public**: any object path is fetchable without a session. The app
  serves it directly by redirecting to the CDN (`src/app/api/media/[id]/route.ts:67`).
- Expense receipts are stored there like product photographs. `expenses.attachment_media_id` points at
  a `store_media` row; the detail query joins `store_media m … m.deleted_at is null` and returns
  `m.url` as `attachmentUrl` (`src/lib/store-admin/expenses.ts:100-127, 147, 197`).
- The URL is random enough in practice but not authenticated. Anyone who learns it — a shared screen, a
  referrer header, a forwarded link, a browser cache — can fetch the receipt.
- Interims that hold today: the URL is only rendered in the staff-only expense pages; the bucket cannot
  be *listed* with the publishable key; archiving the media row deletes the object (L-8).

### Target design

Split the two kinds of media. Product photos stay in the public `media` bucket. Expense receipts move
to a **private** bucket read through an authenticated, audited proxy route, exactly like
`/api/media/[id]` already does for the object fetch — but the file never has a public URL.

```
browser ──▶ GET /api/store-admin/expenses/[id]/receipt
              │  requireStoreRole('store_admin')      (audit read)
              │  POST /storage/v1/object/sign/expense-receipts/<path>   (service role, 60 s)
              └─▶ 302 to the short-lived signed URL
```

### Steps

**1. Add the bucket and the column (migration 0068, additive).**

- Create the private bucket `expense-receipts` (`public: false`) with the service role, or by hand in
  the Storage panel if the project prefers that. Record which was done.
- `alter table store_media add column if not exists bucket text not null default 'media'` — existing
  rows keep pointing at the public bucket until they are moved.
- A check constraint `bucket in ('media','expense-receipts')`.
- No RLS change is needed on `store_media` (it is already enabled); the bucket is what moves.
- **Do not** revoke anything on `store_media` in this migration; the read path still uses it.

**2. Route new receipt uploads to the new bucket.**

- `uploadToStorage()` in `src/lib/platform/storage.ts` currently hardcodes `BUCKET = 'media'`. Add a
  `bucket` parameter defaulting to `media`; the expense attachment path passes `expense-receipts`.
- Store the object path in `store_media.storage_path` and set `store_media.bucket`. Leave `store_media.url`
  **empty** for private objects — a column that looks like a public URL is how this bug comes back.
- Constrain what may be uploaded to a receipt: PDF plus the existing image types, size limit unchanged.
  `store_media.mime_type` has a check constraint that does not include PDF today; the migration must
  extend it or receipts must be images only. **Decide before writing the migration.**

**3. Add the read route.**

- `GET /api/store-admin/expenses/[id]/receipt` — `requireStoreRole('store_admin')`, rate limited per
  actor, writes a `store_admin_audit` row (`expense.receipt.view`, `entityId` = expense id, **never**
  the path or filename), then returns a 302 to a signed URL minted with a 60-second expiry.
- Signed URLs come from the Storage API (`POST /storage/v1/object/sign/<bucket>/<path>`,
  `{ expiresIn: 60 }`) using `SUPABASE_SERVICE_ROLE_KEY`. The key never leaves the server.
- Never cache the redirect (`Cache-Control: no-store`); a cached signed URL outlives the session.
- The expense detail page links to this route instead of rendering `attachmentUrl`.

**4. Move the existing receipts (one-off script, not a migration).**

- `scripts/migrate-receipts-to-private.mjs` (dry-run by default, `--apply` to execute):
  1. select the `store_media` rows referenced by a live `expenses.attachment_media_id`;
  2. copy each object from `media` to `expense-receipts` (Storage copy API, or download → upload);
  3. verify the copy exists and its size matches;
  4. update `store_media.bucket` and keep `storage_path`, clear `url`;
  5. **only after** step 4 is verified, delete the original from the public bucket.
- Write a JSON manifest of every id and outcome to a path outside the repo. Never log a receipt
  filename or URL.

**5. Close the loop.**

- Extend `scripts/check-security-db-state.mjs` (or a sibling) with: no `store_media` row with
  `bucket='media'` referenced by a live expense; the private bucket is not public.
- Add a negative test: an anonymous `GET` of a receipt object URL returns 400/403.

### Rollback

| Point | How |
|-------|-----|
| After step 1 | Drop the column default; the bucket is unused. Nothing is lost. |
| After step 2, before step 4 | Point the expense upload path back at `media` (one constant). New receipts are public again, which is the status quo. |
| After step 4 | Step 5 of the move deletes originals **last** on purpose. If a receipt is missing, it is still in the private bucket and in the manifest; re-copy it back and restore `bucket`/`url` from the manifest. Do not delete the manifest until a week of clean use. |

There is no destructive migration in this plan.

### Testing

- Unit: the route refuses viewer/admin-less sessions (403), writes an audit row, and sets
  `Cache-Control: no-store`; the signer is called with the private bucket.
- Integration (scratch schema, per the existing fixture pattern): upload → row has `bucket =
  'expense-receipts'` and an empty `url` → the route returns 302 → the signed URL fetches the object →
  the same object path fetched anonymously returns 403.
- Replay: migration 0068 applies twice cleanly (`scripts/replay-check.md`).
- Manual: after the move, open one old receipt as an admin and confirm it renders; fetch the old public
  URL and confirm it now 404s.

### Risk of doing it

**Medium.** The failure mode is a lost or briefly exposed receipt. The ordering above (copy → verify →
repoint → delete later) makes a lost receipt recoverable, but the delete step is irreversible and must
be run with the manifest in hand. The route and the audit row are routine. The migration itself is one
column and one bucket.

### Estimated effort

| Step | Size |
|------|------|
| 1. migration 0068 + bucket | small (one file, one panel action) |
| 2. upload path | small (one parameter, one call site) |
| 3. read route + audit + test | medium (a new route, a role check, a rate limit) |
| 4. move script + dry run + apply | medium (the only risky step) |
| 5. checks and negative test | small |

---

## I-1 — the app connects as the table owner and bypasses RLS

### What is true today (measured, read-only, 2026-11-07)

| Fact | Value |
|------|-------|
| Relations in `public` | 97 |
| Tables with RLS enabled | 96 (one relation is a view: `order_sale_state`) |
| Tables with `FORCE ROW LEVEL SECURITY` | **0** |
| Policies | 13, all `SELECT` for `anon`/`authenticated`, on catalogue and CMS tables only |
| `SECURITY DEFINER` functions | 0 |
| Functions owned by `postgres` | 30 (triggers and helpers) |
| Sequences | 19 |
| The connection's role | a non-superuser that **owns** the tables |

The app connects with `DATABASE_URL` as the table owner. PostgreSQL does not apply RLS to a table's
owner unless `FORCE ROW LEVEL SECURITY` is set, so today every query in `src/` sees every row. RLS
protects only the Supabase API roles. Every app query must scope by user or role itself — and that is
accepted because the app is the only tenant of that connection.

The goal is the opposite arrangement: the app connects as a **non-owner** role that is subject to RLS,
so a forgotten `where user_id = …` fails closed instead of leaking every customer's rows.

### Why this is not a one-line change

Turning on `FORCE ROW LEVEL SECURITY` over the owner connection would lock the app out of almost every
table on the first request: 96 tables have RLS and only 13 policies, all of them for the API roles. The
change is therefore: create a runtime role, grant it exactly what it needs, and give each table a policy
that expresses how the app already scopes its queries. That is a schema-wide piece of work, not a
hardening tweak — which is why it is staged.

### Target design

- A new role `gadzio_runtime`: `LOGIN`, `NOBYPASSRLS`, **not** the owner of anything, no `CREATE` on
  `public`.
- `FORCE ROW LEVEL SECURITY` on every RLS table.
- Policies that read the request's identity from transaction-local settings the app sets at the top of
  every request or job:

  ```sql
  -- set once per transaction, from the resolved session, never from user input
  select set_config('app.user_id', $1, true);
  select set_config('app.staff_id', $2, true);
  select set_config('app.staff_role', $3, true);
  ```

  ```sql
  create policy "own orders" on public.orders
    for select using (user_id = nullif(current_setting('app.user_id', true), '')::text);
  ```

- The storefront/catalogue tables keep their public `SELECT` policies; the runtime role gets `SELECT`
  on the same columns the API roles do.
- Tables written only by a trusted server path (the ledgers, counters, audit) get policies keyed on
  `app.staff_role`, or an `INSERT`-only policy plus the existing immutability triggers.

### Steps, in order — each one shippable and reversible

**Stage 0 — inventory (done for this plan).** The table above is the baseline. Re-run the same queries
before every stage; 97/96/0/13/30/19 are the numbers to compare against.

**Stage 1 — identity plumbing (no behaviour change).**

- Add `withRequestIdentity()` (or equivalent) in `src/lib/platform/db.ts`: a helper that runs a unit of
  work in a transaction after setting the three `app.*` settings from the already-resolved session.
- Adopt it in ONE low-risk read path (the account order list) and verify output is byte-identical.
- Nothing about roles or policies changes yet.

**Stage 2 — policies on the customer-facing tables (migration 0068).**

- Policies for `users`, `user_sessions`, `orders`, `order_items`, `order_addresses`,
  `customer_addresses`, `user_login_events`, `notifications` scoped on `app.user_id`.
- Policies for the store-admin tables scoped on `app.staff_role` (viewer ⊂ admin ⊂ owner, mirroring
  `roleSatisfies()` in `src/lib/auth`).
- Policies for the ledgers: `INSERT` allowed for the runtime role, `UPDATE`/`DELETE` still refused by
  the existing triggers.
- **Policies are additive here** — the owner connection is not subject to them yet, so this stage
  changes nothing at runtime. It is safe to apply and roll back (drop policy).

**Stage 3 — the role and its grants (migration 0069).**

- `create role gadzio_runtime nologin` is wrong — it must log in. Create it with `LOGIN PASSWORD`,
  `NOBYPASSRLS`, no ownership, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`.
- `grant usage on schema public`; `grant select, insert, update, delete` on the tables the app writes;
  `grant select` on the catalogue tables with the **same 30-column list** as 0064 (reuse that list, do
  not retype it); `grant usage, select` on all 19 sequences (`nextval` is needed for the
  `…_id_seq` defaults).
- `grant execute` on nothing in `public` — there are no `SECURITY DEFINER` functions. Triggers run as
  the invoking role, so the guard functions only need to be callable, which the default
  `PUBLIC EXECUTE` on a newly created function already gives; confirm this rather than assume it.
- The role must **not** own any table, or `FORCE` is the only thing standing between it and bypass.

**Stage 4 — shadow run.**

- Point a second connection (a read-only replica or a transaction whose role is switched with
  `set local role gadzio_runtime`) at the same queries and compare result counts. Any query that
  returns fewer rows is a missing policy or an unscoped query, and that is exactly the bug the plan is
  meant to find.
- Run the full integration suite (`npm test`) with `DATABASE_URL` pointed at the new role in a scratch
  schema.

**Stage 5 — cut over.**

- Set `DATABASE_URL` to the runtime role's connection string in staging; run the
  [staging runbook](staging-runbook-20261106.md) end to end.
- Production: change the environment variable and restart. No code deploy and no migration.

**Stage 6 — make it enforced.**

- `alter table … force row level security` on every RLS table, owner included. This is the step that
  closes I-1. Do it only after Stage 5 is stable, because it also applies to any ad-hoc owner
  connection — including the migration runner and the scripts in `scripts/`, which would then need
  the same identity plumbing or a deliberate `BYPASSRLS` role.
- **The migration runner is the sticking point.** `scripts/migrate.mjs` connects with `DATABASE_URL`
  and writes `schema_migrations`; after `FORCE`, it needs either the owner with an explicit
  `set role` reset or a separate owner connection string. Decide this before Stage 6, not during it.

### Rollback

| Stage | Rollback |
|-------|----------|
| 1 | Revert the one call site. |
| 2 | `drop policy` — the owner connection never saw them. |
| 3 | `drop role gadzio_runtime` after revoking its grants; nothing depends on it yet. |
| 4 | Nothing to undo; the owner connection is still the app's. |
| 5 | Point `DATABASE_URL` back at the owner. This is the whole rollback, and it is a variable change and a restart. Keep the owner connection string until Stage 6 has run for a week. |
| 6 | `alter table … no force row level security` per table. Keep the owner connection as the documented emergency path. |

### Testing

- **Per stage:** the existing integration suites connect as the configured role, so running them
  against the runtime role (Stage 4/5) exercises the real policies.
- **Negative tests, one per customer table:** a transaction with `app.user_id` = A must see zero rows of
  B's orders, addresses and sessions. These belong in `tests/` alongside the security suites.
- **Catalogue parity:** `node scripts/verify-rls-consumer-tables.mjs` against staging after every stage
  — the public read surface must not change.
- **State check:** `node scripts/check-security-db-state.mjs` — after Stage 2, `RLS-1` still passes;
  add a `FORCE` assertion when Stage 6 lands.
- **Replay:** 0068 and 0069 through `scripts/replay-check.md`, twice, on a scratch clone.

### Risk of doing it

**High, and it is an availability risk, not a data-loss one.**

- A missing policy or grant is a **production outage on the first request**: 96 tables, 13 policies and
  19 sequences all have to be right at once.
- Every unscoped query in `src/` becomes visible — that is the point, but it means the failure surfaces
  as `permission denied` or silently empty results, in the worst case on a payment path.
- `FORCE` (Stage 6) also applies to tooling that connects as the owner; the migration runner is the
  first casualty.
- The mitigation is the staging: policies are additive in Stage 2, the role is unused until Stage 5,
  the cutover is a variable, and Stage 6 is a separate, reversible step.

### Estimated effort

| Stage | Size | Why |
|-------|------|-----|
| 0. inventory | done | read-only queries |
| 1. identity plumbing | medium | touches the db helper and one path; must not change output |
| 2. policies (0068) | **large** | the bulk: ~20 customer/staff tables, plus catalogue parity |
| 3. role + grants (0069) | medium | mechanical but wide; the 30-column list must match 0064 exactly |
| 4. shadow run | medium | comparison harness + a full test pass |
| 5. cutover | small | environment change |
| 6. force RLS | medium | runner and ad-hoc scripts need a plan |

Do Stage 1-2 as their own change, land them with no runtime effect, and only start Stage 3 when the
policies have been reviewed. None of it should be bundled with a feature release.

---

## Order to do these in

**L-9 first, I-1 second.** L-9 removes an exposure that exists now (a public receipt URL) with a
medium, well-bounded change and a staged object move. I-1 is the stronger architectural fix but carries
a first-request outage risk across every table, and its value is only realised once every query is
scoped — the same condition the current design already states. Doing L-9 does not make I-1 harder; they
touch different tables.
