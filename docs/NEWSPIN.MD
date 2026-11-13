# Gadzio: Free gift on orders and the daily Spin and Win wheel

**What you asked for**
1. **Free gift:** when a customer's cart reaches a target amount, a free gift is added to the cart automatically, shown with a small icon of the gift and the word FREE. The gift, the target amount and everything about it can be changed by staff at any time.
2. **Spin wheel:** a wheel with prizes that are coupons. If a customer wins, the coupon goes straight into their Coupons section. One spin per customer per day. The prizes on the wheel are editable by staff.

**How to use this file**
1. Save it in the repo root as `SPIN_WHEEL_AND_FREE_GIFT_PLAN.md` and commit it, so the agent can always re-read it.
2. Paste the starter message (at the bottom) once per phase. Each phase ends with a report and the agent waits for you to say "continue".
3. The agent may ask you decisions with pop-up questions. My suggestions are in the table near the end.

**Build order I recommend**
- The **Spin wheel** only creates coupons, so it does not touch the payment path. It can be built first.
- The **Free gift** changes checkout (an extra order line and extra stock to claim), so build it **after** the PayU staging proof and the load test from `MASTER_REMAINING_WORK.md` are done. If those are not finished, do Phases 0, 3 and 4 first and hold Phases 1 and 2.

---

## The ideas in one picture

```text
FREE GIFT (staff set up rules)
  Rule: spend Rs 999 or more -> free "Phone stand" (a real product with its own stock)
  Cart at Rs 750:   "Add Rs 249 more to unlock a FREE [icon] Phone stand"
  Cart at Rs 1,050: [icon] Phone stand   FREE   (added automatically)
  Checkout: the server checks again, claims the gift's stock together with the order

SPIN AND WIN (staff set up the wheel)
  Wheel segments: 10% off | Rs 50 off | Free shipping | Better luck tomorrow | ...
  Customer signs in, spins once per day (store time), the SERVER decides the result
  Win -> a personal single-use coupon is created and appears in Your Coupons
```

---

## Common rules (apply to every phase)

1. This file is self-contained. Never print secret values; report names and counts only. Work in the main session and commit in logical commits to a NEW branch (never main).
2. Report findings before changing code. Each phase: inspect, build, test, then a short report with real results; stop and wait for me to say "continue".
3. You may ask me decisions with AskUserQuestion: up to 4 questions per call, 2 to 4 options, your recommendation first and marked "(Recommended)". Do not ask what you can find in the code. If I do not answer, take the conservative option for anything that moves money or deletes data and record it in `PROMO_NOTES.md`.
4. Only the test database may be written to, and only with the approvals already given for it; never a production database, real payment or real message. Tell me the database host name (never full URLs or credentials) and row counts before applying migrations, and ask me first.
5. **The server decides everything.** Gift eligibility, the gift line, the spin result, the daily limit, prize caps and coupon creation are all decided and recorded on the server on the database clock. The browser only displays. The price shown equals the price charged; money is integer paise.
6. Migrations are additive and numbered after the last file; row level security on every new table; never edit an applied migration; never delete or rewrite orders, stock movements, coupons already redeemed, audit rows or price history.
7. Reuse what exists: the coupon engine (limits under row locks, reserved and consumed redemptions, assigned coupons, the customer Coupons page), the stock claim and release ledger per option, the shared price resolver, the status module, the notification matrix and outbox, the store timezone setting, the shared helpers for hex colours and rupee input. Do not build a second coupon engine or a second stock engine.
8. Customer UI matches the home page style, responsive at 1440, 768 and 390 px, accessible (contrast, keyboard use, visible focus, labels, `prefers-reduced-motion`, announcements for screen readers). Admin UI uses plain words and help text on every field (the field-help checker must pass). Every store-admin API keeps its role check and same-origin check and writes an audit row without secrets or personal data.
9. Keep working: sale mode, coupons, shipping charge, reservations, maintenance mode, notifications, POS, abandoned-checkout handling. Do not touch the Education Store.
10. The database pool is small (about 15 slots on the pooler): keep every new transaction short, set lock and statement timeouts like the other transactions, never call an external service inside a transaction, and cache read-only configuration for a few seconds.
11. DB-backed tests may only write to a throwaway schema or the approved test database and must clean up. Do not weaken, delete or skip a test; report skipped counts with reasons.
12. Every phase ends with the full `npm test`, typecheck, build, all check scripts (routes, account routes, admin boundary, field help, links), `npm audit`, `git status` clean. Update `FEATURES.md` with real results. If an API or quota error interrupts you, stop and tell me the exact step you reached.

