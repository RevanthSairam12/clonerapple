# Not-connected code audit

**Scope:** source audit of the current repository on 31 October 2026. This document names environment variables only; it contains no secret values and does not claim that a database row exists unless the source establishes the behavior.

## Executive summary

The application has two admin surfaces with separate authentication boundaries: the legacy CMS under `/admin` and the operational store desk under `/store-admin`. Store-admin routes use `store_admins`, `store_admin_sessions`, and the `store_admin_session` cookie. Commerce data is served through the server-side PostgreSQL access layer; the public Supabase client is used for legacy CMS/content and storage concerns, not for users, sessions, orders, or store-admin authorization.

The strongest connected areas are catalogue and stock, orders and payments, checkout/shipping, coupons, maintenance mode, notification enqueue/outbox, sale pricing, and the report pages. The main gaps are configuration that is saved but has no complete runtime consumer, especially `automated_messages.delay_minutes`, reCAPTCHA enforcement and several generic list tables. All 17 declared notification events have enqueue paths, including the indirect stock and fulfilment mappings. Saved configuration with no consumer should be labelled inactive.

## Evidence appendices

The detailed inventories accompany this summary:

- [Settings consumer matrix](AUDIT_SETTINGS.md): individual setting keys and downstream effects.
- [Tables and access evidence](AUDIT_TABLES.md): migration declarations and source reads/writes.
- [Pages, APIs and component import graph](AUDIT_ROUTES_COMPONENTS.md): framework routes, explicit caller evidence and import coverage.
- [Notification and environment evidence](AUDIT_NOTIFICATIONS_ENV.md): every declared event and environment name, including dynamic presence readers.

These documents describe source behavior, not deployed configuration or database contents.

## Settings and downstream consumers

### `store_settings` field catalogue

The authoritative text setting catalogue is `src/lib/store-admin/settings-rules.ts`. It contains seven sections and 58 keys:

- **Business:** `trade_name`, `legal_name`, `email`, `phone`, `address`, `country`, `timezone`, `time_format`, `footer_text`, `receipt_footer`, `cookie_notice`, `logo_media_id`, `favicon_media_id`.
- **Orders:** `order_prefix`, `order_start_number`, `invoice_prefix`, `auto_confirm`, `shipping_enabled`, `pos_confirm_unusual_price`, `pickup_enabled`, `free_shipping_over`, `auto_cancel_unpaid_hours`, `reservation_seconds`, `payment_failure_grace_seconds`, `payment_unresolved_minutes`, `return_window_days`, `default_fulfilment_status`, `processing_time_text`, `cutoff_text`.
- **Payments:** `coupons_enabled`, `refunds_restore_coupon`, `cod_enabled`, `payu_enabled`, `manual_payments_enabled`, `payu_mode`, `payment_note`.
- **Mail:** `mail_driver`, `mail_status`, `mail_host`, `mail_port`, `mail_username`, `mail_encryption`, `mail_from_email`, `mail_from_name`, `sms_gateway`, `sms_status`, `sms_sender_id`, `sms_dlt_template_id`.
- **Storefront:** `login_heading`, `login_subheading`, `login_background_media_id`, `login_support_link`, `recaptcha_site_key`, `recaptcha_status`.
- **Maintenance:** `maintenance_enabled`, `maintenance_message`, `maintenance_starts_at`, `maintenance_ends_at`.

Connected consumers include maintenance enforcement (`src/lib/storefront/maintenance.ts`), notification provider settings (`src/lib/notifications/settings.ts`), checkout/shipping settings (`src/lib/checkout/settings.ts`), POS unusual-price confirmation (`src/lib/store-admin/pos.ts`), coupon validation and checkout, coupon restoration during refunds (`src/lib/store-admin/returns.ts`), order numbering (`src/lib/payu/orders.ts`), payment reconciliation, and sale/order admin timezone behavior.

The following are persisted and displayed but require special caution:

- `pickup_enabled` is hard-locked off in the rules and checkout exposes delivery only. It is not an available feature switch.
- Payment gateway secrets are intentionally not settings fields; they remain environment configuration.
- `automated_messages.delay_minutes` is editable in the settings-list registry, but `src/lib/notifications/enqueue.ts` currently enqueues immediate work and does not apply that delay. Treat it as stored-only until a scheduler consumes it.
- Generic `store_integrations` rows are non-secret configuration records. A row is not evidence that an integration is wired.
- `footer_text`, login copy/media, and some business identity fields are only operationally visible where their respective storefront/CMS consumers read them; they should not be described as changing every admin document without tracing that renderer.

### Separate configuration stores

