# Production environment settings

Environment variables decide how the application connects to PostgreSQL, whether a production
deployment is safe against forged client addresses, and whether an owner can repoint email delivery.
Each variable has a safe default, so an unconfigured deployment runs — this page explains when each
value applies and what the server logs at boot.

Placeholders for every variable are in [`.env.example`](../.env.example). Never commit a real value.

---

## `DATABASE_URL`, `DATABASE_MIGRATION_URL` and `DATABASE_POOL_MAX` (Vercel & Supabase)

| Variable | Port / Pooler mode | Used by | Why |
|----------|--------------------|---------|-----|
| `DATABASE_URL` | **6543** (Supabase Supavisor **Transaction** pooler) | Next.js application runtime (`getSql()`) | Multiplexes serverless function instances across short-lived transactions; `db.ts` automatically sets `prepare: false` on port `6543` and configures `idle_timeout: 20`, `connect_timeout: 10`, `max_lifetime: 1800`. |
| `DATABASE_MIGRATION_URL` | **5432** (Supabase Supavisor **Session** pooler or Direct connection) | `npm run db:migrate`, CLI scripts, and isolated `itest_*` / `fs_*` test fixtures | DDL migrations, `SET search_path`, and session-scoped test fixtures require session state that transaction mode (`6543`) does not preserve. Prefers `DATABASE_MIGRATION_URL`, falls back to `DATABASE_URL`, and **refuses port `6543`** with an explicit error. |
| `DATABASE_POOL_MAX` | Integer `1`–`100` (optional; default `10` in production, `5` in dev) | Next.js application runtime (`getSql()`) | Caps concurrent connections per Node instance. |

---

## `TRUST_PROXY`

**What it does.** The app derives the client address from `X-Forwarded-For` / `X-Real-IP` only when
`TRUST_PROXY` says a proxy is in front. That address feeds the per-IP rate-limit buckets (catalog
availability, coupon validation, PayU initiate and webhook, customer reveal, sign-in/sign-up) and the
hashed IP on the audit trail. The single gate is `src/lib/platform/client-ip.ts:14-28`; no other file
reads those headers.

**Accepted values.** `1`, `true`, `yes`, `on` (case-insensitive). Anything else — including `0`,
`false` and an empty string — is "not declared".

| Setting | When it applies | Effect |
|---------|-----------------|--------|
| `TRUST_PROXY=1` | The process sits behind a reverse proxy, load balancer or tunnel that **overwrites** `X-Forwarded-For` with the real client address (nginx `proxy_set_header`, a cloud load balancer, Cloudflare, a tunnel). | Per-IP limits are keyed on the real client address. Sign-in lockouts, reveal limits and webhook limits apply per client. |
| Unset (or any other value) | Clients reach the process directly, or the proxy forwards `X-Forwarded-For` without overwriting it. | The forwarded header is ignored, the client address is unknown, and per-IP buckets are **skipped**. Per-account and per-email limits still apply. |

**Why the default is "unset".** `X-Forwarded-For` is caller-authored unless a proxy rewrites it. If
the app trusted it without a proxy, a caller could send a fresh address with every request and never
meet a per-IP bucket. Skipping the bucket is deliberate: with no trustworthy address, forming one
shared "unknown" bucket would let a single caller lock out everyone else. The per-actor limits are the
fallback.

**Choose by asking one question:** *does a proxy I control overwrite `X-Forwarded-For` before the
request reaches Node?* Yes → set it. No → leave it unset.

**Boot warning.** In production, a `TRUST_PROXY` value that is set but unrecognised (e.g.
`TRUST_PROXY=proxy` or `=localhost`) logs:

```
[startup] TRUST_PROXY is set to a value this app does not recognise, so forwarded client addresses are ignored. Use 1, true, yes or on to trust a reverse proxy, or remove the variable.
```

An unset `TRUST_PROXY` does not warn — it is a valid choice.

---

## `MAIL_ALLOWED_HOSTS`

