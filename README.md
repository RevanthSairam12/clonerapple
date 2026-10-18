# Gadzio storefront

A standalone Next.js 16 app — the Gadzio storefront homepage (layout, typography,
assets and interactions) plus the shop, search, support, cart and checkout routes.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run build && npm run start    # production
npm run typecheck                 # tsc --noEmit
```

Requires Node 20.9+.

## What's inside

```
src/app/
  page.tsx            route + metadata
  layout.tsx          html/body shell
  globals.css         tailwind + the site stylesheet
  gadzio.css          design tokens and the rules
                      utilities can't express (dot pills, scrims, hairlines)
src/components/sites/www-apple-com-736d3707/root-8a5edab2/
  GadzioHomePage.tsx  page shell; owns banner state and content offset
  LocaleBanner.tsx    fixed dismissible banner
  GlobalNav.tsx       fixed bar, click-driven flyouts, search, mobile drawer
  NavFlyoutGroups.tsx / NavSearchPanel.tsx
  HeroSection.tsx     3 full-bleed tiles (+ HeroInlineMedia video stage)
  PromoSection.tsx    6 tiles, 1 → 2 columns
  TileCard.tsx        shared tile
  EndlessEntertainmentGallery.tsx   two synced carousels
  GlobalFooter.tsx    footnotes, directory (accordion on mobile), legal row
  ArtDirectedPicture.tsx
  icons.tsx           13 icon components
  data/               nav, tiles, gallery, footer, locale-banner content
public/sites/www-apple-com-736d3707/root-8a5edab2/
  images/ videos/ fonts/ seo/     256 files
```

## Behaviour notes

- **Breakpoints** 735 / 834 / 1069 px (Tailwind variants `am:` `anav:` `al:`).
- **Nav flyouts open on click**, not hover — that's what the live page does.
- **Gallery** auto-advances every 4.16 s with a 1 s slide; dots jump, the round
  control pauses.
- **Locale banner** offsets the fixed nav; dismissing it lifts the page content.
- Images use plain `<picture>` + `<source media>` rather than `next/image`, because
  the design art-directs a different crop per breakpoint (and per viewport height
  for the hero) — something `next/image` can't express.

## Assets

All imagery, video, wordmarks and the SF Pro font files were downloaded from
apple.com and remain **© Apple Inc.** They're included here so the page renders
exactly like the original. This project is a personal/educational reproduction —
it isn't affiliated with or endorsed by Apple, and the assets aren't licensed for
redistribution or commercial use. Swap them for your own before publishing
anything.

Apple product names and compatibility statements (iPhone, iPad, AirPods, MagSafe
and similar) are legitimate references to the devices Gadzio accessories fit —
not affiliation claims. Marketing links no longer navigate to apple.com.

## PayU Hosted Checkout Integration

The Gadzio platform includes a production-grade, secure integration of **PayU Hosted Checkout** (redirect flow) adhering strictly to PayU India's cryptographic and security standards.

### How the Payment Flow Works

```
[Browser]              [Gadzio Server]             [PayU Gateway]
   |                          |                          |
   |--- 1. POST /initiate --->|                          |
   |    (items, customer)     | (compute DB totals,      |
   |                          |  create order CREATED,   |
   |                          |  compute SHA-512 hash)   |
   |<-- 2. JSON (hash, fields)|                          |
   |                          |                          |
   |--- 3. Auto-submit form ---------------------------->|
   |       (hidden POST)      |                          |
   |                          |                          |
   |                          |<-- 4. Server Webhook ----|
   |                          |    (reverse-hash check,  |
   |                          |     verify payment API,  |
   |                          |     atomic PAID update)  |
   |                          |                          |
   |<-- 5. Browser Redirect -----------------------------|
   |    (POST to surl/furl)   |                          |
   |                          |                          |
   |--- 6. POST /api/payu/success ---------------------->|
   |                          | (reverse-hash verify,    |
   |                          |  verify payment check,   |
   |                          |  idempotent DB update)   |
   |<-- 7. HTTP 303 GET /order/success?txnid=... --------|
   |                          |                          |
   |--- 8. GET /order/success -> (owner auth & DB status)|
