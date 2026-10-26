# Gadzio Store Admin — 6amMart-Parity Rebuild Plan

**Status:** proposal
**Date:** 2026-10-24
**Target:** `apple-clone` — Next.js 16 App Router, existing `/store-admin`
**Reference:** 6amMart v4.0 admin panel (Laravel + Blade)
**Scope:** Overview · Sales · Catalog · Customers · Reports · Settings — single online store, electronic gadgets

---

## 1. Decision summary

Build the six sections above to **6amMart admin depth**: grouped sidebar, KPI
dashboards, filter-heavy list screens, quick-view side panels, order timelines,
invoice print, returns/refunds, catalogue with variants and reviews, customer 360,
a full report set, and a business-settings suite.

The UI reproduces 6amMart's **structure, density and interaction model**: fixed
left sidebar with collapsible groups and pinning, top bar with search and
notifications, card-based dashboards, data tables with status badges, offcanvas
quick views, tabbed detail pages, and sectioned settings forms.

This is a **single-store e-commerce** admin. Every marketplace / quick-commerce
module is excluded — see §6.

### Decisions locked (2026-10-24)

| Decision | Choice |
|---|---|
| Store credit / wallet | **Excluded** |
| Loyalty programme | **Excluded** |
| Serial / IMEI tracking | **Excluded** |
| POS | **Kept and visible** — existing module, unchanged |
| PayU refund API | **Excluded** — refunds are recorded manually against the order |
| Courier API | **Excluded** — tracking URL template only; Gadzio supplies the URL |
| Marketing (coupons, banners, campaigns) | **Excluded** |
| Vendors, riders, zones, parcels, subscriptions | **Excluded** |
| Dark mode, private media, social login | **Deferred** |
| Email/SMS provider choice | **Deferred** — templates and settings built, provider wired when chosen |

### IP constraint

The 6amMart copy on disk is a **nulled** distribution. It is used strictly as a
visual and functional reference:

- No Blade/PHP code, CSS/JS bundles, fonts, icons, images or migrations are copied
  into this repository.
- The theme is re-created as original CSS in the existing `sa-*` namespace, matching
  layout, spacing and behaviour — not lifting the proprietary stylesheet.
- Nothing from the nulled package is deployed or run.
- If any 6amMart code or asset is ever wanted, a legitimate licence must be bought
  first.

This gives the "same UI" in the practical sense: the same screens, same navigation,
same table/form/panel anatomy, same workflows. It does not mean shipping their
copyrighted theme files.

---

## 2. Product context

| Item | Value |
|---|---|
| Business | Gadzio — electronic gadgets |
| Model | Single online store, standard e-commerce |
| Orders | Web checkout (PayU) + manually recorded payments |
| Refunds | Recorded manually in the admin; no PayU refund API |
| Fulfilment | Third-party courier; admin stores courier + tracking number, and builds the tracking link from a configured URL template |
| Currency | INR (paise internally) |
| Tax | Not GST-registered; "Receipt / Bill of Supply" |
| Storefront | Existing Next.js app |
| Admin users | `store_owner` ⊇ `store_admin` ⊇ `store_viewer` (fixed by `AGENTS.md`) |

**No** vendors, nearby stores, riders, zones, parcels, delivery slots as dispatch,
subscriptions, store credit, loyalty, or marketplace commissions.

---

## 3. Scope contract

Exactly six sidebar sections:

1. **Overview** — sales, users and transactions dashboards.
2. **Sales** — orders, order detail, quick view, invoice, manual payments, refunds,
   returns, cancellation reasons, order edit logs, exports, POS.
3. **Catalog** — products, variants, categories, attributes, brands, units,
   conditions, add-ons, gallery, reviews, stock, import/export.
4. **Customers** — customer list, 360 view, user accounts, subscribers, customer
   settings.
5. **Reports** — order, item, day-wise, transactions, expenses, stock, low stock,
   customers, payments.
6. **Settings** — business profile, fulfilment, payments, email/SMS, templates,
   notifications, analytics, SEO, social, pages, maintenance, reasons, staff, audit,
   media.

Explicitly **not** in scope: store credit/wallet, loyalty, serial/IMEI tracking,
marketing campaigns, coupons, flash sales, banners, push notifications, vendors,
delivery fleet, zones, parcels, subscriptions, multi-language, multi-currency, app
settings, module/add-on platform, landing-page builder.

---

## 4. UI parity specification

### 4.1 Shell

```
┌──────────────┬─────────────────────────────────────────────────────────────┐
│  Gadzio      │  ☰   Search orders, products, customers…   ＋  🔔  Avatar  │
│  Store Desk  ├─────────────────────────────────────────────────────────────┤
│              │  Dashboard / Orders                    [Export] [+ New]      │
│  OVERVIEW    │                                                             │
│   Overview   │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│              │  │ Revenue │ │ Orders  │ │ AOV     │ │ Refunds │            │
│  SALES       │  └─────────┘ └─────────┘ └─────────┘ └─────────┘            │
│   Orders     │                                                             │
│   Returns    │  ┌──────────────────────────────┐ ┌───────────────────────┐ │
│   Requests   │  │ Sales chart                  │ │ Order status          │ │
│   Payments   │  └──────────────────────────────┘ └───────────────────────┘ │
│   POS        │                                                             │
│              │  ┌───────────────────────────────────────────────────────┐  │
│  CATALOG     │  │ Recent orders table                                   │  │
│   Products   │  └───────────────────────────────────────────────────────┘  │
│   Categories │                                                             │
│   …          │                                                             │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

| Element | Specification |
|---|---|
| Sidebar | 260px fixed; brand block 64px; uppercase section labels; 40px items, 8px radius, icon + label + optional chevron; active item tinted with left marker; group collapse persisted; pin favourites to a "Pinned" block; collapses to a 72px icon rail below 1200px; overlay drawer below 768px |
| Top bar | 64px; hamburger, global search, quick-create, notification bell with unread count, avatar menu (name, role, sign out) |
| Content | neutral light-grey page background; 20–24px gutters; max-width 1440px; white cards with 1px border, 8–12px radius, subtle shadow |
| Page header | title 22–24px semibold, muted subtitle, breadcrumb, right-aligned primary + secondary actions |
| Density | table text 13px, row height 48px, form labels 12.5px, inputs 40px — matches the reference's compact operations feel |

Responsive breakpoints: 1440 (full), 1200 (mini rail), 992 (rail + condensed
tables), 768 (drawer + stacked cards), 390 (single column).

### 4.2 Component anatomy

**Stat card** — 44px tinted icon tile, 12px uppercase label, 28px value, delta pill
(green/red), click-through to the filtered list.

**Data table** — toolbar above (search, filter chips, date range, status select,
column sort, page size); optional bulk-select column; sticky header; 13px rows;
status badges; right-aligned money; row action menu; footer with row range,
page size and pagination. Header stays fixed while the body scrolls on long lists.

**Quick-view offcanvas** — 480px right panel for orders and customers, opened from
a table row without leaving the list; shows summary, items, payment, timeline, and
primary actions.

**Detail page** — header with ID, status pill, primary actions; underline tabs
(Summary · Items · Payments · Timeline · Notes); right rail for customer, shipping
and shipment; append-only timeline.

**Form** — sectioned white cards (Basics, Pricing, Inventory, Media, SEO,
Visibility); two-column grid at ≥1024px; sticky bottom action bar; dirty-state
guard; inline errors; image uploader with drag-reorder and alt text.

**Settings** — left sub-navigation inside the section, content in cards; each card
has a title, helper text, fields, and a save action; destructive changes use a
confirmation modal.

**Feedback** — toast on success/failure; modal confirmation for destructive
writes; skeleton loaders; empty states with a next action; permission-denied panel
naming the required role.

**Print** — A4 invoice and packing-slip styles, isolated print CSS, store logo,
order/line/payment/shipment blocks.

### 4.3 Interaction parity

- Search-as-you-type in list toolbars, debounced, URL-synced.
- Status tabs on the orders list (`All · Pending · Processing · Shipped ·
  Delivered · Cancelled · Refunded · Failed`).
- Row click opens the detail page; a secondary "quick view" action opens the
  offcanvas.
- Bulk selection with bulk actions.
- Inline status changes where safe, with optimistic update and rollback.
- Keyboard: `/` focus search, `g o` orders, `g p` products, `Esc` closes overlays.
- All state survives refresh through query parameters.

### 4.4 Design tokens

Extend `src/app/(store-admin)/store-admin/store-admin.css` with a token layer:

| Token group | Purpose |
|---|---|
| `--sa-ink`, `--sa-muted`, `--sa-faint` | text hierarchy |
| `--sa-paper`, `--sa-card`, `--sa-line` | page, card, hairline |
| `--sa-accent`, `--sa-accent-soft` | primary actions, active nav, focus |
| `--sa-ok`, `--sa-warn`, `--sa-danger`, `--sa-info` + soft variants | status badges |
| `--sa-r-sm/md/lg` | 4 / 8 / 12px radii |
| `--sa-shadow-card`, `--sa-shadow-pop` | card and overlay elevation |
| spacing scale 4/8/12/16/20/24/32 | layout rhythm |

Rules: no colour-only status, minimum 4.5:1 text contrast, visible focus rings,
`prefers-reduced-motion`, 24×24px minimum hit targets.

---

## 5. Functional specification

**Appendix C is the field-level completeness checklist.** Every field on an
in-scope 6amMart screen is either mapped to a Gadzio field, marked Extend (added
for this business), or marked Skip with the reason. This section describes
behaviour; Appendix C is the inventory that proves nothing was missed.

### 5.1 Overview

Three tabs, mirroring 6amMart's dashboard, dashboard-users and
dashboard-transactions screens.

**Sales tab**
- KPI cards: gross revenue, paid orders, average order value, discounts, refunds,
  net revenue, failed payments, pending fulfilment.
- Period switch: Today / 7 days / 30 days / 90 days / This month / Custom, with
  comparison delta against the previous equal period.
- Sales chart: revenue and order count; switchable bar/line.
- Order-status breakdown: pending, processing, shipped, delivered, cancelled,
  payment failed, refunded.
- Top products by revenue and units; top categories/brands.
- Recent orders (10) with status and quick view.
- Action queues: unpaid orders, failed payments, refunds awaiting action, open
  requests, low-stock and out-of-stock SKUs.

**Users tab**
- Total customers, new in period, returning, guest vs registered.
- Signup trend chart.
- Top customers by spend.
- Recently registered list with link to the 360 view.

**Transactions tab**
- Payments received by method (PayU, UPI, bank, cash, card machine).
- Refunds issued.
- Net cash movement for the period.
- Recent transactions with order link and reconciliation status.

All figures are computed in SQL from `orders`, `order_items`, `order_payments`,
`refunds`, `users` and `customers`; never from client state.

### 5.2 Sales

**Orders list**
- Search: order ID, txnid, customer name, email, phone, product name/SKU.
- Filters: payment status, fulfilment status, channel (web/POS/manual), date range,
  amount range, courier, refund state.
- Status tabs as in §4.3.
- Sort: newest, oldest, highest value, most items.
- Columns: order, date, customer, items, total, payment, fulfilment, channel,
  actions.
- Quick view offcanvas per row.
- Bulk actions: export, mark processing, print invoices.
- Saved views (personal and shared).

**Order detail**
- Header: order number, date, status pills (payment + fulfilment), actions
  (invoice, packing slip, refund, cancel, resend email).
- Summary tab: customer, shipping address, billing address, notes, totals.
- Items tab: product, variant, SKU, quantity, unit price, line total. Cart may be
  edited only while unfulfilled, and the edit is audited.
- Payments tab: captured, refunded, balance; payment rows from `order_payments`;
  manual payment recording; reconciliation state.
- Timeline tab: append-only `order_status_history` (payment and fulfilment domains).
- Notes tab: internal notes only, never customer-visible.
- Shipment block: courier, tracking number, shipped/delivered dates, and a
  **tracking link built from the configured URL template**. No courier API call is
  made; Gadzio supplies the template.
- Order edit history: every edit stores a before/after summary in an immutable log.

**Manual payments / offline verification**
- List of orders awaiting manual verification.
- Verify, reject with reason, attach reference, audit every action.

**Refunds and returns**
- Return/RMA list with statuses (`requested → approved → received → refunded /
  rejected`).
- Reason catalogue, condition grade, restock toggle.
- Full and partial refunds; amount cannot exceed captured minus already refunded.
- Refund record: method, reference, processed by, timestamp, note.
- Refunds are recorded manually — there is no PayU refund API call.
- Stock restock writes `stock_movements` with reason `return`.

**Cancellation reasons**
- CRUD reference data, active flag, order of display, audit.

**Exports**
- Orders and transactions CSV, column allow-list, date range, PII masking.

**POS**
- Existing module kept as-is and visible in the sidebar. It is outside this rebuild.

### 5.3 Catalog

**Products list**
- Search name, SKU, model number, brand.
- Filters: category, brand, condition, active, stock status, price range.
- Bulk activate/deactivate/archive; export.
- Columns: image, name, SKU, category, brand, price, stock, status, updated.

**Product editor** — tabs/sections matching 6amMart's product form depth:
- General: name, slug, SKU, model number, EAN/UPC, brand, category, condition
  (new / refurbished / open-box), short description, full description,
  highlights, in-the-box.
- Pricing: price, compare-at/MRP, cost (owner-only), currency INR; price history
  written on every change after the Phase 0 gate.
- Inventory: stock, low-stock threshold, reserve on order, backorder policy.
- Variants: matrix editor (e.g. colour × storage/RAM × connectivity) with
  per-variant SKU, price, stock, image, barcode.
- Media: gallery, order, alt text, product video URL.
- Attributes: colour, storage, connector, compatibility, etc.
- Merchandising: featured badge, related products, upsells, visibility.
- SEO: title, description, canonical.
- Add-ons: warranty extension, gift wrap, accessory bundle — optional line items
  offered on the product page.

**Categories**
- Three levels (main → sub → sub-sub), drag reorder, slug, SEO, active, product
  count; cycle prevention.

**Reference data**
- Brands: name, logo, description, active.
- Attributes and options: used by filters and variants; owner-only writes.
- Units: piece/pack, owner-only writes.
- Common conditions: new/refurbished/open-box definitions.

**Stock**
- Stock list per product/variant with on-hand, reserved, available.
- Adjustments with reason (restock, damage, correction, return, sale) and note.
- Movement history from `stock_movements`.
- Low-stock and out-of-stock views with thresholds.
- Stock report.

**Media library**
- Grid/list of uploads, upload, replace, alt text, usage count, delete guard when
  referenced.

**Reviews**
- Moderation queue: pending, published, rejected.
- Rating, title, body, customer, product, verified-purchase flag.
- Publish/reject with reason; audit.

**Bulk transfer**
- CSV import with template download, validation dry-run, per-row errors, chunked
  transactional writes, and a downloadable error report.
- CSV export of the current filtered catalogue.

**Approval / vendor submission** — not applicable (single store).

### 5.4 Customers

**Customers list**
- Search name, email, phone (masked by default).
- Filters: registered/guest, has orders, date range, spend range, status.
- Columns: customer, contact (masked), orders, lifetime value, last order,
  joined, type.
- Export with PII rules.

**Customer 360**
- Header: name, contact (owner-only reveal), joined, status.
- Tabs: Overview (lifetime value, order count, AOV, first/last order), Orders,
  Payments, Addresses, Notes.
- Actions: add note, disable, anonymise (owner), export.

**User accounts**
- Registered accounts list: name, email, signup, last login, order count, status.
- Detail: profile, sessions/devices, login history, orders.
- Actions: disable, revoke sessions, trigger password reset (owner).

**Subscribers**
- Newsletter and back-in-stock emails; source, consent, subscribed date,
  unsubscribe; export.

**Customer settings**
- Guest checkout on/off, account required for orders, default customer group.

**Explicitly excluded:** store credit/wallet, loyalty points, subscriptions,
rentals.

### 5.5 Reports

Every report: date range, category/brand/status filters, totals row, CSV export,
and a print-friendly view. No tax report — the business is not GST-registered.

| Report | Contents |
|---|---|
| Order report | Orders, revenue, discounts, refunds, net; grouped by day/week/month; status breakdown |
| Item-wise report | Units sold, revenue, returns, return rate, current stock, sell-through |
| Day-wise report | Daily revenue, orders, AOV, new customers, refunds |
| Transaction statement | Every payment and refund with order, method, reference, status |
| Payment reconciliation | PayU vs manual vs POS; matched/unmatched; failed payments |
| Expense report | Manual expense entries by category and date |
| Stock report | On-hand, reserved, available, value at cost and retail |
| Low-stock report | Items at or below threshold, last movement, suggested reorder |
| Customer report | New vs returning, repeat rate, top customers, guest vs registered |
| Category/brand report | Revenue and units by category and brand |

Expense tracking is included because 6amMart's report suite depends on it; it is a
simple `expenses` table with category, amount, date, note, attachment — not
accounting software.

### 5.6 Settings

**Store profile** — legal name, display name, address, phone, support email, logo,
favicon, currency (INR), timezone, order prefix and starting number, invoice
prefix.

**Fulfilment & shipping** — shipping methods and rates, free-shipping threshold,
processing time, courier names, and the **tracking URL template** (for example
`https://courier.example/track?awb={tracking}`). The template is supplied by
Gadzio; no courier API is called.

