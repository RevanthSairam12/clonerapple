# Notification and environment evidence

Source inventory, 31 October 2026. Names and source locations only; no environment values were inspected for this inventory. Paths below are relative to the repository root.

## Every declared notification event

The event catalogue is `src/lib/notifications/types.ts:12`. The common order adapter is `src/lib/notifications/order-context.ts:71`; its by-transaction adapter loads the persisted order at line 94. The queue calls enqueue at `src/lib/notifications/queue.ts:29`. An emitter proves a queue attempt, not successful delivery: the enabled matrix, recipients and provider configuration still govern delivery.

| Event | Production enqueue path and trigger |
| --- | --- |
| order_placed | `src/app/api/payu/initiate/route.ts:387`, after order creation → queueOrderEvent |
| payment_received | `src/lib/payu/process-response.ts:201`, `src/lib/payu/reconcile.ts:243`, `src/app/api/store-admin/orders/[txnid]/payments/route.ts:132`, `src/app/api/store-admin/payments/[id]/review/route.ts:92` → order adapters |
| processing | `src/lib/notifications/order-context.ts:107` maps PROCESSING; automation calls queueFulfilmentEvents from `src/lib/payu/process-response.ts:202` and `src/lib/payu/reconcile.ts:244`; staff fulfilment adapter at `src/app/api/store-admin/orders/[txnid]/fulfilment/route.ts:98` |
| shipped | Same fulfilment paths; ON_THE_WAY mapping at `src/lib/notifications/order-context.ts:108` |
| delivered | Same fulfilment paths; DELIVERED mapping at `src/lib/notifications/order-context.ts:109` |
| cancelled | `src/lib/payu/process-response.ts:224`, `src/lib/payu/reconcile.ts:468`, `src/app/api/store-admin/orders/[txnid]/cancel/route.ts:87`, `src/app/api/store-admin/requests/[id]/route.ts:56`; CANCELED fulfilment mapping at `src/lib/notifications/order-context.ts:110` |
| refund_requested | `src/app/api/account/orders/[txnid]/requests/route.ts:22` and `src/app/api/store-admin/returns/route.ts:98` |
| refund_completed | `src/app/api/store-admin/returns/[id]/refund/route.ts:105` and `src/app/api/store-admin/orders/[txnid]/refund/route.ts:94` |
| back_in_stock | `src/lib/notifications/stock-events.ts:20` selects event when availableBefore <= 0 and availableAfter > 0; `src/app/api/store-admin/stock/[productId]/adjust/route.ts:90` evaluates it and line 96 queues it |
| password_reset | Customer password change: `src/app/api/account/password/route.ts:24`; staff password route: `src/app/api/store-admin/staff/[id]/password/route.ts:68` |
| staff_invite | `src/app/api/store-admin/staff/route.ts:82`, after staff creation; message excludes credential |
| low_stock | `src/lib/notifications/stock-events.ts:21` selects event on crossing from above threshold into positive low stock; stock adjustment queues at `src/app/api/store-admin/stock/[productId]/adjust/route.ts:96` |
| payment_processing | `src/lib/payu/process-response.ts:222` and `src/lib/payu/reconcile.ts:542` |
| payment_failed | `src/lib/payu/process-response.ts:226` and `src/lib/payu/reconcile.ts:373` |
| reservation_expired | `src/app/api/payu/initiate/route.ts:397` and `src/lib/payu/reconcile.ts:412` |
| refund_pending | `src/lib/payu/process-response.ts:208` and `src/lib/payu/reconcile.ts:247` |
| payment_review | `src/lib/payu/process-response.ts:212` and line 217; `src/lib/payu/reconcile.ts:251`, line 256 and line 515 |

All 17 vocabulary events have an emitter, including indirect mappings. The stock context contains product name, available quantity, staff link and movement token (`src/app/api/store-admin/stock/[productId]/adjust/route.ts:84`); it does not identify a customer subscriber. Do not describe this as a waiting-list subscription delivery implementation.

`src/lib/notifications/enqueue.ts:306` selects enabled matrix cells; lines 315–317 read settings and templates. Missing recipients become SKIPPED at line 367; customer in-app becomes SKIPPED at line 370; staff in-app is marked SENT at line 374. Automated-message delay is not applied in this enqueue flow. `password_reset` currently also labels notifications after authenticated password changes; its name alone does not establish a recovery/reset-link workflow.