---

## Phase 0: Audit and decisions (read-only)

Report with file names, then ask me ONLY the decisions still open:
1. **Coupons:** how assigned (personal) coupons work today (restricted emails or user id, per-customer limit, total limit, expiry, visibility switch, how the customer Coupons page chooses what to list), whether a coupon can be created in code from a template safely, how codes are generated, the redemption lifecycle, and the notification event list (is there a place for a "spin win" message).
2. **Cart and checkout:** how the cart is stored, how server cart references supply prices and availability to the browser, how `createOrderUsing` resolves items, claims stock (lock order: orders, stock sorted by product and option, coupons, order counter), where a gift line would be added, how order lines, packing slip, invoice, receipt, reports and returns read lines, and how the free-shipping threshold computes its amount (the gift threshold will use the same basis).
3. **Catalogue:** how a product can be hidden from the storefront, search, filters and sitemaps yet still exist for orders (needed for gift-only items), and whether a product can be flagged "gift only".
4. **Storefront:** where a Spin entry point could sit on the home page and in the account dashboard without disturbing the layout, and whether the store timezone setting is consumed anywhere.
5. **Bot protection and sign-up:** whether any bot check exists, whether email verification exists, and how sign-up treats an already registered email.
Write `PROMO_NOTES.md`, then ask:
- **Gift threshold basis:** item subtotal after sale prices and before coupons (recommended, the same as free shipping), or after coupons.
- **More than one gift rule:** if several rules qualify, give only the highest one (recommended) or all of them.
- **Gift no longer available at checkout** (sold out or rule ended after the customer saw it): show a message and let the customer continue without it (recommended) or block checkout.
- **Day for the daily spin:** the calendar day in the store timezone, resetting at midnight India time (recommended), or 24 hours after the last spin.
- **Who can spin:** signed-in customers only (recommended, since the prize goes to their account).
- **Abuse limits:** maximum spins per IP per day (recommended 5, since families share Wi-Fi) and a minimum account age (recommended 0 minutes plus a bot check once one exists).

---

## Phase 1: Free gift - rules, engine and admin

### 1A. Gift items
- A gift is a real catalogue item (a product or one option of a product) so it has a SKU and its own stock. It can be marked **Gift only**: it is hidden from the storefront, search, filters and sitemaps, cannot be bought on its own (a direct link says it is not available), and never appears in recommendations. Existing products can also be used as gifts. Gift stock is tracked: the admin warns if the gift item has no stock limit or is out of stock.

### 1B. Rules (Store Admin -> Marketing -> Free gifts)
Each rule has: name, the gift item, **target amount** (rupees, the shared parser), icon (use the gift's photo, or upload a small image from the Media screen; shown small and round), badge text (default "FREE"), message shown when unlocked (default "You unlocked a free gift!"), start and end (database clock, store timezone), active switch, optional quantity cap (maximum gifts to give), optional limit per customer, and priority. Plain-word help text on every field, a live preview of how the gift line and the progress nudge look, and warnings (no stock, cap reached, overlapping rules, threshold below the cheapest product). Staff can edit the gift item, amount or text at any time; the change applies to new carts and new orders only; existing orders keep a snapshot. Every change is audited.

### 1C. Server engine (one pure, tested module)
- Eligible amount = item subtotal after live sale prices and before coupons (or per my answer), excluding gift lines. A rule is met when the amount is greater than or equal to the target (exactly equal qualifies). With several qualifying rules use my answer (default: highest only). Maximum one of each gift per order.
- In `createOrderUsing` and only there (authoritative): after resolving the items, compute the gift lines, add the gift item's stock to the SAME sorted stock-lock batch so the lock order stays deadlock-free, check the gift's stock and the rule's cap and per-customer limit under lock, insert the gift line (price 0, flagged gift, rule id, the gift's regular price as an informational "value"), and claim its stock exactly like any other line. All in the same transaction and the same ledger, so failure, cancel, expiry, late payment and return release or restock it correctly and exactly once.
- If the gift can no longer be given at that moment (sold out, rule ended, cap reached): return a typed conflict (like the price-change guard) with the new totals and "free gift no longer available"; the customer reviews and may continue without it (per my answer). Never silently drop it, and never silently add one the customer was not shown.
- Gift lines are excluded from coupon eligible amounts, from the shipping threshold and from item-wise revenue; they add zero to the payable amount and the gateway amount. The price-change guard and totals are unaffected except through the conflict above.
- POS is unchanged and gives no automatic gifts.
- Additive migration: gift flag and rule id on order lines, gift-only flag on products, the rules table (RLS on, no policies), a counter table or query for caps.

