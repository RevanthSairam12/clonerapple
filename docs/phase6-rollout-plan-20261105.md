# Rollout plan — products with models and colours

**Prepared 5 November 2026. Nothing in this plan has been executed against the
live store database.** It is the written counterpart to Phase 6 of
`PRODUCT_OPTIONS_FINAL_PLAN.md` (`PRODUCT_EDITOR_FINISH.md` Phase F3 does not
exist in this repository, so this plan reconstructs F3's requirements from the
final plan and `DISPOSABLE_DB_RUNBOOK.md`).

Everything below assumes the store is the Gadzio single-store catalogue. The
Education Store is not part of this rollout.

---

## 1. What ships

| Area | Change |
| --- | --- |
| Shared lists | Owner-only CSV/paste import for device models and colours, with preview, near-match acknowledgement, no-op re-import and error CSV |
| Product editor | `Sell by` choice, one options table (model/colour/SKU/price/sale/stock/active/history), fast entry and pasted blocks, per-colour photos, guided stock move |
| Pricing | Option price and sale editing by admin/owner, large-change confirmation, paired `price_history` rows under one `change_group` |
| Storefront | Model-first, then colour selector; colour gallery switching; exact option price |
| Checkout and stock | Exact option claimed, released once, consumed after payment; returns restock only what was sold |
| Admin | Stock, low stock, reports, price history, orders, packing slip, invoice and POS all name the exact model and colour |

Migrations involved: `0055` through `0061`. All seven were applied to the live
database on 5 November 2026 (see `docs/migrations-pending.md`). A fresh
environment must run every file from `0001` to `0061` in filename order.

## 2. Before the window (owner)

1. **Back up the database.** Take a provider snapshot and a logical dump
   (Supabase dashboard backup or `pg_dump` against the session pooler). Record
   the backup identifier and timestamp. Do not delete the previous backup.
2. **Restore the backup once, somewhere disposable, and check it opens.** A
   backup that has never been restored is not a backup. `DISPOSABLE_DB_RUNBOOK.md`
   has the three supported targets.
3. **Record the starting point.** Keep these counts from immediately before the
   window: products, product_variants, stock, stock_movements, orders,
   order_items, coupons, coupon_redemptions, price_history, store_admins.
4. **Confirm `schema_migrations`** lists every file up to `0061`. On the current
   live database it does (59 rows).
5. **Decide the window.** A low-traffic hour with no campaign ending. Tell staff
   that catalogue edits will pause.
6. **Collect the real inputs**: the phone-model list (CSV or paste), the colour
   list with hex codes, the stock counts, and one colour photo per colour.

## 3. Maintenance window

1. Turn on **maintenance mode** so the storefront stops taking new orders.
   Existing unpaid reservations keep their normal expiry.
2. Wait until the checkout reservation count is zero, or accept that a
   reservation may expire during the window (the expiry path releases it
   exactly once).
3. Run `npm run db:migrate`. The runner skips files already recorded and sends
   each file as one transaction.
4. Deploy the matching application build.
5. Turn maintenance mode off and open the storefront.

### Rehearsal evidence for these migrations (5 November 2026)

`scripts/rehearse-options-migrations.mjs` replayed `0001`–`0057`, copied 1,935
real rows from 93 tables into a throwaway schema, applied `0058`–`0061`, ran
188 checks and ran `0058`–`0061` a second time. Result: **188/188 checks
passed**, every copied row unchanged, the schema dropped, the live counts
identical afterwards. This is the rehearsal that `docs/migrations-pending.md`
records as missing at the time 0058–0061 were applied.

Two rehearsal-only rewrites are documented in the script: migration `0014`
reads `information_schema` with `table_schema = 'public'`, and migrations
`0021`, `0026`, `0034`, `0037`, `0049` and `0051` inspect `pg_constraint` /
`pg_class` without a schema filter. Both are correct for a single-schema
production database and only needed scoping because the live schema sat beside
the rehearsal schema. **Do not "fix" these in production migrations.**

