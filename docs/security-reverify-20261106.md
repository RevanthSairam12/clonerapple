# Gadzio security remediation — re-verification

**Date:** 2026-11-06
**Audit under re-verification:** 2026-11-06 Gadzio security audit (findings H-1…H-3, M-1…M-3, L-1…L-9, I-1…I-7)
**Commit re-verified:** `79a2522` (branch `revanthsairam12`, working tree clean)
**Migrations assumed applied:** 0063, 0064, 0065, 0066
**Mode:** READ-ONLY. No source, migration, test or config file was modified. No migration was run. No
INSERT/UPDATE/DELETE/DDL was issued. The only writes were this report and the HTTP GET probes that
PostgREST serves.

## Method and constraints

* Baseline gates were executed as shipped (`npm test`, `npx tsc --noEmit`, `npm run build`, the four
  static checkers).
* Live probes used the publishable key against PostgREST. Only HTTP status and row counts are
  recorded here — never a row body, key, token, connection string, customer PII or payment value.
* Database state was read with SELECT-only catalogue queries on a single short-lived
  `DATABASE_URL` connection (`max: 1`, `idle_timeout: 5`, closed with `sql.end()`) to respect the
  15-session pooler cap.
* Code-level checks cite `file:line`; commit messages were not treated as evidence.
* Anything that could not be performed is marked NOT TESTED with the reason. Nothing was inferred.

---

## PART 1 — Baseline gates

| ID | Check | Expected | Actual | Verdict |
|----|-------|----------|--------|---------|
| P1-1 | `npm test` | 0 failing | 0 failing; all suites pass, including the new `security-*` tests | PASS |
| P1-2 | `npx tsc --noEmit` | 0 errors | 0 errors | PASS |
| P1-3 | `npm run build` | success | success, 271 app routes compiled | PASS |
| P1-4 | `node scripts/check-store-admin-routes.mjs` | exit 0 | exit 0, every `store-admin` route guarded except `auth/login` | PASS |
| P1-5 | `node scripts/check-account-routes.mjs` | exit 0 | exit 0 | PASS |
| P1-6 | `node scripts/check-admin-boundary.mjs` | exit 0 | exit 0 (no store-admin/admin identity crossing) | PASS |
| P1-7 | `node scripts/verify-rls-consumer-tables.mjs` | exit 0 | exit 0 — `users 401 • user_sessions 401 • orders 401 • order_sale_state 401 • content_blocks 200/12 • products 200/16 • products.cost_paise 401 • schema_migrations 401` | PASS |
| P1-8 | Route inventory frozen | 167 `route.ts` + 104 `page.tsx` = 271; no A/D/R under `src/app` since `d2dfaca` | 167 + 104 = 271; `git diff --name-status d2dfaca..HEAD -- src/app` = 14 modified (`M`), 0 added, 0 deleted, 0 renamed | PASS |

---

## PART 2 — Live read-only REST probes (publishable key)

Every probe below is an anonymous GET. Status is the whole answer; no body content is reproduced.

| ID | Probe | Expected | Actual | Verdict |
|----|-------|----------|--------|---------|
| H-1 | `GET /rest/v1/order_sale_state?select=*&limit=1` | 401/403 (view must run as invoker and be unreadable) | 401 | PASS |
| M-2a | `GET /rest/v1/products?select=cost_paise&limit=1` | 403/error, not 200 | 401 (column is not granted, so PostgREST rejects the select before RLS) | PASS |
| M-2b | `GET /rest/v1/products?select=id,name,price_paise&limit=1` | 200 with ≥16 rows | 200 / 16 rows | PASS |
| M-2c | `GET /rest/v1/products?select=updated_by` | 401/403 | 401 | PASS |
| M-2d | `GET /rest/v1/products?select=catalog_revision` | 401/403 | 401 | PASS |
| M-2e | `GET /rest/v1/products?select=id,name,price_paise,slug&limit=1` | 200, same count | 200 / 16 rows | PASS |
| L-1 | `GET /rest/v1/schema_migrations?select=*&limit=1` | 401/403 | 401 | PASS |
| R-1 | `GET /rest/v1/users?select=*&limit=1` | 401 | 401 | PASS |
| R-2 | `GET /rest/v1/user_sessions?select=*&limit=1` | 401 | 401 | PASS |
| R-3 | `GET /rest/v1/orders?select=*&limit=1` | 401 | 401 | PASS |
| R-4 | `GET /rest/v1/content_blocks?select=*&limit=1` | 200 with rows | 200 / 12 rows | PASS |
| R-5 | Sweep of all 88 tables/views discovered in `migrations/` (`?select=*&limit=1`) | only intentionally public relations return 200 | `products` 401 (ungranted column defeats `*`); `order_sale_state` 401; every other non-catalogue table 200 with **0 rows**; the intentional public catalogue relations (`attribute_options`, `attributes`, `brands`, `categories`, `facet_defs`, `product_facets`, `product_images`, `product_specs`, `product_variants`) 200 / 1 row each under `limit=1`, plus `content_blocks` 200 / 12 | PASS (see note) |