**Payments** — PayU enabled/sandbox indicator (keys stay in env), manual methods
(UPI, bank transfer, cash, card machine), COD toggle, payment instructions shown
at checkout. Refunds are manual records, not API calls.

**Email & SMS** — provider selection, sender identity, test send, SMS templates.
Provider choice is deferred; the settings and templates are built now.

**Notification templates** — editable transactional templates: order placed,
payment received, shipped, delivered, cancelled, refunded, back-in-stock,
password reset, staff invite. Subject + body with token placeholders; preview.

**Notification settings** — which events send email/SMS/in-app; per-role in-app
notification preferences.

**Analytics** — GA4, Google Tag Manager, Meta Pixel, TikTok, Snapchat, Pinterest,
LinkedIn, Twitter/X; each with an enabled toggle and ID field.

**SEO defaults** — title template, meta description, social image, robots policy
for non-product pages.

**Social links** — Instagram, Facebook, YouTube, X, WhatsApp.

**Pages** — About, Privacy, Terms, Refund/Returns, Cancellation, Shipping,
Warranty; Markdown/rich-text editor, slug, SEO fields, publish toggle.

**Reasons & reference data** — order cancellation reasons, refund reasons, return
reasons, expense categories.

**Automated messages** — event → template mapping (order placed, shipped,
delivered, refunded, abandoned cart if enabled).

**Security** — session lifetime, login page branding, reCAPTCHA keys, failed-login
lockout settings.

**Integrations** — email provider, analytics IDs, external API keys held in env
with only non-secret config in the database.

**Staff & roles** — list staff, invite, edit role, disable, revoke sessions. Only
three roles; no custom roles.

**Audit log** — filter by actor, action, entity, date; read-only; CSV export.

**Maintenance** — storefront maintenance mode with message; admin remains
available.

**Media** — shared media library screen from Catalog, also reachable here.

**Danger zone** — nothing destructive: no database settings screen, no theme/editor
that writes storefront code.

---

## 6. Parity matrix — 6amMart screen → this build

### Overview
| 6amMart | Decision |
|---|---|
| `dashboard-ecommerce` | **Adopt** — Sales tab |
| `dashboard-users` | **Adopt** — Users tab |
| `dashboard-transactions` | **Adopt** — Transactions tab |
| Food/grocery/pharmacy/parcel/dispatch dashboards | **Skip** — different business model |

### Sales
| 6amMart | Decision |
|---|---|
| Order list, status tabs, export | **Adopt** |
| Order view, quick view, invoice print | **Adopt** |
| Offline payment verification | **Adopt** — manual payments |
| Refund requests | **Adopt** — manual refund records |
| Cancellation reasons | **Adopt** |
| Order edit + edit logs | **Adopt** |
| Scheduled orders | **Adopt as a filter/tab** (no dispatch system) |
| Parcel orders, dispatch list | **Skip** |
| POS | **Keep existing module, visible** |

### Catalog
| 6amMart | Decision |
|---|---|
| Item add/edit/list/view/status | **Adopt** |
| Variants and food variations | **Adopt as product variants** (colour/storage/connectivity) |
| Add-ons and add-on categories | **Adopt as product add-ons** (warranty, gift wrap, bundles) |
| Categories (3 levels), attributes, brands, units, common conditions | **Adopt** |
| Product gallery, product video | **Adopt** |
| Item reviews | **Adopt** |
| Stock update, stock report, low-stock report | **Adopt** |
| Bulk import/export | **Adopt** |
| Serial / IMEI tracking | **Skip** |
| Vendor product approval / denied / requests | **Skip** — no vendors |
| Store categories | **Skip** — single store |

### Customers
| 6amMart | Decision |
|---|---|
| Customer list and 360 view | **Adopt** |
| Customer wallet, add fund, wallet report | **Skip** |
| Loyalty point report and settings | **Skip** |
| Subscribed emails | **Adopt** — subscribers |
| Customer settings | **Adopt** |
| Subscription plans / pro customer / rental | **Skip** |

### Reports
| 6amMart | Decision |
|---|---|
| Order report, item-wise, day-wise | **Adopt** |
| Order transaction statement | **Adopt** |
| Expense / other expense | **Adopt** — simple expense ledger |
| Stock / low-stock | **Adopt** |
| Tax reports | **Skip** — not GST-registered |
| Store / delivery-man / admin earning, disbursements | **Skip** — no commissions or fleet |
| Top stores / top zones | **Skip** |
| Parcel / rental / rideshare reports | **Skip** |

### Settings
| 6amMart | Decision |
|---|---|
| Business setup, currency | **Adopt** |
| Payment methods (online + offline) | **Adopt** |
| SMS module, mail config, email templates | **Adopt** |
| Notification settings | **Adopt** — email/SMS/in-app; no FCM |
| reCAPTCHA, login setup | **Adopt** |
| Third-party APIs, external configuration | **Adopt** |
| Analytics integrations | **Adopt** |
| Social login, social media | **Adopt social links**; social login deferred |
| SEO settings | **Adopt** |
| Pages (about/privacy/terms/refund/cancellation/shipping) | **Adopt** |
| Maintenance mode, automated messages, reasons | **Adopt** |
| Employees | **Adopt as Staff** |
| Custom roles | **Skip** — fixed three-role model |
| File manager | **Adopt as Media** |
| Contact messages, account | **Adopt** |
| App settings, FCM, landing-page settings, language manager | **Skip** |
| Database setting, addon activation, system addons | **Skip** — dangerous or marketplace-only |

---

## 7. Current state vs target

| Area | Exists today | Work required |
|---|---|---|
| Auth | `store_admins`, sessions, three roles (`0010`, `src/lib/store-admin/auth.ts`) | Staff UI, capability matrix, session revoke |
| Audit | `store_admin_audit`, `writeAudit`, masking | Audit viewer, more action coverage |
| Catalogue | categories, products, variants, stock, movements, brands, units, attributes (`0011`, `0012`) | Category tree, gadget fields, add-ons, reviews, media, import/export, editor depth |
| Orders | list/detail APIs, statuses, items, addresses, deliveries, payments, POS (`0014`, `0017`) | Returns/refunds, cancellation reasons, invoice, notes, edit logs, tracking fields, exports |
| Customers | read-only directory (`0015`) | 360, accounts, notes, subscribers, settings |
| Reports | none | Ten reports + exports |
| Overview | basic counts | Full dashboards |
| Settings | store profile + POS settings (`0017`) | Full settings suite, templates, pages, integrations, fulfilment |
| UI | plain `sa-*` screens, top nav | New sidebar shell, component library, all screens |
| Pricing | **checkout uses static code prices** (`src/lib/payu/catalog.ts`) | Phase 0 gate before any price write |

### The Phase 0 blocker

`src/lib/payu/catalog.ts` builds the checkout catalogue from static
`PRODUCTS` / `ALL_ACCESSORY_PRODUCTS` modules. Until checkout resolves prices from
`products` / `product_variants` / `stock`:

- price editing stays disabled (`AGENTS.md`, design v1 §5.4 / v2 §5);
- the    field in the product editor stays read-only.

Phase 0 is non-negotiable and comes before every feature phase.

---

## 8. Architecture and conventions

### 8.1 Rendering and routing

- Next.js 16 App Router; `export const dynamic = 'force-dynamic'` on admin pages.
- Server Components by default; client islands only for filters, charts, editors,
  offcanvas panels and toasts.
- Pages live in `src/app/(store-admin)/store-admin/(protected)/…`; the protected
  layout keeps the structural session guard.
- Route handlers live in `src/app/api/store-admin/…`.
- Read the relevant guides under `node_modules/next/dist/docs/` before writing new
  patterns (per `AGENTS.md`).

### 8.2 Data layer

- `src/lib/store-admin/*` modules: pure rules modules plus DB modules returning
  `{ ok: true, data } | { ok: false, error }`.
