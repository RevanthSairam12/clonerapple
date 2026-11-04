# Gadzio: PayU sync, invoices and refunds, attributes, variant stock, coupon visibility

**How to use this file**
1. Save it in the repo root as `PHASES_PAYU_INVOICE_VARIANTS.md` and commit it, so the agent can always re-read it.
2. Start each phase with the one-line message from "Starter messages" at the bottom. Do the phases in order. Each phase ends with a report, and you reply "continue" for the next.
3. The agent may ask you decisions with pop-up questions. My suggestions are in the table near the end.

**Run order and what it depends on**
- Finish the admin merge and the checkout/payment/account prompt (`CHECKOUT_PAYMENT_ACCOUNT_PROMPT.md`) first, or tell the agent which parts of them are not done yet. Phases 1 and 2 reuse the payment/order status module from that prompt. If it does not exist yet, the agent builds it here once and the other prompt reuses it.
- Phase 1 needs a **public HTTPS address** for your site (a deployed copy or a tunnel such as ngrok or cloudflared). PayU cannot send callbacks to `localhost`, and a browser that is not on your computer cannot open it. This is very likely the cause of "Site can't be reached".

---

## Common rules (apply to every phase)

1. This file is self-contained. Do not rely on earlier conversations. Never print secret values (PayU key and salt, tokens, passwords, database URLs); report names and counts only.
2. Report findings before changing code. For each phase: Step 0 inspect and report, then build, then tests, then a short report with the evidence below. Stop at the end of each phase and wait for me to say "continue".
3. You may ask me questions when a decision is mine. Use the AskUserQuestion tool: up to 4 questions per call, 2 to 4 options, your recommendation first and marked "(Recommended)". Do not ask what you can find in the code. If I do not answer, take the conservative option for anything that moves money or deletes data, record it under "Decisions taken without an answer" in `PHASES_NOTES.md`, and continue with what does not depend on it.
4. The server is authoritative for every amount, status and stock decision. A payment is Paid only after the PayU hash is verified AND the server-side PayU verification confirms it AND the transaction id and amount match the order. Never from a browser redirect alone.
5. Payment status, order status, shipment status and refund status are four independent values. One shared status module derives them for every screen, document and notification. Do not scatter status logic.
6. All money is integer paise. Rupee input uses the shared `parseRupeesToPaise` and formatter. All times use the database clock.
7. Migrations are additive, in their own numbered files (check `migrations/` for the next number), with row level security enabled on every new table in the same file. Never delete or rewrite existing business data. Data migrations are idempotent and dry-run first, with counts reported.
8. Do not break the storefront. No unrelated UI changes. Education Store untouched. The commerce boundary (website content editor cannot hold products, prices or stock) stays.
9. Every store-admin API keeps `requireStoreRole(...)`; mutating ones keep `assertSameOrigin(request)`; every change is audited without secrets or personal data. Account routes keep session and ownership checks. New admin fields get help text (the field-help registry, if it exists).
10. DB-backed tests must really run (report passed, failed and skipped; a skipped test is not a pass) and must only write inside throwaway schemas. If you ever need to write to the configured database, tell me which database host (name only) and the row counts first and ask.
11. Each phase finishes with: `npm test`, typecheck, build, all check scripts, `npm audit`, `git log --oneline` for the new commits and `git status` (clean). Update `FEATURES.md` (feature descriptions, evidence block with real counts, file map). If an API or quota error interrupts you, stop and tell me the exact step you reached.

---

## Phase 1: PayU payment synchronization and the successful-payment flow (CRITICAL)

**Problem:** after a successful payment the browser shows "Site can't be reached"; PayU and the site do not agree on payment status.

**Step 0: reproduce and find the cause.** Report all of these before changing anything:
- How the PayU request is built: the success, failure and cancel URLs (`surl`, `furl`, `curl`), the webhook URL, and exactly where the base address comes from (an environment variable, request headers, or hard-coded). Say what values they have right now (host names only).
- How each callback route (`/api/payu/success`, `/failure`, `/cancel`, `/webhook`) reads the request (PayU sends POST form data; check GET too), how it verifies the hash, how it redirects (a 307 or 308 redirect re-sends the POST and breaks pages; the correct redirect after a POST is 303), and what happens on any error (it must never end in a blank page or an unreachable address).
- Whether the order result pages require a signed-in session, and what happens when the return from PayU arrives without the session cookie (cross-site returns often drop it).
- Which of these explains "Site can't be reached": a localhost or wrong-port base address in the PayU request, an `http` versus `https` mismatch, a redirect to an absolute URL on the wrong host, a dev server that is not reachable from the customer's browser, or a crash in the handler. Show the evidence.
- Ask me how I am testing (deployed copy or tunnel) and what public address to use.

