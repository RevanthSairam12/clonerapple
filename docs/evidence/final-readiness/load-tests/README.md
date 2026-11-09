# Task 4 — 50 / 100 Concurrent Checkout & PayU Simulator Load Test Evidence

- **Generated at:** `2026-11-09T16:09:23Z`
- **Runner:** `scripts/perf/node-staging-checkout.mjs`
- **Staging Status:** **BLOCKED (Vercel `bom1` Staging)** — No Vercel `bom1` staging deployment exists (`APP_BASE_URL` points to an inactive trycloudflare tunnel).
- **Local-Only Supplement Status:** **PASS (Executed against local production build `http://localhost:3000` ↔ Supabase `ap-south-1` Mumbai pooler on port `6543`, labeled strictly as local-only, never as staging)**

## 1. Local Auth-Gate Concurrency (`guest_checkout = off`, Default Store Setting)

File: `local-node-checkout-summary.json`

| Cohort | Concurrency | Mode | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) | HTTP Statuses | Unhandled 5xx |
|---|---:|---|---:|---:|---:|---:|---|---:|
| `distinct_50` | 50 | `distinct_skus` | 478.05 | 480.08 | 496.19 | 496.19 | `401: 50` | `0 (0%)` |
| `distinct_100` | 100 | `distinct_skus` | 124.71 | 252.69 | 263.38 | 263.38 | `401: 100` | `0 (0%)` |
| `hot_50` | 50 | `hot_sku` | 73.11 | 122.87 | 126.11 | 126.11 | `401: 50` | `0 (0%)` |
| `hot_100` | 100 | `hot_sku` | 124.63 | 256.82 | 269.30 | 269.30 | `401: 100` | `0 (0%)` |

## 2. Local Row-Lock & Flash-Sale Oversell Concurrency (`guest_checkout = on`, `initialOnHand = 2`)

File: `local-flash-sale-concurrency.json` (Target variant: `test_var_blu_u_fr20261109` on `test_product_fr20261109`, seeded with `on_hand = 2`, followed by 50 and 100 simultaneous checkout requests + PayU webhook simulator callbacks)

| Cohort | Concurrency | Mode | p50 (ms) | p95 (ms) | p99 (ms) | Max (ms) | HTTP 200 | HTTP 409 (`out_of_stock`) | Unhandled 5xx | Simulator Callbacks (`p50 / p95`) |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---|
| `hot_50` | 50 | `hot_sku` | 2858.99 | 3664.00 | 3728.26 | 3728.26 | **2** | **48** | **0 (0%)** | `2 sent (461.53 ms / 461.53 ms)` |
| `hot_100` | 100 | `hot_sku` | 2834.41 | 4775.64 | 4989.66 | 4989.66 | **0** | **100** | **0 (0%)** | `0 sent` |

## 3. Post-Run Database Invariants (`docs/load-test-runbook.md` §5)

- **Negative Stock Rows (`on_hand < 0 OR reserved < 0`):** `0`
- **Hot Variant Final Stock (`test_var_blu_u_fr20261109`):** `on_hand = 0, reserved = 0` (exact 2 units claimed by the 2 HTTP 200 orders, zero oversell across 150 concurrent requests)
- **Leaked `idle in transaction` Sessions (> 30s):** `0`