- `postgres` tagged templates; explicit transactions for multi-table writes.
- Stable sort keys and indexed filters on every list query.
- Keep `getSql()` at `max: 5`. Scripts and tests use `max: 1–2`; the Supabase
  session pooler allows 15 clients total and `next dev` needs several.

### 8.3 Permissions

Keep the fixed roles and add capabilities:

```ts
type Capability =
  | 'dashboard.read'
  | 'orders.read' | 'orders.write' | 'orders.refund' | 'orders.edit'
  | 'catalog.read' | 'catalog.write' | 'catalog.reference.write'
  | 'customers.read' | 'customers.pii.reveal'
  | 'reports.read' | 'exports.run'
  | 'settings.read' | 'settings.write'
  | 'staff.manage' | 'audit.read';
```

| Capability | viewer | admin | owner |
|---|---:|---:|---:|
| all `*.read`, `dashboard.read`, `reports.read` | ✓ | ✓ | ✓ |
| `orders.write`, `orders.edit`, `catalog.write`, `exports.run` | | ✓ | ✓ |
| `orders.refund`, `catalog.reference.write`, `customers.pii.reveal`, `settings.write`, `staff.manage`, `audit.read` | | | ✓ |

- Every route calls `requireStoreRole()` (enforced by
  `scripts/check-store-admin-routes.mjs`), then `requireCapability(...)`.
- Mutations also call `assertSameOrigin(request)`.
- Staff cannot change their own role or grant above their own.
- Disabling a staff member revokes their sessions immediately.

### 8.4 Audit

- Every mutation writes `writeAudit()`; exports and PII reveals are audited too.
- `before`/`after` pass through `maskPii`; no raw PayU response, email, phone,
  address, IP or user agent.
- `store_admin_audit` stays append-only.

### 8.5 Validation

- Add `zod`; one schema per route and form.
- `400` validation, `403` capability, `404` missing, `409` state conflict,
  `503` database unavailable. No SQL or stack traces in responses.
- Logs never contain PII or secrets.

### 8.6 Money

- Integer paise everywhere (`*_paise`), never floats.
- One pricing module computes line totals, discounts, shipping and refunds;
  unit-tested; used by checkout and admin.
- Refund invariant: `refunded_total + new_refund <= captured_total`.

### 8.7 Media

- Reuse `media` + Supabase Storage bucket `media` (migration `0007`).
- Upload validates MIME by byte sniffing, caps size, uuid path; soft delete.
- Derivatives for list thumbnails and product cards.

### 8.8 Exports and jobs

- CSV route handlers with a column allow-list, row cap and PII masking.
- Large exports run through `admin_jobs` and give a downloadable artifact.
- Postgres-backed job runner invoked by one secured cron route (`CRON_SECRET`):
  low-stock alerts, abandoned-cart email (if enabled), outbox flush, retention
  cleanup, scheduled maintenance toggles.

### 8.9 Providers

- Email/SMS behind adapters; credentials in env only. Provider selection deferred.
- Courier: name + tracking URL template supplied by Gadzio; no API integration.
- PayU refunds: recorded manually; no provider call.

### 8.10 UI implementation

- New primitives under `src/components/store-admin/ui/`: `Card`, `StatCard`,
  `DataTable`, `Toolbar`, `FilterChip`, `StatusBadge`, `Pagination`, `Tabs`,
  `Offcanvas`, `Modal`, `Toast`, `EmptyState`, `Skeleton`, `FormField`,
  `ImageUploader`, `SectionCard`, `StickySaveBar`.
- Styling stays in `store-admin.css` under `.sa-shell`, using the token layer.
  No Tailwind in admin, so storefront and admin never couple.
- Icons: original inline SVG set in `src/components/store-admin/icons.tsx` (or
  `lucide-react` if a dependency is acceptable).
- Charts: use the `dataviz` skill before building; a small chart component with
  accessible colours and a data-table fallback.

---

## 9. Data model plan

Additive migrations, one implicit transaction each, no destructive statements,
RLS enabled in the creating file with no policies.

| Migration | Contents |
|---|---|
| `0018_store_analytics_indexes.sql` | **Applied.** Read indexes for the overview dashboards: paid-order windows, customer history, order-item product roll-ups, new-user/session windows, POS payment dates. No tables and no RLS change. |
| `0019_order_notes.sql` | **Applied.** `order_notes`: append-only internal staff notes per order (body capped at 2,000 characters, author denormalised). No update or delete path. RLS enabled with no policies. |
| `0020_order_edits.sql` | **Applied.** `order_edit_logs` (order, actor, `changed_fields`, masked `before`/`after`, reason) with an immutability trigger. RLS enabled, no policies. |
| `0021_payment_reviews.sql` | **Applied.** `order_payments.review_status` (`NOT_REQUIRED`/`PENDING`/`VERIFIED`/`REJECTED`), `reviewed_by`, `reviewed_at`, `rejection_reason`; partial index for the pending queue. No RLS change (`order_payments` is reached through `orders`). |
| `0022_store_admin_preferences.sql` | **Applied.** `store_admin_preferences` (one row per admin, `saved_views` jsonb). RLS enabled, no policies. |
| `0023_order_returns.sql` | **Applied.** `cancellation_reasons` (seeded catalogue); `return_requests` (RMA workflow `REQUESTED → APPROVED → RECEIVED → REFUNDED`, or `REJECTED`/`CANCELLED`); `return_items` (quantity, condition grade, restock flag); `refunds` (append-only, immutability trigger) with indexes. `orders` additions: `cancellation_reason_id`, `cancelled_by`. Recreates `order_sale_state` so a recorded refund surfaces as `REFUNDED`. RLS enabled on all four tables, no policies. |
| `0024_catalog_core.sql` | **Applied.** `categories.parent_id` (tree grouping only, indexed); `conditions` (New/Refurbished/Used, seeded) with `products.condition_id`; `stock_movements.note` for manual adjustment reasons. RLS enabled on `conditions`, no policies. |
| `0025_catalog_operations.sql` | **Applied.** `product_reviews` (rating 1–5, status `pending`/`published`/`rejected`, rejection reason, store reply, verified flag) with status and product indexes; `store_media` (metadata only — bytes live in Storage under `storage_path`, with `alt`, dimensions and soft delete); `catalog_imports` (mode, status, row counts) and `catalog_import_errors` (row number, column, message) for downloadable reports. RLS enabled on all four, no policies. |
| `0026_customer_accounts.sql` | **Applied.** `users` additions: `is_blocked`, `blocked_at`, `blocked_reason`, `anonymised_at`, `last_login_at`, `customer_group` (retail/vip/wholesale), `marketing_opt_in`; `user_sessions` additions: `device`, `ip_hash` (SHA-256, never the raw IP), `last_seen_at`. New tables: `customer_notes` (append-only, body 1–2,000), `user_login_events` (outcome only — no IP or user agent), `newsletter_subscribers` (lower-cased unique email, consent/source/unsubscribe trail), `customer_settings` (key/value). RLS enabled on all four, no policies. |
| `0027_store_expenses.sql` | **Applied.** `expense_categories` (seeded: rent, utilities, salaries, packaging, marketing, travel, equipment, software, other); `expenses` (category, title, amount paise, spend date, note, receipt media, soft delete, author columns) with report indexes; `products.cost_paise` (internal unit cost, nullable, never a selling price). RLS on both tables, no policies. |
| `0028_reporting_indexes.sql` | **Applied.** Read indexes for the report queries: refunds by date, recorded payments by date, return items by order item, orders by status and channel. No tables and no RLS change. |
| `0029_store_admin_access.sql` | **Applied.** `store_admins` additions: `phone`, `avatar_media_id`, `last_login_at`, `must_change_password`, `password_changed_at`, `updated_at`; indexes for the audit timeline and active staff. No `store_admin_invites` table: invitations need a public accept route, which would break the rule that only `auth/login` is public under `/api/store-admin`. The owner creates accounts with a one-time temporary password instead; invitations return when an outbound mail provider exists. `store_admins` already had RLS from 0010 — no change here. |
| `0030_order_operations.sql` | `invoice_counters`; `orders` additions: `order_note`, `payment_reference`, `payment_proof_media_id`, `shipped_at`, `delivered_at`. (Returns, refunds and cancellation reasons shipped in `0023`.) RLS. |
| `0031_catalog_depth.sql` | `categories` additions: `image_media_id`, `is_featured`, `priority`; product columns: `short_description`, `tags`, `model_number`, `manufacturer`, `ean`, `unit_id`, `unit_value`, `warranty_months`, `video_url`, `max_purchase_qty`, `min_purchase_qty`, `is_featured`, SEO fields; `product_variants` additions: `barcode`, `stock_on_hand`, `image_media_id`; `product_relations`; `product_addons`. (Review moderation and the store reply shipped in `0025`; `cost_paise` moved forward to `0027`.) RLS. |
| `0032_store_settings.sql` | **Applied.** `fulfilment_providers` (name, tracking URL template); `shipping_methods`; `payment_methods` (seed: cod, PayU, manual); `store_pages` (eight drafts seeded); `seo_pages` (14 page keys); `social_links`; `analytics_scripts`; `store_integrations` (non-secret config); `email_templates`; `automated_messages`; `notification_channel_settings` (72 channel × audience × topic cells, only in-app staff notifications on); `refund_reasons`; `return_reasons`. Scalar settings stay in the existing `store_settings` key/value table. Two planned tables merged: `offline_payment_methods` is a `kind = 'manual'` row in `payment_methods`, and `notification_templates` is `email_templates` — no behaviour lost. RLS on all thirteen tables, no policies. |
| `0033_notifications.sql` | `admin_notifications`; `admin_notification_reads`; `notification_broadcasts`; `outbox_messages` (channel, recipient, payload, status, attempts). RLS. |
| `0034_jobs.sql` | `admin_jobs` (kind, payload, status, attempts, run_at, locked_at, last_error). RLS. |
| `0035_search_indexes.sql` | `pg_trgm`; GIN indexes on product name/slug/SKU and order txnid/customer email. |

Conventions: integer paise, soft delete where history matters, `is_active` for
reference rows, mutation-blocking triggers on immutable history tables,
documented retention for PII tables, no provider secrets or raw payment responses
in the database.

---

## 10. Roadmap

Estimates assume one experienced full-stack developer, sequential work, no
external design handoff. Add 20–25% buffer.

### Phase 0 — Foundations and the pricing gate (1 week)

- Read the Next.js 16 guides before coding.
- Move checkout/PayU pricing to the database; fail closed for unknown IDs.
- Add a test proving a `products.price_paise` change changes the PayU amount.
- Only then open the owner-only, audited price write path with `price_history`.
- Add `zod`, `permissions.ts`, capability declarations in the route guard script,
  and route-level `loading.tsx` / `error.tsx`.

**Done when:** checkout pricing is provably DB-derived; the price gate test is
green; typecheck, tests and the route script pass.

### Phase 1 — Admin shell and component library (1.5 weeks)

- Sidebar, top bar, page header, breadcrumbs, mobile drawer, pins.
- Primitives from §8.10 and the token layer.
- Rewrite existing pages onto the shell with no behaviour change.

**Done when:** every existing screen renders in the new shell at 390/768/1200/1440;
keyboard and focus behaviour is correct; no API regression.

### Phase 2 — Overview dashboards (1.5 weeks)

- Sales, Users and Transactions tabs; KPI queries; charts; top lists; action
  queues; period comparison.
- `analytics.ts` query layer + indexes.

**Done when:** every dashboard figure reconciles with the equivalent filtered list.

### Phase 3 — Sales core (2 weeks)

- Orders list with status tabs, filters, sorting, saved views, quick view.
- Order detail with tabs, timeline, notes, shipment block, invoice and packing
  slip print.
- Manual payment verification; order edit with immutable edit log.
- Order and transaction CSV exports.

**Done when:** an order can be found, inspected, printed, edited (where allowed),
and exported end to end.

**Progress (2026-10-24).**
- Done: status tabs with counts, search, channel, date range, sortable amount and
  date columns, masked order CSV export with an audit row.
- Done: order detail split into Overview · Items · Shipment · Payments · Timeline ·
  Notes tabs; internal notes are append-only (`order_notes`, migration 0019) with an
  audited write path.
- Done: quick-view slide-over on the orders list, built from the same repository as
  the full page.
- Done: printable invoice and packing slip. They show the unmasked delivery address,
  so they are owner-only and every render writes an `order.document.view` audit row.
- Done: payment-level transaction CSV export (Overview → Transactions), with no
  customer contact data and an audited filter record.
- Done: saved order views. Chips above the list apply a canonical, allow-listed
  filter set; each staff member keeps up to ten in `store_admin_preferences`
  (migration 0022), so they follow them across browsers. Every change is audited.