**Note on R-5.** "200 with 0 rows" is what RLS with no/limited policies looks like from PostgREST; it
is not exposure. This was cross-checked against `pg_class.relrowsecurity` (true for every public
table) and `pg_policies` (only SELECT policies for `anon`/`authenticated`, and only on `brands`,
`categories`, `content_blocks`, `product_images`, `product_variants`, `products`). `products` also
returns 401 on `select=*` because `cost_paise` and friends are not granted, which is stronger than a
row filter.

---

## PART 3 — Database state (SELECT only, owner connection)

| ID | Check | Expected | Actual | Verdict |
|----|-------|----------|--------|---------|
| D-1 | Applied migrations | 0063–0066 present in `schema_migrations` | 0063, 0064, 0065, 0066 all present | PASS |
| D-2 | `order_sale_state` view options | `security_invoker=true` | `relkind = v`, `reloptions = {security_invoker=true}`, owner `postgres` | PASS |
| D-2b | `order_sale_state` grants | no `anon`/`authenticated` grant | grants revoked (matches the 401 above) | PASS |
| D-3 | 0066 statement guards | statement-level BEFORE TRIGGER on each immutable table | 6 triggers, `tgtype = 34` (BEFORE \| STATEMENT \| TRIGGER), `tgenabled = O`, on `order_edit_logs`, `order_status_history`, `payment_events`, `price_history`, `refunds`, `store_admin_audit` | PASS |
| D-4 | `schema_migrations` RLS | `relrowsecurity = true` | true (`relforcerowsecurity = false`; the owner/runner bypasses RLS, which is required) | PASS |
| D-5 | `products` column privileges | `anon` + `authenticated` SELECT grant excludes `cost_paise` | 30 columns granted to both roles; `cost_paise` absent | PASS |
| D-6 | RLS everywhere | every public table has RLS | true for all public tables, including `admin_sessions`, `admin_users`, `media`, `site_settings` | PASS |
| D-7 | 0066 trigger check never executed a destructive statement | no TRUNCATE run | only `pg_trigger`/`pg_class` catalogue reads were issued | PASS |

---

## PART 4 — Functional regression around the withdrawn access

| ID | Check | Expected | Actual | Verdict |
|----|-------|----------|--------|---------|
| F-1 | Any storefront/account REST read of `products` | none | no `rest/v1/products` and no `.from('products')` in `src/` | PASS |
| F-2 | Any `select('*')` against a public table in app code | none | none in `src/` | PASS |
| F-3 | Public content reads still work | `content_blocks`, `site_settings` read with explicit columns | `src/lib/content.ts` selects `value` / `key, value`; probes R-4 pass | PASS |
| F-4 | `order_sale_state` consumers stay on the owner connection | server-only, `DATABASE_URL` | call sites: `src/lib/account/orders.ts:239,248,359,387`, `src/lib/order-status.ts:108`, `src/lib/store-admin/order-channel.ts:109,123`, `src/lib/store-admin/orders.ts:459,474,514,614,723` — all `getSql()`/`DATABASE_URL` | PASS |
| F-5 | `schema_migrations` consumers | runner only | only `scripts/migrate.mjs:64,79` and `scripts/rehearse-options-migrations.mjs:205` | PASS |
| F-6 | Runner can still read **and** write the ledger after 0065 | owner connection unaffected | `migrate.mjs` uses `DATABASE_URL` (table owner); 0065 and 0066 are recorded in the table, which is itself proof a post-lockdown insert succeeded | PASS |
| F-7 | Price-editing gate condition | PayU must read prices from the DB before the write path is live | `src/lib/payu/db-catalog.ts:115-124,148-156,290-316` selects `products.price_paise` / `sale_price_paise` server-side per line; gate condition met | PASS |

---