## Environment readers

This covers direct `process.env.NAME`, injected `env.NAME`, and the fixed descriptor names passed to `secretStatus()`. Scripts are listed separately from application runtime. NODE_ENV is a framework/runtime selector, not a secret.

| Name | Source reader | Effect |
| --- | --- | --- |
| DATABASE_URL | `src/lib/admin/db.ts:31`, line 48 | Server PostgreSQL access |
| DATABASE_SSL | `src/lib/admin/db.ts:51` | PostgreSQL SSL configuration |
| NODE_ENV | `src/lib/admin/db.ts:32`, `src/lib/admin/auth.ts:204`, `src/lib/store-admin/auth.ts:346`, `src/lib/user-auth.ts:415`, `src/app/api/payu/reconcile/route.ts:30` | Logging, secure cookies and production behavior |
| NEXT_PUBLIC_SUPABASE_URL | `src/utils/supabase/server.ts:4`, `src/utils/supabase/client.ts:3`, `src/lib/content.ts:31`, `src/lib/admin/storage.ts:10` | Legacy content/client/storage connection |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | `src/utils/supabase/server.ts:5`, `src/utils/supabase/client.ts:4`, `src/lib/content.ts:32` | Public content/client configuration |
| SUPABASE_SERVICE_ROLE_KEY | `src/lib/admin/storage.ts:11` | Server storage access |
| PAYU_ENV | `src/lib/payu/config.ts:32` | PayU environment |
| PAYU_KEY | `src/lib/payu/config.ts:34` | PayU merchant configuration |
| PAYU_SALT | `src/lib/payu/config.ts:35` | PayU hash verification/configuration |
| PAYU_BASE_URL | `src/lib/payu/config.ts:36` | PayU base URL override |
| APP_BASE_URL | `src/lib/payu/config.ts:39`, `src/lib/notifications/enqueue.ts:92`, `src/app/android/page.tsx:21` | Callback, notification and storefront absolute URLs |
| CRON_SECRET | `src/app/api/payu/reconcile/route.ts:27` | Reconciliation authorization; readiness presence reader also at `src/lib/notifications/diagnostics.ts:312` |
| MAIL_PASSWORD | `src/lib/notifications/providers.ts:84`, line 172 | Mail readiness and SMTP credentials |
| MSG91_AUTH_KEY | `src/lib/notifications/providers.ts:108`, line 211 | MSG91 readiness and authorization |
| TWILIO_ACCOUNT_SID | `src/lib/notifications/providers.ts:117`, line 272 | Twilio readiness and account selection |
| TWILIO_AUTH_TOKEN | `src/lib/notifications/providers.ts:120`, line 273 | Twilio readiness and authorization |
| NOTIFICATION_RETENTION_ENABLED | `src/lib/notifications/rules.ts:89`, called through `src/lib/notifications/outbox.ts:406` | Enables terminal outbox body/recipient scrubbing |
| NOTIFICATION_RETENTION_DAYS | `src/lib/notifications/rules.ts:91`, same caller | Retention duration |
| RECAPTCHA_SECRET_KEY | Fixed descriptor `src/app/(store-admin)/store-admin/(protected)/settings/storefront/page.tsx:19` → dynamic `process.env[entry.envVar]` at `src/lib/store-admin/secret-status.ts:25` | Presence-only status; no verification/enforcement consumer found |
| STORE_ADMIN_EMAIL | `scripts/create-store-admin.mjs:48` | Staff provisioning script only |
| STORE_ADMIN_ROLE | `scripts/create-store-admin.mjs:49` | Staff provisioning script only |
| STORE_ADMIN_NAME | `scripts/create-store-admin.mjs:50` | Staff provisioning script only |
| STORE_ADMIN_PASSWORD | `scripts/create-store-admin.mjs:123` | Staff provisioning script only |

The named variables in the FEATURES.md environment table (lines 67–75) all have source readers, but RECAPTCHA_SECRET_KEY is status-only. Thus “documented without a functional consumer” applies to CAPTCHA enforcement, while “no reader” would be inaccurate. FEATURES.md:70 says reconciliation accepts unauthenticated POSTs without CRON_SECRET; its later fail-closed statement at line 519 and the route's production authorization behavior must replace that historical claim. Provider credential presence is not provider readiness, and provider readiness is not proof of a successful send.
