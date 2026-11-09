# Production Go-Live Checklist (`docs/GO_LIVE_CHECKLIST.md`)

This is the authoritative pre-launch and cutover gate checklist for the Gadzio storefront and Store Admin. Every item must be checked off before switching `PAYU_ENV` to production (`live` / `production`) and opening the storefront to public traffic.

---

## 1. Regional Topology & Database Pooler Configuration

- [ ] **Supabase Region (`ap-south-1`):** Production database is provisioned in **Mumbai, India (`ap-south-1`)**.
- [ ] **Vercel Function Region (`bom1`):** `vercel.json` pins `"regions": ["bom1"]` (Mumbai, India) so serverless functions execute in the same region as Supabase (`~1–3 ms` single-statement RTT).
- [ ] **Connection Strings (`DATABASE_URL` vs `DATABASE_MIGRATION_URL`):**
  - `DATABASE_URL` uses the **Transaction Pooler** on port `6543` (`sslmode=require`).
  - `DATABASE_MIGRATION_URL` uses the **Session Pooler** on port `5432` (`sslmode=require`) for `npm run db:migrate` and schema scripts (`resolveMigrationDatabaseUrl` refuses port `6543`).
  - `"postgres": "3.4.9"` is pinned in `package.json` and `package-lock.json`, and `disablePoolerPipelining` is active in `src/lib/platform/db.ts` (`DATABASE_DISABLE_POOLER_NO_PIPELINE` unset).
- [ ] **Role Timeouts:** `idle_in_transaction_session_timeout = '30s'` is configured on `postgres` and `authenticator` roles (`migrations/0067_db_connection_decisions.sql`).

---

## 2. Schema Migrations, RLS & Security Verification

Run against the production database before cutover:

- [ ] `npm run db:migrate` — all 65 migrations (`0001`–`0067`) applied cleanly.
- [ ] `node --env-file=.env.local scripts/check-security-db-state.mjs` — all `10/10` checks pass (`MIG-1`, `PRIV-1`, `COLS-anon-allow`, `COLS-anon-deny`, `COLS-authenticated-allow`, `COLS-authenticated-deny`, `PRIV-2`, `RLS-1`, `VIEW-1`, `GUARD-1`).
- [ ] `node --env-file=.env.local scripts/verify-rls-consumer-tables.mjs` — `users`, `user_sessions`, `orders`, `order_sale_state`, `products.cost_paise`, and `schema_migrations` return HTTP `401` to the publishable key.
- [ ] `npm run check:db-clientread` — `stuckClientReadCount: 0` in `pg_stat_activity`.

---

## 3. Data Migration & Storage Parity (`DATA_MIGRATION_REPORT.md`)

- [ ] `node --env-file=.env.local scripts/verify-migrated-data.mjs` confirms 100% SHA-256 canonical parity across all 52 kept tables (`content_blocks`, `site_settings`, `store_settings`, `categories`, `products`, `product_images`, `stock`, `payment_methods`, reason lists, notification matrix, and owner `store_admins` account).
- [ ] All objects in the public `media` bucket are present with matching sizes and SHA-256 checksums.
- [ ] Transactional tables (`orders`, `users`, `user_sessions`, `payment_events`, `notification_outbox`) start clean on production; `order_number_counters`, `receipt_counters`, and `invoice_number_counters` are initialized.

---

## 4. Production Environment Variables & Site Address Health Check

- [ ] **`APP_BASE_URL`:** Set to the permanent production HTTPS origin (e.g. `https://gadzio.in`) — no path, no query string, not `localhost`, and **not** a temporary tunnel host (`*.trycloudflare.com`, `*.ngrok-free.app`, etc.).
- [ ] **`PAYU_ENV`:** Set to `live` (or `production`), with live `PAYU_KEY` and `PAYU_SALT`.
- [ ] **`PAYU_RETURN_SECRET`:** Set to a 32+ character cryptographic secret for signed cross-site return links (`rt`).
- [ ] **`CRON_SECRET`:** Set to a 32+ character secret for `GET /api/payu/reconcile`.
- [ ] **`TRUST_PROXY`:** Set to `1` on Vercel so `clientIpFromRequest` reads the platform-supplied forwarded client IP.
- [ ] **`MAIL_ALLOWED_HOSTS` & `MAIL_PASSWORD`:** Set when SMTP delivery is enabled in Store Admin → Settings → Email & SMS.
- [ ] **Owner Diagnostic (`POST /api/store-admin/site-address-check`):** In Store Admin → Settings → Payments → **Site address health check (`APP_BASE_URL`)**, click **Check site address** and confirm:
  - **Reachable:** `Yes (HTTP 200)`
  - **HTTPS:** `HTTPS`
  - **Host type:** `Permanent host`
  - **Production ready:** `Ready`

---

## 5. Automated Pre-Deploy Verification Suite

All checks must pass with zero errors:

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run check:store-admin-routes`
- [ ] `npm run check:account-routes`
- [ ] `npm run check:admin-boundary`
- [ ] `npm run check:field-help`
- [ ] `npm run check:links`
- [ ] `npm run check:secrets`
- [ ] `npm audit` (`0` vulnerabilities)
- [ ] `git diff --check`

---

## 6. Background Reconcile Scheduler (`docs/reconcile-scheduling.md`)

- [ ] Configure the 1–2 minute scheduler calling `GET <APP_BASE_URL>/api/payu/reconcile` with header `Authorization: Bearer <CRON_SECRET>`.
- [ ] Confirm on `/store-admin` Overview that **Background jobs → Last reconcile run** turns green (`OK`) within 5 minutes.

---

## 7. Staging Proof & Controlled Production Payment Smoke Test

- [ ] Complete the staging PayU round-trip verification in `docs/staging-checklist.md` §7.
- [ ] Once explicitly authorized by the store owner, execute the ₹1.00 controlled production payment smoke test in `docs/evidence/final-readiness/production-smoke/README.md`, then cancel/refund the test order and unpublish the smoke SKU.

---

## 8. Accepted Risks & Post-Launch Scaling Notes

- [ ] **Shared Rate Limiter (`src/lib/payu/rate-limit.ts`):** `checkRateLimit` uses an in-process sliding window with the `RateLimitStore` interface seam. Before scaling horizontally across multiple serverless instances under sustained attack, back `RateLimitStore` with Redis / Upstash or PostgreSQL.
- [ ] **Expense Receipts Storage (`docs/security-known-risks-20261106.md` L-9):** Expense attachments currently share the `media` bucket behind unguessable UUID paths and are deleted on archive; move to a private bucket with signed URLs if sensitive supplier invoices are uploaded.