- Done: manual payment review queue (`/store-admin/payments`). UPI, bank transfer
  and “other” entries land as `PENDING` and only count once approved; rejection
  needs a reason and moves the row to failed (migration 0021).
- Done: order edit with immutable edit log. Contact and shipping-address fixes
  are validated, masked in `order_edit_logs` (migration 0020), and audited;
  items and amounts stay locked.
- Phase 3 complete (2026-10-24). Verified with `tsc`, the 118-test suite, the
  35-route guard check and a live smoke test.

### Phase 4 — Returns, refunds and cancellation (2 weeks)

- Return/RMA workflow, manual refunds (full/partial), reasons, restock, stock
  movements.
- Cancellation reasons and cancellation flow.
- Concurrency-safe refund invariant and tests.

**Done when:** refunds cannot exceed captured, every transition is audited, and
rule tests cover partial refunds, restock and cancellation.

**Progress (2026-10-24).**
- Done: migration `0023_order_returns.sql` — `return_requests`, `return_items`,
  append-only `refunds` (immutability trigger), seeded `cancellation_reasons`,
  `orders.cancellation_reason_id`/`cancelled_by`. `order_sale_state` recreated so
  a recorded refund reads as `REFUNDED`.
- Done: `return-rules.ts` is pure and unit-tested; `returns.ts` holds the locked
  transactions for opening a return, moving it, restocking on receipt, recording
  a refund and cancelling an order.
- Done: RMA workflow `REQUESTED → APPROVED → RECEIVED → REFUNDED` with
  `REJECTED`/`CANCELLED` exits. Receipt restocks only resellable/opened lines
  that were flagged, adds `stock_movements` rows with reason `return`, and does
  nothing for untracked products.
- Done: manual refunds (full and partial) with the captured total as a hard
  ceiling. The check runs inside a transaction that locks the order, so two
  concurrent refunds cannot overshoot; refunds are never edited or deleted.
- Done: cancellation flow with an active-reason catalogue, order/delivery status
  updates, an `order_status_history` row, and owner-only cancellation once an
  order is on the way.
- Done: `/store-admin/returns` (status tabs and counts), `/store-admin/returns/[id]`
  (items, decisions, refunds), the Returns tab on order detail (start a return,
  standalone refund), the cancel card on Shipment, and
  `/store-admin/settings/reasons`.
- Done: `tests/return-rules.test.mjs` — transitions, refund invariant (partial,
  exact, over, concurrent-style), restock eligibility, line quantities, reasons
  and cancellation rules. Suite is now 138 tests.
- Phase 4 complete (2026-10-24). Verified with `tsc`, the 138-test suite, the
  41-route guard check, a production build and a live smoke test: approve →
  receive restocked 2 units (5 → 7) with one `return` movement; a full UPI refund
  closed the return; an over-refund and a refund without a reference were
  rejected; two simultaneous refunds produced one `201` and one `409`; a paid
  processing order was cancelled with a catalogue reason and then refunded in two
  parts (100000 + 49900 of 149900); viewer role was refused at the API. All test
  fixtures were removed afterwards and the stock row restored.

### Phase 5 — Catalog core (3 weeks) — complete 2026-10-24

- Products list and full editor (gadget fields, variants, media, SEO, add-ons,
  related).
- Category tree, brands, attributes, units, conditions.
- Stock list, adjustments, movement history, low-stock views.

**Progress:** the price gate is open because PayU resolves every cart line from
`products` server-side (`api/payu/initiate`), so an edited price is the price
charged. Shipped: `0024_catalog_core` (category `parent_id`, `conditions` +
seeded New/Refurbished/Used, `products.condition_id`, `stock_movements.note`);
`catalog-crud-rules` validators (category/slug/cycle, condition, new product,
price pair, variant, stock adjustment/settings); `catalog-crud` writes —
category upsert/archive (refused with live children or products), condition
upsert/hide, product create with opening `price_history` and stock row,
`updateProductPricing` appending `price_history`, variant upsert/archive with
override history, `adjustStock` (never negative, never below reserved, writes a
movement and syncs `products.in_stock`), stock settings; APIs for all of them
(owner for reference data, admin for products/price/variants/stock; routed
through `requireStoreRole` + `assertSameOrigin` + `writeAudit`); UI
`/store-admin/categories` tree manager, Conditions card on Catalogue data,
`/store-admin/products/new`, price/variant editors on the product page,
`/store-admin/stock` and `/store-admin/stock/[productId]` with movement log.
Tests: `catalog-crud.test.mjs` (20) — suite now 158.

**Still deferred to Phase 6:** add-ons, related products, bulk import/export,
media library, reviews moderation, low-stock reporting views beyond the
existing `/store-admin/low-stock`. Search ranks by the existing `pg_trgm`
indexes once `0033` lands.

**Done when:** a new gadget with variants can be created, stocked, published and
found by search.

### Phase 6 — Catalog operations (2 weeks) — complete 2026-10-24

- Reviews moderation; media library; bulk CSV import with dry-run and errors;
  catalogue export.
- Stock and low-stock reports.

**Progress:** shipped `0025_catalog_operations` (`product_reviews`, `store_media`,
`catalog_imports`, `catalog_import_errors`; RLS on all four, no policies);
`review-rules` (status transitions, mandatory rejection reason, reply cap,
masked email), `media-rules` (magic-byte sniffing, 25 MB cap, dimensions,
filename/alt validation), `catalog-csv` (RFC 4180 parser, 5,000-row cap,
provisional row validation, template/export serialiser) and the services
`reviews`, `media`, `catalog-transfer` (`exportCatalogue`,
`runCatalogueImport` — validate everything, then one transaction,
`exportStockReport`, `getImportReport`); APIs for reviews (`GET` list, `PATCH`
publish/reject/reply), media (`GET`/`POST` multipart, `PATCH` alt, `DELETE`
archive), import (template `GET`, validate/commit `POST`, error-report CSV) and
CSV exports (catalogue, low/all stock) — all `requireStoreRole`, mutations
`assertSameOrigin`, privileged actions audited (`review.status`, `review.reply`,
`media.upload`, `media.alt`, `media.archive`, `catalog.import`) with no email,
name or raw file payload in the audit rows; public `/api/media/[id]` redirect
so storefront images need no session; UI `/store-admin/reviews` (counts, search,
publish/reject-with-reason/reply), `/store-admin/media` (upload, alt, copy URL,
delete guard, type filter), `/store-admin/catalog/transfer` (dry run, commit,
errors, report download, export filters, stock CSVs) and export buttons on
`/store-admin/low-stock`. Tests: `catalog-csv` (19), `review-rules` (5),
`media-rules` (7) — suite now 189; route checker covers 58 guarded routes.

**Done when:** a 5,000-row import completes without partial writes and produces an
error report; media and review actions are audited.

### Phase 7 — Customers and users (2 weeks) — complete 2026-10-24

- Customers list and 360; user accounts, sessions, login history.
- Notes; PII reveal; subscribers; customer settings; exports.

**Progress:** shipped `0026_customer_accounts` (`users` block/group/last-login
columns, `user_sessions.device`/`ip_hash`/`last_seen_at`, `customer_notes`,
`user_login_events`, `newsletter_subscribers`, `customer_settings`; RLS on every
new table, no policies); `customer-rules` (filter parsing with round-trip dates
and rupee ranges, group and setting vocabularies, subscriber email validation,
block/unsubscribe reason bounds, coarse device labels, `anonymisedEmail`);
rewritten `customers` service (registered + guest rows in one paged query,
lifetime value and paid counts from `orders`, 360 with orders, addresses,
merged gateway/recorded payments and masked references, owner-only reveal);
`customer-accounts` (account list, session and login history by 12-hex token
prefix, revoke one/all, block that deletes sessions, anonymise that keeps
financial order rows and notes); `customer-notes`, `customer-settings`
(guest checkout, default group, checkout opt-in) and `subscribers`;
storefront auth now records `signup`/`success`/`failed`/`blocked`/`logout`
events with a device label and a hashed IP, refuses blocked accounts at sign-in
and at session validation, and honours the guest-checkout setting at
`/checkout` and in PayU initiate (saved addresses and per-user rate limits only
apply to signed-in customers); APIs for the list, detail, notes, status,
sessions, owner-only reveal/anonymise, masked customer CSV, settings and
subscribers (masked list, owner-only full-email export) — all
`requireStoreRole`, mutations `assertSameOrigin`, privileged actions audited
(`customer.view/reveal/note.add/block/unblock/sessions.revoke/export/
settings.update/anonymise`, `subscriber.add/unsubscribe/resubscribe/export`)
with masked contacts and no note text in the audit rows; UI
`/store-admin/customers` (filters, summary, masked table, guests, export),
customer 360 with Overview/Orders/Payments/Addresses/Notes/Security tabs,
`/customers/accounts`, `/customers/subscribers`, `/customers/settings`, plus
the sidebar group. Tests: `customer-rules` (13) — suite now 202; route checker
covers 67 guarded routes; live smoke on a production build passed 78 checks
(filters, masking, aggregates, reveal, block/unblock against real sign-in,
session revoke, role refusals, settings and guest checkout, subscribers,
anonymise, audit contents).

**Done when:** non-owners cannot reach PII; every reveal is audited; customer
aggregates match order history. Met: reveal and anonymise are owner-only,
full addresses appear only in the audited owner export, and the 360 totals were
verified against seeded order history.

### Phase 8 — Reports (2 weeks) — complete 2026-10-24

- Ten reports from §5.5, shared filter/export/print components, expense ledger.
- Reporting indexes and performance review.

**Progress:** shipped `0027_store_expenses` (`expense_categories` seeded with
nine rows; `expenses` with category, amount, spend date, note, receipt media,
soft delete and author columns; RLS on both) and `0028_reporting_indexes`
(refund, recorded-payment, return-item and order-status read indexes);
`report-rules` (the ten-report catalogue with its filter capabilities, UTC
range parsing capped at 731 days and defaulting to 30, day/week/month grouping,
a shared 500-row cap, display formatting, linked order/product/customer cells,
and a CSV writer that consumes the same columns and rows as the screen);
`expense-rules` (title, rupee amount, spend date, note and category validators);
`expenses` (paged ledger, day/category roll-up, create/update/soft-delete,
duplicate-safe categories); `reports` (order, item-wise, day-wise, transaction
statement, payment reconciliation, expense, stock, low-stock, customer and
category/brand reports — captured revenue is `PAID` and not cancelled, legacy
orders fall back to `amount` when `total_paise` is null, gateway money is
unioned with `order_payments` without double counting, statement totals count
only settled payments, and totals stay exact when a table hits the cap); APIs
for report data, CSV export and the ledger/categories (all `requireStoreRole`,
mutations `assertSameOrigin`, audits `report.export`,
`expense.create/update/delete`, `expense.category.create` carrying ledger fields
only — the note and receipt never reach the audit); UI `/store-admin/reports`
hub, `/reports/[report]` with filters, stat tiles, totals row, truncation notice
and a print-only header, plus `/store-admin/expenses`, `/expenses/new` and
`/expenses/[id]`, wired into the Insights sidebar; product unit cost
(`cost_paise`) is editable on the product page and drives value at cost in the
stock report. Also fixed `writeAudit` to store `before`/`after` as jsonb objects
rather than JSON strings (they could not be queried with `->>`). Tests:
`report-rules` (14), `expense-rules` (5) — suite now 221; route checker covers
72 guarded routes; live smoke on a production build matched every report's
totals and fixture rows against independent SQL for the same filters (including
channel, category and return filters), CSV headers and BOM against the table,
viewer/admin/owner refusals, the expense lifecycle, audit contents and every
page. Warm report queries took roughly 0.3–0.7 s on the current dataset.

**Done when:** every report matches its source list for the same filters and runs
within the performance budget. Met: the smoke compared each report with source
SQL and found no difference, and every report answered inside a second on the
pooled connection at the current data volume.

### Phase 9 — Settings, staff and audit (2.5 weeks)

- Store profile, fulfilment and tracking template, payments, email/SMS, templates,
  notifications, analytics, SEO, social, pages, reasons, automated messages,
  security, integrations, maintenance.
- Staff management; audit viewer.

**Built.** Staff: `/settings/staff` (create, edit, deactivate, reset password,
sign out everywhere) with `store_owner ⊇ store_admin ⊇ store_viewer`, a
21-row capability matrix, and safety rules (no self role change, no self
deactivation, the last active owner cannot be demoted). Disabling a member or
changing their role revokes every session; a reset revokes sessions and marks
`must_change_password`, which pins the account to `/store-admin/profile` until
the password changes. `/store-admin/profile` carries the member's own name,
phone, password and session list. Audit: `/audit-log` filters by actor, action,
entity and date (default last 7 days, max 366), shows before/after jsonb and
exports CSV (5,000-row cap), each export writing its own audit row.