### 1D. Admin and reporting
- Rules list with status (Active, Scheduled, Ended, Paused, Cap reached), gifts given and remaining, and a "Free gifts" report (orders, gift units, estimated cost from the internal cost price, revenue of orders that unlocked a gift, CSV). Admin order detail, packing slip and the pick list show the gift line with a clear FREE GIFT label so it is packed. A return or refund that drops the remaining paid amount below the rule's target adds a staff note "free gift may need to be returned"; nothing is clawed back automatically.

### 1E. Tests
Pure rule table (below, equal, above the target; several rules; sale price moving an order across the threshold; coupon basis per my answer); gift line created with price 0 and stock claimed in the same transaction; gift stock lock order with concurrent checkouts, POS, cancel and reconcile (no deadlock); two buyers for the last gift produce one gift and one conflict; cap and per-customer limit under concurrency; rule edited or ended between display and pay returns the conflict and creates no order; cancel, failure, expiry and late payment release the gift stock exactly once; returns and refunds note the gift; gift-only items never appear on the storefront, search or filters and cannot be bought directly; excluded from coupons, shipping threshold and revenue; snapshot unchanged after a rule edit; permissions and audit.

**Done when:** staff can set "spend Rs 999, get a free phone stand", and an order that reaches Rs 999 contains the gift with its stock claimed atomically.

---

## Phase 2: Free gift - what the customer sees

1. **Progress nudge:** in the cart, the checkout summary and (if enabled in the rule) a slim strip on product pages: "Add Rs 249 more to unlock a FREE [icon] Phone stand", with a small progress bar. When unlocked, the message changes to the rule's message.
2. **Automatic gift line:** when the eligible amount meets the target the gift line appears in the cart and the checkout summary automatically: a small round icon of the gift, its name, a clear FREE badge, and the gift's value struck through. It cannot be removed or have its quantity changed by the customer, and when the cart drops below the target it disappears automatically. The gift line is derived from the server's rules for display (it is not stored as a normal cart item) and the server decides again at checkout.
3. In sale mode nothing says "not available" in the UI; the gift check happens at click, with the conflict message from Phase 1.
4. **Where it shows afterwards:** order success page, receipt, invoice (a line at zero, ask my accountant how gifts should be treated for tax), customer order detail, emails (a whitelisted variable for the gift name) and the account order list.
5. Style: the existing cart and checkout components and tokens, mobile first, accessible (the icon has alt text, the FREE badge is real text, the progress is announced).
6. **Tests:** nudge and progress for every state; auto add and auto remove as quantities change; display equals what the server creates; conflict message and continue-without-gift flow; gift line not removable; documents show the gift; accessibility structure; sale mode behaviour.

**Done when:** a customer sees how far they are from the gift, the gift appears by itself with its icon and FREE, and the order, receipt and packing slip all show it.

---

## Phase 3: Spin wheel - engine and admin

### 3A. Data and rules (additive migration, RLS on)
- **Wheel settings:** enabled switch, title and subtitle, start and end, spins per customer per day (default 1), terms text (required before enabling; link on the wheel page; the agent does not invent legal text), maximum spins per IP per day, minimum account age, and whether to show the entry on the home page.
- **Segments** (2 to 12): label (short, for the wheel), colour (hex, text colour chosen automatically for contrast), type (**Coupon prize** or **No prize** such as "Better luck tomorrow"), weight (positive whole number; the admin screen shows the resulting percentage), optional daily cap and total cap, active switch, sort order. A **coupon prize** defines the personal coupon that is created for a winner using the existing coupon fields: discount type (percent with a maximum amount, fixed amount, or free shipping), minimum order, scope (whole order by default, products or categories optional), and **valid for N days** after the win. Prizes are copied into a new coupon at win time; later edits never change coupons already won.
- **Spins table:** one row per customer per store day with a unique key on (customer, store day), the chosen segment, the coupon created, the time, hashed IP, and the weights used.

