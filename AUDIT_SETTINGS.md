# Settings Runtime Audit

## Scope and method

This appendix enumerates 58 store `SETTING_FIELDS` in `src/lib/store-admin/settings-rules.ts`, 3 customer setting keys, 3 sale controls (`enabled`, `starts_at`, `ends_at`), 6 `THEME_FIELDS` entries, and separately 63 editable descriptor-field occurrences across 12 structured settings-list kinds. The 63 count includes repeated shared fields such as `is_active` at each list use-site; it is neither a count of unique keys nor a replacement for the 58 store settings. Content collection descriptors in `src/lib/admin/collections.ts` have a provisional inventory below; exact field expansion and downstream consumer tracing remain incomplete and are marked UNTRACED. A consumer means code outside the setting editor, descriptor/rules file, generic persistence/loader, or generic JSON editor that actually reads/branches on the value, renders it, sends it, or uses it in operational/admin documents. A generic `getStoreSettings()`/`getContent()` is not evidence of runtime effect.

Search scope: tracked source beneath `src/`, migrations and tests were inspected to identify actual tables and contracts; `src/app`, `src/components`, and `src/lib` were searched for exact keys, aliases, and data flow. Generated `.next`, `node_modules`, and `.claude/worktrees` copies were excluded. Findings are code-path facts, not claims about live database values. `STORED ONLY` means no actual consumer was found within that scope. Recommendations for such fields are to leave at their safe default and treat as inactive; remove/disable the control or wire it end-to-end before relying on it.

## Store settings