**Build:**
1. **One base-URL function.** `surl`, `furl`, `curl`, the webhook URL and every redirect use one configured site address (a required environment variable, validated). In production it must be a public HTTPS address; warn clearly on `localhost`. Never derive it from an untrusted `Host` header. If it is missing, checkout fails closed with a clear admin-visible message, not a broken PayU page.
2. **Callback handlers.** Accept the form POST (and GET where PayU sends it), verify the hash, call PayU server-side verification, then run ONE shared, atomic, idempotent transition used by the redirect handlers, the webhook and the reconcile worker. Always answer with a 303 redirect to a result page chosen from the order's effective status (success, failed, cancelled, processing/pending). Any error redirects to a safe status page for that transaction; never a blank page, stack trace or raw gateway response.
3. **Verify before marking paid.** Compare the transaction id with the order, the amount with the order total in paise, and the currency and product info where PayU returns them. Record the gateway transaction id (`mihpayid`) with a unique constraint so one gateway payment can only attach once. A mismatch never marks the order paid; it sets the payment review flag and writes an audit row.
4. **Return without a session.** If the customer comes back from PayU without a session, show a safe summary page (order number, status, amount) using a short-lived signed link included in the redirect (HMAC with a server secret from the environment; fail closed if the secret is missing). Full details still need the signed-in owner.
5. **Statuses.** Handle success, failure, cancelled, user-cancelled, pending and unknown correctly: pending is shown as Pending/Verifying, never Paid; failed and cancelled show clearly and release stock and any coupon use according to the existing rules; a failed payment can be retried (new attempt, never a second paid order).
6. **Works even if the customer never returns.** The webhook (server to server) and the reconcile worker must update the order without the browser: webhook before redirect, redirect before webhook, webhook only, redirect only, repeated webhook, and a customer who closes the PayU page all end in the same correct final state with no duplicate order, duplicate payment row, duplicate stock claim or duplicate message. Document the exact webhook URL I must set in the PayU dashboard and the reconcile schedule (every minute, with the cron secret).
7. **Payment event timeline.** Add an additive table of sanitized payment events (order, source: redirect, webhook or reconcile, PayU status, outcome, reason, time; no raw payloads, no card data, no secrets). Show it as a "Payment timeline" on the admin order detail so a sync problem can be diagnosed. Staff with store_admin or above get a "Verify with PayU" action (rate limited, audited) using the same transition; customers get "Check payment status" on a pending order.
8. **Simulator.** Write `scripts/simulate-payu-callback.mjs` that builds correctly hashed success, failure, cancel and pending POSTs (using the salt from the environment without printing it) and sends them to a running local or deployed server, including duplicates, out-of-order delivery, wrong amount and wrong transaction id. Also provide a stub for the verification API in tests.

**Tests:** hash valid and invalid; amount mismatch, wrong transaction id and duplicate gateway id never mark paid; success marks paid exactly once; failure, cancel and pending states; duplicate and out-of-order callbacks; webhook-only; redirect-only; redirect always 303 and never to the wrong host; return without a session shows the safe page; missing site address fails closed; reconcile settles a never-returned payment; rate limits; no raw payload stored.

**Done when:** a PayU test-mode payment returns the customer to the correct confirmation page every time, the order shows Paid in the admin and customer pages, a payment where the customer closes the tab still settles, and nothing is ever double-counted. Give me a manual test checklist for the real PayU test run.

---

## Phase 2: Receipts, refunds and invoices

**Rules in one place:** payment status, order status, shipment status and refund status are independent. A receipt, bill or invoice is built from those four values, never from one "status".

**Step 0:** list every receipt, bill and invoice surface today (customer receipt page and any receipt pop-up, admin invoice, packing slip, POS receipt, notification attachments) and how each decides what to show; show the case of a cancelled order wrongly shown as paid. List how refunds are stored today (manual records, return refunds, refund obligations) and what refund states exist.