### 3B. The draw (one short transaction, all on the server)
1. Require a signed-in customer, same-origin check, maintenance mode respected, rate limits (per customer and per IP, per my answer), the wheel enabled and inside its window, and the terms accepted flag.
2. Compute today's store day from the **database clock and the store timezone setting** (validated against the database's timezone names; default Asia/Kolkata).
3. **Insert-first:** try to insert today's spin row. If one exists, return the SAME result as today's spin and the time of the next spin; never draw again. This makes double taps, two tabs and concurrent requests safe.
4. Lock the segment rows that have caps, exclude exhausted or inactive segments, and draw with a cryptographically secure random number (`crypto`), weighted by the remaining segments' weights. Record the roll and the weights.
5. If the segment is a coupon prize: create the personal coupon in the same transaction using the existing coupon engine: unique random code, restricted to this customer, one use in total and per customer, expires after N days, visible only on this customer's Coupons page (not "Show to all users"). Increment the caps.
6. Commit, then queue the notification after commit (a new "spin win" event in the notification matrix with customer in-app on by default and email off), with whitelisted variables only (prize name, coupon code, expiry).
7. Return the result to the browser, which animates the wheel to land on the segment the server chose. The result is never decided or revealable on the client.
- Keep the transaction to a handful of statements, set lock and statement timeouts, return a friendly 503 with Retry-After on a timeout, and read the wheel configuration through a cache of a few seconds with the live caps checked under lock.

### 3C. Admin (Store Admin -> Marketing -> Spin wheel)
- Settings card, segments table (add, edit, reorder, remove or deactivate, with weights and live percentages, a warning if the odds of winning a prize are very high or no segment is a prize, and a preview of the wheel), a **Test spin** button for staff that shows how the wheel looks and animates but creates nothing, and a plain "How the wheel works" help panel.
- Editing is atomic and audited; staff can change segments at any time; the next spin uses the new setup; past wins and their coupons are untouched.
- **Reports:** spins per day, wins by segment, coupons won, redeemed and expired, revenue and total discount from orders that used a spin coupon, a log of recent spins with masked customer details, and CSV export.
- Enabling is blocked until terms text exists and at least one prize segment is active.

### 3D. Abuse protection
Per-IP daily cap, optional minimum account age, the bot check once one exists (ask me), prize caps so a bug or a viral post cannot hand out unlimited coupons, a visible kill switch (the enabled switch), and an alert in the Needs-attention panel if a daily cap is reached. Spinning never requires a purchase.

### 3E. Tests
Daily limit on the store day across midnight in India time and across time zone settings; concurrency (many parallel requests from one customer produce exactly one spin and one coupon; two tabs; retry after a timeout returns the same result); the unique key; weighted draw is correct over a large simulation within tolerance, uses the secure source, and respects exhausted caps without changing other weights incorrectly; coupon created restricted to the winner, single use, correct expiry, correct amounts, visible only to that customer and appears on their Coupons page; another customer cannot see or use it; a no-prize result creates no coupon; caps under concurrency; enabling blocked without terms; maintenance mode; rate limits and the per-IP cap; no result data in logs; test spin creates nothing; editing segments does not change existing coupons; audit rows; permissions.

**Done when:** staff can configure the wheel, one customer can spin once a day, and a win creates a personal coupon that shows up in their Coupons page.

---

## Phase 4: Spin wheel - what the customer sees