| Key | Runtime consumer / effect | Surface and status |
|---|---|---|
| `trade_name` | `src/lib/notifications/enqueue.ts:353`; `src/lib/notifications/diagnostics.ts:191,245`; `src/components/store-admin/DocumentHeader.tsx:12`; `src/app/(store-admin)/store-admin/(protected)/pos/receipt/[txnid]/page.tsx:33`; `src/lib/storefront/maintenance.ts:266,327` | Notification templates/previews, POS receipt and operational document header, and maintenance page store name. Includes operational/admin-document and storefront-maintenance use. |
| `legal_name` | STORED ONLY | Leave blank; do not treat as invoice/legal identity until invoice generation consumes it. |
| `email` | `src/lib/notifications/enqueue.ts:231,355`; `src/components/store-admin/DocumentHeader.tsx:15` | Notification recipients/support address and operational document header. |
| `phone` | `src/lib/notifications/enqueue.ts:232,354`; `src/components/store-admin/DocumentHeader.tsx:14` | Notification recipients/support phone and operational document header. |
| `address` | `src/components/store-admin/DocumentHeader.tsx:13` | Operational document header address (invoice/receipt/packing-slip surfaces that render the shared header). |
| `country` | STORED ONLY | Default is informational only; no country-dependent runtime behavior found. |
| `timezone` | `src/lib/store-admin/sale.ts:52-60`; `src/lib/store-admin/store-clock.ts:7,34`; `src/lib/store-admin/analytics.ts:27,218`; `src/lib/store-admin/reports.ts:33,330,820,972`; `src/lib/storefront/maintenance.ts:266-281,317,366` | Sale window interpretation and admin display, store-day analytics/report boundaries and labels, plus maintenance window parsing and expected-end display (admin and storefront). |
| `time_format` | STORED ONLY | Do not rely on this to affect displayed clocks; leave default. |
| `footer_text` | STORED ONLY | Do not rely on storefront footer output; use content/theme override where available. |
| `receipt_footer` | `src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/invoice/page.tsx:83`; `src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/packing-slip/page.tsx:75`; `src/app/(store-admin)/store-admin/(protected)/pos/receipt/[txnid]/page.tsx:37` | Printed at the bottom of admin invoice, packing slip, and POS receipt documents. |
| `cookie_notice` | STORED ONLY | No storefront notice consumer found; do not use as consent mechanism. |
| `logo_media_id` | STORED ONLY | No media lookup/render consumer found. |
| `favicon_media_id` | STORED ONLY | No favicon consumer found. |
| `order_prefix` | `src/app/api/payu/initiate/route.ts:299` | Online order reference creation. |
| `order_start_number` | `src/app/api/payu/initiate/route.ts:300` | Online order sequence initialization. |
| `invoice_prefix` | `src/app/(store-admin)/store-admin/(protected)/orders/[txnid]/invoice/page.tsx:90` | Used to construct the admin-generated order invoice identifier/document. |
| `auto_confirm` | `src/lib/payU/orders.ts:890-898` | Controls whether a newly created PayU order is marked confirmed (operational order creation). |
| `shipping_enabled` | `src/lib/checkout/settings.ts:67` | Checkout shipping policy; disables shipping availability. |
| `pos_confirm_unusual_price` | `src/lib/store-admin/pos.ts:523` | POS cashier confirmation for unusual entered prices (operational). |
| `pickup_enabled` | `src/lib/store-admin/settings-rules.ts:671` | Hard-coded `pickupEnabled()` always returns false; field is locked off. Inactive by design. Keep off; checkout has no pickup method. |
| `free_shipping_over` | `src/lib/checkout/settings.ts:68` | Converted to paise and used by shipping policy. |
| `auto_cancel_unpaid_hours` | `src/lib/payU/reconcile.ts:102` | Configures unpaid-order reconciliation expiry (operational). |
| `reservation_seconds` | `src/lib/checkout/reservation-rules.ts:47-50` | Checkout inventory reservation duration. |
| `payment_failure_grace_seconds` | `src/lib/checkout/reservation-rules.ts:51-52` | Failed-payment stock reservation grace. |
| `payment_unresolved_minutes` | `src/lib/checkout/reservation-rules.ts:52` | Unresolved-payment reservation window. |
| `return_window_days` | `src/lib/account/return-window.ts:20`; `src/lib/notifications/enqueue.ts:356` | Return eligibility and notification copy (storefront/account and notification). |
| `default_fulfilment_status` | `src/lib/payU/orders.ts:890-898` | Supplies the initial fulfilment status when a PayU order is created (operational). |
| `processing_time_text` | STORED ONLY | Not rendered on product/checkout pages; leave default. |
| `cutoff_text` | STORED ONLY | Not rendered on storefront; leave default. |
| `coupons_enabled` | `src/app/checkout/page.tsx:98`; `src/app/cart/page.tsx:27`; `src/app/bag/page.tsx:27`; `src/app/api/coupons/validate/route.ts:91`; `src/app/api/payu/initiate/route.ts:272` | Controls coupon UI and server validation (storefront/checkout). |
| `refunds_restore_coupon` | `src/lib/store-admin/returns.ts:770` | Refund action restores coupon use when enabled (operational). |
| `cod_enabled` | STORED ONLY | No COD method selector/processor found. Keep off; enabling has no effect. |
| `payu_enabled` | `src/app/api/payu/initiate/route.ts:118` | Rejects/permits PayU initiation. |
| `manual_payments_enabled` | STORED ONLY | No manual UPI/bank transfer checkout flow found. Keep off; enabling has no effect. |
| `payu_mode` | STORED ONLY | No runtime read found; gateway configuration is environment-based. Do not use this as a live/test switch. |
| `payment_note` | `src/app/checkout/page.tsx:95` | Passed as checkout payment note (storefront). |
| `mail_driver` | `src/lib/notifications/providers.ts:69` | Selects log-only vs SMTP channel (operational). |
| `mail_status` | `src/lib/notifications/providers.ts:72` | Enables/disables email delivery (operational). |
| `mail_host` | `src/lib/notifications/providers.ts:75,168`; `src/lib/notifications/diagnostics.ts:145` | SMTP transport and diagnostics. |
| `mail_port` | `src/lib/notifications/providers.ts:87,169`; `src/lib/notifications/diagnostics.ts:146` | SMTP transport and diagnostics. |
| `mail_username` | `src/lib/notifications/providers.ts:166`; `src/lib/notifications/diagnostics.ts:148` | SMTP authentication configuration/diagnostics. |
| `mail_encryption` | `src/lib/notifications/providers.ts:170-171` | Sets SMTP SSL/STARTTLS behavior. |
| `mail_from_email` | `src/lib/notifications/providers.ts:81,189`; `src/lib/notifications/diagnostics.ts:186` | Sender identity and diagnostics. |
| `mail_from_name` | `src/lib/notifications/providers.ts:190`; `src/lib/notifications/diagnostics.ts:200` | Sender display name. |
| `sms_gateway` | `src/lib/notifications/providers.ts:102,336`; `src/lib/notifications/diagnostics.ts:251` | Selects MSG91/Twilio provider (operational). |
| `sms_status` | `src/lib/notifications/providers.ts:99`; `src/lib/notifications/diagnostics.ts:291` | Enables/disables SMS delivery. |
| `sms_sender_id` | `src/lib/notifications/providers.ts:219,283`; `src/lib/notifications/diagnostics.ts:298` | Provider sender identity. |
| `sms_dlt_template_id` | `src/lib/notifications/providers.ts:220`; `src/lib/notifications/diagnostics.ts:308` | MSG91 DLT template configuration. |
| `login_heading` | STORED ONLY | No sign-in screen consumer found. Leave default. |
| `login_subheading` | STORED ONLY | No sign-in screen consumer found. Leave blank. |
| `login_background_media_id` | STORED ONLY | No login media lookup/render consumer found. Leave blank. |
| `login_support_link` | STORED ONLY | No staff login support-link consumer found. Leave blank. |
| `recaptcha_site_key` | STORED ONLY | No reCAPTCHA widget/API consumer found. Keep unset; this setting alone does not provide bot protection. |
| `recaptcha_status` | STORED ONLY as an enforcement toggle. Separate presence-only secret status: `src/app/(store-admin)/store-admin/(protected)/settings/storefront/page.tsx:18-20,63-69` → `src/lib/store-admin/secret-status.ts:25`. | The admin screen reports only whether `RECAPTCHA_SECRET_KEY` is configured; that check does not read or enforce this toggle, validate a token, or protect login. Keep off; secret presence does not establish CAPTCHA enforcement. |
| `maintenance_enabled` | `src/lib/storefront/maintenance.ts:268` | Storefront request gate (storefront availability); owner-only setting. |
| `maintenance_message` | `src/lib/storefront/maintenance.ts:136` | Message shown by maintenance response (storefront). |
| `maintenance_starts_at` | `src/lib/storefront/maintenance.ts:136` | Maintenance window start boundary. |
| `maintenance_ends_at` | `src/lib/storefront/maintenance.ts:136` | Maintenance window end boundary. |