Settings: one descriptor catalogue (`settings-rules.ts`, 45 keys across six
sections) drives the screen and the API validation; a bulk PUT saves a section
atomically and audits one row per changed key. Maintenance keys are owner-only.
Secrets (PayU key/salt, SMTP password, SMS tokens, reCAPTCHA secret) are never
stored or rendered — each screen shows only whether the environment variable is
present. Eleven configuration lists (couriers, shipping methods, payment
methods, pages, SEO rows, social links, analytics, integrations, automated
messages, email templates, refund/return reasons) share one engine
(`setting-lists.ts`) and one audited API; rows are hidden with `is_active`, never
deleted. Couriers carry a `{tracking}` URL template validated as HTTPS, previewed
on the shipping screen, and applied automatically when a courier delivery is
saved with a matching courier name and no hand-typed URL.

**Deferred, recorded here deliberately:** `0033_notifications.sql` (outbox and
staff notifications), `0034_jobs.sql` and `0035_search_indexes.sql` are not
started. Notification channels and automated messages are definitions only —
nothing is sent until an outbound provider and the worker exist; the screens say
so. reCAPTCHA enforcement and storefront consumption of the new settings (login
copy, shipping rates, maintenance mode) likewise wait for their own phase.

Tests: `staff-rules` (10), `settings-rules` (10), `tracking-template` (8) — suite
now 249; the route checker covers 83 guarded routes. Typecheck clean.

**Done when:** all settings persist and are audited; disabling staff revokes
sessions; no secrets live in the database; a tracking link is generated from the
configured template. Met: every settings write and list write audits one row;
deactivation and role changes revoke sessions; secrets are environment-only and
the screens report presence only; `buildTrackingUrl` drives both the order save
and the preview, and is covered by tests.

### Phase 10 — Hardening and polish (1 week)

- Accessibility audit, keyboard shortcuts, saved views, empty/error states.
- Performance budgets, slow-query review, retention jobs, backup runbook.
- Dark mode deferred.

**Done when:** the accessibility checklist passes and the runbook is written.

### Timeline

| Phase | Duration | Cumulative |
|---|---:|---:|
| 0 Foundation + pricing gate | 1 wk | 1 wk |
| 1 Shell + components | 1.5 wk | 2.5 wk |
| 2 Overview | 1.5 wk | 4 wk |
| 3 Sales core | 2 wk | 6 wk |
| 4 Returns/refunds | 2 wk | 8 wk |
| 5 Catalog core | 3 wk | 11 wk |
| 6 Catalog operations | 2 wk | 13 wk |
| 7 Customers | 2 wk | 15 wk |
| 8 Reports | 2 wk | 17 wk |
| 9 Settings/staff/audit | 2.5 wk | 19.5 wk |
| 10 Hardening | 1 wk | 20.5 wk |

**Launchable slice at ~11 weeks:** Phases 0–5 give a complete shell, dashboard,
sales with refunds, and a full catalogue. Reports and settings can follow while the
store runs.

---

## 11. Testing and quality gates

Every phase must pass:

1. `npm run typecheck`
2. `npm test`
3. `node scripts/check-store-admin-routes.mjs`
4. Unit tests for every pure rules module (pricing, refunds, permissions, stock,
   import validation).
5. SQL integration checks against a scratch database with `max: 1`, never beside
   `next dev`.
6. Manual smoke: golden path, permission-denied path, failure path.
7. Diff review: no secrets, no PII in logs/audit, no destructive migration.
8. Every new table has RLS enabled in its creating migration.
9. UI checklist: 390/768/1200/1440, keyboard-only pass, focus visible, tables
   usable with 200+ rows.

Optional later: Playwright for order → refund and product → storefront flows.

---

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| **Nulled-source IP** | Reference only; original code and assets; licence before any reuse |
| **Price gate reopened** | Phase 0 test; owner-only write path; price history; route classification |
| **PII leakage** | Masked audit, allow-listed logs, owner-only reveal, retention jobs |
| **Pooler exhaustion** | `max: 5` app, `max: 1–2` scripts, no ad-hoc scripts beside dev |
| **Next.js 16 drift** | Read bundled docs before new patterns |
| **Scope creep to marketplace** | §6 parity matrix and the locked decisions are the contract |
| **Manual refund errors** | Required provider reference, owner-only action, immutable refund rows, reconciliation report |
| **Courier tracking links** | URL template validated on save; missing tracking number hides the link |
| **Import corrupting catalogue** | Dry-run, row validation, chunked transactions, error report |
| **Report performance** | Index-first SQL, bounded ranges, aggregate in the database |
| **UI drift from the reference** | Screen-by-screen parity checklist in Phase 1 and each feature phase |
| **Dual writer with `/admin` CMS** | Store-admin links to `/admin`; never writes `content_blocks` |

---

## 13. Deferred decisions

These are intentionally out of the first build. They do not block any phase.

1. **Email/SMS provider** — templates and settings ship; the adapter is wired when
   a provider is chosen.
2. **Reviews policy** — default is open reviews with moderation. Verified-purchase
   enforcement can be added later.
3. **Dark mode** — deferred to a later polish pass.
4. **Private media bucket + signed URLs** — keep the existing public bucket.
5. **Social login** — social links only; no OAuth login for customers.

---

## 14. Definition of done

- The admin is original Next.js code; no 6amMart code or assets are in the repo.
- The six sections are complete to the parity matrix in §6.
- Every store-admin API route calls `requireStoreRole` and a capability; mutations
  call `assertSameOrigin`.
- Every new table has RLS with no policies.
- Every privileged action is audited with masked PII.
- Checkout prices, refunds and stock are database-derived and server-authoritative.
- Every list, dashboard and report reconciles with its source data.
- Typecheck, tests, route guard, accessibility checklist and the UI parity
  checklist pass.
- A new staff member can be invited, scoped, and disabled without touching the
  database by hand.

---

## Appendix A — Route map

```
/store-admin
  /                         Overview (Sales · Users · Transactions tabs)
  /orders                   Orders list
  /orders/[txnid]           Order detail
  /returns                  Returns & refunds
  /payments                 Manual payment verification / reconciliation
  /requests                 Existing order requests
  /pos                      Existing POS (kept visible)

  /products                 Products list
  /products/[id]            Product editor
  /categories               Category tree
  /catalog/brands           Brands
  /catalog/attributes       Attributes
  /catalog/units            Units
  /catalog/conditions       Conditions
  /reviews                  Review moderation
  /stock                    Stock list and adjustments
  /low-stock                Low-stock view
  /media                    Media library
  /catalog/transfer         Import / export

  /customers                Customers list
  /customers/[id]           Customer 360
  /users                    Registered accounts
  /users/[id]               Account detail
  /subscribers              Subscribers
  /customers/settings       Customer settings

  /reports/orders           Order report
  /reports/items            Item-wise report
  /reports/daily            Day-wise report
  /reports/transactions     Transaction statement
  /reports/payments         Payment reconciliation
  /reports/expenses         Expenses
  /reports/stock            Stock report
  /reports/low-stock        Low-stock report
  /reports/customers        Customer report
  /reports/catalog          Category / brand report

  /settings                 Store profile
  /settings/fulfilment      Fulfilment & shipping (tracking URL template)
  /settings/payments        Payments
  /settings/messaging       Email & SMS
  /settings/templates       Notification templates
  /settings/notifications   Notification settings
  /settings/analytics       Analytics
  /settings/seo             SEO defaults
  /settings/social          Social links
  /settings/pages           Content pages
  /settings/reasons         Cancellation / refund / return reasons
  /settings/automation      Automated messages
  /settings/security        Security
  /settings/integrations    Integrations
  /settings/staff           Staff & roles
  /settings/audit           Audit log
  /settings/maintenance     Maintenance mode
```

## Appendix B — API map

```
/api/store-admin/overview/{sales,users,transactions}
/api/store-admin/orders
/api/store-admin/orders/[txnid]
/api/store-admin/orders/[txnid]/{payments,fulfilment,notes,tracking,edit}
/api/store-admin/orders/[txnid]/refund      POST refund not tied to a return
/api/store-admin/orders/[txnid]/cancel      POST cancel before delivery
/api/store-admin/returns                    GET list · POST open a return
/api/store-admin/returns/[id]               GET detail · PATCH approve/reject/receive/cancel
/api/store-admin/returns/[id]/refund        POST refund against a received return
/api/store-admin/reasons/cancellation       GET · POST create/update a reason
/api/store-admin/payments/verify
/api/store-admin/catalog/products
/api/store-admin/catalog/products/[id]
/api/store-admin/catalog/products/[id]/{images,attributes,variants,addons,relations}
/api/store-admin/catalog/{categories,brands,attributes,units,conditions}
/api/store-admin/catalog/import
/api/store-admin/catalog/export
/api/store-admin/reviews
/api/store-admin/stock
/api/store-admin/media
/api/store-admin/customers
/api/store-admin/customers/[id]
/api/store-admin/customers/[id]/{notes,reveal}
/api/store-admin/users
/api/store-admin/users/[id]
/api/store-admin/subscribers
/api/store-admin/reports/{orders,items,daily,transactions,payments,expenses,stock,low-stock,customers,catalog}
/api/store-admin/settings
/api/store-admin/settings/{fulfilment,payments,messaging,templates,notifications,analytics,seo,social,pages,reasons,automation,security,integrations,maintenance}
/api/store-admin/staff
/api/store-admin/audit
/api/store-admin/exports/[kind]
```

Every route except `auth/login` must call `requireStoreRole`; every mutating route
must call `assertSameOrigin`.

---

## Appendix C — Field-level parity inventory

**What was checked.** The 6amMart v4.0 archive is the source of truth for this
inventory. Fields were read from `routes/admin.php`, the admin controllers
(including `ItemController`), and the corresponding Blade forms: product
create/edit partials, `category/index.blade.php`, `category/_edit.blade.php`,
`brand/index.blade.php`, `brand/partials/edit_partial.blade.php`,
`attribute/edit.blade.php`, `unit` forms, `common-condition/edit.blade.php`,
add-on forms, `order/index.blade.php`, `order/order-view.blade.php`, refund,
customer, employee, business-settings, notification, review and report views.
Multi-language arrays (`name[]`, `description[]`, `title[]`) are listed once
because Gadzio is single-language. Marketplace/fleet fields are still listed and
marked Skip so the omission is explicit, not accidental.

**Decision key.**

| Code | Meaning |
|---|---|
| **Adopt** | Same field and behaviour. |
| **Map** | Same concept, renamed or reshaped for a single gadget store. |
| **Extend** | Added because a gadget store needs it; not present in 6amMart. |
| **Skip** | Not carried; reason stated. |

### C.1 Overview

#### C.1.1 Sales tab — 6amMart dashboard metrics

| 6amMart field | Gadzio label | Decision |
|---|---|---|
| `total_sale` | Gross revenue | Adopt |
| `total_orders` | Paid orders | Adopt |
| `total_customers` | Customers in period | Adopt |
| `total_products` | Active SKUs | Adopt |
| `total_items` | Units sold | Adopt |
| `total_stores` | — | Skip — single store |
| `admin_commission` | — | Skip — no commission model |
| `delivery_commission` | — | Skip — no delivery fleet |
| `total_discount` | Discounts | Adopt |
| `total_coupon_discount` | — | Skip — coupons out of scope |
| `total_tax` | — | Skip — not GST-registered |
| `total_refund` | Refunds | Adopt |
| `total_cancelled` | Cancelled orders | Adopt |
| `total_failed` | Failed payments | Adopt |
| `total_delivered` | Delivered | Adopt |
| `total_processing` | Processing | Adopt |
| `total_pending` | Pending payment | Adopt |
| `total_out_for_delivery` | Shipped | Map |
| `total_new_product` | New products in period | Adopt |
| `total_unassigned_orders` | Unfulfilled paid orders | Map |
| `total_user` | Registered customers | Adopt |

**Widgets and their fields.**

| 6amMart widget | Fields carried | Decision |
|---|---|---|
| Order statistics | status, count, percentage | Adopt |
| User statistics | total, active, inactive, blocked | Adopt |
| Top selling products | image, name, order count, price, revenue | Adopt |
| Top customers | name, email, phone, order count, total spent | Adopt |
| Top stores / top delivery men | — | Skip |
| Recent orders | order id, customer, total, payment status, order status, date | Adopt |
| Order by zone | — | Skip; replaced by Extend: orders by destination state |
| Sales chart | revenue, order count, bar/line, period comparison | Adopt |
| Date range | today, 7/30/90 days, this month, custom | Adopt |

#### C.1.2 Users tab