## PART 5 — Code-level re-check (read the code, cite `file:line`)

| ID | Check | Expected | Actual (evidence) | Verdict |
|----|-------|----------|-------------------|---------|
| H-2 | No injected HTML from the database | stored values rendered as text; the only raw HTML is a validated colour block | Only two `dangerouslySetInnerHTML` sites exist: `src/app/layout.tsx:45-47` (interpolates only `safeThemeColor()` output plus the constant `FONT_FALLBACK` from `src/lib/fontLoaders.ts`), and `src/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter.tsx:44,112` which sit inside a block comment that opens at line 18 and closes at line 154 (dead file; the live footer is `GadzioFooter`). No `innerHTML`, `document.write`, `set:html` or `eval` in `src/`. Email: `src/lib/notifications/templates.ts:64-71` `escapeHtml`, applied to body `:276`, button URL/label `:278`, heading `:282`, footer `:291`; links pass `safeHttpsUrl`/`safeEmailLink` (`:119-128`, `:135-149`, https-only, rejects credentials and protocol-relative). Rendered at `src/lib/notifications/enqueue.ts:406` | PASS |
| H-3 | `mail_*` owner-only on write; `mail_encryption=none` rejected outside dev; password only to allow-listed host; intended route roles | all four | `isOwnerOnlySetting()` returns true for `maintenance_*` and `mail_*` — `src/lib/store-admin/settings-rules.ts:734-736`, enforced inside the write transaction at `src/lib/store-admin/settings.ts:94-100` (`forbidden`, 403). The route passes owner-ness from the session, not from the body: `src/app/api/store-admin/settings/route.ts:72` (`guard.session.role === 'store_owner'`) behind `requireStoreRole('store_admin')` at `:37`. `mailEncryptionAllowed` — `settings-rules.ts:743-747`, wired at `:714`. `mailHostAllowed` — `src/lib/notifications/providers.ts:71-83`; refused at `:108-110`; defence-in-depth so a direct transport builder still withholds the password at `:205-212`. Routes: notifications GET viewer / POST owner + `assertSameOrigin` — `settings/notifications/route.ts:14,32,35`; retry POST owner + `assertSameOrigin` — `settings/notifications/retry/route.ts:18,21`; `mail-check` owner — `mail-check/route.ts` | PASS |
| M-1 | Customer detail masked for every role; reveal owner-only and audited without PII | all | Detail is GET-only and `store_admin` — `src/app/api/store-admin/customers/[id]/route.ts:10,23`. Masking: `src/lib/store-admin/masking.ts:12-46` (email `r***@domain`, phone keeps first/last two digits, address lines and pincode become `[redacted]`), applied at `src/lib/store-admin/customers.ts:418-425`. Reveal: `requireStoreRole('store_owner')` `customers/[id]/reveal/route.ts:39`, `assertSameOrigin` `:36`, rate limits on actor and (trusted) IP `:79-90`, audit writes `field` + `addressId` + `reason` only — `:96-105` and `:131-139` — never the revealed value | PASS |
| M-3 | SVG not uploadable; legacy SVG rows served inert | both | `ALLOWED_MEDIA_TYPES` — `src/lib/store-admin/media-rules.ts:8-16` (jpeg/png/webp/gif/avif/webm/mp4, no SVG). Serving: `src/app/api/media/[id]/route.ts:47-66` — SVG rows are proxied as `Content-Disposition: attachment`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:`, `X-Content-Type-Options: nosniff`; everything else 302s to the bucket with `nosniff` (`:70-79`) | PASS |
| L-2 | Non-owner result page cannot see items, delivery or timeline | gated on `access === 'owner'` | `src/components/orders/OrderResultPage.tsx:89` (delivery), `:109` (items), `:142` (timeline), `:163` (documents), and the pay-again action requires owner at `:172`. The customer projection still strips pre-delivery invoice identity before render (`:71-77`) | PASS |
| L-3 | Sign-up cannot mint a session for an existing address; sign-in always can | duplicate returns the same success body with no token | `src/lib/user-auth.ts:187-219` — `signUp` returns `{ ok: true; token: string | null }` and `token: null` on the duplicate path `:219`; `signIn` `:250-256` is typed `{ ok: true; token: string }` only. Consumer: `src/app/api/auth/signup/route.ts:66-69` sets the cookie only when `result.token` exists and the response body is always `{ ok: true }`; `src/app/api/auth/signin/route.ts:39` sets it unconditionally on success | PASS |
| L-4 | Theme colours cannot break out of the `<style>` block | validated at write and at read | Write seam: `src/lib/website/content-store.ts:151` rejects a theme key whose value is not a complete hex. Read seam: `src/app/layout.tsx:28-30` runs `safeThemeColor`, which returns `null` unless `isThemeHexColor` passes — `src/lib/website/theme-rules.ts:22-30` | PASS |
| L-5 | Stored message bodies render as text | no markup | `src/components/account/MessageBody.ts:11-16` uses `createElement('div', { className: '… whitespace-pre-wrap …' }, body)` — a text child React escapes; used at `src/components/account/MessagesManager.tsx:135`. The only other stored bodies (`note.body`) are JSX text children at `store-admin/…/customers/[id]/page.tsx:441` and `…/orders/[txnid]/page.tsx:631` | PASS |
| L-6 | XFF is trusted only behind a declared proxy; rate limits cannot be keyed on a spoofed IP | single gate, empty IP skips the IP bucket | Gate: `src/lib/platform/client-ip.ts:14-28` (`trustProxy` requires `TRUST_PROXY` = 1/true/yes/on; otherwise returns `''`). No other file reads `x-forwarded-for`/`x-real-ip` — every consumer goes through `client-ip.ts`: `catalog/availability/route.ts:35`, `coupons/validate/route.ts:46`, `payu/initiate/route.ts:54`, `payu/webhook/route.ts:27`, `customers/[id]/reveal/route.ts:79`, `store-admin/audit.ts:148`, `user-auth.ts:98`. Callers take the `ip ? … : null` branch so an empty IP never forms a shared bucket (e.g. `reveal/route.ts:79-90`) | PASS |
| L-7 | Missing, unknown and not-yours renders identically | one component, one message | `src/components/orders/OrderResultPage.tsx:27-48` defines the single `Unavailable()` card and one message; `:60` (`!txnid`), `:63` (`!result.ok`), `:69` (`!access`), `:77` (document read failure) all return it. All five entry pages use this component (`src/app/order/{success,failed,processing,cancelled,status}/page.tsx`). The account detail path does not distinguish either: `src/app/account/orders/[txnid]/page.tsx:28` and `…/receipt/page.tsx:24-25` `notFound()` for both absent and not-yours, because `getCustomerOrderDetail` filters on `user_id` (`src/lib/account/orders.ts:359-387`) | PASS |
| L-8 | Archiving media no longer leaves the object readable | row archived, then object deleted; failure never exposes the path | `src/lib/store-admin/media.ts:170-219` — transaction into `let result`, and only `if (result.ok)` does it call `deleteFromStorage` on `result.data.before.storage_path`; a failed delete logs without the path. `deleteFromStorage` — `src/lib/platform/storage.ts:62-75` returns `false` on any failure, never throws. Only writer of `store_media.deleted_at` (`media.ts:197`); the storefront route resolves `deleted_at is null` (`api/media/[id]/route.ts:38-41`) | PASS |
| I-5 | Declared-oversized multipart is refused before buffering | Content-Length check first, post-parse check retained | `src/app/api/store-admin/media/route.ts:57-63` reads `content-length` and returns 413 when it exceeds `MAX_MEDIA_BYTES + MULTIPART_OVERHEAD_BYTES`; `await request.formData()` is at `:66`; the authoritative `file.size > MAX_MEDIA_BYTES` check remains after parsing. Only multipart route in the app | PASS |
| RM-1 | Role-matrix test covers `settings`, `settings/lists/[kind]`, `settings/notifications`, `notifications/retry`, `customers/[id]`, `customers/[id]/reveal` | all six | `tests/security-role-matrix.test.mjs:38-63` covers `settings/notifications`, `settings/notifications/retry`, `settings/lists/[kind]` (NULL = dynamic, asserted textually at `:102`), `customers/[id]`, `customers/[id]/reveal`. **`settings/route.ts` is absent.** All six endpoints do have the right roles in code (`settings/route.ts:37` admin + owner-only keys inside the transaction; `lists/[kind]/route.ts` viewer GET / owner-or-admin POST; notifications GET viewer / POST owner; retry owner; customers/[id] admin; reveal owner), but the matrix does not pin them | FAIL (test coverage only — no code defect) |

### Bypass searches performed

| Search | Result |
|--------|--------|
| Other raw-HTML sinks (H-2) | `dangerouslySetInnerHTML` only at `layout.tsx:45` and inside the dead `GlobalFooter.tsx` comment; no `innerHTML`/`document.write`/`set:html`/`eval` |
| Other email renderers (H-2) | only `templates.ts` `renderEmail`, called once at `enqueue.ts:406`; every interpolated value is escaped |
| Other DB→HTML paths (H-2) | message bodies (`MessageBody`), admin notes (JSX text), settings section copy (`settings/page.tsx:147`, from code constants) — all text children |
| Other `mail_*` write paths (H-3) | none; `updateStoreSettings` is the only writer and it checks `canEditOwnerOnly` |
| Other sign-up/sign-in session mints (L-3) | only `src/app/api/auth/{signup,signin}/route.ts` call `signUp`/`signIn` |
| Other `<style>` interpolation (L-4) | only `layout.tsx:45-47`; every other `<style>` is an imported `.css` file |
| Other XFF readers (L-6) | none outside `client-ip.ts` |
| Other order-result renderers (L-7) | only `OrderResultPage`; account pages use `notFound()` for both cases |
| Other media soft-delete paths (L-8) | only `store-admin/media.ts:197`; expenses only join with `deleted_at is null` |
| Other multipart routes (I-5) | only `store-admin/media/route.ts` |
| `assertSameOrigin` on every mutating store-admin route | all mutating handlers call it (automated sweep) |

---

## PART 6 — Anything missed

| ID | Check | Expected | Actual | Verdict |
|----|-------|----------|--------|---------|
| S-1 | New tables since `d2dfaca` | each ships with RLS in its own migration | migrations added since `d2dfaca`: 0064, 0065, 0066. None contains `create table`; 0063 (view invoker) predates the diff base. Every public table still has RLS (`pg_class`) | PASS |
| S-2 | Secrets-adjacent settings writable by `store_admin` | none | No webhook, PayU base-URL, storage-endpoint or SMS-host setting exists. Everything under `mail_*` (host, port, username, encryption, from, SMS sender/DLT) is owner-only via `isOwnerOnlySetting` (`settings-rules.ts:734-736`), which `settings.ts:94-100` enforces on every key regardless of route | PASS |
| S-3 | Admin-controlled URL fetched server-side with a credential | none | Server-side `fetch` calls: MSG91 hardcoded `https://api.msg91.com/…` (`providers.ts:267`) with the key in the body — no host control; PayU verify endpoint is hardcoded per environment (`src/lib/payu/config.ts:219-226`) — `PAYU_BASE_URL` only affects the hosted-checkout redirect, not a credentialed server fetch; storage uses `PROJECT_URL` from env (`platform/storage.ts:67`); SMTP goes through the allow-list. `sms_gateway` is a fixed select (`settings-rules.ts:461-472`) | PASS |
| S-4 | `products` table-level privileges | should be SELECT-only for API roles | **Table-level `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` are still granted to `anon` and `authenticated`** — 0064 revoked only SELECT. See finding N-1 | FAIL (Low) |