## Customer settings

| Key | Runtime consumer / effect | Surface and status |
|---|---|---|
| `guest_checkout` | `src/app/checkout/page.tsx:35`; `src/app/api/payu/initiate/route.ts:100` | Storefront checkout gate and server-side guest-payment eligibility check. |
| `default_customer_group` | `src/lib/user-auth.ts:125-131`; call at `:215`, inserted into `users.customer_group` at `:219-222` | Applied to newly created consumer accounts; accepts `vip`/`wholesale` or falls back to `retail`. Existing accounts are not changed. |
| `checkout_marketing_optin` | `src/app/checkout/page.tsx:93`; `src/app/api/payu/initiate/route.ts:403` | Controls checkout marketing opt-in UI and whether an explicit submitted opt-in is accepted; does not imply consent is preselected. |

## Structured settings lists (`LIST_KINDS`)

All 12 kinds and all 63 editable descriptor-field occurrences in `src/lib/store-admin/setting-lists.ts:77-383` are covered below. Multiple fields share a row only when their status is the same. The generic `listSettingRows()` at `:431-449`, settings pages, `SettingList.tsx`, and the lists API are editor/persistence paths, not business consumers. Generated IDs, `updated_at`, and fixed SEO `page_key` are structural keys rather than editable field descriptors.

