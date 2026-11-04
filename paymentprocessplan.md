ROLE
Senior full-stack and backend engineer in the Gadzio repo. Read FEATURES.md and the current
code first. This task has six parts. This message is self-contained; do not rely on earlier
instructions. Never print secret values. Report findings before changing code in each part,
commit each part in small steps with tests, and if an API or quota error interrupts you,
stop and tell me the exact step you reached.

HOW TO WORK WITH ME
- You may ask me questions when a decision is mine. Use the AskUserQuestion tool: up to 4
  questions per call, 2 to 4 clear options, your recommendation first and marked
  "(Recommended)". Do not ask what you can find in the code. Batch related questions.
- If I am not available, do not guess on anything that moves money or deletes data: take the
  conservative option, write it under "Decisions taken without an answer" in
  CHECKOUT_PLAN.md, and continue with parts that do not depend on it.
- Start by writing CHECKOUT_PLAN.md (findings for all six parts and the questions), show me
  a short summary, get my answers, then build.

HARD CONSTRAINTS
1. The server is authoritative for every amount. Shipping, discount, total, advance and
   balance are computed on the server inside /api/payu/initiate under the same transaction
   and stock locks as the order. A client-sent amount is never charged. The client may send
   its displayed total only as an expectation (the existing price-change guard) and a
   mismatch returns the existing 409 "prices have changed" path with the new totals.
