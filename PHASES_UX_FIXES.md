# Gadzio: Checkout, order status, invoices, simpler products, variant pricing, descriptions, site pages and search

**How to use this file**
1. Save it in the repo root as `PHASES_UX_FIXES.md` and commit it, so the agent can always re-read it.
2. Paste one starter message (at the bottom) per phase. Do the phases in order. Each phase ends with a report and the agent waits for you to say "continue".
3. The agent may ask you decisions with pop-up questions. My suggestions are in the table near the end.

**What changes and where**
- **Customer-facing screens may change their UI**, but every change must match the rest of the site (same header, footer, fonts, colours, spacing, buttons and cards as the home page). No new visual language.
- **Admin screens may be redesigned freely** for clarity, but must keep roles, guards, audit rows and help text.

**Conflicts with earlier files:** this file wins. It changes the invoice rule from `PHASES_PAYU_INVOICE_VARIANTS.md` Phase 2 (the invoice is now shown only after delivery) and the cart and checkout layout. It also builds the variant-level pricing that Phase 4 of that file assumes. If you have not finished the PayU payment-sync phase (Phase 1 of that file), do that first; nothing here replaces it.

---

## Common rules (apply to every phase)

1. This file is self-contained. Do not rely on earlier conversations. Never print secret values; report names and counts only.
2. Report findings before changing code. Each phase: Step 0 inspect and report, then build, then tests, then a short report. Stop at the end of each phase and wait for me to say "continue".
3. You may ask me questions when a decision is mine. Use the AskUserQuestion tool: up to 4 questions per call, 2 to 4 options, your recommendation first and marked "(Recommended)". Do not ask what you can find in the code. If I do not answer, take the conservative option for anything that moves money or deletes data, record it under "Decisions taken without an answer" in `UX_NOTES.md`, and carry on.
4. The server is authoritative for every price, amount, status and stock decision. A payment is Paid only after the verified gateway confirmation. Payment, order, shipment and refund status stay four independent values from one shared status module.
5. All money is integer paise; rupee input uses the shared parser and formatter. All times use the database clock.
6. Migrations are additive in their own numbered files (check `migrations/`), row level security on every new table, no deletion or rewriting of business data. Data migrations are idempotent and dry-run first, with counts reported.
7. Customer-facing UI: first write down the design values the home page actually uses (fonts, type scale, colours, spacing, buttons, cards, borders, radius, header, footer) in `UX_NOTES.md` and apply them to every changed customer screen. Responsive at 1440, 768 and 390 px with no horizontal scroll or layout shift; accessible (contrast at least WCAG AA, visible focus, keyboard use, labels on every field, semantic headings). Give before and after screenshots (or a precise render description) at those widths for each changed screen.
8. Admin UI: plain language, no jargon. Every field has a short help text (the field-help registry, if it exists, so the field-help check passes). Every store-admin API keeps `requireStoreRole(...)`; mutating ones keep `assertSameOrigin(request)`; every change is audited without secrets or personal data. Account routes keep session and ownership checks.
9. Do not touch the Education Store, POS pricing rules (staff type the price), or the identity separation. Do not break existing storefront behaviour: sale mode, coupons, shipping charge, reservations, maintenance mode and notifications must keep working.
10. DB-backed tests must really run (report passed, failed and skipped; a skipped test is not a pass) and may only write inside throwaway schemas. If you ever need to write to the configured database, tell me the database host name and row counts first and ask.
11. Each phase finishes with `npm test`, typecheck, build, all check scripts, `npm audit`, `git log --oneline` for the new commits and `git status` (clean). Update `FEATURES.md` (feature text, evidence block with real counts, file map). If an API or quota error interrupts you, stop and tell me the exact step you reached.

---

## Phase A: Customer order flow (cart, checkout, order status page, invoice visibility)