| Kind / table | Descriptor field(s) | Downstream consumer / status and recommendation |
|---|---|---|
| `fulfilment-providers` / `fulfilment_providers` | `name`, `tracking_template`, `is_active` | `src/lib/store-admin/orders.ts:1057-1073`: active courier matched by name supplies a tracking URL template when staff omit an explicit URL. Operational order administration. |
| `fulfilment-providers` | `sort_order` | STORED ONLY outside the generic list editor; order lookup does not use this ordering. Do not rely on it to prioritize providers. |
| `shipping-methods` / `shipping_methods` | `name`, `rate_paise`, `free_over_paise`, `is_active`, `sort_order` | `src/lib/checkout/settings.ts:55-63,74-81`: selected and mapped into the checkout shipping policy. Storefront shipping method identity, rate, threshold, availability and ordering. |
| `shipping-methods` | `eta_min_days`, `eta_max_days` | STORED ONLY: checkout reader does not select either field. Treat delivery-time controls as inactive until an ETA display consumes them. |
| `payment-methods` / `payment_methods` | `code`, `label`, `kind`, `instructions`, `is_active`, `sort_order` | STORED ONLY: descriptor/generic-editor references only in the searched `src` scope. Keep inactive; this list does not enable COD, manual payments, or a gateway. |
| `social-links` / `social_links` | `network`, `url`, `is_active`, `sort_order` | STORED ONLY: no downstream table reader found. Treat footer-link controls as inactive until footer rendering is wired. |
| `analytics-scripts` / `analytics_scripts` | `provider`, `script_id`, `is_active` | STORED ONLY: no downstream table reader found. Keep inactive; saving an ID does not establish script injection or analytics collection. |
| `integrations` / `store_integrations` | `provider`, `region`, `bucket`, `sender_identity`, `webhook_url`, `is_active` | STORED ONLY: no downstream table reader found. Keep inactive; do not rely on these values to configure a provider or webhook. |
| `automated-messages` / `automated_messages` | `message_key`, `channel`, `subject`, `body`, `is_active` | `src/lib/notifications/enqueue.ts:120-129,157-173,317`: active rows matched to the event/channel provide notification copy fallbacks. Operational notification construction; delivery additionally depends on provider and worker readiness. |
| `automated-messages` | `label`, `delay_minutes` | STORED ONLY outside editor: enqueue query does not select them. `label` is an admin label; treat delay control as inactive and do not promise delayed scheduling. |
| `email-templates` / `email_templates` | `template_key`, `subject`, `heading`, `body`, `button_label`, `button_url`, `footer_text`, `is_active` | `src/lib/notifications/enqueue.ts:97-113,159-166,316`: active event template overrides notification email parts, with blank values falling back. Operational notification construction. |
| `email-templates` | `name` | STORED ONLY outside editor: admin display/order label, not email content. Do not expect a recipient-visible effect. |
| `pages` / `store_pages` | `slug`, `title`, `body`, `seo_title`, `seo_description`, `status` | STORED ONLY: no downstream table reader found. Treat publishing and SEO controls as inactive; do not assume a published row creates a storefront route. |
| `seo` / `seo_pages` | `meta_title`, `meta_description`, `meta_image_media_id`, `robots_index`, `robots_follow` | STORED ONLY: no downstream table reader found. Treat these controls as inactive; do not rely on them for metadata or indexing behavior. |
| `refund-reasons` / `refund_reasons` | `label`, `is_active`, `sort_order` | STORED ONLY: no downstream table reader found. Treat pick-list configuration as inactive until refund operations read this table. |
| `return-reasons` / `return_reasons` | `label`, `is_active`, `sort_order` | STORED ONLY: no downstream table reader found. Treat pick-list configuration as inactive until return operations read this table. |

The negative findings above are limited to table-name and field searches in `src`; they exclude generic descriptor/editor references and do not assert anything about live rows or external consumers.

## Sale settings

| Field | Runtime consumer / effect | Surface and status |
|---|---|---|
| `enabled` | `src/lib/storefront/sale-state.ts:60-75`, consumed through `src/lib/storefront/sale.ts` and `src/lib/catalog/storefront.ts` | Sale state affects storefront catalog pricing/display. |
| `starts_at`, `ends_at` | `src/lib/storefront/sale-state.ts:60-75` | Database-clock window determines whether sale is active; admin also displays state. |

## Site theme registry (`THEME_FIELDS`)

| Key | Runtime consumer / effect | Surface and status |
|---|---|---|
| `fontFamily` | `src/lib/fonts.ts:35`; `src/app/layout.tsx` | Allow-listed font resolved into site font styling. |
| `logoText` | STORED ONLY for site-wide theme row; `oppo.nav.logoText` is separate content data | Do not expect this global setting to alter OPPO navigation; edit the OPPO nav collection instead. |
| `appleCopyright` | `src/app/page.tsx:74-75` | Overrides homepage footer copyright (storefront). |
| `oppoPrimaryColor` | `src/app/layout.tsx:25` | Sets OPPO green CSS variable (storefront). |
| `oppoGreenDark` | STORED ONLY | No CSS/runtime consumer found; leave default. |
| `oppoGreenLight` | STORED ONLY | No CSS/runtime consumer found; leave default. |

## Structured content field and list descriptors

The collection registry is `src/lib/admin/collections.ts`. The rows below inventory descriptor paths but their consumer data flow remains UNTRACED. Generic loading and absence of literal property matches do not establish that these values are inactive. Do not change content or disable controls on the basis of this section. Education Store remains deferred.

