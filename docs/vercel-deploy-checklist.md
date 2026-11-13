# Vercel Deploy Checklist (`docs/vercel-deploy-checklist.md`)

This runbook covers the complete Vercel + Supabase + PayU + Resend deployment setup for **Gadzio**, from initial **Staging (Preview)** deployment through **Production** cutover (Option A — keeping the existing Mumbai Supabase project and using migration `0073_mark_test_order.sql` to isolate pre-launch test orders from analytics/reports without deleting or renumbering any row).

> **Security rule:** Never commit or print actual keys, salts, passwords, or database URLs. Every table below lists variable **names** and **example shapes** only.

---

## 1. Vercel Project Settings

Configure under **Vercel Project → Settings**:

| Setting | Value | Notes |
|---|---|---|
| **Framework Preset** | `Next.js` | Detected automatically (`next.config.ts` in repo root). |
| **Root Directory** | `.` (repository root) | `package.json` and `vercel.json` sit at the repo root. |
| **Function Region** | **`bom1` (Mumbai, India)** | Pinned in `vercel.json` (`"regions": ["bom1"]`) to match Supabase `ap-south-1` (Mumbai) and keep DB round-trips ~1–3 ms. Also set **Functions → Function Region = Mumbai (`bom1`)** in Project Settings so UI and `vercel.json` agree. |
| **Node.js Version** | **`22.x` or `24.x` (Active LTS)** | Verified locally on Node `v24.18.0`; `package.json` uses ES modules/Node built-ins compatible with Vercel's active Node LTS (`22.x` / `24.x`). Pin via Vercel Settings (`22.x` or `24.x`) if not locked in `.nvmrc`. |
| **Install Command** | `npm ci` (or default `npm install`) | `package-lock.json` is committed cleanly (`0` `npm audit` vulnerabilities). |
| **Build Command** | `npm run build` | Default Next.js build (`next build`). Do **not** run `db:migrate` inside the Vercel build step because Vercel runtime uses port `6543` (`DATABASE_URL`), while migrations require `5432` (`DATABASE_MIGRATION_URL`) with explicit approval. |
| **Output Directory** | `.next` (default) | Managed by Next.js preset. |
| **Branch Configuration** | **Production Branch:** `main`<br>**Staging Branch:** e.g. `staging` or PR branch previews | Never push directly to `main` until staging proof passes; deploy PR/staging branch first. |

---

## 2. Deployment Protection Settings (Critical for PayU Callbacks on Staging)

PayU sends cross-site `POST` browser redirects (`surl`, `furl`, `curl`) and server-to-server webhook `POST` requests directly from `test.payu.in` / PayU servers without a Vercel login session. **If Vercel Deployment Protection blocks unauthenticated requests on your staging URL, every PayU callback will fail with HTTP 401/403 ("Site can't be reached" / blocked callback).**

Configure under **Vercel Project → Settings → Deployment Protection**:

1. **Staging / Preview URL (required during PayU TEST proof):**
   - Option 1 *(simplest for a dedicated custom staging domain)*: Attach a custom staging domain (for example `staging.gadzio.co.in` or your assigned preview alias) and either set **Vercel Authentication → Only Preview Deployments** with a domain exemption if supported, OR temporarily disable Vercel Authentication on the dedicated staging project/environment while keeping:
     - Store Admin behind `/store-admin/login` + HTTP-only `store_admin_session` + owner TOTP 2FA
     - Customer account behind `/auth` + `user_session`
     - Storefront behind Store Admin **Maintenance mode (`ON`)** (with secret preview bypass cookie or internal test access) if you don't want public browsing before launch
     - `/api/payu/reconcile` guarded by `Authorization: Bearer <CRON_SECRET>` (32+ chars)
   - Option 2 *(if your Vercel plan supports **Protection Bypass for Automation** on Preview deployments)*: Note that PayU **cannot** inject a `x-vercel-protection-bypass` header into `POST /api/payu/success`, `/api/payu/failure`, `/api/payu/cancel`, or `/api/payu/webhook` unless query parameters are stripped cleanly — and PayU hash verification + `txnid` lookups expect clean route URLs without surprise auth interstitials. Therefore, for live PayU callback testing (`POST` forms & webhooks), the staging hostname configured in `APP_BASE_URL` **must allow public unauthenticated HTTPS reachability** to `/api/payu/*` and `/order/*`.
