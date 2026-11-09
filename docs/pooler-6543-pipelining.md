# Port 6543 Transaction Pooler Pipelining & `ClientRead` Guard

## 1. Root Cause

Supabase's Transaction Pooler (`*.pooler.supabase.com:6543`, Supavisor in transaction mode) requires `prepare: false` in `postgres.js`.

In `postgres.js` (`3.4.9`), setting `prepare: false` has a subtle protocol effect in `src/connection.js`:

1. **Unparameterized queries (`parameters.length === 0`):**
   - `q.describeFirst` is `false`.
   - `toBuffer(q)` sends ` unnamed(q)` (`Parse + DescribeUnnamed + Bind + ExecuteUnnamed + Sync`) in a single packet ending with `Sync`.
   - `execute(q)` returns `true`, which causes `go(c, q)` in `src/index.js` to place the connection into the **`busy`** queue so additional queries can be pipelined onto the same socket before `ReadyForQuery` returns.
2. **Parameterized queries (`parameters.length > 0` with `prepare: false`):**
   - `q.describeFirst` is `true` (`parameters.length && !q.prepared`).
   - `toBuffer(q)` sends `Parse + Describe + Flush` **without `Sync`**, waiting for PostgreSQL to reply with `ParameterDescription` (`t`) before sending `Bind + Execute + Sync`.
3. **The Supavisor `:6543` Deadlock:**
   - When an unparameterized query (`q1`, ending in `Sync`) runs on a connection `c`, `c` enters `busy`.
   - If a parameterized query (`q2`, ending in `Flush` with no `Sync`) is dispatched before `q1` finishes, `postgres.js` pipelines `q2`'s `Parse + Describe + Flush` onto `c` right behind `q1`'s `Sync`.
   - When `q1` completes and PostgreSQL emits `ReadyForQuery` (`Z`), Supavisor's transaction pooler treats the transaction cycle as finished and detaches/releases the backend connection, stranding `q2`'s open extended-query cycle on the PostgreSQL backend in `state = 'active', wait_event = 'ClientRead'`.

---

## 2. The Workaround (`src/lib/platform/db.ts`)

In `src/lib/platform/db.ts`, `disablePoolerPipelining(client)` wraps `Query.prototype.handle` for port-6543 pooler clients:

- For any query where `this.options.onexecute` is not already set (`sql.begin` sets its own `onexecute` on `BEGIN` to reserve the connection), `this.options.onexecute` is set to `() => false`.
- In `postgres.js` (`src/connection.js` line 176):
  ```js
  return write(toBuffer(q))
    && !q.describeFirst
    && !q.cursorFn
    && sent.length < max_pipeline
    && (!q.options.onexecute || q.options.onexecute(connection))
  ```
- Returning `false` from `onexecute` causes `c.execute(q)` to return `false`, which moves the connection to the **`full`** queue instead of `busy` until `ReadyForQuery` arrives.
- `sql.begin` transactions continue to work because `begin` supplies its own `onexecute` callback on `BEGIN`, and concurrent queries inside `tx` are queued in `queries` and executed one at a time on `ReadyForQuery` (`c.reserved()`).
- `fetch_types` remains `true` (the default) so `fetchArrayTypes()` registers PostgreSQL array serializers (`sql.array(...)`).

---

## 3. Version Pinning & Internals Contract Test

Because the workaround depends on `postgres.js` `Query.prototype.handle`, `query.options.onexecute`, and `connection.js` moving connections to `full` when `execute()` returns `false`:

- `package.json` and `package-lock.json` pin `"postgres": "3.4.9"` (exact version, no `^` or `~` range).
- `tests/pooler-6543-pipelining.test.mjs` verifies:
  1. `package.json` and `package-lock.json` pin exact `"3.4.9"`, matching `PINNED_POSTGRES_VERSION`.
  2. `assertPostgresPoolerInternals` and the `postgres` source files (`src/query.js`, `src/connection.js`, `src/index.js`) preserve the exact `handle()`, `onexecute`, and `busy`/`full` queue semantics.
  3. The `DATABASE_DISABLE_POOLER_NO_PIPELINE` environment switch disables the workaround when set to `1`, `true`, `on`, or `yes`.
  4. An opt-in live port-6543 regression test (`RUN_POOLER_6543_REGRESSION=1`) reproduces the hang with the workaround disabled (`DATABASE_DISABLE_POOLER_NO_PIPELINE=1`) and verifies that the same concurrent workload completes cleanly with zero `ClientRead` stalls when enabled.

---

## 4. Environment Switch

To disable the workaround without a code change (for example, after upgrading Supavisor or switching `DATABASE_URL` to a direct/session connection):

```bash
DATABASE_DISABLE_POOLER_NO_PIPELINE=1
```

Accepted truthy values: `1`, `true`, `on`, `yes` (case-insensitive).

---

## 5. Read-Only `ClientRead` Monitoring Script

Run the read-only monitor against `DATABASE_MIGRATION_URL` (or `DATABASE_URL`) to check for any PostgreSQL backend stuck in `state = 'active'` and `wait_event = 'ClientRead'` for longer than the threshold (default 5 seconds):

```bash
node --env-file=.env.local scripts/check-db-clientread.mjs
# or via npm:
npm run check:db-clientread
```

The script outputs a redacted JSON report (PIDs, ages, wait events, application name — never queries, parameters, or credentials) and exits with code `1` if `stuckClientReadCount > 0`.