| Collection / descriptor path(s) | Actual consumer or status |
|---|---|
| `apple.hero_tiles` list `heroTiles[]`: `headline`, `subheadText`, `href`, `ctas[0..1].label`, `ctas[0..1].href`, `infoTooltip`, `imageSrc`, `imageSmallSrc`, `imageSmall2xSrc`, `imageMediumSrc`, `imageMedium2xSrc`, `imageLargeSrc`, `imageLarge2xSrc` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `apple.hero_video` top-level `imageSrc` and responsive image variants; list `clips[]`: `label`, `src`, `left`, `width` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `apple.promo_section`: `heading`; list `promoTiles[]` and all `TILE_ITEM_FIELDS` paths | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `apple.ribbon`: `text`, `shopHref` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `apple.locale_banner`: `copy`, `selectedLabel`, `continueLabel`, `continueHref` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `apple.nav`: `searchPlaceholder`; list `items[]` (`label`, `href`) | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `apple.footer`: `footnotesHtml`, `copyright`, `localeLabel`, `localeHref` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `apple.gallery`: `heading`, `secondRowEnabled`; list `items[]`: `title` and all responsive image fields | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `apple.seo`: `title`, `description`, `ogTitle` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.announce`: `text`, `linkLabel`, `linkHref` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.nav`: `logoText`; lists `leftLinks[]`, `rightLinks[]` (`label`, `href`) | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.hero_slides` list `slides[]`: `title`, `subtitle`, `image`, `learnMoreHref`, `buyNowHref` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.hot_sale`: `badge`, `title`, `tagline`, `image`, `learnLabel`, `buyLabel` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.products` list `items[]`: `title`, `titleSup`, `image`, `descriptions`, `learnHref`, `buyHref` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.offers`: `heading`; list `items[]`: `title`, `description`, `image`, `href` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.explore`: `heading`; list `items[]`: `title`, `description`, `image`, `href` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.support`: `heading`; list `items[]`: `label` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.community`: scalar fields; list `cards[]`: `title`, `subtitle`, `image` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.footer`: `disclaimer1`, `disclaimer2`, `disclaimer3`, `tagline` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `oppo.seo`: `title`, `description` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `edu.hero`: `headline`, `subhead` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `edu.product_nav` list `items[]`: `headline`, `tag`, `desc`, `price`, `image`, `href`, `dark`, `savingsBadge` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| Each of `edu.shelf_savings`, `edu.shelf_ways_to_save`, `edu.shelf_difference`, `edu.shelf_accessories`, `edu.shelf_potential`, `edu.shelf_more_to_love`, `edu.shelf_experience`: `headline`, `subhead`, `enabled`; list `cards[]` with the `EDU_CARD_ITEM_FIELDS` above | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `edu.quick_links` list `items[]`: `label`, `href` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `edu.seo`: `title`, `description` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `cases.category_links` list `items[]`: `label`, `href` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `cases.page_header`: `title`, `sortLabel` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |
| `cases.seo`: `title`, `description` | UNTRACED: downstream per-field consumer not yet established; no inactive classification or recommendation. |

### Descriptor-field completeness notes

Shared schemas and some abbreviated field groups still need an exact per-field expansion and consumer trace. Editor-only schema metadata (labels, hints, types, options and item limits) is distinct from saved content values.


## Key inactive-setting findings

Many `store_settings` descriptors advertise controls whose values are not consumed: legal name, country/time format, storefront footer/media controls, fulfillment copy, COD/manual payments, PayU mode, staff login copy/background/support and reCAPTCHA fields. These are saved values, not implemented behavior. Keep safe defaults and do not promise operational or customer-facing effects until each path is wired and tested. Invoice prefix, auto-confirm, initial fulfillment status, receipt footer, business contact fields and customer-group defaults have confirmed consumers above and must not be classified as inactive. Store pickup is explicitly locked off and hard-coded false. The theme palette contains two unused OPPO color keys and a global `logoText` that is distinct from content-block navigation data.

## Audit limitations

The store-setting, customer-setting and structured settings-list inventories are enumerated above. The content-collection section is a descriptor inventory with unresolved data-flow tracing, not a completed per-field runtime audit. Absence of a direct path match does not prove a JSON value is unused: spread props, aliases and whole-object rendering require further tracing. No inactive recommendation should be inferred for those unresolved collection paths, including Education Store (which remains deferred). This appendix therefore does not claim exhaustive runtime-consumer certainty for all content descriptors.