```

1. **Initiate (`POST /api/payu/initiate`)**:
   - Accepts only item IDs and quantities (never client prices).
   - Authoritative prices are resolved from the server product catalog.
   - Generates unique, cryptographic alphanumeric `txnid` (max 25 chars).
   - Computes SHA-512 request hash: `sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)`.
   - Stores Order in PostgreSQL database with `status = 'CREATED'`.
   - Returns parameters to frontend; `salt` is NEVER sent to the client.

2. **Hosted Checkout Auto-Submit (`/checkout`)**:
   - Frontend dynamically creates a hidden `<form method="POST" action="PAYU_BASE_URL/_payment">`.
   - Disables the "Pay Now" button immediately upon click to prevent double submissions.
   - Auto-submits the form to redirect the customer to PayU's hosted payment page.

3. **Browser Return (`POST /api/payu/success`, `/failure`, `/cancel`)**:
   - Recomputes reverse SHA-512 hash using server `SALT` (handling both standard and `additionalCharges`).
   - Verifies hash using constant-time string comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
   - Cross-checks returned `amount` and `key` against stored Order in DB.
   - Performs server-to-server confirmation with PayU's Verify Payment API.
   - Idempotently updates order status with database row locking (`FOR UPDATE`).
   - Issues an **HTTP 303 (See Other)** redirect to `/order/success?txnid=...` to prevent refresh re-submissions and strip sensitive tokens from URL.

4. **Server Webhook (`POST /api/payu/webhook`)**:
   - Primary source of truth for payment status.
   - Performs identical reverse-hash, amount, and txnid validation.
   - Idempotently marks order `PAID` and triggers order fulfillment exactly once.

5. **Reconciliation Worker (`scripts/reconcile-orders.mjs` & `/api/payu/reconcile`)**:
   - Checks orders stuck in `CREATED` or `PENDING` older than 15 minutes.
   - Queries PayU's Verify Payment API server-to-server and reconciles unhandled drop-offs.

---

### How to Run Tests

1. **Cryptographic Hash Unit Tests**:
   ```bash
   node scripts/test-payu-hash.mjs
   ```
   Validates request hash formula (16 pipes), reverse hash formula (17 pipes / 18 fields), `additionalCharges` prefix (18 pipes), and constant-time string equality.

2. **Full Automated Integration Test Suite**:
   ```bash
   node scripts/test-payu-integration.mjs
   ```
   Tests live database order creation, unique `txnid` constraint enforcement, tampering rejection (forged hashes, modified amounts), idempotent state transitions, and replay attack defense.

3. **Manual Test Credentials (PayU Sandbox)**:
   - **Environment**: `PAYU_ENV=test`
   - **Test Success Card**: `5123456789012346`, Expiry: any future date, CVV: `123`, OTP: `123456`
   - **Test Failing Card**: `5123456789012340`, CVV: `123`
   - **Test UPI**: `anything@payu`

---

### How to Go Live

1. **PayU Dashboard Configuration**:
   - Log in to your [PayU Merchant Dashboard](https://onboarding.payu.in) and toggle from **Test** to **Live Mode**.
   - Navigate to **Developer Tools** → **API Keys** to retrieve your live **Merchant Key** and **Merchant Salt**.
   - Navigate to **Developer Tools** → **Webhooks**:
     - Enable Webhooks for **Payment Success**, **Payment Failure**, and **Refund**.
     - Set the Webhook URL: `https://gadzio.in/api/payu/webhook`.

2. **Production Environment Variables**:
   Update your production server or hosting platform environment (e.g. Vercel, AWS):
   ```env
   PAYU_ENV=live
   PAYU_KEY=<YOUR_PRODUCTION_MERCHANT_KEY>
   PAYU_SALT=<YOUR_PRODUCTION_MERCHANT_SALT>
   PAYU_BASE_URL=https://secure.payu.in
   APP_BASE_URL=https://gadzio.in
   CRON_SECRET=<RANDOM_STRONG_SECRET>
   ```

3. **Verification**:
   - Perform a live transaction of ₹1 to ₹10 using a real card or UPI ID.
   - Verify order transitions to `PAID` in database and PayU Dashboard.
   - Verify webhook log confirmation.
   - Issue a refund directly from the PayU Dashboard if desired.

