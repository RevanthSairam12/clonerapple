# REMAINING_NOTES.md — Engineering Notes & Decisions

**Branch:** `backup/remaining-work-20261108`  
**Date:** 8 November 2026

---

## 1. Decisions Taken Without an Answer (Rule 2)

1. **Stage 5 Item (8) — Stored-Only Settings Disposition (Conservative / Recommended Option):**
   - **Wired to storefront:**
     - **Store pages (`store_pages`):** `/privacy`, `/terms`, and `/support` read published `store_pages` rows (falling back to the built-in copy when absent or in `draft` status) via `src/lib/storefront/site-pages.ts`.
     - **Footer & business details (`store_settings`):** `trade_name`, `legal_name`, `email`, `phone`, `address`, `footer_text`, and `cookie_notice` are wired to `/support`, `/privacy`, `/terms`, and `GlobalFooter` / `GadzioFooter` (in addition to order receipts, invoices, and the `/account` support card).
     - **SEO titles & descriptions (`seo_pages`):** `readSeoPageOverride` in `src/lib/storefront/site-pages.ts` reads `seo_pages` fallback metadata for `privacy`, `terms`, `support`, and `search` (while homepage, Cases, and Education SEO remain managed under Website → Content).
   - **Labelled `"Not active yet"` in Store Admin help text:**
     - **Social links (`social_links`), Analytics scripts (`analytics_scripts`), and Integrations (`store_integrations`):** Clearly labelled `"Not active yet"` in `src/lib/store-admin/setting-lists.ts`.
     - **reCAPTCHA / Bot protection (`recaptcha_site_key`, `recaptcha_status`):** Clearly labelled `"Not active yet"` in `src/lib/store-admin/settings-rules.ts` (bot protection is currently handled by per-route rate limiting and same-origin guards).
     - **Customer login page copy (`login_heading`, `login_subheading`, `login_background_media_id`):** Clearly labelled `"Not active yet"` in `src/lib/store-admin/settings-rules.ts`.
     - **Cash on delivery (`cod_enabled`) and automated message delay (`automated_messages.delay_minutes`):** Clearly labelled `"Not active yet"`.

2. **Stage 6(c) — Email (SMTP) & SMS (MSG91 / Twilio) Credentials:**
   - Because live SMTP and SMS credentials were not supplied in `.env.local`, `mail_driver` remains `log` (outbox rows are recorded cleanly without external network delivery) and `sms_status` remains `off`. `node scripts/check-notifications.mjs` verifies that all 102 notification templates render cleanly with zero unresolved tokens or secret leaks, and reports the exact readiness steps needed when production credentials are provided.

---

## 2. Summary of Completed Stages (0 through 7)

- **Stage 0:** Saved work on `backup/remaining-work-20261108`, verified test DB on `aws-0-ap-northeast-1.pooler.supabase.com:5432`, cleaned up empty `idxprobe` schema.
- **Stage 1:** Audited all plans and codebase/tests in `STATUS_MATRIX.md`.
- **Stage 2:** Atomic one-active-checkout resume/supersede (`pg_advisory_xact_lock`, `isIdenticalCheckoutAttempt`, own-hold availability exclusion), shared Payment & Order status glossary (`derivePaymentAndOrderStatus`), `GET /api/payu/reconcile` + DB heartbeat (`src/lib/payu/reconcile-heartbeat.ts`) + `docs/reconcile-scheduling.md`, and Store Admin **Needs attention** + **Background jobs** panels (`src/lib/store-admin/needs-attention.ts`).
- **Stage 3:** Post-commit per-option low-stock staff notifications for web checkout (`createOrderUsing`) and POS sales (`createPosSaleUsing`) with per-crossing deduplication (`movement:<id>`).
- **Stage 4:** Moved plain reads before `orders` and `stock` row locks in `createOrderUsing` while preserving lock order `orders -> stock -> coupons -> order_number_counters`, and collapsed coupon evaluation from 6 SQL round trips to 2 (`loadCouponDefinition` + `readCouponCustomerContext`).
- **Stage 5:**
  - Cancelled orders hide active shipment details across customer, admin detail, packing slip, and status loaders and log `shipment_cancelled`.
  - Plain-language field help across all 60 `store_settings` fields, 66 fields across 13 `setting-lists`, 218 Website/Theme fields, and 16 core `ProductHelp` rules, verified by `npm run check:field-help` (`scripts/check-field-help.mjs`).
  - Restyled `/account/*` and `/auth` to match home page Gadzio design tokens (`#ffe100`, `#1d1d1f`, `transducer`, shared `GadzioHeader` + `GlobalFooter`).
  - Rendered `/privacy`, `/terms`, and `/support` inside the shared storefront layout reading `store_pages`, `store_settings`, and `seo_pages`, verified by `npm run check:links` (`scripts/check-links.mjs`).
  - Added `GET /api/search/suggest` (`src/lib/storefront/search-suggest.ts`) and accessible combobox typeahead suggestions in `src/components/header/GadzioHeader.tsx`.
- **Stage 6:** Full verification (`1,873 tests: 1,778 pass, 0 fail`, plus real PostgreSQL integration suites for Stages 2–5; `npm run typecheck`; `npm run build`; all 7 check scripts; `npm audit` 0 vulnerabilities).
- **Stage 7:** Prepared `docs/staging-checklist.md` for staging & production rollout.
