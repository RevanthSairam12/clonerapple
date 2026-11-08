# Staging Checkout Concurrency & PayU Simulator Load-Test Runbook

**Date:** 2026-11-08  
**Scripts:**
- k6 script: `scripts/perf/k6-staging-checkout.js`
- Pure-Node equivalent (zero external binary required): `scripts/perf/node-staging-checkout.mjs`

---

## 1. Required Regional Topology (Vercel + Supabase)

Running multi-round-trip row-locking checkout transactions (`createOrderUsing`) across continents inflates lock-hold duration by 50–100 ms per SQL round-trip (~350–500 ms per transaction). Before running the staging load benchmark, ensure both compute and database sit in **Mumbai**:

| Layer | Provider | Required Region | Identifier / Setting |
| :--- | :--- | :--- | :--- |
| **PostgreSQL + Supavisor Pooler** | Supabase | **Mumbai (India)** | `ap-south-1` (`aws-0-ap-south-1.pooler.supabase.com`) |
| **Serverless Functions (Next.js API)** | Vercel | **Mumbai (India)** | `bom1` (set in `vercel.json` `"regions": ["bom1"]` or Project Settings → Functions → Region) |

With `bom1` ↔ `ap-south-1`, single-query RTT drops from ~65 ms to **1–3 ms**, reducing `createOrderUsing` lock hold time to **~15–25 ms** per checkout.

---

## 2. Pre-Flight Staging Configuration

Verify the following settings on the staging deployment before starting the load run:

1. **Database Connection & Pooler**:
   - `DATABASE_URL` points to the transaction pooler on port `6543` (`?pgbouncer=true`).
   - `DATABASE_POOL_MAX=1` on Vercel.
   - Role-level `idle_in_transaction_session_timeout = '30s'` is applied on `postgres` and `authenticator`.
2. **PayU Test Mode**:
   - `PAYU_ENV=test`
   - `PAYU_KEY` and `PAYU_SALT` set to PayU test credentials.
   - `APP_BASE_URL` set to the public HTTPS staging origin.
   - Store Admin → Settings → Checkout: **PayU enabled = `on`**.
3. **Guest Checkout or Session Cookie**:
   - Either enable **Guest Checkout** in Store Admin → Customers → Settings (`guest_checkout = 'on'`) so each virtual user can check out with a unique synthetic customer email, **or** pass `-e SESSION_COOKIE="user_session=..."` (note: a single signed-in account is limited to one active reservation at a time by `findActiveReservationForUser`, so **Guest Checkout `on`** is required to test 50 and 100 concurrent checkouts simultaneously).
4. **Order Numbering**:
   - If you want to isolate **stock row lock contention** from the global `order_number_counters` row lock during the `distinct_50` and `distinct_100` runs, leave `order_prefix` empty in Store Admin → Settings → Orders (uses random `GDZ...` `txnid`).
   - To test global counter serialization alongside stock locking, set `order_prefix = 'GDZ-'`.
5. **Stock Seeding on Staging**:
   - Ensure each SKU in `DISTINCT_SKUS` has `track_inventory = true` and `on_hand >= 200`.
   - For the `hot_50` and `hot_100` cohorts, set `HOT_SKU` `on_hand` to:
     - `200` if testing **lock queuing throughput and p50/p95 latency** where all 50/100 buyers succeed, or
     - `10` if testing **flash-sale oversell prevention** (exactly 10 HTTP `200` orders created, 40/90 HTTP `409 out_of_stock` or `503 busy`, zero oversell).

---

## 3. Running the Load Tests

### Option A: Using `k6` (`scripts/perf/k6-staging-checkout.js`)

Run all four cohorts sequentially (`distinct_50` → `distinct_100` → `hot_50` → `hot_100`) including the PayU simulator callback path:

```bash
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e DISTINCT_SKUS=apple-60w-usbc-charge-cable-1m,apple-20w-usbc-power-adapter,apple-usbc-to-lightning-cable-1m,apple-earphones-usbc,apple-earphones-lightning \
  -e HOT_SKU=apple-20w-usbc-power-adapter \
  -e PAYU_SALT="$PAYU_SALT" \
  -e SIMULATOR_STATUS=failure \
  -e CALLBACK_ROUTE=webhook \
  scripts/perf/k6-staging-checkout.js
```

Run a single cohort in isolation:

```bash
# 50 concurrent checkouts on distinct SKUs
k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=distinct_50 scripts/perf/k6-staging-checkout.js

# 100 concurrent checkouts on distinct SKUs
k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=distinct_100 scripts/perf/k6-staging-checkout.js

# 50 concurrent checkouts on one hot SKU
k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=hot_50 scripts/perf/k6-staging-checkout.js

# 100 concurrent checkouts on one hot SKU
k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=hot_100 scripts/perf/k6-staging-checkout.js
```

### Option B: Using Node.js (`scripts/perf/node-staging-checkout.mjs`)

If `k6` is not installed on the runner machine, run the zero-dependency Node script:

```bash
node --env-file=.env.local scripts/perf/node-staging-checkout.mjs \
  --base-url https://staging.example.com \
  --distinct-skus apple-60w-usbc-charge-cable-1m,apple-20w-usbc-power-adapter,apple-usbc-to-lightning-cable-1m,apple-earphones-usbc,apple-earphones-lightning \
  --hot-sku apple-20w-usbc-power-adapter \
  --scenario all
```

---

## 4. How the PayU Simulator Path Works in the Load Script

1. **Step A (`POST /api/payu/initiate`)**:
   - Sends a valid Indian shipping address, contact details, item selection, and a unique synthetic `X-Forwarded-For` IP per virtual user (`198.51.x.y`) so per-IP rate limiting (`20 / 5 min`) does not mask database concurrency.
   - Records `p50`, `p95`, `p99`, and `max` latency for `initiate` per cohort (`distinct_50`, `distinct_100`, `hot_50`, `hot_100`).
2. **Step B (`POST /api/payu/webhook` or `/api/payu/success`)**:
   - When `initiate` returns HTTP `200` and `PAYU_SALT` is provided in the environment, the script extracts `fields.key`, `fields.txnid`, `fields.amount`, `fields.productinfo`, `fields.firstname`, and `fields.email`.
   - Computes the exact SHA-512 reverse hash (`computeReverseHash` contract: `sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)`).
   - Posts the signed form payload to `/api/payu/webhook` (default `SIMULATOR_STATUS=failure` so reservations enter the failure/release lifecycle cleanly and return stock after grace, or `SIMULATOR_STATUS=success` to test verification against PayU test mode).

---

## 5. Pass / Fail Criteria & Metrics to Record

After the run finishes, `k6` writes `staging-checkout-k6-summary.json` (and prints the JSON summary to stdout). Record the following table in the release evidence log:

| Cohort | Concurrency | SKU Distribution | p50 Latency (ms) | p95 Latency (ms) | HTTP 200 | HTTP 409 (`out_of_stock`) | HTTP 503 (`busy` + `Retry-After`) | Unhandled 5xx Rate |
| :--- | :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `distinct_50` | 50 | 5+ distinct SKUs | Target `< 600 ms` | Target `< 1500 ms` | Record | Record | Record | **Must be `0%`** |
| `distinct_100` | 100 | 5+ distinct SKUs | Target `< 1000 ms` | Target `< 2500 ms` | Record | Record | Record | **Must be `0%`** |
| `hot_50` | 50 | 1 hot SKU | Target `< 1500 ms` | Target `< 5200 ms` | Record | Record | Record | **Must be `0%`** |
| `hot_100` | 100 | 1 hot SKU | Target `< 2500 ms` | Target `< 5500 ms` | Record | Record | Record | **Must be `0%`** |

### Invariants to Verify After the Run

Run these read-only checks against the staging database after the load test completes:

1. **Zero Negative Stock**:
   ```sql
   SELECT id, product_id, variant_id, on_hand, reserved
   FROM public.stock
   WHERE on_hand < 0 OR reserved < 0;
   -- Expected: 0 rows
   ```
2. **Stock Ledger Conservation**:
   - Every `CREATED` / `PENDING` / `PROCESSING` order with `reservation_state = 'ACTIVE'` has a matching `-quantity` `'sale'` movement in `stock_movements`.
   - Total `on_hand` reduction equals net `SUM(delta)` in `stock_movements`.
3. **Zero Idle-in-Transaction Leaks**:
   ```sql
   SELECT count(*)::int AS leaked_idle_in_tx
   FROM pg_stat_activity
   WHERE datname = current_database()
     AND state = 'idle in transaction'
     AND state_change < now() - interval '30 seconds';
   -- Expected: 0
   ```