**A. Orders without a successful payment**
- No paid invoice or paid receipt is ever shown or generated for an order whose payment is pending, verifying, failed or cancelled. The receipt pop-up and page show the correct status instead: **Payment Pending**, **Payment Failed**, **Cancelled**, **Refund Initiated**, **Refund Successful** (and Paid only when payment is verified as successful).
- A cancelled order shows **Cancelled**, never Paid. A paid order that was later cancelled shows its refund state.

**B. Bill (invoice) request**
- On the customer order detail page a **Request bill** action is offered once payment is successful, whether or not the order has shipped.
- It asks for a reason (a dropdown of reasons managed in Store Admin Settings -> Reasons, plus "Other" with a short text box). The request is saved (order, customer, reason, time), rate limited, and visible to staff on the order.
- After the reason is submitted, show the bill according to the four statuses. Before shipment this is a bill/receipt for a paid order (ask me whether to label it "Bill / Payment receipt, invoice follows on shipment" or to issue the tax invoice earlier; recommended: provisional bill now, tax invoice on shipment). Only successful payments can view a paid bill.
- If a refund has been initiated, the bill shows **Refund Initiated**. When the refund is completed it shows **Refund Successful**. A refunded or partly refunded order is never presented as a normal successful sale; show refunded amounts and a clear stamp.

**C. Automatic invoice after shipment**
- When an order is marked **Shipped**, generate the invoice automatically in the same step. No reason is asked after that. The customer opens it directly from the order details page (and it is available to staff).
- Invoice numbering: sequential and unique using the invoice prefix setting and a transactional counter (like the order-number counter); the number is assigned once and never changes; marking Shipped twice, retries and concurrent updates never create a second number. Store the invoice number and issue time on the order.
- If the order is cancelled after an invoice exists, the invoice shows its status (Cancelled / Refund states) and is never deleted. Credit notes are out of scope; tell me if tax rules would require one.
- Use the existing invoice renderer for the content (store header, items, shipping, discount and coupon, totals). Add tax lines only if tax is already configured; do not invent GST logic.

**Refund status model:** inspect the existing refund records and add what is missing, additively: a refund has states Initiated and Completed (and Failed or Rejected if needed). Staff mark a refund Completed with a reference (refunds stay manual because there is no PayU refund API). Customers see the refund state on the order and the bill; notifications use the existing refund events.

**Tests:** every combination of the four statuses renders the right document or status (a table-driven test over all combinations); no paid bill for pending, failed or cancelled; bill request needs a successful payment and a reason, saves it, is rate limited and owner-only; refund initiated and completed stamps; invoice generated exactly once on Shipped, numbers unique under concurrent updates; cancelled order never shows Paid; pop-up and page agree; staff and customer views consistent.

**Done when:** a customer can never get a paid-looking document for an unpaid, failed or cancelled order, can request a bill with a reason after paying, gets the invoice automatically after shipment, and sees Refund Initiated and Refund Successful correctly.

---

## Phase 3: Product attributes and mobile compatibility

**Problem:** adding a product shows unrelated attributes and every mobile model, so wrong information can reach the storefront.

**Step 0:** report how attributes and compatibility are stored and loaded today, where the product form gets its attribute list and model list, how the storefront reads compatibility (static data files versus the database), and which existing products have attribute values that do not belong to their type and which have all models selected. Counts and examples only.

**Build:**
1. **Product types.** An admin-managed list of product types (for example mobile case, adapter/charger, cable, earphones, AirPods case), each linked to a category.
2. **Attribute sets.** Attributes are linked to product types (with order, required or optional, and where each shows on the storefront). The product create and edit form loads ONLY the attributes for the selected category and type, and reloads when they change. Changing the type with values already entered warns and hides the unrelated attributes; stored values are kept (archived), never deleted.
3. **Device models.** An admin-managed list of devices (brand such as Apple, Samsung, OPPO; model name; sort order; active). A product that needs compatibility has a manual, searchable multi-select grouped by brand. Nothing is selected by default and there is no automatic "all models". A "select all for this brand" shortcut is allowed but never pre-applied. For product types flagged as needing compatibility, publishing requires at least one model.
4. **Storage.** A proper join between products and device models (additive migration, row level security, relationships enforced), saved and read back correctly on create, edit, duplicate, CSV import and export.
5. **Storefront.** Product pages, category filters and search show ONLY the models selected for that product, and only the attributes relevant to its type. A product with no compatibility data shows no compatibility block instead of showing all models.
6. **Safe data migration (dry run first):** for existing products where the current static data lists specific models, import exactly those; never assign all models; where there is no data, leave compatibility empty and list the product under a "Needs compatibility review" filter in Store Admin; report unrelated attribute values per product and hide them without deleting. Show me the dry-run report before applying anything.

