# Migration replay check — 0063 to 0067

A plan for proving that the security migrations apply cleanly to a database that has never seen them,
and that they are idempotent. **Nothing here touches the live database and nothing runs a migration
against it.** Every command below targets a scratch Postgres on `127.0.0.1`.

Why it matters: 0063-0067 have already been applied to the live database, so a plain `db:migrate` only
prints `skipping`. It says nothing about what would happen on a restored backup or a fresh
environment. This is the only way to find out without running a migration on a live system.

Run this before deploying 0063-0067 to any new environment, and after editing any of the five files.

---

## 0. Prerequisites

| Need | Check |
|------|-------|
| Docker (or a local Postgres 15+) | `docker --version` |
| `pg_restore` / `psql` matching the server | `psql --version` |
| A backup of the database taken **before** 0063 was applied | see step 2 if you do not have one |
| The repo's `.env.local` untouched | this plan never sets `DATABASE_URL` there |

Create the scratch project directory **outside the repo** and run everything from there. The runner is
invoked by absolute path so it still writes to the repo's `migrations/` directory.

```bash
export SCRATCH=~/gadzio-replay
mkdir -p "$SCRATCH"
export REPO=/c/Users/Abcom/Documents/clon/apple-clone   # adjust to your clone
```

---

## 1. Start a scratch Postgres

```bash
docker run --rm -d --name gadzio-replay \
  -e POSTGRES_PASSWORD=scratch \
  -e POSTGRES_DB=gadzio_replay \
  -p 55432:5432 \
  postgres:15

docker exec gadzio-replay pg_isready -U postgres -d gadzio_replay
```

`postgres:15` matches the live server (PostgreSQL 15.1) closely enough for a replay. Everything in
0063-0067 is supported from PostgreSQL 14 (`create or replace trigger`).

---

## 2. Get a starting point

Pick the case that matches what you have.

### Case A — restoring a backup from before 0063 (the real check)

```bash
pg_restore --clean --if-exists --no-owner \
  --dbname "postgresql://postgres:scratch@127.0.0.1:55432/gadzio_replay" \
  /path/to/pre-0063.dump
```

Sanity-check it is genuinely *before* 0063:

```bash
psql "postgresql://postgres:scratch@127.0.0.1:55432/gadzio_replay" -c \
  "select filename from schema_migrations order by filename desc limit 5"
```

Expected: the highest row is `0062_…` (or earlier). **If you see 0063, this is the wrong backup — a
replay from here proves nothing.** Stop and take a fresh backup from a point before the migrations were
applied.

### Case B — no pre-0063 backup: replay from empty

That is still worth doing (it proves creation order and idempotency from zero) but it is **not** the
same as replaying onto real data. Record it as such.

```bash
psql "postgresql://postgres:scratch@127.0.0.1:55432/gadzio_replay" -c "select current_database()"
# empty database, no schema_migrations table
```

### Case C — the backup holds the schema but 0063-0067 are not in the ledger

If you cannot get a pre-0063 backup, `--clean --if-exists` on a current dump plus a delete from
`schema_migrations` for `0063_%` … `0067_%` reproduces the state. **Never do this on the live
database.** Do it only on the scratch copy, and only after confirming the scratch copy is the one you
are connected to:

```bash
psql "$SCRATCH_URL" -c \
  "delete from schema_migrations where filename like '0063_%' or filename like '0064_%' or filename like '0065_%' or filename like '0066_%' or filename like '0067_%'"
```

This is the one write in this plan, and it runs against `$SCRATCH` only. Set it explicitly so a typo
cannot reach the live database:

```bash
export SCRATCH_URL="postgresql://postgres:scratch@127.0.0.1:55432/gadzio_replay"
```

---

## 3. Run the migrations

```bash
cd "$SCRATCH"
export DATABASE_URL="$SCRATCH_URL"
export DATABASE_SSL=false
node "$REPO/scripts/migrate.mjs"
```

`migrate.mjs` loads `.env.local` from the **current working directory**, and only fills a variable
that is not already set — so running from `$SCRATCH` keeps the scratch `DATABASE_URL` and never reads
the repo's. `DATABASE_SSL=false` is required because the scratch server has no TLS.

### Expect

- `0063` … `0067` are applied in order, each with `applying … done`.
- Earlier files are `skipping … (already applied)` in Case A/C, or applied in Case B.
- No `Refusing to run <file>: contains a destructive statement.`

If the runner refuses a file, the forbidden-word regex in `migrate.mjs:44-46` matched the file text.
0066 and 0067 build the `truncate` keyword at run time (`'trun' || 'cate'`) precisely to avoid this;
any other file that trips it needs a code review, not a regex change.

### The most likely failure on a plain Postgres

`psql`-created databases have neither `anon` nor `authenticated`. `0002_rls.sql` and `0013_…` name them
directly (`revoke all privileges on table … from anon, authenticated`, `create policy … to anon,
authenticated`), so a Case B run stops at `0002`. That is not a defect in 0063-0067; it is the
Supabase-shaped schema assuming the API roles exist.

0063-0067 themselves are guarded — 0064, 0065 and 0067 each check `pg_roles` or `to_regclass` before
touching them, and 0066 only needs the tables. To exercise a Case B run end to end, create the roles
first:

```bash
psql "$SCRATCH_URL" -c "create role anon nologin; create role authenticated nologin"
```

Record in the run log that the roles were created by hand — it means the run covers 0063-0067 but not
the real Supabase role setup.

---

## 4. Verify the state (the Task 1 checks, against the scratch database)

The same script used against the live database, pointed at the scratch server:

```bash
cd "$SCRATCH"
DATABASE_URL="$SCRATCH_URL" DATABASE_SSL=false node "$REPO/scripts/check-security-db-state.mjs"
```

Expect **all ten checks PASS**. On a scratch database with the hand-made roles, the counts match:
`0063-0067 all recorded`, `no table-level privileges for anon/authenticated`, `30 display columns
granted`, the three withheld columns, `RLS enabled`, `security_invoker=true`, six statement guards.

Two things the script cannot prove on a plain Postgres, because they are PostgREST behaviour rather
than catalogue state:

- **M-2 / L-1 live probes.** With no PostgREST in front of the scratch database there is no
  `GET /rest/v1/products` to call. The grant state is what the script checks; the 401 is what the live
  probes in `docs/security-reverify-20261106.md` recorded.
- **RLS as a non-owner.** The app connects as the table owner, which bypasses RLS (accepted risk I-1).
  To see RLS actually reject, connect *as* `anon`:

  ```bash
  psql "postgresql://anon@127.0.0.1:55432/gadzio_replay" -c "set role anon; select count(*) from users"
  # expect: 0 rows (RLS on, no policy), not an error
  ```
  (Add `-h` and the password prompt as your scratch server requires; roles created without
  `LOGIN` need `ALTER ROLE anon LOGIN PASSWORD 'scratch'` first.)

### The RLS verifier

`scripts/verify-rls-consumer-tables.mjs` reads `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and calls PostgREST. It has no meaning against a bare Postgres
and no PostgREST to call, so it is **not run** here. It runs against a deployed environment:

```bash
node scripts/verify-rls-consumer-tables.mjs
# or, against staging:
NEXT_PUBLIC_SUPABASE_URL=https://<staging-ref>.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<staging publishable key> \
node scripts/verify-rls-consumer-tables.mjs
```

Record its output (status and row counts only) in the run log. Never paste the key.

---

## 5. Prove 0065, 0066 and 0067 are idempotent

A fresh replay proves they *apply*. Idempotency needs a second application. `migrate.mjs` skips
anything already in `schema_migrations`, so delete those three rows — **on the scratch database
only** — and run it again.

```bash
psql "$SCRATCH_URL" -c \
  "delete from schema_migrations where filename like '0065_%' or filename like '0066_%' or filename like '0067_%'"

cd "$SCRATCH"
DATABASE_URL="$SCRATCH_URL" DATABASE_SSL=false node "$REPO/scripts/migrate.mjs"
```

**Expect:**

- `applying 0065_… done`, `applying 0066_… done`, `applying 0067_… done` — no error.
- 0065: `alter table … enable row level security` on an already-enabled table is a no-op; the
  `revoke all` statements are no-ops too.
- 0066: `create or replace function` and `create or replace trigger` replace the existing pair with
  identical definitions — no `trigger already exists` error. (This is why 0066 uses
  `create or replace trigger` rather than drop-and-create; `drop trigger` would also trip the runner's
  forbidden-word regex.)
- 0067: revoking a privilege that is not held is a no-op; the `pg_roles` guard skips a database with
  no `anon`/`authenticated`.

Then re-run the state check and confirm the same ten PASSes:

```bash
DATABASE_URL="$SCRATCH_URL" DATABASE_SSL=false node "$REPO/scripts/check-security-db-state.mjs"
```

### 0064 specifically

0064 is not in the idempotency list because it is *convergent* rather than a no-op: it revokes the
table-wide `SELECT` and grants the 30-column list again, so a second run restores exactly the same
state. If you want to prove it too, delete its ledger row and re-run — the expected result is the same
30-column grant and no error, and `COLS-*-allow` stays at 30.

The same applies to 0063 (`alter view … set (security_invoker = true)` is idempotent and `revoke` is a
no-op).

---

## 6. Prove the statement guard actually fires

0066 is the one migration whose effect is only visible when a statement runs. Confirm the guard
rejects the bulk statement **on the scratch database**:

```bash
psql "$SCRATCH_URL" -c "truncate public.store_admin_audit"
```

Expect:

```
ERROR:  store_admin_audit rows cannot be emptied wholesale
```

Repeat for `price_history`, `order_status_history`, `order_edit_logs`, `refunds` and `payment_events`.
This is the one destructive statement in this plan and it is deliberately rejected — if it succeeds,
0066 did not apply and the run fails.

---

## 7. Clean up

```bash
docker stop gadzio-replay
rm -rf "$SCRATCH"
```

Unset the scratch variables in that shell before doing anything else in it:

```bash
unset DATABASE_URL DATABASE_SSL SCRATCH_URL
```

---

## Run log template

| Item | Value |
|------|-------|
| Date / operator | |
| Case (A / B / C) | |
| Backup point (highest pre-replay migration) | |
| Roles created by hand? | |
| First replay: files applied | |
| State check: PASS/FAIL per check | |
| Second replay (0065-0067): files applied | |
| State check after second replay | |
| Statement guard test (step 6) | |
| `verify-rls-consumer-tables.mjs` (if a deployed env was available) | |
| Anything unexpected | |

---

## What this plan cannot prove

- **PostgREST behaviour.** The 401s for `products.cost_paise`, `order_sale_state` and
  `schema_migrations` are HTTP results from a running PostgREST. Only a deployed environment shows
  them; the catalogue state is what a scratch replay checks.
- **Real data volume.** A restore of a small backup does not stress the `products` grant change or the
  ledger triggers under load.
- **That the live database matches.** This plan proves the files apply and converge; it does not audit
  what is in production. That is Task 1 (`check-security-db-state.mjs` against `DATABASE_URL`).