1. **Entry points** (all small and in the existing style): a "Spin and Win" button or strip on the home page (switchable in settings), a card on the account dashboard that shows "Spin now" or "Next spin in hh:mm:ss", and a link in the Coupons page. Signed-out customers see the wheel page with a sign-in prompt that returns them to it after signing in or signing up.
2. **The wheel page** inside the normal layout: a responsive wheel (SVG or canvas, readable at 390 px) with the segment labels and colours from the settings, a large Spin button, a smooth spin that lands on the server's result, a result panel ("You won 10% off! Code ABC123, valid until 20 Nov") with buttons "View my coupons" and "Continue shopping", the next-spin countdown, and the terms link. If today's spin is already used, show today's result and the countdown, never spin again.
3. **Accessibility and comfort:** keyboard operable, a visible focus ring, `prefers-reduced-motion` skips the animation and shows the result at once, the result is announced to screen readers, and a plain text list of the prizes is available for screen readers and when scripts fail. No sound by default.
4. **Coupons page:** a won coupon appears at once with its code (copy button), what it gives, the minimum order, a countdown to expiry, and a "From Spin and Win" label; expired ones disappear. The cart and checkout coupon box accepts it with the usual rules.
5. **Messages:** the in-app message in the Message centre (and email if the owner enables that cell).
6. **Tests:** page states (signed out, available, already spun, wheel off or outside its window, error); the animation lands on the server result; reduced motion; accessibility structure; countdown correctness; coupon appears without a reload; copy button; cart acceptance of the won coupon; entry points hidden when disabled.

**Done when:** a customer spins, sees the wheel land, finds the coupon in their Coupons page, applies it at checkout, and cannot spin again until the next day.

---

## Phase 5: Proof

1. Real-database tests for every concurrency and cap rule above (double spin, caps, last gift unit, gift stock lock order against checkout, POS, cancel and reconcile), on the approved test database or a throwaway schema.
2. A signed-in browser run with screenshots at 1440, 768 and 390 px: owner creates the gift rule and the wheel; customer sees the nudge, the gift appears at the target, checks out in PayU test mode (or the simulator) and the order carries the gift; the same customer spins, wins, uses the coupon, and is refused a second spin the same day; the next day (clock moved in the test) spinning works again.
3. Load check for the spin endpoint (concurrent spins by many customers) and for checkout with a gift on a hot gift item, recording p50, p95 and errors.
4. Update `FEATURES.md`, the owner help, and write a one-page owner guide "Set up a free gift and the daily wheel" with screenshots.
5. Report what is proven and what is not.

---

## Decisions the agent will probably ask, with my suggestions

| Question | Suggestion |
|---|---|
| Gift threshold basis | After sale prices, before coupons (same as free shipping) |
| Several gift rules qualify | Give only the highest one |
| Gift unavailable at checkout | Tell the customer and let them continue without it |
| Day for the daily spin | The calendar day in India time (midnight reset) |
| Who can spin | Signed-in customers only |
| Per-IP daily cap | 5 spins |
| Minimum account age | 0, plus a bot check once one exists |
| Wheel prize shape | A personal coupon copied from the prize settings, single use, expires after N days |
| Gift-only items | Hidden from the storefront and cannot be bought alone |
| Tax and gifts | Ask your accountant how free gifts and the zero-price invoice line must be treated |

## What only you can do
1. Decide the real gift items, the target amounts and the prizes and odds. Make sure every prize is affordable at the highest realistic win rate.
2. Write your own terms for the wheel and have a professional review them. Promotions involving chance have rules that depend on how they are run; the safest basic design is that spinning is free and needs no purchase, but get proper advice.
3. Ask your accountant about the tax treatment of free gifts and the invoice line.
4. Provide stock for the gift items and keep it tracked.
5. After launch, watch the Needs-attention panel and the Free gifts and Spin reports in the first week.

## Starter message

```text
Read SPIN_WHEEL_AND_FREE_GIFT_PLAN.md in the repo root. Follow its Common rules. Do Phase 0
only: report what exists today, write PROMO_NOTES.md, and ask me only the decisions still
open. Do not change code yet. Stop and wait for me to say "continue".
```

For later phases, replace "Phase 0" with the next phase number.

## Manual checks after each phase
- **1:** create a rule "spend Rs 999, free phone stand"; set the gift's stock to 1; check the admin shows the warnings; edit the amount and see it apply to a new cart only.
- **2:** add items to a cart and watch the nudge change; cross the target and see the gift appear with its icon and FREE; go below and see it disappear; place an order and check the receipt and packing slip.
- **3:** configure three segments and a daily cap; click Test spin; check the odds percentages update.
- **4:** sign in, spin, see the wheel land, find the coupon in Your Coupons, apply it in the cart, try to spin again.
- **5:** spin from two browser tabs at once and confirm only one spin counts; use the last unit of a gift in two browsers at once.