2. An order is PAID only after hash verification plus the server-side PayU verification (or
   the worker's equivalent). Never from a browser redirect alone.
3. All money is integer paise; rupee input uses the shared parseRupeesToPaise and formatter.
4. All times use the DATABASE clock. Nothing already PAID may change state because of these
   changes. Old orders stay valid and readable. Migrations are additive (next free number:
   check migrations/), new tables get RLS enabled in the same file, no data is deleted.
5. Do not touch the Education Store, POS pricing rules (POS has no shipping or coupons), or
   the customer/store-admin identity separation.
6. Every store-admin API keeps requireStoreRole(...); mutating routes keep
   assertSameOrigin(request); every change is audited without secrets or personal data.
   Account routes keep requireAccountSessionApi / requireAccountPageSession and
   check-account-routes must cover any new route.
7. New admin form fields get help text (the field-help registry, if it exists) so
   check-field-help passes.
8. npm test (report passed, failed, skipped; DB-backed tests must really run), typecheck,
   build, all check scripts and npm audit must pass. Show git log --oneline and git status
   (clean) at the end.

======================================================================
PART 1: CONFIGURABLE SHIPPING CHARGE AND FREE-SHIPPING THRESHOLD
======================================================================
Requirement: shipping is not always zero. Staff set, without code changes:
  - Standard shipping charge (for example Rs 50).
  - Minimum order amount for free shipping (for example Rs 999).
Rule: if the order amount is BELOW the threshold, charge the standard charge; if it MEETS OR
EXCEEDS the threshold, shipping is free. Example that must pass as tests:
  Rs 499 -> Rs 50, Rs 899 -> Rs 50, Rs 999 -> Rs 0, Rs 1,499 -> Rs 0.
Step 0: inspect how shipping is computed today (shipping_enabled, free_shipping_over,
shipping_methods, the "first active method" logic), where those settings are edited
(Settings -> Orders and Settings -> Shipping), what the cart, checkout, success page,
receipt, invoice, packing slip and notifications show, and how the free-shipping coupon type
and the price-change guard use shipping.
Questions to ask me (unless already clear):
  a. SINGLE SOURCE: make two simple fields in Settings -> Shipping the only shipping rule
     (recommended), and fold the old free_shipping_over value and the per-method rates into
     them, label the shipping-methods table as not used, or keep methods as the engine.
  b. WHAT THE THRESHOLD COMPARES: item subtotal after sale prices and BEFORE coupon discount
     (recommended, so a coupon never causes a shipping charge), or after coupon discount.
  c. EMPTY THRESHOLD: does an empty threshold mean "always charge" or "always free"
     (recommend: empty = no free-shipping threshold, always charge; 0 charge = free).
Build:
  - Settings -> Shipping (Store Admin): "Shipping charge" and "Free shipping on orders of
    Rs ... or more" fields (rupees, shared parser, plain validation, help text), plus the
    existing shipping on/off switch. Shown with a live example line ("Orders under Rs 999
    pay Rs 50; Rs 999 and above ship free"). Changes are audited and take effect on the next
    request (revalidate).
  - One pure, tested function computes shipping from (amount for threshold, settings,
    free-shipping coupon). Use it everywhere: cart, checkout, /api/payu/initiate (authoritative),
    order record (shipping_paise), success page, receipt, invoice, packing slip, order detail,
    notifications, reports.
  - Cart and checkout show Subtotal, Discount (if any), Shipping, Total, and update at once
    when quantities, the coupon, or the sale state change. When a threshold is set and the
    customer is below it, show a short nudge: "Add Rs X more for free shipping". Use existing
    styles; add the smallest markup needed.
  - The PayU amount = items - discount + shipping and equals the displayed Total. The
    price-change guard includes shipping. A FREE_SHIPPING coupon sets shipping to 0.
  - Edge cases: shipping disabled -> 0; threshold exactly met -> free; sale ending between
    display and pay -> 409 with new totals; pickup stays disabled and ignored.
Tests: the four example amounts; boundary at threshold minus 1 paise, equal, plus 1 paise;
coupon interplay per my answer b; free-shipping coupon; shipping disabled; client-sent
shipping ignored; PayU amount equals displayed total; settings validation; old orders
unchanged; every surface shows the stored shipping.

======================================================================
PART 2: PAYMENT STATUS AND ORDER STATUS, SEPARATE AND CONSISTENT
======================================================================
Requirement: payment statuses Pending, Cancelled, Failed and Success must be handled and
displayed correctly everywhere; an order is never marked paid while payment is pending or
cancelled; payment status and order status are managed separately (an order can be awaiting
payment while its payment status is pending).
Step 0: map exactly how status is stored today (orders.status values such as CREATED,
PENDING, PROCESSING, PAID, FAILED, CANCELLED; fulfilment_status; order_payments rows;
the order_sale_state view; reservation_state; payment_review_required) and every place a
status is shown: admin orders list and filters, order detail, Payments page and review
tables, Overview tiles, reports, customer orders list and detail, /order/success, failed,
cancelled, processing and status pages, receipts, notifications. List every inconsistency
(different words, colours or filters for the same state).
Build, without a destructive schema change:
  - ONE status module (for example src/lib/order-status/) that derives, from stored fields,
    two independent values for every order: PAYMENT STATUS and ORDER (fulfilment) STATUS.
    Payment status vocabulary: Pending (awaiting or not yet confirmed), Verifying
    (PROCESSING, gateway answer unclear), Paid (success), Failed, Cancelled, Refunded,
    Partially refunded (and, if COD is built, Advance paid / Balance due). Order status
    vocabulary: Awaiting payment, Confirmed, Packed, Shipped, Delivered, Cancelled,
    Returned. Separate customer-facing wording and admin wording where they must differ, but
    ONE glossary, in one file, used by every surface. Add a DB view if helpful (additive).
  - Show BOTH as separate chips on admin order list and detail, Payments page, customer order
    list and detail, and the result pages. Filters and Overview tiles use the same derivation.
  - Rules, proven by tests: pending or cancelled payment never produces Paid; PROCESSING is
    never revenue; only a verified capture creates Paid; failed and cancelled payments leave
    the order Awaiting payment or Cancelled per existing reservation rules, never Confirmed.
  - PENDING / VERIFYING: show the correct status and give the customer a "Check payment
    status" button on the order page (rate limited, signed-in owner only) and staff a
    "Verify with PayU" action on the order and Payments pages (store_admin and above,
    audited, rate limited). Both call the same server-side verification and the same
    idempotent transition, and report plainly: still pending, paid, failed, cancelled.
  - CANCELLED payment: clear wording ("Payment was cancelled") on every surface.
  - FAILED payment: a "Retry payment" action. Because each PayU attempt needs a fresh txnid,
    ask me which design I want: (recommended) Retry reopens checkout pre-filled with the same
    items, address and still-valid coupon and creates a NEW attempt, marking the failed one
    superseded so it is never counted twice; or retry on the same order record. Whatever you
    build must never create two PAID orders for one cart, and a late capture on a superseded
    attempt must follow the existing late-payment path (re-claim stock or flag, one refund
    obligation).
  - Delayed callbacks and webhooks: duplicate or out-of-order callbacks never double-mark,
    double-claim stock, double-release, double-notify or create duplicate payments (tests for
    success-after-failure, failure-after-success, webhook before redirect, redirect before
    webhook, repeated webhook).
  - Admin Orders, Payments page and the customer order page must show the same payment
    status for the same order: write a test that renders or derives all surfaces for a
    seeded order in each state and asserts identical labels.

======================================================================
PART 3: "CHECKOUT ALREADY IN PROGRESS" MUST NOT BLOCK ABANDONED CHECKOUTS
======================================================================
Symptom: a customer closes the checkout or payment page without paying, tries again, and
gets an error that a checkout is already in progress.
Step 0: reproduce it and find the exact cause (an active reservation counted against the
same customer's own stock, a cart_id or duplicate-submit lock, a unique constraint, or a
check on an open PENDING order). Show the code path, the message text and the data state.
Fix (safe, no duplicates):
  - Failed, cancelled, expired or released attempts NEVER block a new checkout.
  - A customer's own active hold must never make an item look sold out to that same
    customer (their held units are excluded from "held by others" in availability and in the
    initiate stock check).
  - If an unpaid attempt for the same customer/cart is still active: (a) if the cart,
    address and coupon are identical, resume it (return the same attempt's PayU redirect, so
    double clicks and two tabs do not create two orders); (b) if anything changed, verify the
    old attempt with PayU first: if it is actually PAID, send the customer to its success
    page (no duplicate); otherwise supersede it (release its reservation and stock in the
    same transaction, mark it SUPERSEDED with a reason) and create the new attempt. A late
    capture on the superseded attempt goes through the existing late-payment handling.
  - If PayU cannot be reached for verification, fail closed with a clear, short message and a
    retry button ("We could not confirm your previous payment yet. Please try again in a
    minute."), never the vague "already in progress" message, and never a permanent block.
  - Tests: close-and-retry works; double submit and two tabs make one order; changed cart
    supersedes; old attempt actually paid redirects to success; own hold does not look sold
    out; two different customers racing for the last unit still produce one order; stock and
    coupon redemptions are released exactly once; superseded-then-late-paid is flagged
    correctly.

======================================================================
PART 4: CANCELLED ORDERS MUST NOT SHOW ACTIVE SHIPPING DETAILS
======================================================================
Symptom: after an order is cancelled, its courier and tracking details still show.
Step 0: find where delivery details are stored and every place they are read: admin order
detail, delivery screen, customer order detail and tracking link, receipts, packing slip,
exports, notifications, timeline.
Fix:
  - Add an additive marker on the delivery record (for example is_active, voided_at,
    void_reason, via migration). When an order is cancelled (any path: admin cancel,
    customer-approved cancel, auto-cancel, payment failure after shipment data was added),
    mark the shipment inactive in the SAME transaction as the cancellation and write an audit
    row that keeps the original courier, tracking number and slot (masked where needed).
  - Customers and staff see NO active shipment on a cancelled order: no tracking number, no
    tracking link, no "shipped" chip, no delivery slot. The admin order detail shows a plain
    "Shipment cancelled" line and a timeline event; the original details live only in the
    audit log.
  - Server rules: delivery details cannot be added or edited on a cancelled order; the
    "shipped" notification is never sent for a cancelled order; the packing slip for a
    cancelled order is clearly marked CANCELLED and shows no shipment; exports leave the
    tracking columns empty for cancelled orders.
  - Data fix: a dry-run-first, idempotent, audited script marks inactive the shipments of
    orders that are ALREADY cancelled; report counts, never delete rows.
  - Tests: cancel via each path voids the shipment; readers filter inactive shipments on
    every surface; edits blocked; audit keeps the history; the backfill is idempotent;
    non-cancelled orders are unaffected.

======================================================================
PART 5: COD WITH A PARTIAL ADVANCE (stays OFF)
======================================================================
Requirement: COD is intentionally disabled now and will be enabled in a future update. When
enabled, customers choose COD at checkout, pay a partial advance online to confirm the order,
and pay the balance on delivery.
Step 0: report what exists today for cod_enabled and the payment settings, and confirm that
nothing about COD is visible to customers while it is off.
Ask me: (a) BUILD NOW behind the switch, default OFF and locked, as the last part with its
own commits (recommended, so it is ready when I flip it), or only write COD_DESIGN.md and
leave it unbuilt; (b) advance type and value (percentage or fixed, minimum amount), and
whether the advance is refundable if the order is cancelled before dispatch; (c) when COD
orders count as revenue (recommended: the advance counts as payments received when paid; the
order counts in the sales reports when the balance is collected or the order is delivered and
settled); (d) any COD limits (maximum order amount).
If building:
  - Settings -> Payments: COD switch (default off), advance type, advance value, minimum
    advance, maximum COD order amount, advance refundable switch. Help text on each. While the
    switch is off, nothing about COD appears anywhere in the storefront, emails or reports.
  - Checkout: when enabled, a small payment-method choice (Pay online in full, or Cash on
    delivery with "Pay Rs X now, Rs Y on delivery"). Server computes total (items - discount +
    shipping), advance, and balance_due; PayU charges ONLY the advance; the order becomes
    Confirmed only after the verified advance; stock is claimed as for any order and released
    the same way on failure or expiry.
  - Data: additive columns or table for payment method, advance_paise and balance_due_paise;
    payment status for these orders is Advance paid, then Paid in full once the balance is
    collected. Refunds, returns and cancellation follow my answers.
  - Admin: order detail shows total, advance paid and balance due; a "Collect balance"
    action (store_admin and above, audited, amount and method cash or UPI) records the
    balance payment; delivery cannot be finalised silently with a balance due without a
    warning. The packing slip, invoice and delivery screen show "Collect Rs Y on delivery".
  - Customer: order pages and notifications show advance paid and balance due. Whitelisted
    notification variables only (add balance_due and payment_method).
  - Reports and revenue follow answer (c) and are documented on each report page.
  - Tests: off by default and invisible; checkout split math in paise; PayU amount equals the
    advance; verified advance confirms; failed advance releases stock; balance collection;
    cancel and refund rules; duplicate callbacks; reports follow the documented rule.

======================================================================
PART 6: /account DESIGN MUST MATCH THE HOME PAGE
======================================================================
Requirement: the customer account area should look great and match the home page UI.
Step 0: list every /account page and the sign-in page (/auth), how each looks today, and the
design values the HOME PAGE actually uses (fonts, type scale, colours, spacing, buttons,
cards, borders, radius, shadows, header, footer, hover and focus styles). Put them in
CHECKOUT_PLAN.md as a short style sheet. If a newer account dashboard (card layout with live
data) already exists, restyle it; if only the old pages exist, restyle those.
Do not copy any other brand's look. Use Gadzio's own tokens and components.
Build:
  - Restyle the whole account area (dashboard, orders, order detail, receipt screen, profile,
    addresses, requests, and any coupons, messages or data pages that exist) and the /auth
    sign-in and sign-up page to use the same header, footer, fonts, colour tokens, spacing
    scale, buttons, cards and form fields as the home page. Reuse existing shared components
    and tokens; add new shared ones only where none exist.
  - Layout: consistent page title and breadcrumb, a card grid on the dashboard (three columns
    desktop, two tablet, one mobile), tidy tables that become stacked cards on mobile, status
    chips with the one shared payment and order status styling from Part 2, friendly empty
    states, loading skeletons, success and error toasts, and clear primary and secondary
    buttons.
  - Quality: responsive at 1440, 768 and 390 px widths with no horizontal scroll or layout
    shift; accessible (contrast at least WCAG AA, visible focus, keyboard navigation, labels
    on every field, semantic headings); printing the receipt still works.
  - Behaviour is unchanged: no change to data, routes or security. Keep the live-data and
    auto-refresh behaviour if it exists.
  - Provide before and after screenshots (or a precise render description) at the three
    widths for the dashboard, an order detail with each payment status chip, the profile, and
    the sign-in page, and a side-by-side comparison with the home page, then list any
    remaining differences and why.
  - Tests: structural tests that the account pages use the shared layout and tokens, no
    hard-coded colours outside the tokens, every form field has a label and help or error
    text, and the route checker still passes.

======================================================================
DELIVERABLES
======================================================================
1. CHECKOUT_PLAN.md with findings, my answers and decisions for all six parts.
2. Code in small reviewable commits, one set per part, in this order: shipping, status
   model, checkout resume and supersede, cancelled shipments, account design, then COD last.
3. Updated FEATURES.md (shipping rule, status glossary, checkout resume behaviour, cancelled
   shipments, COD settings, account design notes, evidence block with real final counts) and
   updated report definitions where revenue or status wording changed.
4. A list of every storefront file changed and every new route or API, for my visual review.
5. npm test (passed, failed, skipped), typecheck, build, all check scripts, npm audit,
   git log --oneline, git status (clean).

DEFINITION OF DONE
  - Staff set the shipping charge and free-shipping threshold in Store Admin; Rs 499 and Rs 899
    pay Rs 50, Rs 999 and Rs 1,499 ship free; cart, checkout, PayU amount, order and documents
    all agree.
  - Payment status and order status are separate, use one glossary and look the same in the
    admin, the Payments page and the customer pages; nothing is Paid until the gateway
    confirms; pending can be verified, failed can be retried, cancelled is clearly shown.
  - Closing a checkout and starting again always works, without duplicate orders or payments.
  - A cancelled order never shows an active shipment to anyone; history stays in the audit log.
  - COD is invisible while off and, if built, works with an online advance and a balance on
    delivery.
  - The account area looks like the home page, works on mobile, and is accessible.