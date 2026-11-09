# Task 2 — Public HTTPS PayU Sandbox & Callback Verification Evidence

- **Generated at:** `2026-11-09T16:05:32Z`
- **Runner:** `scripts/e2e/verify-payu-callbacks.mjs`
- **Overall Status:** **PARTIAL**
  - **Live PayU Hosted Sandbox Page & External Callback Delivery:** **BLOCKED** — The configured `APP_BASE_URL` trycloudflare tunnel is unreachable (`ENOTFOUND`), neither `cloudflared` nor `ngrok` is installed on this host, and no merchant sandbox card credentials were supplied.
  - **Local HTTP Callback Routes, Reverse-Hash Verification, S2S Processor & DB Invariants:** **PASS (8/8 checks)**

## What Was and Was Not a Real PayU Sandbox Payment

- **Not executed (BLOCKED):** Submitting card/UPI credentials on PayU's hosted `https://test.payu.in/_payment` page and receiving an unsolicited external HTTP POST from PayU's servers over a public HTTPS tunnel.
- **Executed and verified (PASS):**
  1. Real checkout initiation (`POST /api/payu/initiate`) generating real signed form fields (`txnid`, `amount`, `productinfo`, `surl`, `furl`, `curl`, `hash`).
  2. Live HTTP callback/webhook requests to `/api/payu/webhook` and `/api/payu/success` testing missing fields, forged reverse hashes, tampered amounts, tampered product info, and unverified gateway claims (calling the real `https://test.payu.in/merchant/postservice.php?form=2` S2S Verify endpoint, which refuses unverified local txnids and keeps the order out of `PAID`).
  3. Authoritative `processPayUCallback` integration against the real Postgres database for S2S-confirmed capture (`CREATED → PAID`, `reservation_state = CONSUMED`), idempotent duplicate callback replay (`outcome = unchanged`, no double stock deduction), cross-order `mihpayid` replay rejection (`duplicate_gateway_payment`), and user-cancelled callback restocking (`CANCELLED`, `reservation_state = RELEASED`, `on_hand` restored `+1`).
  4. Real authenticated browser screenshots of `/order/success` (`01-order-success-paid.png`) and `/order/cancelled` (`02-order-cancelled-restocked.png`).

## Verification Matrix (`results.json`)

| Check | Status | Result Detail |
|---|---|---|
| `public_https_callback_tunnel` | **BLOCKED** | Configured `APP_BASE_URL` tunnel is unreachable (`ENOTFOUND`); no `cloudflared`/`ngrok` binary installed on host and no PayU sandbox card credentials supplied |
| `webhook_missing_txnid_rejected` | **PASS** | `POST /api/payu/webhook` without `txnid` → `HTTP 400 (Invalid payload: txnid required)` |
| `callback_tampered_hash_rejected` | **PASS** | `txnid=GDZ001023` → `HTTP 400 error="tampered_hash"` `order.status=CREATED` `review_flagged=true` `event=rejected/tampered_hash` |
| `callback_amount_mismatch_rejected` | **PASS** | `txnid=GDZ001023` claimed=`1.00` expected=`2039.00` → `HTTP 400 error="amount_mismatch"` `order.status=CREATED` `event=rejected/amount_mismatch` |
| `callback_productinfo_mismatch_rejected` | **PASS** | `txnid=GDZ001023` → `HTTP 400 error="productinfo_mismatch"` |
| `browser_return_unverified_capture_not_marked_paid` | **PASS** | `POST /api/payu/success` → `HTTP 303 Location=/order/status` `order.status=CREATED` (never `PAID` without S2S confirmation) |
| `s2s_verified_capture_and_idempotent_duplicate_replay` | **PASS** | `txnid=GDZ001023` → 1st=`PAID` (`reservation=CONSUMED`), 2nd replay=`PAID` (`event=unchanged`, `stock_movements=1->1`) |
| `cross_order_duplicate_mihpayid_rejected` | **PASS** | `txnid=GDZ001024` reusing `mihpayid` from `GDZ001023` → `rejected=true` `reason="duplicate_gateway_payment"` `order.status=CREATED` |
| `cancelled_callback_releases_stock_claim` | **PASS** | `txnid=GDZ001025` → `order.status=CANCELLED` `reservation=RELEASED` `on_hand=14->15` `redirect=/order/cancelled` |