| 6amMart field | Gadzio label | Decision |
|---|---|---|
| Total users | Total customers | Adopt |
| Active users | Active in period | Adopt |
| Inactive users | No order in period | Adopt |
| Blocked users | Blocked accounts | Adopt |
| New users | New in period | Adopt |
| Guest users | Guest checkouts | Adopt |
| User list | name, email, phone, joined, orders, spend | Adopt |
| Wallet balance / loyalty point columns | — | Skip — no wallet or loyalty |

#### C.1.3 Transactions tab

| 6amMart field | Gadzio label | Decision |
|---|---|---|
| Transaction id | Payment / refund id | Adopt |
| Order id | Order | Adopt |
| Customer | Customer | Adopt |
| Amount | Amount | Adopt |
| Payment method | Method | Adopt |
| Payment status | Status | Adopt |
| Date | Date | Adopt |
| Reference / txn id | Provider reference | Adopt |
| Admin earning / store earning / delivery earning | — | Skip — single store, no split |
| Transaction type | Payment or refund | Extend |

### C.2 Sales

#### C.2.1 Order list — tabs, columns and filters

| 6amMart status tab | Gadzio tab | Mapping |
|---|---|---|
| All | All | — |
| Pending | Pending payment | Unpaid or awaiting confirmation |
| Confirmed / accepted | Paid | Captured, not yet processing |
| Processing | Processing | — |
| Handover | Ready to ship | Packed and handed to courier |
| Out for delivery | Shipped | In transit |
| Delivered | Delivered | — |
| Canceled | Cancelled | — |
| Payment failed | Payment failed | — |
| Refunded | Refunded | — |
| Scheduled | — | Skip — no scheduled orders |
| Offline pending | Manual: pending | Manual payment awaiting verification |
| Offline verified | Manual: verified | — |
| Offline denied | Manual: rejected | — |

**List columns.**

| 6amMart column | Gadzio column | Decision |
|---|---|---|
| SL | # | Adopt |
| Order id | Order | Adopt |
| Order date | Date | Adopt |
| Customer info (name, email, phone) | Customer | Adopt |
| Store | — | Skip |
| Total amount | Total | Adopt |
| Payment method | Payment | Adopt |
| Payment status | Payment status | Adopt |
| Order status | Fulfilment status | Map |
| Action | Actions | Adopt |
| — | Items count | Extend |
| — | Channel (web / POS / manual) | Extend |

**Filters and controls.**

| 6amMart control | Gadzio control | Decision |
|---|---|---|
| Search (order id, customer, item) | Same, plus txnid and SKU | Adopt |
| Store filter | — | Skip |
| Zone filter | — | Skip |
| Module filter | — | Skip |
| Date range | Date range | Adopt |
| Payment status | Payment status | Adopt |
| Order status | Fulfilment status | Adopt |
| Sort by date | Newest / oldest | Adopt |
| — | Highest value / most items | Extend |
| Export CSV / Excel | CSV export with PII masking | Adopt |
| — | Saved views | Extend |

**Quick view offcanvas fields:** order id, date, customer, items with variant,
total, payment method, payment status, fulfilment status, channel, and actions
(view, invoice, advance status, cancel).

#### C.2.2 Order detail — every field

**Order header and status block.**

| 6amMart label | Gadzio field | Decision |
|---|---|---|
| Order ID | `orders.txnid` / order number | Adopt |
| Order date | `orders.created_at` | Adopt |
| Scheduled at | — | Skip — no scheduling |
| Order status | `orders.fulfilment_status` | Map |
| Payment status | `orders.payment_status` | Adopt |
| Payment method | `orders.payment_method` | Adopt |
| Order note | `orders.order_note` | Adopt |
| Cancel note / reason | `orders.cancellation_reason` | Adopt |
| Canceled by | `orders.cancelled_by` | Adopt |
| Denied note | `manual_payment_reviews.rejected_reason` | Map |
| Reference code | `orders.payment_reference` | Adopt |
| Amount paid | computed from `order_payments` | Adopt |
| Due amount | total minus paid | Adopt |
| Admin note | `order_notes` (internal) | Adopt |
| Customer note | `orders.order_note` | Adopt |
| Delivery instruction | `orders.delivery_instruction` | Adopt |
| Cutlery | — | Skip — food-only |

**Customer block.**

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| Customer name | `order_addresses.name` snapshot | Adopt |
| Phone | `order_addresses.phone` | Adopt |
| Email | `users.email` / snapshot | Adopt |
| House / floor / road | address line 1–3 | Adopt |
| Address | city, state, pincode | Adopt |
| Latitude / longitude | optional map link | Adopt |
| Guest user flag | `orders.is_guest` | Adopt |
| Store info | — | Skip |
| Delivery man info | — | Skip |

**Items table.**

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| Item name | `order_items.product_name` | Adopt |
| Variation | `order_items.variant_label` | Adopt |
| Add-ons | `order_items.addons` (JSON) | Adopt |
| Quantity | `order_items.quantity` | Adopt |
| Stock qty | available stock at order time | Adopt |
| Unit price | `order_items.unit_price_paise` | Adopt |
| Discount | `order_items.discount_paise` | Adopt |
| Line total | `order_items.line_total_paise` | Adopt |
| Add item search | product/variant picker | Adopt |
| Add-on select | add-on picker + price | Adopt |
| Edit / remove item | allowed only while unfulfilled, audited | Adopt |
| — | SKU / model number | Extend |
| — | Item note | Extend |

**Price breakdown.**

| 6amMart label | Gadzio field | Decision |
|---|---|---|
| Items price | `orders.subtotal_paise` | Adopt |
| Add-on cost | included in subtotal | Adopt |
| Subtotal | `orders.subtotal_paise` | Adopt |
| Discount | `orders.discount_paise` | Adopt |
| Coupon discount | — | Skip — no coupons |
| Referral discount | — | Skip — no referrals |
| Extra packaging | — | Skip — no packaging charge |
| Delivery fee | `orders.shipping_paise` | Map |
| Tax / VAT | — | Skip — not GST-registered |
| Total | `orders.total_paise` | Adopt |
| Amount paid | sum of captured payments | Adopt |
| Due amount | total minus paid | Adopt |
| Amount returned to wallet | — | Skip — no wallet |
| Payment reference code | `orders.payment_reference` | Adopt |
| Paid by | customer name / method | Adopt |
| Payment proof image | `order_payments.proof_media_id` | Map |

**Shipment block.**

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| Delivery man | — | Skip — third-party courier |
| Delivery fee area | — | Skip |
| Delivery time | — | Skip |
| Delivery proof image | shipment proof upload | Map |
| — | `orders.courier_name` | Extend |
| — | `orders.tracking_number` | Extend |
| — | `orders.tracking_url` (from template) | Extend |
| — | `orders.shipped_at`, `orders.delivered_at` | Extend |

**Refund block:** refund request flag, reason, amount, status, rejection note,
processed by, processed at; see C.2.5.

**Edit history log:** edited by, edited at, field, old value, new value, reason,
IP hash. Immutable; no update or delete path.

**Status actions:** mark paid (manual), processing, ready to ship, shipped,
delivered, cancel with reason, record refund. Every transition writes
`order_status_history` and `store_admin_audit`.

#### C.2.3 Invoice and packing slip

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| Invoice number | `invoice_counters` + prefix | Adopt |
| Order id | order number | Adopt |
| Invoice date | generated date | Adopt |
| Store name, address, phone, email, logo | `store_settings` | Adopt |
| Store GST / tax id | — | Skip — not registered |
| Customer name, address, phone, email | order snapshot | Adopt |
| Item table: SL, item, variation, qty, unit price, total | same | Adopt |
| Subtotal | subtotal | Adopt |
| Discount | discount | Adopt |
| Delivery charge | shipping | Map |
| Tax | — | Skip |
| Grand total | total | Adopt |
| Paid / due | paid / due | Adopt |
| Payment method and status | same | Adopt |
| Note and terms | store note / terms | Adopt |
| Footer | invoice footer | Adopt |

Packing slip carries order number, date, customer, items and quantities, and
internal note; no prices.

#### C.2.4 Manual / offline payment verification

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| Order id | order | Adopt |
| Order date | order date | Adopt |
| Customer info | customer name, phone, email | Adopt |
| Payment method | method name | Adopt |
| Payment information | reference / sender details | Adopt |
| Customer note | payment note | Adopt |
| Total amount | amount | Adopt |
| Transaction id | `order_payments.reference` | Adopt |
| Payment proof | `order_payments.proof_media_id` | Map |
| Status (pending / verified / denied) | pending / verified / rejected | Adopt |
| Denied note | `rejected_reason` | Adopt |
| Verify action | verify, audit | Adopt |
| Switch to COD | switch method, audit | Adopt |
| Export | CSV | Adopt |

#### C.2.5 Refunds and returns

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| Refund id | `refunds.id` | Adopt |
| Order id | `refunds.order_id` | Adopt |
| Customer | customer | Adopt |
| Refund reason | `refund_reasons` | Adopt |
| Refund amount | `refunds.amount_paise` | Adopt |
| Refund method | original method / manual | Adopt |
| Refund reference | provider or bank reference | Adopt |
| Refund status | requested / approved / received / refunded / rejected | Adopt |
| Rejection note | `refunds.rejection_note` | Adopt |
| Requested at | `refunds.requested_at` | Adopt |
| Processed by / at | `refunds.processed_by`, `processed_at` | Adopt |
| Return items and quantities | `return_items` | Extend |
| Condition grade | `return_items.condition_grade` | Extend |
| Restock toggle | restock + `stock_movements` reason `return` | Extend |
| Photos | `return_items.photos` | Extend |

Refund reasons CRUD fields: reason text, applies to (customer / admin), active,
display order.

#### C.2.6 Cancellation reasons

Fields: reason, applies to (customer / admin), status, display order. Columns:
#, reason, type, status, action.

#### C.2.7 Order exports

Column allow-list: order id, date, channel, customer name, email (masked), phone
(masked), shipping city/state/pincode, items, units, subtotal, discount,
shipping, total, payment method, payment status, fulfilment status, courier,
tracking number, refund amount, cancellation reason. No full address or raw
payment payload.

### C.3 Catalog

#### C.3.1 Product list

| 6amMart control | Gadzio control | Decision |
|---|---|---|
| Search | name, SKU, model number, EAN, brand | Adopt |
| Category filter | category, including children | Adopt |
| Sub-category filter | same tree | Adopt |
| Brand filter | brand | Adopt |
| Condition filter | condition | Adopt |
| Store filter | — | Skip |
| Zone filter | — | Skip |
| Status filter | active / inactive / archived | Adopt |
| — | stock status (in / low / out) | Extend |
| — | price range | Extend |
| Columns: SL, image, name, category, price, stock, status, action | same, plus SKU, brand, updated | Adopt + Extend |
| Edit / delete | edit, duplicate, archive, restore | Adopt |
| Update stock | stock adjustment dialog | Adopt |
| Export CSV / Excel | CSV export | Adopt |
| Bulk actions | activate, deactivate, archive, export | Extend |

#### C.3.2 Product create/edit — full field inventory

**Basic setup.**

| 6amMart field | 6amMart label | Gadzio field | Decision |
|---|---|---|---|
| `name[]` | Product name | `products.name` | Adopt |
| `short_description` | Short description | `products.short_description` | Adopt |
| `description[]` | Description | `products.description` (rich text) | Adopt |
| `category_id` | Category | `products.category_id` | Adopt |
| `sub_category_id` | Sub category | `products.category_id` (tree) | Map |
| `store_category_id` | Store category | — | Skip — no store categories |
| `brand_id` | Brand | `products.brand_id` | Adopt |
| `condition_id` | Condition | `products.condition_id` | Adopt |
| `unit` | Unit | `products.unit_id` | Adopt |
| `unit_value` | Unit value | `products.unit_value` | Adopt |
| `generic_name` | Generic name | `products.model_number` | Map |
| `manufacturer` | Manufacturer | `products.manufacturer` | Adopt |
| `tags` | Tags | `products.tags` | Adopt |
| `addon_ids[]` | Add-ons | `product_addons` | Adopt |
| `available_time_starts` / `ends` | Available time | — | Skip — always available |
| `item_type` (veg / non-veg) | Item type | — | Skip — food-only |
| `organic` | Organic | — | Skip — food-only |
| `is_halal` | Halal | — | Skip — food-only |
| `is_prescription_required` | Prescription required | — | Skip — pharmacy-only |
| `basic` | Basic medicine | — | Skip — pharmacy-only |
| `nutritions[]` | Nutrition | — | Skip — food-only |
| `allergies[]` | Allergies | — | Skip — food-only |
| — | — | `products.slug` | Extend |
| — | — | `products.ean` / UPC | Extend |
| — | — | `products.highlights` | Extend |
| — | — | `products.in_the_box` | Extend |
| — | — | `products.warranty_months` | Extend |
| — | — | `products.is_featured` | Extend |
| — | — | `products.is_active` | Extend |

