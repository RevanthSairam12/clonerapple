# Task 5 — Controlled Production Payment Smoke-Test Procedure

**Execution Status:** `BLOCKED — awaiting explicit authorization for a real production payment.`

> **Hard Safety Gate:** Do **NOT** execute a live payment against `https://secure.payu.in/_payment` or set `PAYU_ENV=live` until an authorized store owner explicitly approves a controlled ₹1.00 / low-value smoke transaction and provides the operator payment instrument.

---

## 1. Pre-Conditions Before Authorization Is Granted

1. **Regional Topology Active (`docs/cutover-plan.md`):**
   - Vercel Function region is deployed to `bom1` (Mumbai, India) via `vercel.json`.
   - Supabase PostgreSQL + Supavisor pooler is in `ap-south-1` (Mumbai, India).
2. **Production Environment Variables Verified (Vercel Production Scope Only):**
   - `APP_BASE_URL` = canonical production HTTPS origin (e.g. `https://gadzio.co.in`), no path or query string.
   - `PAYU_ENV=live`, `PAYU_KEY` and `PAYU_SALT` = live merchant credentials (never committed to git or printed in logs).
   - `PAYU_RETURN_SECRET` = 32+ character cryptographic secret for signed return links (`rt`).
   - `CRON_SECRET` = configured for `/api/payu/reconcile`.
3. **Storefront & Maintenance Gate:**
   - Store Admin → Settings → Storefront: keep **Maintenance mode ON** (or use an unlisted draft/smoke SKU) while staging the smoke product so no external customer can purchase the test item.
   - Store Admin → Settings → Payments: verify **PayU enabled = `on`** and **Shipping fee = `0`** (or explicit known paise value) for the smoke window.

---

## 2. Step-by-Step Controlled Smoke-Test Procedure (Once Authorized)

### Step A — Stage a Dedicated Smoke SKU
1. Sign in to `/store-admin` as `store_owner`.
2. Create or activate a dedicated smoke-test product (e.g. `smoke-verify-item`, price `₹1.00` / `100` paise, `inventory_mode = 'variant'`, `on_hand = 1`, `low_stock_threshold = 1`).
3. Confirm the item renders at `₹1.00` on `/shop/product/smoke-verify-item`.

### Step B — Initiate & Complete One Real ₹1.00 Payment
1. Sign in as the designated operator customer account at `/auth`.
2. Add the smoke SKU (`quantity = 1`) to the bag and open `/checkout`.
3. Verify the displayed server-priced total is `₹1.00` (`100` paise).
4. Submit checkout (`POST /api/payu/initiate`):
   - Confirm the browser is redirected to `https://secure.payu.in/_payment`.
   - Record the generated `txnid` (do not log hashes or secrets).
5. Complete the ₹1.00 payment using the authorized operator UPI/card instrument.

### Step C — Verify Browser Return, Webhook & Database Invariants
1. **Browser Return (`POST /api/payu/success`):**
   - Confirm HTTP `303 See Other` redirect to `/order/success?txnid=<txnid>&rt=<token>`.
2. **Order & Stock State (`/store-admin/orders/<txnid>`):**
   - `orders.status = 'PAID'`
   - `orders.reservation_state = 'CONSUMED'`
   - `orders.payu_mihpayid` is populated and non-null
   - `stock.on_hand` decremented from `1 → 0`, and `stock_movements` has one `delta = -1, reason = 'sale'` row.
3. **Payment Events & Audit Trail:**
   - `payment_events` records `outcome = 'paid'` with `source = 'redirect'` or `'webhook'`.
   - If both browser return and webhook arrive, the second arrival is recorded as `outcome = 'unchanged'` (idempotent).
4. **Notification Outbox (`/store-admin/settings/notifications`):**
   - `order_placed`, `payment_received`, and `out_of_stock` (`on_hand = 0`) notifications are queued/sent in `notification_outbox`.
5. **Customer Receipt (`/account/orders/<txnid>/receipt`):**
   - Confirm invoice/receipt renders with the exact ₹1.00 total and item snapshot.

### Step D — Cancel / Refund & Deactivate Smoke SKU
1. In `/store-admin/orders/<txnid>`, initiate the refund/cancellation workflow for the ₹1.00 smoke order (`POST /api/store-admin/orders/<txnid>/cancel` or `/refund`) and record the refund reference.
2. In `/store-admin/products/smoke-verify-item`, set `is_active = false` (unpublish the smoke SKU) and restore normal shipping/storefront settings.
3. Record redacted screenshots and `txnid` in `docs/evidence/final-readiness/production-smoke/`.