**What it does.** The store owner can edit the SMTP host in the settings panel. The server holds the
SMTP password in `MAIL_PASSWORD` and sends it to whatever host is configured. `MAIL_ALLOWED_HOSTS` is a
comma-separated allow-list: when the configured `mail_host` is not on it, delivery is refused and the
password is never sent. The check is `mailHostAllowed()` in `src/lib/notifications/providers.ts:71-83`,
applied by `mailConfigProblem()` (`:108-110`) with a second refusal inside the transport builder
(`:202-212`).

**Format.** Comma-separated host names, case-insensitive, exact match. No scheme, no port, no path,
no spaces.

```
MAIL_ALLOWED_HOSTS=smtp.example.com,email-smtp.ap-south-1.amazonaws.com
```

**Accepted values.**

| Setting | Effect |
|---------|--------|
| Set | Only the listed hosts receive `MAIL_PASSWORD`. A different `mail_host` reports "mail not configured (SMTP host is not in MAIL_ALLOWED_HOSTS)" and logs one warning per process without naming the host. |
| Unset | The configured host is trusted. Delivery works for a single-tenant deployment whose owner already controls the settings, but an owner (or a compromised owner session) could point delivery at another host and receive the password. |

**Set this in production.** Use the real SMTP host. Adding a second host later means a deploy, not a
settings change.

**Address the mail driver runs on.** `mail_driver` lives in the `store_settings` table, so the boot
check cannot know whether SMTP is in use without a database query before the server is ready. The boot
warning therefore fires on `MAIL_ALLOWED_HOSTS` being unset, in production, regardless of the driver;
it is one advisory line, not an error. The precise, driver-aware refusal already exists at send time.

**Boot warning** (production, `MAIL_ALLOWED_HOSTS` unset):

```
[startup] MAIL_ALLOWED_HOSTS is not set. With the SMTP mail driver, an owner who edits mail_host can send the SMTP password to that host. Set it to the comma-separated list of allowed SMTP hosts.
```

---

## The startup check

`src/instrumentation.ts` exports `register()`, which Next calls once per server instance before it
serves a request. It calls `startupWarnings()` in `src/lib/platform/startup-env.ts` and logs each
line prefixed `[startup]`.

Guarantees:

- **Cannot break startup.** The call is wrapped in `try/catch`, the module it calls has no imports and
  does no I/O, and nothing is awaited.
- **No secrets.** A message names a variable, never a value. Covered by
  `tests/security-startup-env.test.mjs`.
- **Development and test are silent.** The warnings fire only when `NODE_ENV=production`.

The checks are advisory. They do not change what the app does; they make a misconfiguration visible in
the first lines of the production log.

---

## Checking a deployment

```bash
# What the server should log on boot (empty output = correctly configured):
#   see the first [startup] lines in the server log

# Confirm the allow-list refuses the wrong host without sending mail:
#   see docs/staging-runbook-20261106.md, checklist item 1
```

Re-run the role and grant checks after any change to these variables or to the mail settings:

```bash
node scripts/check-security-db-state.mjs
node scripts/verify-rls-consumer-tables.mjs
```

---

## Role-level `idle_in_transaction_session_timeout` (For Owner Approval — NOT Applied)

**Status:** **Not applied.** Per the database connection decisions, this setting is documented here for explicit owner approval before running in production.

**Why 30 seconds.** If a serverless function or container freezes mid-transaction (after `BEGIN` and acquiring `FOR UPDATE` row locks, before `COMMIT`/`ROLLBACK` and before the TCP connection closes), PostgreSQL will otherwise hold those row locks until TCP keepalive expires. Setting `idle_in_transaction_session_timeout = '30s'` on the application role causes PostgreSQL to automatically abort any transaction that sits idle for more than 30 seconds (`25P03: terminating connection due to idle-in-transaction timeout`), releasing its locks and pooler slot.

### Exact SQL to apply (after approval)

```sql
-- 1. Apply the 30-second idle-in-transaction timeout to the Supabase application role
--    (replace `postgres` with the dedicated app role name if a separate role is used):
ALTER ROLE postgres SET idle_in_transaction_session_timeout = '30s';

-- 2. Verify the role-level configuration in pg_db_role_setting:
SELECT rolname, rolconfig
FROM pg_roles
WHERE rolname = 'postgres';

-- 3. (Optional) Roll back to default if ever needed:
-- ALTER ROLE postgres RESET idle_in_transaction_session_timeout;
```