**Pricing and inventory.**

| 6amMart field | 6amMart label | Gadzio field | Decision |
|---|---|---|---|
| `price` | Unit price | `products.price_paise` | Adopt |
| `discount` | Discount | `products.compare_at_paise` minus selling price | Map |
| `discount_type` | Percent / amount | derived; editor accepts MRP or discount | Map |
| `tax_ids[]` | Tax | — | Skip — not GST-registered |
| `current_stock` | Current stock | `stock_on_hand`, variant stock | Adopt |
| `maximum_cart_quantity` | Maximum cart quantity | `products.max_purchase_qty` | Adopt |
| — | — | `products.min_purchase_qty` | Extend |
| — | — | `products.cost_paise` (owner-only) | Extend |
| — | — | `products.low_stock_threshold` | Extend |
| — | — | backorder policy | Extend |

Price writes stay locked until Phase 0 completes: checkout must read
`products.price_paise`, and the regression test must prove the storefront, cart
and PayU amount all agree before the editor can write a price.

**Variants.**

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `choice[]` | option name (`Colour`, `Storage`, `Connectivity`) → `product_variants.option_name` | Adopt |
| `choice_no[]` | number of choices | derived |
| `choice_options_{n}[]` | option values → `product_variants.option_value` | Adopt |
| option `name` | option label | Adopt |
| option `type` | single / multiple | Skip — gadget variants are single-select |
| option `min` / `max` | — | Skip — not meaningful for gadgets |
| option `required` | always required | Adopt |
| option value price | `price_paise_override` | Adopt |
| option value stock | `stock_on_hand` per variant | Adopt |
| — | `product_variants.sku` | Extend |
| — | `product_variants.barcode` | Extend |
| — | `product_variants.image_media_id` | Extend |

**Media.**

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `image` | main image → `product_images` sort 0 | Adopt |
| `images[]` | gallery → `product_images` | Adopt |
| image alt / description | `product_images.alt_text` | Extend |
| `video_upload_type` | upload or link | Adopt |
| `video` / `video_link` | `products.video_url` / media asset | Adopt |
| `remove_video` | remove action | Adopt |
| — | gallery ordering | Adopt |
| — | image usage count / delete guard | Extend |

Rules: JPEG, PNG, WebP; one main image required; up to 8 gallery images; video
link or uploaded MP4/WebM up to 50 MB; alt text recommended.

**SEO and merchandising.**

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| — | `products.seo_title` | Extend |
| — | `products.seo_description` | Extend |
| — | `products.canonical_url` | Extend |
| — | featured badge (`is_featured`) | Extend |
| — | related products (`product_relations`) | Extend |
| — | upsells / cross-sells (`product_relations.kind`) | Extend |
| — | storefront visibility (`is_active`, `archived_at`) | Extend |

**Validation rules.**

- Name required, 2–200 characters; slug unique.
- Category required and must be a leaf or explicitly allowed parent.
- Selling price ≥ 0; compare-at price either null or greater than selling price.
- Cost is owner-only and never exposed to `store_viewer`.
- Stock integer ≥ 0; max purchase quantity ≥ 1 and ≥ min purchase quantity.
- Description ≤ 20,000 characters, because gadget specifications and compatibility
  notes need more room than a short grocery listing.
- At least one image; at most 8; accepted types and size checked server-side.
- Variant combination must be unique per product; variant SKU unique globally
  when present.
- Add-ons must be active and belong to the same category or be global.
- Video URL must be HTTPS and on the allow-listed hosts when not an upload.
- Every create, update, archive, restore and price change writes an audit row.

#### C.3.3 Category form and list

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `name[]` | `categories.name` | Adopt |
| `parent_id` | `categories.parent_id` | Adopt |
| `position` (0 main, 1 sub, 2 sub-sub) | depth derived from parent chain; max 3 levels | Map |
| `priority` (high / medium / normal) | `categories.priority` | Adopt |
| `status` | `categories.is_active` | Adopt |
| `featured` | `categories.is_featured` | Adopt |
| image | `categories.image_media_id` | Adopt |
| `tax_ids[]` | — | Skip — not GST-registered |
| — | `categories.slug` | Extend |
| — | `categories.seo_title`, `seo_description` | Extend |
| — | `sort_order` | Extend |

List columns: #, image, name, parent, level, products, priority, status, actions.
Filters: search, level, status. Delete is blocked while products or children
exist; reorder is drag-and-drop; parent cycle is rejected server-side.

#### C.3.4 Brand

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `name[]` | `brands.name` | Adopt |
| image / logo | `brands.logo_media_id` | Adopt |
| `brand_status` | `brands.is_active` | Adopt |
| module assign / transfer | — | Skip — single store, no modules |
| — | `brands.slug` | Extend |
| — | `brands.description` | Extend |
| — | SEO fields | Extend |

List columns: #, logo, name, products, status, actions.

#### C.3.5 Attribute and options

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `name[]` | `attributes.name` | Adopt |
| — | `attribute_options` (value, hex, sort) | Extend |
| — | `product_attribute_values` | Adopt — already in 0012 |

6amMart stores attribute names only and lets each product define its own option
values. Gadzio keeps reusable option values so filters and variant matrices stay
consistent; the product form still allows product-specific values. Writes are
owner-only.

List columns: #, name, values, products, actions.

#### C.3.6 Unit

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `unit[]` | `units.name` | Adopt |
| — | `units.short_code` | Extend |
| — | `units.is_active` | Adopt |

List columns: #, unit name, short code, products, actions.

#### C.3.7 Common condition

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `name[]` | `conditions.name` | Adopt |
| `status` | `conditions.is_active` | Adopt |
| — | product count column | Adopt |

Used for new / refurbished / open-box definitions and the storefront badge.

#### C.3.8 Add-on

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `name[]` | `addons.name` | Adopt |
| `category_id` | `addons.category_id` | Adopt |
| `price` | `addons.price_paise` | Adopt |
| `tax_ids[]` | — | Skip — not GST-registered |
| `status` | `addons.is_active` | Adopt |
| `store_id` | — | Skip — single store |
| — | `addons.description` | Extend |
| — | `addons.image_media_id` | Extend |

Examples: extended warranty, gift wrap, accessory bundle. List columns: #, name,
category, price, status, actions.

#### C.3.9 Stock

| 6amMart control | Gadzio control | Decision |
|---|---|---|
| Store filter | — | Skip |
| Zone filter | — | Skip |
| Search | product, SKU, variant | Adopt |
| Columns: SL, name, current stock, action | #, product, variant, SKU, on hand, reserved, available, threshold, action | Adopt + Extend |
| Update stock | adjustment dialog with delta, reason, note | Adopt |
| — | movement history | Extend |
| — | low-stock / out-of-stock views | Extend |

Adjustment reasons: restock, sale, return, damage, correction, transfer, other.
Every adjustment writes `stock_movements` and an audit row.

#### C.3.10 Reviews

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| Review id | `product_reviews.id` | Adopt |
| Order id | `product_reviews.order_id` | Adopt |
| Customer | customer name / id | Adopt |
| Item | product | Adopt |
| Review text | `product_reviews.body` | Adopt |
| Rating | `product_reviews.rating` (1–5) | Adopt |
| Date | `created_at` | Adopt |
| Store reply | `product_reviews.store_reply`, `replied_at` | Adopt |
| Show / hide | `status` (pending / published / rejected) | Adopt |
| — | verified-purchase flag | Extend |
| — | rejection reason | Extend |

Moderation actions: publish, reject with reason, reply, export. Every moderation
action is audited.

#### C.3.11 Media library

Fields: file name, URL, MIME type, size, dimensions, alt text, uploaded by,
uploaded at, usage count (products, categories, brands, pages, settings).
Actions: upload, replace, edit alt text, copy URL, delete (blocked while
referenced). Grid and list views; type and date filters.

#### C.3.12 Bulk import / export columns

**Import template columns:** `product_id` (blank for create), `name`, `slug`,
`sku`, `model_number`, `ean`, `brand`, `category`, `subcategory`, `condition`,
`unit`, `unit_value`, `short_description`, `description`, `highlights`,
`in_the_box`, `price`, `compare_at_price`, `cost`, `stock`,
`low_stock_threshold`, `min_purchase_qty`, `max_purchase_qty`,
`variant_option_name`, `variant_option_value`, `variant_sku`, `variant_price`,
`variant_stock`, `image_urls` (pipe-separated), `video_url`, `tags`,
`warranty_months`, `is_featured`, `is_active`, `seo_title`, `seo_description`.

Dry-run validates every row, reports row-level errors, and writes nothing.
Commit is chunked and transactional per chunk; every imported product writes an
audit row. Export uses the same columns plus `created_at`, `updated_at`,
`stock_status`.

### C.4 Customers

#### C.4.1 Customer list

| 6amMart control | Gadzio control | Decision |
|---|---|---|
| Search | name, email, phone (masked) | Adopt |
| Joining date range | Joined date range | Adopt |
| Order date range | Last order date range | Adopt |
| Status (active / inactive) | Active / blocked | Adopt |
| Sort by newest / oldest | Same | Adopt |
| Sort by order amount / count | Same | Adopt |
| Storefront filter | — | Skip |
| Columns: SL, name, contact, joining date, total order, total order amount, status, action | customer, contact (masked), orders, lifetime value, last order, joined, status, actions | Adopt |
| — | registered / guest filter | Extend |
| — | spend range | Extend |
| Export | CSV with PII rules | Adopt |

Actions: view 360, add note, block / unblock, export. Blocking requires
`store_admin` or above and is audited.

#### C.4.2 Customer 360

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| Customer id | customer id | Adopt |
| Name | name | Adopt |
| Email | email | Adopt |
| Contact | phone (masked; owner reveal) | Adopt |
| Addresses | `customer_addresses` list | Adopt |
| Completed / incomplete profile | profile completeness | Adopt |
| Total order | order count | Adopt |
| Total order amount | lifetime value | Adopt |
| Wallet balance | — | Skip |
| Loyalty point | — | Skip |
| Order table: order id, date, store, total items, total amount, status, action | order id, date, items, total, status, action | Adopt (store column dropped) |
| — | AOV, first / last order | Extend |
| — | Payments tab | Extend |
| — | Sessions / devices | Extend |
| — | Notes tab | Extend |

Actions: add note, disable, revoke sessions, trigger password reset (owner),
anonymise (owner), export.

#### C.4.3 Customer settings

| 6amMart field | Gadzio setting | Decision |
|---|---|---|
| `customer_wallet` | — | Skip — no wallet |
| `add_fund_status` | — | Skip — no wallet top-up |
| `refund_to_wallet` | — | Skip — refunds go to the original method |
| `customer_loyalty_point` | — | Skip — no loyalty |
| `item_purchase_point` | — | Skip |
| `loyalty_point_exchange_rate` | — | Skip |
| `minimun_transfer_point` | — | Skip |
| `ref_earning_status` / `ref_earning_exchange_rate` | — | Skip — no referrals |
| `guest_checkout_status` | guest checkout on/off | Adopt |
| `customer_personalization_status` | — | Skip — no recommendation engine |
| new-customer discount fields | — | Skip — marketing out of scope |
| — | account required for checkout | Extend |
| — | default customer status | Extend |

#### C.4.4 Subscribers

Fields: email, name (optional), source (newsletter, back-in-stock, checkout),
consent, subscribed at, unsubscribed at, status. Filters: date range, source,
status. Sort: newest / oldest. Export CSV. No wallet or loyalty columns.

#### C.4.5 User accounts

Fields: name, email, signup date, last login, order count, status, email verified,
sessions/devices, login history. Actions: disable, revoke sessions, password reset
(owner). Never display password hashes or session tokens.

### C.5 Staff, roles and audit

#### C.5.1 Employee fields

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `f_name` / `l_name` | `store_admins.name` (split optional) | Map |
| `email` | `store_admins.email` | Adopt |
| `phone` | `store_admins.phone` | Adopt |
| `password` / `confirmPassword` | password + confirmation | Adopt |
| `role_id` | `store_admins.role` (owner / admin / viewer) | Map |
| `image` | `store_admins.avatar_media_id` | Adopt |
| `zone_id` | — | Skip — no zones |
| — | invite flow (`store_admin_invites`) | Extend |
| — | last login | Adopt |

List columns: #, name, email, phone, role, status, last login, actions.

#### C.5.2 Role permissions