### New findings

**N-1 — Low — residual table-level DML grants on `products`**
`migrations/0064_products_column_grants.sql` revokes and re-grants only `SELECT`. The table-level
`INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` grants inherited from the default schema grants
remain in `information_schema.role_table_grants` for `anon` and `authenticated`. RLS has no
INSERT/UPDATE/DELETE policies on `products` for either role, so PostgREST row writes are refused, and
PostgREST cannot issue `TRUNCATE`; both roles are `NOLOGIN`. Impact therefore requires direct database
credentials, which are not part of the REST surface. It is a defence-in-depth gap, not an exploitable
path today. Smallest next step: a future additive migration 0067 that revokes the table-level DML and
grant nothing back (the app never writes `products` through PostgREST).

**N-2 — Low (test coverage) — `PUT /api/store-admin/settings` is not in the role matrix**
Every sensitive route the audit named is pinned except the general settings write. The route is
correct (`settings/route.ts:37` admin, owner-only keys enforced inside `updateStoreSettings`), but a
future change to either line would not be caught. Smallest next step: add
`'settings/route.ts': 'store_admin'` to `tests/security-role-matrix.test.mjs:38-63` and assert the
`guard.session.role === 'store_owner'` hand-off textually.

**N-3 — Informational — legacy `/api/admin/media/[id]` serves legacy bytea rows with a stored MIME**
`src/app/api/admin/media/[id]/route.ts:79-93` returns legacy `media.data` with `mime_type` from the
row and a locked-down CSP (`default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src 'self'`)
plus `nosniff`, but no `Content-Disposition: attachment`. Scripts, framing and subresource loads are
blocked by the CSP, so this is inert in a modern browser; it is the legacy admin panel, untouched by
this remediation, and not a regression. No action proposed.