## 4. Migration order

The order is fixed. `0059` uses functions created by `0057` and `0058`; `0060`
references the `colours` table from `0059`; `0058`'s function must exist before
`0059` builds its unique index.

| Step | Files | Gate before continuing |
| --- | --- | --- |
| 1 | `0001`–`0054` | Only on a fresh database. On the live store these are already applied. |
| 2 | `0055`–`0057` | `select count(*) from product_variants;` unchanged; `products.catalog_revision` present |
| 3 | `0058` | No duplicate brand/model names; both unique indexes exist |
| 4 | `0059` | `colours` and `product_variant_colours` exist, both with RLS on |
| 5 | `0060` | `products.sell_by` default `single`; no invalid `sell_by` value; every `product_images.colour_id` resolves |
| 6 | `0061` | `order_items` has the seven snapshot columns; existing rows still null |

`scripts/migrate.mjs` refuses any file containing a destructive statement. If a
file fails, stop; do not edit it in place and re-run.

## 5. Smoke checks after deploy

Run these in order. Any failure is a stop-and-investigate, not a retry.

### Storefront

1. Open a category page and filter by a model, then by a colour. Only products
   that really have that model/option appear.
2. Open a product with models and colours. Pick the model, then the colour.
   The photos, price and availability change together; a colour with no photo
   keeps the default gallery.
3. Put the exact option in the bag and open the bag. The bag shows the same
   model and colour and the same price.

### Checkout and payment (test mode)

4. Check out the exact option with simulated PayU callbacks. Confirm stock fell
   for that option only; a sibling option did not move.
5. Repeat with a failed and a cancelled payment. The unit comes back exactly
   once; repeating the callback changes nothing.

### Store admin

6. **Stock**: the product total equals the sum of its option rows; each row's
   movement history names the option.
7. **Low stock** and the Stock/Low-stock reports list one row per product or
   option.
8. **Price history** shows the option label and SKU, the old/new regular and
   sale prices, the change group and the actor. A cleared sale shows
   **Sale cleared**, never ₹0.00.
9. **Orders** list, order detail, packing slip and invoice show the model and
   colour that were sold.
10. **POS**: pick the model and colour, type a price, complete a sale. Stock
    moves for that option only.
11. Change one option's price. The next checkout charges the new price; an
    order placed before the change keeps its stored line price.

### Data checks (read-only)

```sql
-- Every stock row equals its opening balance plus the ledger.
select s.product_id, s.variant_id, s.on_hand,
       coalesce((select sum(m.delta) from stock_movements m
                  where m.product_id = s.product_id
                    and m.variant_id is not distinct from s.variant_id), 0) as ledger
  from stock s
 where s.track_inventory
   and s.on_hand < coalesce((select sum(m.delta) from stock_movements m
                  where m.product_id = s.product_id
                    and m.variant_id is not distinct from s.variant_id), 0);
-- Expect zero rows.

-- No order line carries a half-written snapshot.
select count(*) from order_items
 where (variant_device_model_id is null) <> (variant_device_model_name is null);
-- Expect 0.

-- No reservation is stuck past its expiry plus the configured grace.
select count(*) from orders
 where reservation_state = 'ACTIVE' and reservation_expires_at < now() - interval '1 hour';
-- Expect 0 in steady state.
```

## 6. Rollback limits

- The migrations are **additive**. There are no down migrations, and none
  should be written. Dropping the new columns or tables would destroy saved
  option identities, colour links and order snapshots.
- **Code rollback is safe on its own.** The previous build does not read the
  new columns. Order placement probes for `order_items.variant_colour_id` and
  falls back to the legacy insert, so 0061 does not block a rollback.
- **Schema rollback means restoring the backup.** That loses every order,
  stock movement, price change and audit row created after the backup. It is a
  last resort, decided by the owner, not by an engineer mid-incident.