2. **Production Domain:**
   - **Vercel Authentication:** `Disabled` on Production so real shoppers and PayU `https://secure.payu.in` callbacks reach the site directly.

---

## 3. Environment Variables: Staging vs Production

Configure under **Vercel Project → Settings → Environment Variables**, scoped strictly to **Preview (Staging)** vs **Production** (names match `.env.example` and `src/lib/platform/production-env.ts`):

| Variable Name | Staging (`Preview`) Where & Shape | Production (`Production`) Where & Shape | What Breaks If Missing or Wrong |
|---|---|---|---|
| `APP_ENV` | `staging` | `production` | `check:production-env` and the payment initiation guard (`/api/payu/initiate`) fail closed; mismatch blocks PayU checkout or permits unsafe host/key combinations. |
| `APP_BASE_URL` | `https://staging.gadzio.co.in` *(your public HTTPS staging host; NO trailing slash, NO path, NO tunnel host)* | `https://gadzio.co.in` *(canonical permanent HTTPS origin; NO trailing slash or path)* | PayU `surl`/`furl`/`curl`/`webhook` URLs, metadata/OpenGraph links, and transactional email links fail closed or redirect users to the wrong/unreachable origin. |
| `DATABASE_URL` | Supabase **Transaction Pooler** (`port 6543`, `?sslmode=require`) | Supabase **Transaction Pooler** (`port 6543`, `?sslmode=require`) | Direct/Session port `5432` exhausts serverless connections under load; missing `?sslmode=require` fails TLS; `check:production-env` rejects non-`6543` ports. |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<staging-or-prod-ref>.supabase.co` | `https://<prod-ref>.supabase.co` | Storage media URLs and Supabase client helpers fail. (With Option A single DB, both use your existing project URL unless a dedicated staging DB is spun up.) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable `sb_publishable_...` / anon key | Publishable `sb_publishable_...` / anon key | Client storage/SDK initialization fails (note: sensitive tables `users`, `user_sessions`, `orders` keep RLS blocking anon reads!). |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role secret | Server-only service role secret | Admin media uploads/storage object writes fail. Never expose with `NEXT_PUBLIC_`. |
| `PAYU_ENV` | **`test`** | **`live`** | `APP_ENV=staging` forbids `live` (throws before payment init); `APP_ENV=production` rejects `test` so real customers are never sent to sandbox. |
| `PAYU_BASE_URL` | **`https://test.payu.in/_payment`** *(must resolve host `test.payu.in`)* | **`https://secure.payu.in/_payment`** *(must resolve host `secure.payu.in`)* | `check:production-env` and `/api/payu/initiate` fail closed if URL host contradicts `APP_ENV` / `PAYU_ENV`. |
| `PAYU_KEY` | PayU **Test Mode** Merchant Key | PayU **Live Mode** Merchant Key | Hash mismatch on PayU checkout (`Sorry, hash didn't match`) or `verify_payment` errors. |
| `PAYU_SALT` | PayU **Test Mode** Merchant Salt | PayU **Live Mode** Merchant Salt | Payment initiation and callback/webhook signature verification fail with hash errors. |
| `PAYU_RETURN_SECRET` | Random 32+ char hex/base64 secret *(distinct from production)* | Random 32+ char hex/base64 secret *(unique to production)* | Short/missing secret fails `check:production-env` and blocks payment start; shoppers whose cross-site `SameSite` session cookie drops on `303` POST return cannot view `/order/success` summary. |
| `CRON_SECRET` | Random 32+ char secret *(distinct from production)* | Random 32+ char secret *(unique to production)* | Short/missing secret fails `check:production-env`; `/api/payu/reconcile` rejects requests with `401 Unauthorized` and Overview heartbeat turns red (`Stale`). |
| `TRUST_PROXY` | **`1`** | **`1`** | Required on Vercel by `check:production-env`. If unset/`0`, IP rate limiting sees proxy IPs or rejects proxied headers incorrectly. |
| `MAIL_PASSWORD` | Resend SMTP API key *(or blank while mail off on staging)* | Resend SMTP API key *(when `mail_status=on`)* | Outbox email sends fail authentication; Store Admin → Email & SMS retries stay `FAILED`. |
| `MAIL_ALLOWED_HOSTS` | `smtp.resend.com` | `smtp.resend.com` | Required by `check:production-env` when mail is active; prevents outbound SSRF/host tampering via DB settings. |
| `DATABASE_MIGRATION_URL` | **Not set in Vercel Runtime** *(local/CI `.env.local` only, `:5432`)* | **Not set in Vercel Runtime** *(local/CI only, `:5432`)* | Runtime queries must stay on pooler `:6543`; only `npm run db:migrate` uses `DATABASE_MIGRATION_URL` (`:5432`). |
| `SMS_API_KEY` / `MSG91_AUTH_KEY` / `TWILIO_*` | *(Optional, Preview/Staging)* | *(Optional, when SMS is enabled)* | Leave unset unless SMS channel is enabled in Store Admin → Settings → Notifications. |
| `NOTIFICATION_RETENTION_ENABLED` | `false` *(optional)* | `true` or `false` *(optional)* | Controls whether `/api/payu/reconcile` scrubs PII on terminal `notification_outbox` rows older than `NOTIFICATION_RETENTION_DAYS`. |