**Tests:** form loads the right attributes per category and type; unrelated attributes never appear; compatibility is manual, nothing preselected; save and reload round-trips; storefront shows only selected models and relevant attributes; missing compatibility hides the block; CSV round-trip; migration idempotent and never assigns all models; publish rule for compatibility-required types; roles and audit.

**Done when:** adding a mobile case shows only case attributes and lets me pick only the models it fits, and the storefront shows only those models.

---

## Phase 4: Variant-level stock

**Goal:** stock kept separately for every model, specification and variant, for example:
- Mobile cases: iPhone 16 (10), iPhone 16 Pro (5), iPhone 16 Pro Max (8), Samsung S25 Ultra (4).
- Adapters: 25W (15), 35W (10).

**Step 0:** report how stock works today (product-level stock, variants with SKU and stock, stock movements, reserved counters, the availability endpoint, the cart and order line identity), and which products are tracked (most are not). Explain how Phase 3 compatibility relates to variants: recommended design is that a model-specific product has one variant per compatible model (each with its own SKU and stock), and a specification product (wattage, colour) has one variant per specification.

**Build:**
1. **Stock per variant.** Stock rows, movements, reserved counters, tracking switch and low-stock threshold are keyed by variant (products without variants keep product-level stock). Product availability is the sum over its variants.
2. **Admin.** Product edit shows a Variants table with SKU, model or specification, price (and sale price where variants have their own price), tracked, on hand, reserved, available and an Adjust action. A bulk "set stock for all variants" grid. The Stock list and Low-stock list show one row per variant. CSV import and export carry variant stock. Every change is an append-only movement with a reason.
3. **Storefront and cart.** The variant selector shows each option's availability. In normal mode an out-of-stock variant option is disabled with "Stock not available". In sale mode nothing is disabled or marked unavailable; the stock check happens only when the customer clicks Buy Now, Checkout or Pay and says "Out of stock" for that variant. Cart lines, order lines and the availability endpoint carry the variant id. Quantity limits use that variant's available stock.
4. **Checkout and orders.** Claim stock, hold it for the reservation window, release or consume it only for the EXACT variant purchased, under row locks per variant. Failure, cancellation, expiry, auto-cancel, late payment, returns and refunds restock only the right variant, ledger-capped and idempotent. Different variants never block each other; two buyers of the last unit of one variant still produce one order. POS picks a variant and uses that variant's stock. Coupons, sale prices and shipping keep working per line.
5. **Reports.** Stock, low-stock and item-wise reports show the variant. Order documents show the variant (model or specification).
6. **Safe migration.** Products that are not tracked stay exactly as they are (this is most of the catalogue). For tracked products that have several variants, do not invent a split: report them, show an "Allocate stock" warning in Store Admin, and ask me before allocating. Existing orders keep their lines. Dry-run first.

**Tests:** per-variant claim, release and restock for every path (payment success, failure, cancel, expiry, auto-cancel, late payment, return, refund); concurrency on the same variant and on different variants; availability and the selector in normal and sale mode; cart and order carry the variant id; POS; reports; CSV round-trip; migration idempotent; no cross-variant leakage; stock never negative.

**Done when:** each model and specification has its own stock, only the exact variant bought is reduced, out-of-stock variants cannot be bought, and concurrent buyers never oversell a variant.

---

## Phase 5: Coupon visibility controls

**Problem:** every coupon created in Store Admin appears in every customer's dashboard.

**Build:**
1. Add a **Show to all users** option on each coupon (default off) in the coupon form, list (column and filter) and bulk actions, with help text. Existing coupons migrate to off (hidden) so nothing is exposed by accident; report the count.
2. The customer Coupons page (and the dashboard count) lists ONLY: coupons with Show to all users on that are active and currently usable, plus coupons specifically assigned to that customer (by email or customer group). Everything else stays hidden.
3. Visibility is separate from eligibility: a hidden coupon can still be redeemed by anyone who has the code unless it is restricted to specific customers. Say this clearly in the admin help text. Never show total limits, other customers' use, or internal names on the customer page; show the customer's own remaining uses and the expiry.
4. Admin can assign a coupon to specific customers (by email or group) from the coupon page, audited, so it appears only to them.