6amMart custom roles carry a permission matrix across dashboard, orders, items,
categories, brands, units, attributes, conditions, add-ons, customers, reports,
settings, employees, notifications, reviews, refunds and POS. Gadzio keeps three
fixed roles and maps the same permission groups onto capabilities:

| 6amMart permission group | Gadzio capability |
|---|---|
| Dashboard | `overview.view` |
| Orders | `orders.view`, `orders.edit`, `orders.cancel`, `orders.refund` |
| Items / categories / brands / units / attributes / conditions / add-ons | `catalog.view`, `catalog.edit`, `catalog.publish` |
| Customers | `customers.view`, `customers.edit`, `customers.reveal` |
| Reports | `reports.view`, `reports.export` |
| Business settings | `settings.view`, `settings.edit` |
| Employees | `staff.view`, `staff.edit` |
| Notifications | `notifications.send` |
| Reviews | `reviews.moderate` |
| Refunds | `refunds.manage` |
| POS | `pos.use` (existing module) |

`store_owner` holds every capability; `store_admin` holds all except staff
management, role changes, destructive exports and owner-only reveals;
`store_viewer` holds `*.view` only. No custom roles, matching the locked scope.

#### C.5.3 Profile and account

Fields: name, email, phone, avatar, password change (current + new + confirm),
TOTP enrolment, active sessions with revoke. Email change requires re-login.
Password and TOTP secrets are never returned by any API.

#### C.5.4 Audit log viewer

Fields: timestamp, actor name and role, action, entity type, entity id, summary,
masked before/after, hashed IP, hashed user agent. Filters: actor, action,
entity, date range. Read-only, CSV export. No update or delete path.

### C.6 Settings

#### C.6.1 Business profile

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `business_name` | legal name / display name | Adopt |
| `business_email` | support email | Adopt |
| `business_number` | support phone | Adopt |
| `address` | registered address | Adopt |
| `country` | country (India) | Adopt |
| `currency` | INR, fixed | Adopt |
| `currency_symbol_position` | fixed left | Adopt |
| `digit_after_decimal_point` | fixed 2 | Adopt |
| `timezone` | timezone | Adopt |
| `timeformat` | 12h / 24h | Adopt |
| latitude / longitude | optional map pin | Adopt |
| `footer_text` | footer text | Adopt |
| `cookies_text` | cookie notice | Adopt |
| `maintenance_mode` / duration / message | maintenance mode and message | Adopt |
| `additional_charge` | — | Skip — no extra charge |
| admin commission / business model | — | Skip — no marketplace |
| app links / react website | — | Skip — Next.js storefront already exists |
| — | logo, favicon | Extend |
| — | order prefix, starting number | Extend |
| — | invoice prefix | Extend |

#### C.6.2 Order settings

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `order_confirmation_model` | auto-confirm on payment | Map |
| `notification_type` | — | Skip — no Firebase |
| `schedule_order` / `slot_duration` | — | Skip — no scheduling |
| `home_delivery` | shipping enabled | Adopt |
| `takeaway` | pickup enabled (optional) | Map |
| `repeat_order` | — | Skip |
| `free_delivery` / `free_delivery_over_amount` | free shipping threshold | Adopt |
| packaging charge | — | Skip |
| `prescription_order` | — | Skip — pharmacy-only |
| monthly order limit | — | Skip |
| — | order prefix and starting number | Extend |
| — | auto-cancel unpaid after N hours | Extend |
| — | default fulfilment status | Extend |

#### C.6.3 Payments

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `cash_on_delivery` | COD toggle | Adopt |
| `digital_payment` | PayU toggle and sandbox indicator | Adopt |
| `offline_payment` | manual methods toggle | Adopt |
| `partial_payment` | — | Skip — no partial payments |
| gateway list: gateway, gateway_title, mode, status, supported_country, toggle_type | PayU plus manual methods; mode and status only | Map |
| gateway credentials | environment variables only; never stored or displayed | Adopt |
| `method_name` | offline method name | Adopt |
| `payment_note` | instructions shown at checkout | Adopt |
| `input_name[]` | field key | Adopt |
| `customer_input[]` / `customer_placeholder[]` | label and placeholder | Adopt |
| `is_required[]` | required flag | Adopt |
| — | method display order | Extend |

#### C.6.4 Email / SMTP

Fields: driver, host, port, username, password (secret, write-only), encryption,
from email, from name, status, test send. Secrets live in environment variables
or a write-only encrypted store; they are never returned by the settings API.

#### C.6.5 SMS

Fields: gateway, mode, status, sender id, credentials (write-only). Provider
choice remains deferred; the screen and storage exist but the channel is disabled
until a provider is selected.

#### C.6.6 Notification setup matrix

6amMart configures Mail / SMS / Push × Admin / Customer / Store / Delivery Man ×
topics. Gadzio keeps:

| Dimension | Values | Decision |
|---|---|---|
| Channel | email, SMS, in-app admin | Adopt (push skipped) |
| Audience | admin, customer | Adopt (store / delivery man skipped) |
| Topics | order placed, payment received, processing, shipped, delivered, cancelled, refund requested, refund completed, back in stock, password reset, staff invite, low stock | Adopt |

Each cell is an on/off toggle. Changing a toggle is audited.

#### C.6.7 Email templates

Fields: template key, name, subject, heading, body (rich text), button label and
URL, footer text, status. Token palette: `{{order_id}}`, `{{customer_name}}`,
`{{total}}`, `{{tracking_url}}`, `{{refund_amount}}`, `{{store_name}}`. Preview
with sample data and test send. Tokens are validated so an unknown token cannot
be saved.

#### C.6.8 Notification broadcast

| 6amMart field | Gadzio field | Decision |
|---|---|---|
| `notification_title` | title | Adopt |
| `description` | body | Adopt |
| `image` | image media id | Adopt |
| `target` | customers (all / segment) | Map |
| `zone` | — | Skip |
| Send / resend | send, retry | Adopt |
| — | in-app and email channels | Extend |

#### C.6.9 SEO pages

Fields per page: page name, meta title, meta description, meta image, robots
index, robots follow. Pages: home, category, product, search, cart, checkout,
account, about, contact, privacy, terms, refunds, shipping, warranty. Product
and category pages can override the defaults.

#### C.6.10 Social links

Fields: network name, slug, URL, icon, status, display order. Networks:
Instagram, Facebook, YouTube, X, WhatsApp, LinkedIn.

#### C.6.11 Analytics

Fields per provider: type, script id / measurement id, status. Providers: GA4,
Google Tag Manager, Meta Pixel, TikTok, Snapchat, Pinterest, LinkedIn, X. The
script is rendered only when status is active and an id is present.

#### C.6.12 reCAPTCHA

Fields: site key, secret key (write-only), status, applies to (login, checkout,
review, contact). Keys are validated with a test call before saving.

#### C.6.13 Login page setup

Fields: heading, subheading, background image, logo, support link. Stored in
`store_settings`; no code editing.

#### C.6.14 Static pages

Fields per page: title, slug, body (Markdown / rich text), SEO title, SEO
description, status, updated by, updated at. Pages: About, Privacy, Terms,
Refund / Returns, Cancellation, Shipping, Warranty, Contact.

#### C.6.15 Reasons and reference data

- Cancellation reasons: reason, applies to, active, order.
- Refund reasons: reason, applies to, active, order.
- Return reasons: reason, applies to, active, order.
- Expense categories: name, active, order.
All are referenced by foreign key; deletion is blocked while in use.

#### C.6.16 Maintenance

Fields: enabled, message, starts at, ends at, allow admin access. The storefront
shows the message; `/store-admin` stays available. Enabling requires
`store_owner` and is audited.

#### C.6.17 Integrations and storage

Non-secret fields only: provider name, status, region, bucket, sender identity,
webhook URL. Secrets (API keys, SMTP passwords, PayU keys, courier credentials)
stay in environment variables. The screen shows whether each secret is present,
never its value. Storage uses the existing media pipeline; no new provider is
required for launch.

#### C.6.18 Fulfilment and shipping

- Courier: name, tracking URL template (`{tracking}` placeholder), active.
- Shipping method: name, rate, free-over threshold, estimated min/max days,
  active, display order.
- Processing time and cut-off text shown at checkout.
- No courier API calls; the tracking URL is built from the template.

#### C.6.19 POS

Existing POS module stays visible and unchanged. Its settings remain where they
are today; this rebuild does not alter shifts, receipt counters or POS payments.

### C.7 Reports

Every report has a date range, totals row, CSV export and print view. No tax
report.

#### C.7.1 Order report

| 6amMart filter | Gadzio filter | Decision |
|---|---|---|
| Module | — | Skip |
| Store | — | Skip |
| Zone | — | Skip |
| Customer | customer | Adopt |
| Date range | date range | Adopt |
| Order status | fulfilment status | Adopt |
| Payment method | payment method | Adopt |
| — | channel | Extend |

Columns: order id, date, customer, subtotal, discount, shipping, refund, total,
payment method, payment status, fulfilment status, channel.

#### C.7.2 Item-wise report

Filters: category, brand, date range, order status. Columns: product, variant,
SKU, selling price, units sold, current stock, revenue, discount given, returns,
return rate, average rating, average sale value, sell-through.

#### C.7.3 Day-wise report

Filters: date range, channel. Columns: date, orders, units, gross revenue,
discounts, refunds, net revenue, AOV, new customers, returning customers.

#### C.7.4 Transaction statement

Filters: date range, method, status, type (payment / refund). Columns: date,
transaction id, order id, customer, type, method, provider reference, amount,
status, running balance. No admin/store income split.

#### C.7.5 Payment reconciliation

Filters: date range, method, status. Columns: order, expected amount, captured
amount, refunded amount, net, PayU txnid, match status, mismatch reason. Manual
and POS payments included.

#### C.7.6 Expense report

6amMart fields: customer, store, zone, expense type, date range. Gadzio keeps
date range, category, type, amount, description, attachment, created by. Columns:
date, category, description, amount, attachment, created by.

#### C.7.7 Stock report

Filters: category, brand, stock status, search. Columns: product, variant, SKU,
on hand, reserved, available, cost value, retail value, last movement.

#### C.7.8 Low-stock report

Filters: threshold, category, brand. Columns: product, variant, SKU, on hand,
threshold, last movement, suggested reorder quantity.

#### C.7.9 Customer report

Filters: date range, guest / registered, status. Columns: customer, email
(masked), orders, lifetime value, AOV, first order, last order, status.

#### C.7.10 Category / brand report

Filters: date range, category, brand. Columns: category or brand, active
products, units sold, revenue, revenue share, returns, return rate.

**6amMart reports not carried:** tax report (not GST-registered), store report,
delivery-man report, zone report, module report.

### C.8 Fields deliberately not carried

| Group | Fields | Reason |
|---|---|---|
| Marketplace | store_id, store settings, store categories, store subscriptions, store withdrawal, commission, store report | Single store |
| Delivery fleet | delivery man, zone, delivery charge area, cash collection, delivery proof workflow, delivery-man report | Third-party courier |
| Modules | module_id, module assign/transfer, module-wise settings, parcel, pharmacy, food, grocery, e-commerce module switches | One business model |
| Food / pharmacy | veg / non-veg, organic, halal, nutrition, allergies, prescription, basic medicine, cutlery, available time | Gadget store |
| Tax | tax_ids, tax report, VAT columns, GSTIN | Not GST-registered |
| Marketing | coupons, campaigns, banners, referral earnings, new-customer discount, push notifications | Out of scope |
| Wallet / loyalty | wallet, add fund, refund to wallet, loyalty points, point exchange, transfers | Explicitly excluded |
| Subscriptions / rentals | recurring orders, subscriptions, rentals | Not offered |
| Multi-language / currency | translation arrays, language switch, multi-currency | Single language, INR |
| Scheduling | scheduled orders, time slots, takeaway slots | Standard online orders only |
| Custom roles | custom role builder, per-zone roles | Three fixed roles |
| App platform | app links, React website toggle, Firebase, app version settings | Existing Next.js storefront |
| Tax / accounting | account transactions, admin/store earnings, commission ledger | Manual expense tracking only |

### C.9 Coverage statement

For every in-scope screen, each 6amMart field falls into one of three buckets:

1. **Carried** — listed in C.1–C.7 with its Gadzio field name and decision.
2. **Extended** — marked Extend where a gadget store needs a field 6amMart does
   not have (SKU, model number, EAN, warranty, cost, low-stock threshold,
   tracking URL, SEO, audit).
3. **Skipped** — listed explicitly in C.8 with a reason.

No field is dropped silently. When implementation begins, each phase in §10
closes against the matching subsection here, and the phase is not complete until
every Carried and Extend row in that subsection has a database column, a form
control, a validation rule and (where applicable) an audit entry.