> **Option A isolation note (using this Supabase DB for production):** While testing on **Staging (Preview)** before go-live, keep staging pointed at either a separate staging Supabase DB or, if exercising staging checkout against this single Option A DB, remember **only sandbox/test actions are authorized** and mark any staging QA orders with the owner-only **"Mark as test order"** action (migration `0073`) so they stay excluded from revenue, overview, customers, and reports without renumbering (`order_number_counters` / `invoice_number_counters` remain continuous).

---

## 4. Custom Domains & DNS

1. Add the **Production** domain (e.g. `gadzio.co.in` and `www.gadzio.co.in` → redirect `www` to apex, matching `APP_BASE_URL`) under **Vercel Project → Settings → Domains**.
2. Add the **Staging** custom domain (e.g. `staging.gadzio.co.in` pointed to the Preview/Staging branch, or use Vercel's assigned public Preview URL if Deployment Protection allows PayU POST callbacks) and set Staging `APP_BASE_URL` to that exact `https://` origin.
3. Confirm TLS certificate issuance is **Valid (green)** before submitting any URL to PayU.

---

## 5. PayU Dashboard Configuration (Test First, Then Live)

### Stage 1 — Staging Verification (`PAYU_ENV=test`)
1. Sign in to **PayU Merchant Dashboard** and switch the top toggle to **Test Mode**.
2. Open **Developer → API Keys** to get Test `PAYU_KEY` and Test `PAYU_SALT`.
3. Under **Settings → Webhooks** (Test Mode), register:
   - **Successful Payment Webhook URL:** `https://<staging-host>/api/payu/webhook`
   - **Failed / Cancelled Webhook URL:** `https://<staging-host>/api/payu/webhook`
   *(Browser returns `surl`, `furl`, `curl` are generated dynamically per order from `APP_BASE_URL`: `/api/payu/success`, `/api/payu/failure`, `/api/payu/cancel`.)*

### Stage 2 — Production Cutover (`PAYU_ENV=live`)
1. Switch the PayU Dashboard top toggle to **Live Mode**.
2. Confirm KYC/website URL whitelist in PayU matches your exact production domain (`APP_BASE_URL`, e.g. `https://gadzio.co.in`).
3. Copy Live `PAYU_KEY` and Live `PAYU_SALT` into **Vercel Production Environment Variables** only.
4. Register Live **Settings → Webhooks**:
   - **Webhook URL:** `https://<production-domain>/api/payu/webhook`
   - Enable **Payment Success** and **Payment Failed / Cancelled** server-to-server events.

---

## 6. Email Domain Authentication (Resend DNS Records)

Before turning `mail_status = 'on'` in Store Admin → Settings:

1. Add your sending domain in **Resend Dashboard → Domains** (e.g. `gadzio.co.in` or `send.gadzio.co.in`).
2. Add the exact DNS records provided by Resend:
   - **SPF:** `TXT` + return-path `MX` record on the sending host (ensure only ONE `v=spf1` record exists on that host; merge `include:` directives if another sender already uses it).
   - **DKIM:** All Resend `TXT`/`CNAME` DKIM key records (`resend._domainkey...`).
   - **DMARC:** `_dmarc.<root-domain>` `TXT` (`v=DMARC1; p=none; rua=mailto:dmarc@<root-domain>; adkim=r; aspf=r`, later tighten to `p=quarantine`/`p=reject`).
3. Confirm Resend shows **Verified** for both SPF and DKIM, set `MAIL_ALLOWED_HOSTS=smtp.resend.com` and `MAIL_PASSWORD=<Resend API Key>` in Vercel, and set SMTP host = `smtp.resend.com`, port = `465`/`587`, username = `resend` in Store Admin → Settings → Notifications.

---

## 7. Cron & Background Reconciliation Choice

Because `vercel.json` **intentionally omits `"crons"`** (Vercel Hobby rejects every-minute cron schedules and caps cron jobs at 1/day — see `docs/reconcile-scheduling.md`):

- **Chosen Pattern:** External cron scheduler (**`cron-job.org`**, Upstash QStash, or Supabase **`pg_cron` + `pg_net`**) invoking **`GET /api/payu/reconcile`** every **1–2 minutes** (maximum 5 minutes before Overview heartbeat flags red):
  - **Method:** `GET` (or `POST`)
  - **URL:** `<APP_BASE_URL>/api/payu/reconcile`
  - **Header:** `Authorization: Bearer <CRON_SECRET>`
- **Upgrade option:** If moving to Vercel Pro later, you may optionally add `crons` (`* * * * *` -> `/api/payu/reconcile`) in `vercel.json`; the endpoint is lease-locked (`FOR UPDATE SKIP LOCKED`, 180s lease) so even transient overlap is safe.

---

## 8. Step-by-Step Deployment Order

1. **Apply Pending Database Migration (`0073`) & Role Timeouts (Approved DB Window Only):**
   - Run `npm run db:migrate` locally against `DATABASE_MIGRATION_URL` (`:5432`) so `0073_mark_test_order.sql` (`71` migrations `0001`–`0073`) is applied.
   - Run the `idle_in_transaction_session_timeout = '30s'` SQL for `postgres` and `authenticator` in Supabase SQL Editor (`docs/GO_LIVE_CHECKLIST.md §1`) if not yet applied on the target project.
   - Re-run `node --env-file=.env.local scripts/check-security-db-state.mjs` (`10/10` pass) and `node --env-file=.env.local scripts/verify-rls-consumer-tables.mjs`.
2. **Validate Production/Staging Env Config Locally:**
   - Run `npm run check:production-env` against your staging env vars first, then against your production env set (reports variable names and lengths only).
3. **Deploy Staging (Preview / `staging` branch or PR):**
   - Push branch, ensure Staging Vercel Environment Variables (`APP_ENV=staging`, `PAYU_ENV=test`, `PAYU_BASE_URL=https://test.payu.in/_payment`) are saved, and confirm Deployment Protection does not block `/api/payu/*` or `/order/*`.
   - Start external `/api/payu/reconcile` cron targeting Staging and verify Store Admin Overview heartbeat turns green.
   - **Run Staging Proof Suite** once you provide the staging URL:
     - PayU TEST-mode callback proof (real browser redirects + webhook + `/order/success` render — confirm `"Site can't be reached"` is resolved)
     - Signed-in browser suite & load test
     - Mark pre-launch test orders (`is_test = true`) via **Store Admin → Orders → [order] → Mark as test order** (owner-only, audited) and verify Overview/Customers/Reports drop to clean `0` baseline while Orders preserves full history and invoice/order numbering.
4. **Merge PR to `main` & Deploy Production:**
   - Review PR (`traycer/lucky-otter` → `main`), merge in GitHub once staging proof passes, verify Vercel Production environment variables (`APP_ENV=production`, `PAYU_ENV=live`, `PAYU_BASE_URL=https://secure.payu.in/_payment`), and check Store Admin → Settings → **Site address health check (`APP_BASE_URL`)** shows **Ready**.
5. **Cut Over Scheduler & Run Controlled Production Smoke (`production-smoke/README.md`):**
   - Point `/api/payu/reconcile` scheduler (every 1–2 min) to `<Production APP_BASE_URL>/api/payu/reconcile`.
   - Enable Resend mail (`mail_status=on`) and verify SPF/DKIM/DMARC.
   - Only when separately authorized, execute the 1-order ₹1 live smoke test and refund.

---

## 9. Rollback Procedure

- **Application Code Rollback (Zero DB Risk):**
  - In **Vercel Dashboard → Deployments**, open the previous known-good deployment and click **Instant Rollback / Promote to Production** (`~10–30s`).
  - All recent migrations (`0068`–`0073`) are additive; older app code tolerates the new columns cleanly.
- **Database Rollback Policy (Forward-Only):**
  - **Never write or run `DOWN` migrations against production.** All migrations in `migrations/` are additive.
  - If a query or new feature regresses after launch:
    1. Immediately pause traffic using **Store Admin → Settings → Storefront → Maintenance mode (`ON`)** or revert app deployment via Vercel **Promote**, and/or disable Payments (`payu_enabled = off`) or Mail (`mail_status = off`).
    2. Write and apply a **forward fix migration** (`0074_...sql`), or restore from Supabase's scheduled backup / Point-in-Time Recovery (PITR) only in a catastrophic data event.
  - For accidental `"Mark as test order"` actions: owner simply clicks **Unmark test order** with an audit reason (instant, non-destructive).

---

## 10. First-Week Watch List

Monitor daily during the first 7 days after go-live:

1. **Overview → Needs Attention & Background Jobs:** Confirm `payu_reconcile` heartbeat stays green (`< 5m` old), zero `flagged_payments` (`payment_review_required`), zero `stuck_verifying` orders (`status='PROCESSING'`), and zero `refund_obligations` lingering `PENDING`.
2. **Overview KPI Parity vs Reports CSV:** Spot-check Revenue, Orders, and Refunds against PayU settlement dashboard (`Reconciliation` report in `/store-admin/reports`) and confirm test-marked orders (`Test order` badge) remain excluded.
3. **Notification Outbox (`/store-admin/settings/notifications`):** Confirm `notification_outbox` has zero growing `FAILED` backlog (especially `order_placed`, `payment_received`, and password resets) and Resend bounce/complaint rate stays `< 0.1%`.
4. **Supabase Pooler & Locks (`npm run check:db-clientread` + Supabase Health):** Watch `pg_stat_activity` for zero `idle in transaction` locks (`> 30s`) and zero `ClientRead` pooler stalls on `:6543`.
5. **Vercel Function Logs (`/api/payu/*`):** Verify zero `5xx` responses on `/api/payu/initiate`, `/success`, `/failure`, `/cancel`, `/webhook`, and `/reconcile`.
6. **Store Admin Security Audit (`/store-admin/audit`):** Review privileged events (`order.test.mark`, reveals, role changes, two-factor resets) and verify every `store_owner` account has TOTP 2FA enabled.