- If a single migration fails, the transaction rolls back and the earlier files
  remain applied. Fix forward with a new numbered file; never edit an applied
  file.
- Turning maintenance mode back on is the safe intermediate state: the store
  stops taking orders while the admin stays readable.

## 7. First-week watch list

Check daily for seven days; then weekly.

| Watch | Why | Where to look |
| --- | --- | --- |
| Stock rows that disagree with `stock_movements` | The engine's core promise | The read-only query in §5 |
| Orders stuck `ACTIVE` past expiry | A missed release keeps units held | `orders.reservation_state` / `reservation_expires_at` |
| Payments received after expiry | Late capture must reclaim the released unit or flag review | `payment_review_required` orders |
| `order_items` rows with a model but no colour (or the reverse) | A half-written snapshot | §5 query |
| Duplicate or near-duplicate brands/models | The import matches normalized names; a new duplicate means the guard was bypassed | Shared lists screen, owner view |
| Option rows with no stock row or no SKU | Created through an old screen or an interrupted save | Product editor options table |
| Price history rows without a change group | An old write path was used | Price history screen |
| Low-stock alerts not firing per option | Per-option notifications are **not** queued in this build; only product-level adjustments notify | `docs/phase5-options-lifecycle-20261105.md`, known limitations |
| Notification outbox growth | Order/payment events depend on it | `notification_outbox` count |
| PayU callback errors | The price charged must equal the stored line | Server logs, payment review queue |

## 8. What is not covered by this plan

- An authenticated end-to-end browser run against a live-like database was
  **not** executed. The only database target approved for Phase 6 was throwaway
  schemas on the existing Supabase project, which cannot host an authenticated
  Next.js checkout without writing to the live store tables. The steps in §5
  are the acceptance script for the person who runs the real window.
- Provider setup for email/SMS remains incomplete; `check:notifications` reports
  3 pass / 5 fail because mail and SMS are not configured.
- Per-option low-stock notifications are not built.

---

## 9. Database connection scaling & Vercel / Supabase configuration (Updated 8 November 2026)

### Vercel environment variables

Configure the following variables in **Vercel → Project Settings → Environment Variables** (Production & Preview):

| Variable | Value / Source | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Supabase **Transaction Pooler** URI on port **`6543`** (`postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`) | Used by the Next.js application runtime (`getSql()`). `src/lib/platform/db.ts` detects `pooler` + port `6543` and sets `prepare: false` automatically. |
| `DATABASE_MIGRATION_URL` | Supabase **Session Pooler** or Direct URI on port **`5432`** (`postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`) | Used by `npm run db:migrate`, CLI scripts, and schema-pinned test fixtures. Prefers `DATABASE_MIGRATION_URL`, falls back to `DATABASE_URL`, and **refuses port `6543`** with a clear error message. |
| `DATABASE_POOL_MAX` | `10` (optional; integer `1`–`100`, defaults to `10` in production and `5` in development) | Overrides the per-instance connection pool size in `src/lib/platform/db.ts`. |
| `DATABASE_SSL` | `require` (default when unset; only `false` disables TLS) | Enforces TLS connections to Supabase. |
| `TRUST_PROXY` | `1` | Enables real client IP extraction from `X-Forwarded-For` behind Vercel's edge proxy for per-IP rate limiting and hashed audit logs. |
| `MAIL_ALLOWED_HOSTS` | Comma-separated SMTP hostnames (e.g. `smtp.example.com`) | Restricts where `MAIL_PASSWORD` can be sent by the SMTP transport. |

### Pooler & application lifecycle settings

1. **Application pool (`src/lib/platform/db.ts`)**:
   - `max`: `10` in production (`5` in dev), overridable via `DATABASE_POOL_MAX`.
   - `idle_timeout`: `20` seconds (returns idle connections before Supavisor reclaims them).
   - `connect_timeout`: `10` seconds (fails fast when the pooler is saturated).
   - `max_lifetime`: `1800` seconds (rotates connections every 30 minutes).
   - `prepare`: `false` automatically when connected to `...pooler...:6543` (Supavisor transaction mode does not support prepared statements).