### A1. Cart button
- On `/cart` and `/bag` the main button says **Checkout**. It must not say "Check out with PayU" or show any payment-provider name anywhere in the cart. (A short neutral line such as "Secure online payment" is fine on the checkout page; the provider's own page is the only place its name appears.)

### A2. Checkout page layout and fields (`/checkout`)
Layout on desktop (two columns): **Order summary on the LEFT**, **customer details on the RIGHT**. On mobile, stack them: a collapsible order summary at the top (showing the total), then the form.
- **Order summary (left):** each item with image, name, selected variant (model or specification), quantity and line price; the coupon box; Subtotal, Discount, Shipping, Total; the "Add Rs X more for free shipping" nudge when a threshold is set; the stock or price-change messages that already exist.
- **Form (right):**
  - **First name**
  - **Email address (for receipt)**
  - **Mobile number:** exactly 10 digits, Indian format (first digit 6 to 9). Show a fixed "+91" prefix. If the customer pastes +91, 91 or a leading 0, strip it; ignore spaces and dashes. Store the normalized 10 digits.
  - **Shipping address:** house or flat and street, area or landmark (optional), city, state (dropdown of all Indian states and union territories), PIN code (6 digits, not starting with 0). Signed-in customers can pick one of their saved addresses and can choose to save a new one.
  - The pay button shows the amount ("Pay Rs 1,299") and works as the existing checkout does.
- **Validation:** inline messages in plain words under each field, on blur and on submit, and the SAME rules re-validated on the server (the server rejects bad input with the same messages and never creates an order). Keep the guest-checkout setting, marketing opt-in checkbox, coupon box, price-change guard and reservation behaviour exactly as they work today.
- Step 0: report the current checkout form fields, the current address and name storage (including the saved-address table), and any place a phone or PIN is validated differently.

### A3. Order status page after payment
- After a successful payment the customer lands on a page inside the normal site layout with the **site header and footer**, shows a clear **Order successful** message with the order number and amount paid, and then **two buttons: "View order summary" and "Continue shopping"**. If the same two buttons already exist, keep one set only (no duplicates).
- Only claim that an email was sent when the customer email notification for that event is actually enabled and mail is configured; otherwise leave that sentence out.
- **Remove from the status page:** the text "Shipment details will appear after pickup." and the **Order progress** stepper (Pending, Accepted, Preparing, Pickup done / In transit, Delivered). Whether the **Status timeline** stays is a question for me: recommended, keep the status timeline of real events and remove only the placeholder text and the stepper.
- The same layout (header, footer, one set of buttons) applies to the pending, verifying, failed and cancelled results, each with the right message and the right actions (Check payment status, Retry payment, Continue shopping). Use the shared status module for wording.
- Step 0: list every order result page (`/order/success`, `/order/status`, `/order/failed`, `/order/cancelled`, `/order/processing`), which have the header and footer and which do not, and where the placeholder text and the stepper are defined.

### A4. Invoice visibility: only after delivery
Replace the earlier "invoice after Shipped" display rule:
- While the order is **not yet Delivered** (including Shipped and In transit) the customer sees NO invoice and NO "request bill" action. Do not show placeholder text about it.
- Once the order is **Delivered**, the invoice is available from the order details page (View and Print). Ask me whether the customer gets it directly (recommended, no reason needed) or still has to submit a reason through the bill-request form first.
- Orders whose payment is pending, failed or cancelled never show an invoice or paid receipt (the payment status wording stays). Delivered orders with a refund show the invoice with the Refund Initiated or Refund Successful stamp. A simple payment receipt (not an invoice) for paid orders before delivery: ask me whether to keep it (recommended) or hide all documents until delivery.
- Staff can still open the admin invoice at any time after payment (existing owner-only rule unchanged unless I say otherwise).
- Invoice numbering: if numbers are already assigned at Shipped, keep that assignment (never renumber) and only gate who sees it; if not, assign it once when the order is first Delivered. Either way a number is assigned exactly once, even with retries and concurrent updates. Add a one-line note for me: tax rules may require the invoice to be issued at dispatch, so confirm with my accountant.
- Tests: table-driven over payment status, shipment status and refund status; nothing shown before Delivered; the notification and email links do not expose the invoice early; a direct URL to the invoice before delivery returns "not available" and never the document.

**Phase A tests:** cart text; checkout layout classes at three widths; every field's valid and invalid cases on client and server (Indian mobile edge cases, PIN, state); saved address selection; summary matches server totals; success page has header, footer and a single set of buttons; removed texts are gone; invoice visibility table.

---

## Phase B: Catalogue and product admin

### B1. Make the product screens simple (admin)
Today the product form uses jargon ("track inventory", "on hand", "reserved"). Redesign it for a non-technical shop owner.
- **Add product** becomes a step-by-step flow with a progress bar: 1 Basics (name, category, type, brand), 2 Photos, 3 Price and options, 4 Stock, 5 Description, 6 Review and publish. Each step explains itself in one or two sentences. **Edit product** shows the same sections on one page with a side list to jump between them and a sticky Save bar. A "Ready to publish?" checklist shows what is missing (name, photo, price, stock).
- Keep advanced fields (cost, SKU, barcode, weight, tax) collapsed under "Advanced".
- **Options (sub items):** call them "Options" (for example models, wattage, colour, size). A helper lets the owner pick an option type, type the values (for example iPhone 16, iPhone 16 Pro), and generates a table with one row per option: price (blank = same as the product), stock, and Active.
- **Stock in plain words.** Replace the jargon everywhere (product form, Stock pages, Sale page, POS, reports, notification text) with one vocabulary:
  - "Track inventory" becomes **Limit my stock** (toggle).
  - "On hand" becomes **In stock**.
  - "Reserved" becomes **Held in checkouts**.
  - "Available" becomes **Available to buy**.
  - "Low-stock threshold" becomes **Warn me when below**.
  - "Adjust stock" becomes **Add or remove stock**.
- **Tell the owner how to turn on the stock limit.** In the Stock step and on each options table put a short guide that is always visible, for example: "1. Turn on 'Limit my stock'. 2. Type how many you have in each row. 3. Save. When a row reaches 0, customers can no longer buy it." Make it work per option: one master switch, plus a number box in each option row. If the switch is off, show a clear warning "Stock is not limited, so this can be sold without end" and a one-click "Turn on". The products list shows "12 left", "Out of stock", or "Not limited" with a quick "Set stock" action.
- Step 0: list the current product form fields, where tracking, stock and variant controls live today, and every screen that uses the old terms. Show me a proposed screen sketch (text description) before building, and ask me to confirm the step order.

### B2. Separate pricing for each option (variant)
Today each option cannot carry its own price. Make price and sale price work per option.
- Each option can have its own **price** and **sale price** (blank price = use the product price). Sale price must be above 0 and below that option's effective price (plain-word error otherwise). The product-level price remains the default.
- Resolver rule (one shared server function used everywhere): effective regular price = option price, else product price. Effective sale price = option sale price; a product-level sale price applies to an option only when that option has no price of its own. Sale applies only while sale mode is live. Use this resolver for: product pages (the price changes when the customer picks an option), category cards and search ("From Rs X" when options differ, single price when equal), cart, price-change guard, checkout, order lines (store the charged price per option line), PayU amount, order documents, coupons (percentage and fixed apply on the line totals, scoped by product), shipping threshold (line totals), POS (the list price shown as a reference is the option's effective price; staff still type any price), reports (item-wise by option).
- Admin: the options table has Price and Sale price columns; the Sale page lists one row per option (inline edit, bulk percent off, clear); CSV import and export include option prices; every change appends to price history with the option id.
- Safe migration: existing options with no price inherit the product price (nothing changes visibly). Existing product-level sale prices keep working for options without their own price. Report counts first.
- Tests: option price beats product price; blank inherits; sale rules; the displayed price equals the charged price for every option; price-change guard per option; coupons and shipping use option prices; sale ending between display and Pay; POS reference price; CSV round trip; history rows.
- If variant-level stock (Phase 4 of the earlier file) is not built yet, build prices on the existing variant records now and make sure the structure lines up so stock per option can be added later without a rewrite.

### B3. Product description with sections
Each product has a full description kept when adding or editing, and the owner can add different sections inside it.
- In Add and Edit product: a **Short description** (shown near the title and used as the page summary) and a **Sections** area. Sections can be added, renamed, reordered by drag, hidden and removed. Section types: Text (simple formatting: bold, italics, lists, links), Bullet list, Specification table (label and value rows), FAQ (question and answer rows). Offer one-click starter sections: Overview, Key features, Specifications, What's in the box, Warranty and care, Shipping and returns.
- **Safety:** store content as safe structured data or sanitized formatting (no raw HTML or scripts); links get `rel="nofollow noopener"`; test that script tags and event handlers are stripped.
- **Storefront:** the product page renders the sections in the existing product-detail style (same accordion or stacked blocks as the rest of the site), in the saved order, skipping hidden and empty ones. Search can use the short description.
- **Safe migration:** seed sections for existing products from their current description, highlights and "in the box" text (idempotent, dry run first, never overwrite edited sections), so product pages look the same. Products with no content show no empty blocks. Include sections in CSV import and export in a simple, documented format.
- Tests: save and reload; reorder; hide; sanitization; migration idempotent; storefront renders in order; empty sections hidden; permissions and audit.

**Phase B done when:** a shop owner can add a product, give each model its own price and stock in plain words, write a sectioned description, and the storefront shows exactly that, with each option's own price and availability.

---

## Phase C: Site pages and search

### C1. Privacy Policy, Terms and Support pages
- `/privacy`, `/terms` and `/support` (and any other page linked from the header or footer, such as returns, shipping, about, contact or FAQ) must work, render **inside the normal site layout** (same header, footer, breadcrumb, container width and typography as the other pages), and not look like separate standalone pages.
- **Link audit:** crawl every internal link in the header, footer, cart, checkout, account and status pages and fix or remove any that return an error or point nowhere. Add `scripts/check-links.mjs` that does this against a running server and fails on any broken internal link, and run it in the checks.
- **Content from Store Admin:** wire the saved Store Pages (Settings -> Content) and the support email and phone (Settings -> Business) into these pages so staff can edit them without code, with the current text as the fallback. Show a "Last updated" date. Do not invent legal text; keep what exists. Ask me before adding any new page or route.
- **Support page:** shows the store email and phone from settings, order help (link to the account page and the request form), and a short FAQ section if FAQ content exists. Ask me whether to add a contact form (recommended: not now).
- Tests: each page returns 200 and contains the shared header and footer; edited content shows on the page; fallback when empty; the link check passes.

### C2. Search suggestions while typing
- In the header search box, after 2 or more characters (debounced about 200 ms, stale requests cancelled) show a dropdown of matching products: image, name, price (the effective price from the shared resolver, "From Rs X" when options differ), category, and the stock state following the existing rules (normal mode shows Stock not available; sale mode never shows it). Show at most 6 products, a "See all results for ..." row that goes to `/search`, and recent searches when the box is empty and focused. Keyboard: Up and Down move, Enter opens the highlighted product or the full results, Esc closes. Accessible combobox roles. On mobile the suggestions fit the screen and work with the on-screen keyboard.
- Matching: product name, brand, category, SKU and (when Phase 3 compatibility exists) compatible device models, so typing "iphone 16" finds cases made for it. Prefix and word matching is enough; tolerate small typos if a cheap, safe method exists (for example trigram matching via a migration; ask me before adding an extension). Only active products. Education Store items keep working as they do today.
- **Endpoint:** a small server route (new `/api/search/suggest`) that returns only safe fields (id, name, link, image, category, effective price, availability flag): no cost, no stock counts, no internal notes. Rate limited, same-origin, respects maintenance mode, uses one lightweight query (the database pool is small), never cached across different sale states.
- Tests: matching by name, brand, SKU, model; archived products never appear; the price equals the product page price; rate limit; no leaked fields; keyboard and accessibility structure; empty and no-result states.

**Phase C done when:** every footer and header page opens inside the normal layout and no internal link is broken, and typing in the search bar shows matching products immediately.

---

## Phase D: Verification and release notes
1. End-to-end flow on a running server in a safe schema or test mode: browse, search by typing, open a product and pick an option (price and availability change), add to cart, **Checkout**, fill the new checkout form (including invalid Indian mobile and PIN cases), pay in test mode, land on the success page with header and footer and the two buttons, open the order summary, check no invoice before delivery, mark shipped (still no invoice), mark delivered (invoice shown), refund states.
2. Admin walk-through: add a product through the step-by-step flow with options, per-option prices and stock, and a sectioned description; confirm the storefront shows it exactly.
3. Regression: the whole earlier suite (sale mode, coupons, shipping charge, reservations, reports, notifications, staff accounts, maintenance) still passes.
4. Screenshot set at 1440, 768 and 390 px for every changed customer screen, plus a list of every storefront file changed and every new route or API.
5. Final evidence in `FEATURES.md`: test counts, check results, migrations in order, anything not built.

---

## Decisions the agent will probably ask, with my suggestions

| Question | Suggestion |
|---|---|
| Does the status page keep the status timeline? | Keep the timeline of real events; remove the placeholder text and the progress stepper |
| After delivery, does the customer need a reason to see the invoice? | No, show it directly |
| Keep a simple payment receipt before delivery? | Yes, keep it, labelled "Payment receipt", never called an invoice |
| Where is the invoice number assigned? | Keep the current assignment, only hide it until delivery |
| Add product flow? | Step by step for new products, one page with sections for editing |
| Product-level sale price vs options with their own price? | An option with its own price uses its own sale price only |
| Typo tolerance in search? | Only if it needs no new extension; otherwise prefix and word matching |
| Support page contact form? | Not now; show email and phone and order help |
| Legal page text? | Keep the existing text, make it editable, and have a professional review it |

## What only you can do
1. Review the policy text (privacy, terms, returns) with a professional; the agent will not write legal text.
2. Give the agent your accountant's answer on when an invoice must be issued, if you want that rule changed.
3. Enter your real stock counts in the new "In stock" boxes once Phase B is done.
4. Run the manual checks below, and a real PayU test payment through the new checkout.

## Starter messages

Paste one at a time (change the phase letter each time):

```text
Read PHASES_UX_FIXES.md in the repo root. Follow its Common rules. Do Phase A only: write
your Step 0 findings first, ask me any decisions you need, then build, test and report. Stop
when Phase A is done and wait for me to say "continue".
```

## Manual checks after each phase
- **A:** open the cart (button says Checkout), then checkout: summary on the left, details on the right on desktop, stacked on a phone. Try a 9-digit mobile number and a 5-digit PIN. Pay in test mode and check the success page has the header, footer and two buttons only, with no "Shipment details will appear after pickup" and no progress stepper. Check an order that is Shipped shows no invoice, and Delivered shows it.
- **B:** add a product through the steps; add three models with different prices and stock; open it on the storefront and pick each model (the price changes); check the description sections appear in order.
- **C:** open Privacy, Terms and Support from the footer and check they look like the rest of the site. Type "iph" in the search bar and check suggestions appear.
