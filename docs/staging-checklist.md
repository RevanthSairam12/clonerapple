# Staging & Production Rollout Checklist (`docs/staging-checklist.md`)

This runbook covers the staging verification and production cutover for the Gadzio storefront and Store Admin.

---

## 1. Infrastructure & Region Alignment

- [ ] **Supabase Region:** Provision the production Supabase project in **Mumbai (`ap-south-1`)** so database round trips from India are ~2–5 ms instead of ~90–120 ms cross-region.
- [ ] **Vercel Function Region:** Confirm `vercel.json` pins serverless functions to **`bom1` (Mumbai)** (`"regions": ["bom1"]`).
- [ ] **Database Connection Strings:**
  - `DATABASE_URL`: Use the Supabase **Transaction Pooler** connection string on port `6543` with `sslmode=require`.
  - `DATABASE_MIGRATION_URL`: Use the Supabase **Session Pooler** connection string on port `5432` with `sslmode=require` (required for `npm run db:migrate` and administrative scripts).
  - Never expose `DATABASE_URL`, `DATABASE_MIGRATION_URL`, or service-role keys in `NEXT_PUBLIC_*` variables.

---

## 2. Two Ways to Obtain a Public HTTPS Address (`APP_BASE_URL`) for Staging

PayU requires `APP_BASE_URL` to be a publicly reachable `https://` origin (no path, no query string) so browser `POST` returns (`surl`, `furl`, `curl`) and server-to-server webhooks (`/api/payu/webhook`) can reach the application.

### Option A — `cloudflared` Quick Tunnel on Windows (Local Production Server)

Use this when running the production build locally on Windows (`http://localhost:3000`) to test real PayU sandbox callbacks without deploying to Vercel first:

1. **Install `cloudflared` on Windows:**
   ```powershell
   winget install --id Cloudflare.cloudflared -e --source winget
   ```
   *(Alternatively, download `cloudflared-windows-amd64.exe` from the official `cloudflare/cloudflared` GitHub Releases page.)*
2. **Build and start the local production server on port 3000:**
   ```powershell
   npm run build
   npm run start
   ```
3. **Start the HTTPS tunnel in a second PowerShell window:**
   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```
4. **Configure `APP_BASE_URL` in `.env.local`:**
   - Copy the generated `https://<random-words>.trycloudflare.com` origin printed by `cloudflared` (origin only, no trailing slash or path).
   - Set `APP_BASE_URL=https://<random-words>.trycloudflare.com` and `PAYU_ENV=test` in `.env.local`, then restart `npm run start`.
   - **Safety guard:** Temporary tunnel hosts (`*.trycloudflare.com`, `*.ngrok-free.app`, `*.loca.lt`, etc.) are permitted **only** when `PAYU_ENV=test`. When `PAYU_ENV=production` or `live`, `resolveAppBaseUrl()` and `POST /api/payu/initiate` automatically refuse tunnel hosts (`code: 'tunnel_in_production'`).

### Option B — Vercel Staging Deployment in Mumbai (`bom1`)

Use this for full staging verification and concurrent load testing (`docs/load-test-runbook.md`):

1. **Deploy to Vercel (`bom1`):**
   - Link the repository to a Vercel project and confirm `vercel.json` contains `"regions": ["bom1"]` so Next.js serverless functions execute in Mumbai (`bom1`) alongside the `ap-south-1` Supabase database.
   - Assign a stable staging domain/alias (for example, `https://staging.gadzio.in` or the branch alias `https://<branch>-<project>.vercel.app`) and set `APP_BASE_URL` to that exact `https://` origin with `PAYU_ENV=test`.
2. **Configure Vercel Deployment Protection So PayU Callbacks Are Not Blocked:**
   - By default, Vercel Preview deployments enable **Vercel Authentication** (or Password Protection), which intercepts unauthenticated incoming requests with HTTP `401` / SSO login redirects.
   - Because PayU's gateway servers (`test.payu.in`) and cross-site browser form `POST` redirects (`POST /api/payu/success`, `/api/payu/failure`, `/api/payu/cancel`, `/api/payu/webhook`) do not carry a Vercel SSO cookie, **Vercel Deployment Protection will block PayU callbacks with HTTP 401** if left active on the staging URL.
   - In **Vercel Dashboard → Project Settings → Deployment Protection**:
     - Disable **Vercel Authentication** and **Password Protection** for the staging environment during PayU verification, **or** promote the staging build to a dedicated staging project's Production domain where Deployment Protection does not gate public traffic (or configure a Vercel WAF/Deployment Protection bypass rule allowing unauthenticated `GET`/`POST` requests to `/api/payu/*`).
3. **Verify Reachability from Store Admin:**
   - Sign in as `store_owner` and open **Store Admin → Settings → Payments → Site address health check (`APP_BASE_URL`)** → click **Check site address** (`POST /api/store-admin/site-address-check`).
   - Confirm the diagnostic reports **Reachable: Yes (HTTP 200)** and **HTTPS: HTTPS** (if Deployment Protection is blocking the URL, the diagnostic flags `HTTP 401 / 403`).