- `customer_settings` is read by checkout and PayU initiation and edited under customer settings. The reader/writer is `src/lib/store-admin/customer-settings.ts`.
- `sale_settings` is read by storefront sale-state and edited by the store-admin sale screen.
- Legacy `site_settings` and CMS `content_blocks` are read by `src/lib/content.ts`; the theme registry includes `fontFamily`, `logoText`, `appleCopyright`, `oppoPrimaryColor`, `oppoGreenDark`, and `oppoGreenLight`.
- Structured list tables are described by the fixed registry in `src/lib/store-admin/setting-lists.ts`: fulfilment providers, shipping methods, payment methods, social links, analytics scripts, store integrations, automated messages, email templates, store pages, SEO pages, refund reasons, and return reasons. Rows are soft-hidden with `is_active` where supported.

## Tables and read/write usage

The migration set covers these functional families:

- **Legacy/admin:** `admin_users`, `admin_sessions`, `content_blocks`, `site_settings`, `media`.
- **Identity:** `store_admins`, `store_admin_sessions`, `store_admin_audit`, `users`, customer sessions, addresses, login events, customer settings, notes, and subscribers.
- **Catalogue:** categories, products, facets/specifications, images, variants, price history, stock and stock movements, brands, units, attributes/options, conditions, reviews, media, imports/errors, and collections.
- **Commerce:** orders, order items/status history/addresses/deliveries/events, requests, notes/edit logs, payments, POS shifts/counters, returns/items/refunds, refund obligations, coupons/targets/redemptions, and reservations.
- **Configuration/reporting:** all 12 structured settings tables, store settings, order counters, sale settings, preferences, expenses/categories, notification matrix/templates, and notification outbox.

Read/write patterns are server-side and domain-specific. Catalogue and stock mutations go through store-admin APIs and write audit records. Orders/payment/return flows update their own history and stock/reservation state. Reports read those records and do not mutate them. Configuration is mostly written through fixed descriptors and validated values rather than arbitrary table/column input. The audit boundary is strongest at the store-admin API layer: each route must require a store role, mutations must check same-origin, and privileged mutations must call `writeAudit()`.

## Pages, APIs, and callers

The App Router contains 93 page modules across storefront, customer account, legacy CMS admin, and store-admin. The operational store-admin families include:

- dashboard, orders, order detail/invoice/packing slip, requests and returns;
- catalogue/products/categories/collections/reviews/media;
- stock and low-stock;
- POS, receipts, shifts/end-of-day, payments;
- customers, customer detail/accounts/subscribers/settings;
- expenses;
- reports and CSV export;
- sale and coupons;
- settings for business/orders/payments/storefront/mail/content/shipping/analytics/reasons/notifications/staff;
- profile, staff, and audit log.

There are approximately 127 API route modules. They cover separate auth flows, legacy CMS content/media/settings, customer account operations, PayU initiate/callback/reconcile, and store-admin CRUD/operations for catalogue, orders, returns/refunds, customers, staff, stock, notifications, audit, settings, POS, reports, and exports. Browser callers are present in checkout/cart/account components, theme/collection editors, and store-admin client components. A route file alone is not proof of a user-facing caller because server actions and direct server imports also exist; orphan classification requires an import/caller graph pass.

## Unused or weakly connected components

No component is marked dead solely from filename or route absence. The codebase includes framework-discovered pages and server-only modules that will not appear in a browser `fetch()` scan. The defensible weak-connection findings are:

- `automated_messages.delay_minutes`: saved and rendered, but not consumed by notification enqueue scheduling.
- `back_in_stock` is connected: `src/lib/notifications/stock-events.ts:20` chooses it on an available-stock crossing from nonpositive to positive, and `src/app/api/store-admin/stock/[productId]/adjust/route.ts:90` forwards it to the queue at line 96. This is a manual-adjustment trigger; it does not establish a waiting-list subscriber notification flow.
- Generic integration rows and some list records are configuration storage, not proof of a runtime integration.
- Some API routes may be reachable only through indirect server calls. Do not delete route modules until a full import graph and route caller check is performed.

## Environment variables (names only)

The source and scripts reference these names:

`DATABASE_URL`, `DATABASE_SSL`, `NODE_ENV`, `PAYU_ENV`, `PAYU_KEY`, `PAYU_SALT`, `PAYU_BASE_URL`, `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `MAIL_PASSWORD`, `MSG91_AUTH_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `NOTIFICATION_RETENTION_ENABLED`, `NOTIFICATION_RETENTION_DAYS`, `STORE_ADMIN_EMAIL`, `STORE_ADMIN_ROLE`, `STORE_ADMIN_NAME`, `STORE_ADMIN_PASSWORD`.

