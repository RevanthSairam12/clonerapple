# Payment & Reservation Reconciliation Scheduling (`docs/reconcile-scheduling.md`)

## 1. Required Frequency: Every Minute (`* * * * *`)

The reconciliation endpoint (`/api/payu/reconcile`) **must run every 1 minute (`* * * * *`)** in production. It performs four bounded jobs per tick:

1. **Payment verification & settlement (`reconcilePendingOrders`):** Claims due orders (`CREATED`, `PENDING`, `PROCESSING`, and `FAILED`/`CANCELLED` orders still holding grace stock) using `FOR UPDATE SKIP LOCKED` with a 180-second lease, verifies each with PayU's server-to-server `verify_payment` API, settles confirmed captures even when the customer closed their browser tab, releases expired reservations (default 10-minute window) and ended failure-grace holds (default 120 seconds), and flags unresolved payments for staff review.
2. **Notification outbox retry (`processNotificationOutbox`):** Retries up to 10 due email/SMS outbox messages with exponential backoff.
3. **Notification PII retention (`scrubOldNotifications`):** When `NOTIFICATION_RETENTION_ENABLED=on`, scrubs bodies and recipients from terminal outbox rows older than `NOTIFICATION_RETENTION_DAYS`.
4. **Browsing history retention (`pruneOldBrowsingHistory`):** Prunes `customer_browsing_history` rows older than 90 days.

### Heartbeat & Monitoring

Every reconciliation run updates the `payu_reconcile` row in `background_job_heartbeats` (`last_run_at`, `last_success_at`, `last_processed_count`, `last_error`) using the PostgreSQL database clock (`now()`).

- On **Store Admin → Overview (`/store-admin`)**, the **Background jobs** / **Needs attention** panel displays the last successful run time, number of orders processed, and last error.
- If no successful run has occurred in the **last 5 minutes** on the database clock, the indicator turns **red** (`Stale — check scheduler`).

---

## 2. Scheduler Comparison

| Criterion | Option A: Vercel Cron | Option B: Supabase `pg_cron` + `pg_net` | Option C: External Scheduler |
|---|---|---|---|
| **HTTP Method** | `GET /api/payu/reconcile` | `POST` or `GET /api/payu/reconcile` | `POST` or `GET /api/payu/reconcile` |
| **Auth Header** | `Authorization: Bearer <CRON_SECRET>` (sent automatically by Vercel when `CRON_SECRET` env var is set) | `Authorization: Bearer <CRON_SECRET>` (read from `vault.decrypted_secrets`) | `Authorization: Bearer <CRON_SECRET>` |
| **Plan Limits on Frequency** | **Hobby:** max once per day (`0 * * * *` or `* * * * *` fails deployment). **Pro / Enterprise:** supports every minute (`* * * * *`). | **All Supabase plans (Free & Pro):** `pg_cron` supports `* * * * *` (every minute). | Depends on provider (GitHub Actions is ≥5 min and jittery; Upstash QStash / Cron-job.org / Cloudflare Workers support `* * * * *`). |
| **Infrastructure Dependency** | Managed by Vercel deployment config (`vercel.json`). | Runs inside your Supabase Postgres instance; survives frontend redeploys automatically. | Independent of both Vercel and Supabase. |
| **Recommended When** | Running on **Vercel Pro** or **Enterprise**. | Running on **Vercel Hobby** with Supabase (no extra service needed). | Running outside Vercel Pro and wanting external uptime alerting. |

---

## 3. Exact Configuration for Each Option

### Option A: Vercel Cron (Vercel Pro / Enterprise Only)

Vercel Cron invokes scheduled endpoints with an HTTP `GET` request and automatically includes `Authorization: Bearer <CRON_SECRET>` when the `CRON_SECRET` environment variable is defined in the Vercel project.

1. Set `CRON_SECRET` (at least 32 random characters) in **Vercel Project → Settings → Environment Variables** for `Production` and `Preview`.
2. Add the `crons` block to `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["bom1"],
  "crons": [
    {
      "path": "/api/payu/reconcile",
      "schedule": "* * * * *"
    }
  ]
}
```

> **Important Note on Vercel Hobby Plan:** Vercel Hobby accounts only permit cron jobs that run once per day and will refuse a deployment containing `"schedule": "* * * * *"`. Keep `"crons"` out of `vercel.json` on Hobby and use **Option B (Supabase `pg_cron` + `pg_net`)** or **Option C** instead.

---

### Option B: Supabase `pg_cron` + `pg_net` (Works on All Plans)

Supabase includes `pg_cron` and `pg_net`, allowing PostgreSQL itself to trigger `/api/payu/reconcile` every minute with the secret stored in Supabase Vault.

Run the following SQL in the **Supabase SQL Editor** (replace the placeholder URL and secret value with your real staging/production values; never commit real secrets):

```sql
-- 1. Enable extensions
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- 2. Store the public app URL and CRON_SECRET in Supabase Vault
select vault.create_secret('https://your-staging-or-production-domain.example.com', 'gadzio_app_base_url');
select vault.create_secret('REPLACE_WITH_YOUR_CRON_SECRET', 'gadzio_cron_secret');

-- 3. Schedule every-minute reconciliation POST (or GET)
select cron.schedule(
  'gadzio-reconcile-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'gadzio_app_base_url') || '/api/payu/reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gadzio_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
```

**Inspect recent `pg_cron` runs:**

```sql
select jobid, runid, status, return_message, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 20;
```

**Unschedule if switching to another scheduler:**

```sql
select cron.unschedule('gadzio-reconcile-every-minute');
```

---

### Option C: External Scheduler (Cloudflare Cron Worker / Upstash QStash / Systemd Timer)

Any external scheduler that supports 1-minute intervals can call either `GET` or `POST`:

- **URL:** `https://<your-domain>/api/payu/reconcile`
- **Schedule:** `* * * * *` (every minute)
- **Method:** `GET` or `POST`
- **Headers:**
  - `Authorization: Bearer <CRON_SECRET>`
- **Timeout:** 30 seconds

**Verification command (CLI):**

```sh
curl -i -X GET "https://<your-domain>/api/payu/reconcile" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected response: `HTTP/2 200` with JSON `{ "success": true, "summary": { ... } }`, and **Store Admin → Overview → Background jobs** immediately updates its last successful run timestamp to green (`Healthy`).