**Tests:** default hidden; shown only when enabled or assigned; assignment visibility; expired, paused or used-up coupons never listed; no leakage of limits or other customers; customer isolation; migration sets existing coupons hidden.

**Done when:** only coupons marked Show to all users, or assigned to that customer, appear in the dashboard.

---

## Phase 6: End-to-end proof and release readiness

1. **End-to-end flows** against a running server and the database in a safe schema or test mode: browse by compatibility, select a variant, add to cart, apply a coupon, checkout, simulate PayU success, failure, cancel and pending (using the simulator), webhook only, duplicate callbacks; check order, payment, shipment and refund statuses on admin, customer and receipt pages; invoice after Shipped; cancellation with refund initiated and completed; stock per variant before and after each path; concurrent last-unit purchases of a variant. If Playwright is available (or I approve adding it as a dev dependency), add browser flows for checkout and the order pages.
2. **Regression:** the whole earlier suite, sale mode, POS, shipping charges, coupons, notifications, reports and staff accounts still pass.
3. **Real PayU test run:** give me a step-by-step checklist (exact addresses and PayU dashboard settings, test cards, what I should see on each page) for the manual round trip on the public address, including closing the PayU tab and checking the status still updates.
4. **Release checklist** in `FEATURES.md`: migrations to apply in order, environment variables (names only), the PayU dashboard URLs, the reconcile schedule, backup and rollback notes, and a list of what is still not built.
5. Final evidence: `npm test` (passed, failed, skipped), typecheck, build, check scripts, `npm audit`, `git log --oneline`, `git status` (clean).

---

## Decisions the agent will probably ask, with my suggestions

| Question | Suggestion |
|---|---|
| How are you testing PayU (deployed or tunnel) and what is the address? | Use a tunnel or a deployed test copy over HTTPS; give the agent that address |
| Signed link for return pages without a session? | Yes, short-lived and HMAC signed, fail closed if the secret is missing |
| Document before shipment? | Provisional bill now, tax invoice automatically on shipment |
| Refund states? | Initiated and Completed, set by staff with a reference |
| Variant per model for mobile cases? | Yes, one variant per compatible model, each with its own SKU and stock |
| Tracked products with several variants? | Report them and let me allocate stock myself |
| Existing coupons? | All hidden until I switch on Show to all users |
| Add Playwright for browser tests? | Yes, as a dev dependency, if it installs cleanly |

## What only you can do

1. Get a public HTTPS address for the site (deploy, or run a tunnel) and tell the agent.
2. In the PayU dashboard, set the success, failure and cancel URLs and the webhook URL the agent gives you, using the test keys first.
3. Put `PAYU_KEY`, `PAYU_SALT` and the site address in the environment, and schedule the reconcile call every minute with the cron secret.
4. Apply the new migrations to the real database after taking a backup.
5. Turn on **Track inventory** per variant and enter real counts once Phase 4 is done.

## Starter messages

Paste one of these to your agent, one phase at a time:

```text
Read PHASES_PAYU_INVOICE_VARIANTS.md in the repo root. Follow its Common rules. Do Phase 1
only: write your Step 0 findings first, ask me any decisions you need, then build, test and
report. Stop when Phase 1 is done and wait for me to say "continue".
```

For each later phase, replace "Phase 1" with the next phase number.

## Manual checks after each phase

- **Phase 1:** pay in PayU test mode and land on the confirmation page; repeat but close the PayU tab and check the order still turns Paid; try a failed card and a cancel.
- **Phase 2:** open an order that is pending, one that failed, and one that was cancelled; none should show a paid bill. Request a bill on a paid order with a reason. Mark an order Shipped and check the invoice appears with no reason. Record a refund as initiated, then completed, and check the stamp.
- **Phase 3:** add a mobile case and check only case attributes appear and no models are preselected; save and check the storefront lists only the models you ticked.
- **Phase 4:** give one case three models with different stock, buy one model's last unit in two browsers at once, and check only that variant's stock drops.
- **Phase 5:** create two coupons, mark one Show to all users, and check only that one appears in a customer's Coupons page.
