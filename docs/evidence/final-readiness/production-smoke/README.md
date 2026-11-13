# Step 5 — Controlled Production Payment Smoke-Test Procedure

**Execution Status:** `BLOCKED — DO NOT RUN until separately authorized for one live low-value order + refund.`

> **Hard Safety Gate:** Do **NOT** execute a live payment against `https://secure.payu.in/_payment` or run this procedure in automation right now. This checklist defines the controlled verification protocol to run **only** after the owner explicitly authorizes one small real order and subsequent refund.

---

## 1. Pre-Conditions Before Running

1. **Deployment & Environment Verified (`docs/vercel-deploy-checklist.md` & `docs/GO_LIVE_CHECKLIST.md`):**
   - `vercel.json` is deployed with `"regions": ["bom1"]` (Mumbai, India) matching Supabase `ap-south-1`.
   - Vercel Production environment passes `npm run check:production-env` (`APP_ENV=production`, `PAYU_ENV=live`, `PAYU_BASE_URL=https://secure.payu.in/_payment`, `PAYU_RETURN_SECRET` >= 32 chars, `CRON_SECRET` >= 32 chars, `TRUST_PROXY=1`, `APP_BASE_URL` permanent `https://` origin, `DATABASE_URL` on `:6543`, `MAIL_ALLOWED_HOSTS` set when mail is active).
   - Migrations `0001`–`0073` are applied (`npm run db:migrate`), including `0073_mark_test_order.sql`.
   - External `/api/payu/reconcile` cron (`Authorization: Bearer <CRON_SECRET>`) is running every 1–2 minutes and Overview heartbeat is green.
   - Staging TEST-mode proof, browser run, and load test have already passed.
2. **Storefront & Owner Controls Ready:**
   - Sign in to `/store-admin` as `store_owner` (confirm TOTP 2FA is active on owner account).
   - Keep **Maintenance mode ON** (or limit public visibility to internal operator testing) during the smoke test if the public launch announcement has not started yet.
   - Verify **Store Admin → Settings → Site address health check (`APP_BASE_URL`)** shows **Ready**.

---

## 2. Step-by-Step Procedure (Run Only When Explicitly Authorized)

### Step A — Stage a Small Live Smoke SKU
1. Sign in to `/store-admin` as `store_owner`.
2. Create or temporarily unhide a low-value smoke SKU (e.g., `smoke-verify-item`, price **₹1.00** / `100` paise — or lowest PayU live amount allowed by merchant account, e.g. `₹1.00` or `₹10.00`, `track_inventory = true`, `on_hand = 1`).
3. Confirm shipping settings are predictable (e.g., free shipping or exact expected fee) and the product renders cleanly at `/shop/product/smoke-verify-item`.

### Step B — Place One Small Real Order
1. Sign in to the storefront as the designated operator customer account at `/auth` (or test checkout flow end-to-end).
2. Add `quantity = 1` of the smoke SKU to bag and open `/checkout`.
3. Submit payment (`POST /api/payu/initiate`):
   - Verify redirect reaches `https://secure.payu.in/_payment` cleanly (zero SSL/redirect errors, zero `"Site can't be reached"`).
   - Record only the order `txnid` and `order_number` (never log keys, salts, hashes, or card/UPI details).
4. Complete the small real payment using an authorized operator payment method.

### Step C — Verify Live Callbacks, Settlement, Outbox & Heartbeat
1. **Browser Return (`POST /api/payu/success`):**
   - Confirm `303 See Other` redirect to `/order/success?txnid=<txnid>&rt=<token>` with **Payment: Paid** and clean rendering (also test `/order/success?txnid=...&rt=...` in a fresh incognito window to verify signed cross-site `rt` token behavior).
2. **Webhook Idempotency (`POST /api/payu/webhook`):**
   - Open `/store-admin/orders/<txnid>` → **Payment events**: confirm `paid` outcome and verify any duplicate redirect/webhook delivery records `unchanged` (single stock deduction, zero double capture).
3. **Order, Stock & Counters State:**
   - `orders.status = 'PAID'`, `orders.reservation_state = 'CONSUMED'`, `orders.payu_mihpayid` populated, sequential `order_number` incremented properly.
   - `stock.on_hand` decremented (`1 -> 0`) and one `stock_movements` (`sale`, `-1`) row written.
4. **Customer Receipt & Notification Outbox:**
   - Open `/account/orders/<txnid>/receipt` (signed in as buyer) and verify receipt matches paid total.
   - Open `/store-admin/settings/notifications`: verify `order_placed` and `payment_received` email/SMS rows processed cleanly with SPF/DKIM/DMARC passing on delivered mail headers.
   - Open `/store-admin` Overview: confirm `payu_reconcile` heartbeat remains green within 5 minutes.

### Step D — Process Live Refund & Mark Smoke Order as Test (Option A)
1. **Issue Real Refund:**
   - Open `/store-admin/orders/<txnid>` and trigger the refund/cancellation flow (`POST /api/store-admin/orders/<txnid>/refund` or cancel + refund, plus PayU Merchant Dashboard refund confirmation if manual bank/UPI settlement step is needed), recording the refund reference only (no raw gateway payload in docs).
   - Verify `refunds` row / `SaleState = REFUNDED` (or `CANCELED` + refund recorded) and stock restored cleanly (`release`/`restore` movement) without touching invoice immutability.
2. **Mark Smoke Order as Test Order (Option A Clean Books):**
   - On `/store-admin/orders/<txnid>` as `store_owner`, use **Test order classification → Mark as test order** (`POST /api/store-admin/orders/<txnid>/test-order`) with audit reason (e.g., `"Authorized post-deploy ₹1 live payment smoke verification"`).
   - Confirm `/store-admin` Overview, Customers, and Reports exclude the smoke order while `/store-admin/orders` keeps the full audit record (`Test order` badge, continuous `order_number` preserved).
3. **Clean Up Storefront:**
   - Unpublish / deactivate `smoke-verify-item` (`is_active = false`), restore normal store settings, confirm **Maintenance mode** state matches launch readiness, and archive redacted verification notes in `docs/evidence/final-readiness/production-smoke/`.