2. **Per-instance 3-second storefront caches**:
   - `readSaleState()` (`SALE_STATE_CACHE_TTL_MS = 3_000`) and `getMaintenanceState()` (`MAINTENANCE_CACHE_MS = 3_000`) cache decisions in-memory per instance for 3 seconds, deduplicate concurrent in-flight refreshes, advance the PostgreSQL clock (`db_now + elapsedMs`) across scheduled window boundaries, and never cache fail-open / fail-safe error fallbacks.
3. **Transaction fail-fast timeouts (`src/lib/checkout/transaction-guards.ts`)**:
   - Checkout, POS, coupon, and reconcile transactions set transaction-local `lock_timeout = 5000ms` (5 s) and `statement_timeout = 15000ms` (15 s).
   - On `55P03` (`lock_not_available`) or `57014` (`query_canceled`), the transaction rolls back cleanly with zero partial orders and the API returns `503 Service Unavailable` with `Retry-After: 5` and a friendly `"The store is busy right now. Please try again in a moment."` message.
4. **Role-level `idle_in_transaction_session_timeout` (Pending Owner Approval — Not Applied)**:
   - See `docs/production-env-20261106.md` for the exact `ALTER ROLE postgres SET idle_in_transaction_session_timeout = '30s';` SQL awaiting owner approval.

### What to check in the Supabase dashboard

1. **Project Settings → Database → Connection Pooling (Supavisor)**:
   - Confirm **Connection pooling** is enabled.
   - Copy the **Transaction mode** connection string (port **`6543`**) for `DATABASE_URL`.
   - Copy the **Session mode** connection string (port **`5432`**) for `DATABASE_MIGRATION_URL`.
   - Verify the **Default Pool Size** (typically 15 on Free/Small compute tiers, higher on Pro) and **Max Client Connections** (typically 200 in transaction mode).
2. **Reports → Database → Client Connections & Pooler Connections**:
   - Watch active `pg_stat_activity` backend connections during peak/sale traffic; ensure active connections stay below the pooler's backend slot cap.
   - Check that idle connections drop within ~20 seconds after a traffic burst (`idle_timeout: 20`).
   - Check that zero connections remain stuck in `idle in transaction` state.
3. **Logs → Postgres Logs**:
   - Watch for `55P03` (`canceling statement due to lock timeout`) or `57014` (`canceling statement due to statement timeout`) during flash sales — these indicate hot-SKU lock contention failing fast as designed rather than piling up.
   - Confirm zero `prepared statement "..." already exists` or `prepared statement "..." does not exist` errors (proving `prepare: false` is active on port `6543`).

### What to check in the Vercel dashboard

1. **Project Settings → Environment Variables**:
   - Verify `DATABASE_URL` uses port **`6543`** and `DATABASE_MIGRATION_URL` uses port **`5432`**.
   - Verify `TRUST_PROXY=1`, `CRON_SECRET`, `PAYU_KEY`, `PAYU_SALT`, `APP_BASE_URL`, and `MAIL_ALLOWED_HOSTS` are set for Production.
2. **Deployments → Build Logs & Runtime Logs**:
   - Confirm the first lines of server boot logs show no `[startup]` warnings from `src/instrumentation.ts`.
   - Confirm `/api/payu/initiate` and `/api/payu/webhook` return `200`/`409` or friendly `503` (`Retry-After: 5`) under load, with zero unhandled `500` errors or `EMAXCONNSESSION` pool exhaustion errors.
3. **Cron Jobs / Observability**:
   - Confirm `/api/payu/reconcile` runs on schedule with `200 OK` and `summary.errors` empty, releasing expired reservations and draining `notification_outbox`.