**N-4 — Informational — signed-in staff can read `mail_host` / `mail_username`**
`GET /api/store-admin/settings` is open to every signed-in staff role (`settings/route.ts:13`) and
`getStoreSettings` returns the full settings map, including the non-secret SMTP host and username.
Writes remain owner-only and `MAIL_PASSWORD` is only ever read from the environment, so no credential
is exposed. Worth confirming this read sharing is intended when the panel is next reviewed.

---

## FAIL / NOT TESTED

| ID | Verdict | Exact reason | Smallest next step |
|----|---------|--------------|--------------------|
| RM-1 | FAIL (coverage) | `tests/security-role-matrix.test.mjs` does not list `settings/route.ts`; the other five named routes are covered | Add `'settings/route.ts': 'store_admin'` to the matrix map and one owner-only assertion |
| S-4 | FAIL (Low) | Table-level INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER still granted to `anon`/`authenticated` on `products`; RLS blocks row ops and PostgREST cannot TRUNCATE | Additive migration 0067 revoking table-level DML, granting nothing back |
| — | NOT TESTED | **End-to-end staff-session behaviour.** No store-admin login was performed (no staff credentials were used), so role enforcement was verified by reading the guard calls and by the role-matrix unit test, not by live requests as viewer/admin/owner | Run a scratch-environment matrix of the six sensitive endpoints with one account per role |
| — | NOT TESTED | **Live mail delivery and `MAIL_ALLOWED_HOSTS` refusal.** No SMTP credentials or mail server were used | In a scratch environment set a host outside the allow-list and confirm `mail-check` reports "not configured" |
| — | NOT TESTED | **Browser-level XSS rendering** of stored theme colours and message bodies. Verified by code path only, with no headless browser run | Load a page with a hostile stored colour/body in a dev instance and confirm no execution and no style break-out |
| — | NOT TESTED | **Live PayU return-token flow** (`?rt=`). No PayU transaction or `PAYU_RETURN_SECRET` was used; the gate was verified by reading `resolveReturnAccess` and the five entry pages | Execute a sandbox payment and a replayed/expired token against `/order/success` |
| — | NOT TESTED | **Restored-database replay** of 0065/0066. Migrations were already applied; they were not re-run here (forbidden by the read-only rule) | On a restore from before 0063, run `scripts/migrate.mjs` and re-run `verify-rls-consumer-tables.mjs` |

