# Staging & Production Rollout Checklist (`docs/staging-checklist.md`)

This runbook covers the staging verification and production cutover for the Gadzio storefront and Store Admin.

---

## 1. Infrastructure & Region Alignment

- [ ] **Supabase Region:** Provision the production Supabase project in **Mumbai (`ap-south-1`)** so database round trips from India are ~2–5 ms instead of ~90–120 ms cross-region.
- [ ] **Vercel Function Region:** Confirm `vercel.json` pins serverless functions to **`bom1` (Mumbai)** (`"regions": ["bom1"]`).
- [ ] **Database Connection Strings:**
  - `DATABASE_URL`: Use the Supabase **Session / Transaction Pooler** connection string with `sslmode=require`.
  - Never expose `DATABASE_URL` or service-role keys in `NEXT_PUBLIC_*` variables.

---

## 2. Required Environment Variables

Verify that the following environment variables are set in Vercel (Staging / Preview and Production) — **names only, never commit values**:

| Variable | Purpose | Required In |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string for server-side queries | Staging & Prod |
| `APP_BASE_URL` | Canonical public `https://` origin (no trailing slash, no path) used to build PayU callback URLs (`surl`, `furl`, `curl`, `webhook`) | Staging & Prod |
| `PAYU_ENV` | `test` on staging; `live` on production | Staging & Prod |
| `PAYU_KEY` | PayU merchant key | Staging & Prod |
| `PAYU_SALT` | PayU merchant salt (server-only) | Staging & Prod |
| `PAYU_RETURN_SECRET` | 32+ byte secret for HMAC-signed return summary tokens (`rt`) when browser cookies drop across cross-site POST redirects | Staging & Prod |
| `CRON_SECRET` | 32+ byte secret authenticating `GET`/`POST /api/payu/reconcile` | Staging & Prod |
| `MAIL_PASSWORD` | SMTP password (when `mail_driver = smtp` and `mail_status = on`) | Optional until email enabled |
| `MAIL_ALLOWED_HOSTS` | Comma-separated allowlist of permitted SMTP hostnames in production | Optional until email enabled |
| `SMS_API_KEY` | MSG91 / Twilio secret key (when `sms_status = on`) | Optional until SMS enabled |

---

## 3. Database Migrations & Security State Verification

1. Run pending migrations in order against the target database:
   ```bash
   npm run db:migrate
   ```
2. Verify all 10 database security invariants (RLS enabled, `anon`/`authenticated` table privileges revoked, column-level grants restricted to safe display columns, append-only triggers active on `store_admin_audit`, `payment_events`, `price_history`, `stock_movements`, `order_status_history`):
   ```bash
   node scripts/check-security-db-state.mjs
   ```
3. Verify all settings tables and notification channel rows are readable:
   ```bash
   node scripts/check-setting-lists.mjs
   ```
4. Run the read-only product options census to confirm zero products are in an inconsistent option/stock state:
   ```bash
   node scripts/review-product-options.mjs
   ```

---

## 4. Automated Pre-Deploy Checks

Run every automated gate before promoting a build:

```bash
npm test
npm run typecheck
npm run build
npm run check:store-admin-routes
npm run check:account-routes
npm run check:admin-boundary
npm run check:field-help
npm run check:links
npm audit
```

---

## 5. PayU End-to-End Staging Verification

Perform these live checks on the public HTTPS staging URL (`APP_BASE_URL`):

1. **Success Round-Trip (`303 See Other`):**
   - Add an optioned product (e.g., iPhone 16 Pro · Black) to the bag, proceed to `/checkout`, apply a valid coupon, and complete a PayU test payment.
   - Confirm `POST /api/payu/success` verifies the hash and server-to-server PayU status, settles the order once, and responds with `303 See Other` to `/order/success?txnid=...&rt=...`.
   - Confirm `/order/success` renders inside the normal site header/footer with separate **Payment: Paid** and **Order: Confirmed** (or **Awaiting confirmation**) chips and bought item photo/options.
2. **Signed Return Link Without Session Cookie:**
   - Open the `/order/success?txnid=...&rt=...` URL in an incognito window (simulating a dropped cross-site session cookie).
   - Confirm the safe order summary (order number, status, amount) renders without exposing PII, and full receipt/invoice views require signing in as the order owner.
3. **One-Active-Checkout Resume & Supersede:**
   - Start a checkout, return to `/checkout` without paying, and click Pay again with the **same** cart/address/coupon — confirm the existing `txnid` is resumed (`resumed: true`) and stock is not double-reserved.
   - Change the quantity or address and click Pay — confirm the previous unpaid attempt is verified with PayU and atomically superseded (`CANCELLED` / `RELEASED`).
   - Confirm a 1-unit item held by the signed-in customer's own active reservation does not show as sold out to that same customer.
4. **Failure, Cancel & Retry:**
   - Trigger a failed or cancelled PayU test payment and confirm `/order/failed` or `/order/cancelled` offers **Try payment again** and restores checkout cleanly.
5. **Webhook & Scheduled Reconciliation (`/api/payu/reconcile`):**
   - Configure the scheduler per `docs/reconcile-scheduling.md` (`GET /api/payu/reconcile` with `Authorization: Bearer <CRON_SECRET>` every 1–2 minutes).
   - Verify on `/store-admin` Overview that **Background jobs → Payment reconciliation** shows a green status and a fresh timestamp within the last 5 minutes.
6. **Receipts, Invoices & Cancelled Shipments:**
   - Before delivery, confirm the customer sees **View Payment receipt** and direct navigation to `?document=invoice` returns **Document unavailable**.
   - Mark the order `ON_THE_WAY` / `DELIVERED` in Store Admin and confirm a sequential invoice number is allocated once and **View / Print invoice** unlocks after `DELIVERED`.
   - Cancel an order that had shipment details prepared and confirm active tracking/courier details are hidden on customer, admin, and packing-slip views (`Shipment cancelled`).