`RECAPTCHA_SECRET_KEY` has a dynamic presence-only reader: `src/app/(store-admin)/store-admin/(protected)/settings/storefront/page.tsx:19` passes its name to `src/lib/store-admin/secret-status.ts:25`. No CAPTCHA verification/enforcement consumer was found. A presence indicator does not activate reCAPTCHA. The source also contains test/script fallbacks, so the presence of a name in a script does not mean production requires it.

## Notification events and enqueue paths

The current vocabulary in `src/lib/notifications/types.ts` has 17 events:

`order_placed`, `payment_received`, `processing`, `shipped`, `delivered`, `cancelled`, `refund_requested`, `refund_completed`, `back_in_stock`, `password_reset`, `staff_invite`, `low_stock`, `payment_processing`, `payment_failed`, `reservation_expired`, `refund_pending`, `payment_review`.

`enqueueNotification()` reads enabled matrix cells, settings, templates, and recipients, then writes deduplicated outbox rows. `queueNotification()` is fire-and-forget and schedules a best-effort immediate drain. Confirmed enqueue families are:

- order placement from PayU initiation;
- payment received/processing/failed/review and reservation expiry from PayU response/reconciliation paths;
- cancellation and fulfilment events through order context;
- refund requested from customer/staff request flows and refund completed from staff refund flows;
- low stock from stock adjustment;
- staff invite and password reset from staff/customer auth paths;
- refund pending from the payment/refund paths.

`back_in_stock` is emitted by manual stock adjustments through `src/lib/notifications/stock-events.ts:20` and `src/app/api/store-admin/stock/[productId]/adjust/route.ts:96`. Staff in-app messages target staff recipients; customer in-app is skipped by the current recipient policy (`src/lib/notifications/enqueue.ts:370`). Notification settings use `admin` as the matrix audience label for staff.

## Store-admin screens and visible effects

- Business/profile settings affect identity, receipts, selected storefront metadata, timezone/date bucketing, and login copy/media where those consumers read them.
- Order settings affect numbering, checkout reservation and payment grace/review windows, fulfilment defaults/text, return eligibility, shipping, and the locked pickup state.
- Payment/coupon settings affect available payment paths, coupon validation, refund coupon restoration, and payment notes. Gateway credentials remain environment-only.
- Shipping methods affect checkout rates through `src/lib/checkout/settings.ts:74`. List descriptions claiming storefront footer, tracking or SEO effects are not evidence of consumers: `social_links`, `analytics_scripts`, `store_pages`, `seo_pages` and `payment_methods` had no source table reader outside their generic settings engine in the search. See the per-field appendix before relying on any list field.
- Catalogue, stock, POS, order, return, customer, expense, report, sale, and coupon screens are operational surfaces with corresponding API/domain consumers and audit behavior.
- Notification matrix/templates affect enqueue selection and rendered outbound messages; automated-message delay is currently not honored.
- Staff/profile/audit screens affect store-admin identity and accountability, not the legacy CMS identity.

## Prioritized follow-up

### Wire next

1. Add an explicit scheduler/worker contract for `automated_messages.delay_minutes`, or remove/lock the field until delayed delivery exists.
2. Extend the existing manual-adjustment `back_in_stock` trigger only if waiting-list delivery is required; first define subscriber recipients and reservation semantics.
3. Complete the UNTRACED content-collection field expansion and downstream data-flow matrix in `AUDIT_SETTINGS.md`. The appendix already separates the 58 store settings from customer/sale/theme keys and 63 descriptor-field occurrences across 12 structured settings-list kinds; it does not yet establish per-field consumers for all content collections. Resolve those paths before classifying them as inactive.
4. Build an exhaustive route-to-caller/import graph before classifying any API or component as dead.

### Remove or label as inactive

1. Add visible “Not active yet” treatment to saved-but-unused settings and records, beginning with delayed automated messages and generic integrations.
2. Keep `pickup_enabled` visibly locked as unavailable until pickup is implemented end to end.
3. Reconcile historical `FEATURES.md` counts and claims with current route/event/settings registries.

### Operational only

1. Environment secrets and provider credentials are deployment configuration, not editable store settings.
2. Audit retention, notification outbox draining, reconciliation, migrations, and catalog parity are operational jobs/checks.
3. Legacy CMS/theme/content tables remain separate from store-admin commerce and should not be presented as one unified admin identity.

## Audit limitations

This is a source-traced audit, not a production database dump or a browser crawl. It intentionally avoids secret values and does not infer usage from a table declaration, route filename, or component filename alone. A future dead-code pass should parse imports, framework-discovered pages, server calls, and indirect API callers before deleting anything.