---

## 3. PayU Test Dashboard Setup & Official Test Card Documentation

### A. PayU Test Dashboard Steps
1. Sign in to the **PayU Merchant Dashboard** (`onboarding.payu.in` / `dashboard.payu.in`) and switch the environment toggle in the top header to **Test Mode**.
2. Open **Developer → API Keys** (or **Integration → API Details**) and copy:
   - **Merchant Key** → set as `PAYU_KEY`
   - **Merchant Salt (v1 / 32-bit)** → set as `PAYU_SALT`
   - Set `PAYU_ENV=test` and `PAYU_BASE_URL=https://test.payu.in`.
3. *(Optional — Server-to-Server Webhooks)* Open **Settings → Webhooks** in the PayU Test Dashboard and register:
   - **Webhook URL:** `<APP_BASE_URL>/api/payu/webhook`
   - **Events:** Payment Successful, Payment Failed / User Cancelled.
   *(Note: Browser returns use the per-transaction `surl`, `furl`, and `curl` fields signed in `POST /api/payu/initiate` automatically.)*

### B. Where to Find PayU's Official Test-Mode Card & UPI Details
- **Never invent or hardcode card numbers.**
- Look up the current official PayU sandbox test card numbers, expiry dates, CVVs, netbanking simulator credentials, and test UPI VPA handles in PayU's official developer documentation:
  1. **PayU Developer Documentation (`https://docs.payu.in`)** → navigate to **Payment Gateway → Getting Started → Test Your Integration / Test Cards & UPI Credentials**.
  2. Or from inside the **PayU Merchant Dashboard (Test Mode)** → click **Developer → Test Credentials / Help & Docs**, which lists the active sandbox Visa/Mastercard/RuPay test cards and simulated OTP (`123456` or the simulator page's **Approve / Simulate Failure** button on `test.payu.in`).

---

## 4. Required Environment Variables

Verify that the following environment variables are set in Vercel (Staging / Preview and Production) — **names only, never commit values**:

| Variable | Purpose | Required In |
|---|---|---|
| `DATABASE_URL` | PostgreSQL Transaction Pooler connection string (`:6543`, `sslmode=require`) for server-side queries | Staging & Prod |
| `DATABASE_MIGRATION_URL` | PostgreSQL Session Pooler connection string (`:5432`, `sslmode=require`) for migrations and schema scripts | Staging & Prod |
| `APP_BASE_URL` | Canonical public `https://` origin (no trailing slash, no path) used to build PayU callback URLs (`surl`, `furl`, `curl`, `webhook`) | Staging & Prod |
| `PAYU_ENV` | `test` on staging; `live` (or `production`) on production | Staging & Prod |
| `PAYU_KEY` | PayU merchant key | Staging & Prod |
| `PAYU_SALT` | PayU merchant salt (server-only) | Staging & Prod |
| `PAYU_RETURN_SECRET` | 32+ byte secret for HMAC-signed return summary tokens (`rt`) when browser cookies drop across cross-site POST redirects | Staging & Prod |
| `CRON_SECRET` | 32+ byte secret authenticating `GET`/`POST /api/payu/reconcile` | Staging & Prod |
| `MAIL_PASSWORD` | SMTP password (when `mail_driver = smtp` and `mail_status = on`) | Optional until email enabled |
| `MAIL_ALLOWED_HOSTS` | Comma-separated allowlist of permitted SMTP hostnames in production | Optional until email enabled |
| `SMS_API_KEY` | MSG91 / Twilio secret key (when `sms_status = on`) | Optional until SMS enabled |

---

## 5. Database Migrations & Security State Verification

1. Run pending migrations in order against the target database:
   ```bash
   npm run db:migrate
   ```
2. Verify all 10 database security invariants (RLS enabled, `anon`/`authenticated` table privileges revoked, column-level grants restricted to safe display columns, append-only triggers active on `store_admin_audit`, `payment_events`, `price_history`, `stock_movements`, `order_status_history`):
   ```bash
   node scripts/check-security-db-state.mjs
   ```
3. Verify zero sessions are stuck in `ClientRead` on the transaction pooler:
   ```bash
   npm run check:db-clientread
   ```
4. Verify all settings tables and notification channel rows are readable:
   ```bash
   node scripts/check-setting-lists.mjs
   ```
5. Run the read-only product options census to confirm zero products are in an inconsistent option/stock state:
   ```bash
   node scripts/review-product-options.mjs
   ```

---

## 6. Automated Pre-Deploy Checks

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

## 7. PayU End-to-End Staging Verification

Perform these live checks on the public HTTPS staging URL (`APP_BASE_URL`):

1. **Success Round-Trip (`303 See Other`):**
   - Add an optioned product (e.g., iPhone 16 Pro · Black) to the bag, proceed to `/checkout`, apply a valid coupon, and complete a PayU test payment using an official PayU test card from `docs.payu.in`.
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