## What was not covered

* No authenticated store-admin, customer or PayU session was exercised; all live probes were
  anonymous PostgREST reads.
* No source-level review beyond the findings named in the re-verification brief; unrelated routes were
  not re-audited.
* The accepted risk L-9 (expense receipts in the public `media` bucket) is unchanged and remains open
  by design, documented in `docs/security-known-risks-20261106.md`.
* Nothing here is a statement that the application is fully secure. It is a statement that the
  specific remediations listed above behave as intended on 2026-11-06 at `79a2522`.

---

## Verdict

**READY WITH CONDITIONS.**

All four migrations are applied and behave as written; every named finding's fix is present in the
code at the cited lines with no bypass found on the searches performed; the two probes that would
have exposed data (H-1 `order_sale_state`, L-1 `schema_migrations`) return 401; the `products` cost
columns are withheld at grant level and no app code depends on the withdrawn surface; and the full
baseline (tests, typecheck, build, four static checkers, route inventory) is green.

Conditions, in priority order:

1. **N-1 (Low, database hardening):** table-level `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER`
   remain granted to `anon`/`authenticated` on `products`. Not exploitable through PostgREST today
   (no write policies, no TRUNCATE support, both roles `NOLOGIN`). Close it with an additive 0067.
2. **N-2 (Low, test coverage):** the role-matrix test omits `PUT /api/store-admin/settings`. The
   route is correct; the test is incomplete.
3. **Coverage gaps:** staff-session end-to-end, live SMTP, browser-level XSS and PayU return-token
   flows were NOT TESTED for the reasons above and should be run once in a scratch environment before
   relying on this verdict for a production sign-off.
4. **L-9** remains an accepted risk with the documented interim controls.
