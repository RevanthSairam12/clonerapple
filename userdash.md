ROLE
Senior full-stack and backend engineer in the Gadzio repo. Read FEATURES.md and the current
code first. Build a modern customer "Your Account" dashboard at /account, in a card layout:
a grid of cards at the top (each card shows live data), grouped sections of links below,
and personalised rows at the bottom. Everything on it must come from the database for the
signed-in customer, so every page is always up to date.

This is a self-contained task. Do not rely on earlier instructions. Report findings before
changing code, commit in small steps with tests, and if an API or quota error interrupts
you, stop and tell me the exact step you reached. Never print secret values.

HARD CONSTRAINTS
1. Customer identity stays separate from store-admin and legacy-admin identity. Every
   account page uses requireAccountPageSession(...); every account API uses
   requireAccountSessionApi(); every mutation calls assertSameOrigin(request). A customer
   can only ever read or change their own data. Update scripts/check-account-routes.mjs so
   it covers every new account route and fails if one lacks a session and ownership check.
2. Keep every existing /account route and its behaviour (profile, addresses, orders, order
   detail, receipt, requests). New pages may be added under /account.
3. Use the existing design system, components and tokens. No new visual language, no
   Amazon look-alike. Responsive: three columns on desktop, two on tablet, one on mobile.
   Cards are fully keyboard accessible with visible focus.
4. Prices shown anywhere on this dashboard (Buy again, recommendations) come from the
   existing price resolver (sale price only while a sale is live) and stock rules (normal
   mode hides or disables sold-out items; sale mode never shows "not available").
5. Never expose another customer's data, cost prices, internal notes, audit data or
   secrets. Mask phone and email where they are shown in summaries. No personal data in
   logs.
6. Freshness: all account pages are per-user and must never be cached or shared between
   users (dynamic rendering, no-store, no shared CDN cache for these routes).
7. Respect maintenance mode (account is blocked while it is on) and the existing coupon,
   order, stock and notification rules. Do not touch the Education Store. POS and store
   admin are unchanged.
8. New tables ship with RLS enabled in the same migration, no public policies. Next free
   migration number: check migrations/.
9. npm test, typecheck, build, all check scripts (including check-account-routes) and
   npm audit must pass. Show git log --oneline and git status (clean) at the end.

Step 0 findings                                                                                            
                                                                                                                 - Existing pages:                                                                                                - /account (src/app/account/page.tsx) reads users via the live session and the latest row through                                                                                                                         order_sale_state/orders. It currently shows a profile banner, three quick links, and the latest      
  order.
      - /account/profile reads users; the page edits name/phone and posts password changes through account   
        APIs.
      - /account/addresses reads active customer_addresses rows owned by the session user and manages/makes  
  one
        default.
      - /account/orders reads order_sale_state (the orders read view) scoped by user_id, with
        pagination/search/status filters.
      - /account/orders/[txnid] reads the owner-scoped order, order_items, order_addresses,
  order_deliveries,
        order_status_history, and the return-window setting; it exposes customer-safe status, payment,       
        delivery, tracking, and allowed request actions.
      - /account/orders/[txnid]/receipt reads the same owner-scoped order data plus the configured receipt   
                                                                                                             
        footer/trade name.
    - Existing APIs:
      - GET/PATCH /api/account/profile: session-scoped users.
      - POST /api/account/password: session-scoped users/user_sessions; revokes other sessions and queues    
  the
        existing password event.
      - GET/POST /api/account/addresses, PATCH/DELETE /api/account/addresses/[id], POST
        /api/account/addresses/[id]/default: owner-scoped customer_addresses.
      - GET /api/account/orders, GET /api/account/orders/[txnid]: owner-scoped orders/order detail data.     
                                                                                                             
      - POST /api/account/orders/[txnid]/requests: owner-scoped order plus order_requests; same-origin,      
                                                                                                             
        rate-limited, with the existing cancel/return/help rules.
    - Existing account reads already use the separate user_session cookie and database-backed user_sessions; 
                                                                                                             
      there is no store-admin/legacy-admin identity reuse. users, user_sessions, orders, addresses,
  requests,
      and the other customer tables have RLS with no public policies. Account pages are dynamic, but the     
                                                                                                             
      current route guard only mechanically checks ownership for API paths containing orders/.
    - The signed-in header currently shows only an account icon linking to /account. It does not show a      
  name,
      order count, unread count, or server-side cart count; the bag badge is the existing browser-local cart 
                                                                                                             
      count. The signed-out and signed-in account link are visually the same. I’ll preserve signed-out       
  behavior
      and add server-provided customer context to account headers where the header is already rendered with  
  an
      account session.
    - Customer in-app notifications exist in the 72-cell notification matrix, but
      src/lib/notifications/enqueue.ts assigns customer inapp a synthetic recipient customer with reason no  
                                                                                                             
      customer in-app inbox; src/lib/notifications/outbox.ts subsequently marks those rows SKIPPED. The      
  outbox
      has no customer user id or read_at column. Email/SMS delivery is separate and unchanged. Retention     
                                                                                                             
      currently clears body/recipient on old terminal rows.
    - There is no product-view, browsing-history, wishlist, or saved-items implementation. No such table or  
                                                                                                             
      route exists. Product/purchase data currently lives in products, category/brand facets, order items,   
  and
      stock rows; product lists are resolved through loadCatalogUsing/storefront mapping and
  applySaleDisplay,
      with sale state read on the server and stock derived from on_hand - reserved plus in_stock.
    - Store-admin “Anonymise customer” is a transaction in src/lib/store-admin/customer-accounts.ts: it      
  deletes
      all saved addresses and sessions, unsubscribes the newsletter address, replaces email with
      deleted-<id>@anonymised.invalid, clears names/phone/group/marketing consent, marks the account
      blocked/anonymised, and writes a masked audit entry. Orders are intentionally retained unchanged for   
                                                                                                             
      accounting; they therefore keep their existing owner id and shipping snapshots, not an anonymous       
      replacement reference. Customer numbering is GDZ-style txnid; order_number is nullable for legacy      
  rows.
    - The next migration is 0044. The current subscription state is duplicated between
  users.marketing_opt_in
      and newsletter_subscribers; the account profile has no password-change timestamp, so “old password”    
  needs
      a new nullable timestamp with signup/update handling. The store support email/phone are in the
  existing
      
STEP 1: DASHBOARD HOME (/account)
Top grid of cards. Each card is a link to its page and shows a live summary line:
  - Your Orders: total orders, the latest order's number and status chip, and a count of
    orders currently in transit.
  - Returns and requests: open requests count and the latest request's status.
  - Your Addresses: number of saved addresses and which one is the default (masked).
  - Login and security: last sign-in time, number of active sessions, and a prompt if the
    password has not been changed in a long time (setting-free, informational only).
  - Your Coupons: number of coupons currently available to this customer (Step 4).
  - Message centre: unread count (Step 5).
  - Profile: name and masked email/phone, with a nudge if phone is missing.
  - Contact and support: link to /support (static page), with the store phone and email
    from settings if present.
Do NOT invent cards for things Gadzio does not have (saved cards, subscriptions, wallet,
business account, memberships). If a feature does not exist, it does not appear.
Below the grid, grouped link sections (use only features that exist): Orders and shopping
(orders, returns, addresses, Buy again), Messages and preferences (message centre,
communication preferences), Login and security, Manage your data (Step 6).
A greeting with the first name, and a friendly empty state for new customers (no orders:
show "Start shopping" instead of blanks).
All numbers come from one server-side summary function (batched queries, a single round
trip where possible; the session pooler has only 15 connections, so no query-per-card
fan-out) and render server-side. Target under 300 ms on the dev database.

STEP 2: LIVE ORDER DATA
  - Orders list and detail always read from the database (status, payment, delivery,
    tracking link, requests, refunds). Status chips use the existing customer-safe labels.
  - While an order is in an in-flight state (CREATED, PENDING, PROCESSING, or shipped but
    not delivered), the order detail and the dashboard order card refresh by themselves
    every 30 seconds while the tab is visible (pause when hidden, refresh immediately on
    tab focus, stop when the order reaches a final state). Use a lightweight no-store
    endpoint, not a full page reload.
  - After any mutation (new request, address change, profile change, password change),
    the affected cards update immediately (router refresh) without a manual reload.
  - Buy again: a row showing products from the customer's past orders that are still
    active, with current prices and stock state; "Add to bag" uses the existing cart logic
    and re-validates stock and price at click time.

STEP 3: BROWSING HISTORY AND RECOMMENDATIONS (signed-in customers only)
  - Record product views for signed-in customers in a new table (customer id, product id,
    last viewed at, view count), capped at the latest 50 products per customer and
    deleted after 90 days by the existing reconcile run (never delete anything else).
    Record from the product detail page server-side, debounced, never for guests, never
    for archived products.
  - Customer controls: a "Browsing history" page listing what they viewed with Remove and
    Clear all, and a toggle "Save my browsing history" (default on, stored per customer).
    When off, nothing is recorded and existing history is cleared on request.
  - "Recently viewed" row and "Inspired by your browsing history" row on the dashboard.
    Recommendations are simple and explainable: active, in-stock products from the same
    categories and brands the customer viewed or bought, excluding items they already
    bought recently and anything archived. No third-party service, no profiling beyond
    this. Show at most 12 per row with the existing product card component.
  - If there is no history yet, hide these rows.

STEP 4: YOUR COUPONS
  - New page /account/coupons: coupons that are available to THIS customer only, meaning
    private coupons assigned to their email, or restricted to their customer group, that
    are active and not expired. Public codes are never listed (that would defeat code
    secrecy). Show code (with a copy button), value, scope in plain words, minimum order,
    expiry, and the customer's own remaining uses. Never show total limits, other
    customers' use, or internal names.
  - A "Use at checkout" hint only; the code is still entered in the cart or checkout box.
  - The dashboard card count uses the same function.

STEP 5: MESSAGE CENTRE (gives the customer in-app channel a destination)
  - Today customer in-app notifications are SKIPPED for lack of a destination. Connect
    them: when the notification matrix has a customer in-app cell enabled for an event, the
    outbox row is stored against the customer's account and marked SENT, with read_at empty.
    Add the needed columns by migration (customer user id, read_at).
  - New page /account/messages: the customer's messages newest first, with unread styling,
    mark read on open, mark all read, and a link to the related order. Only the customer's
    own rows. Messages follow the existing retention scrub (show a neutral line if the
    body has been cleared).
  - Dashboard card shows the unread count; the header shows a small unread dot if the
    header already has an account menu.
  - Email and SMS delivery paths are unchanged.

STEP 6: COMMUNICATION PREFERENCES AND MANAGE YOUR DATA
  - /account/preferences: one clear toggle for marketing emails (kept in sync with the
    newsletter subscribers list, add and remove), with a plain note that order and payment
    updates are always sent while the store has them enabled. Save with a success message.
  - /account/data: 
      a. "Download my data": a JSON file containing the customer's profile, addresses,
         orders (items, totals, status), requests, coupon uses and browsing history. Needs
         the customer to re-enter their password, rate limited (for example once per
         24 hours), served only to the signed-in owner, never emailed, no secrets or other
         people's data.
      b. "Close my account": requires password re-entry plus typing their email, two
         confirmation steps, and is refused with a clear reason while any order is unpaid,
         not delivered, or has an open return or request. On success: sessions revoked,
         personal details irreversibly replaced with placeholders using the existing
         anonymise logic, marketing opt-out, browsing history deleted, orders kept under an
         anonymous reference for accounting, immediate sign-out, and the email can be used
         to register again. Record it in the audit trail (masked, no personal data).
  - Both actions are rate limited, same-origin checked and covered by check-account-routes.

STEP 7: HEADER AND CONSISTENCY
  - If the header shows account info (greeting, orders link, counts), make it read live
    values for signed-in customers (first name, unread messages, items in bag) and keep
    the signed-out state unchanged.
  - Every account page title, breadcrumb and back link is consistent, and every page has a
    friendly empty state and a loading state.

TESTS (all must be written and passing)
  - Summary function: every card value is correct for a seeded customer (orders, in
    transit, requests, addresses, sessions, coupons, unread messages), and a new customer
    sees clean empty states.
  - Isolation: customer A can never read or change customer B's data on any account page
    or API (orders, requests, addresses, messages, coupons, history, export).
  - Freshness: account responses are not cacheable; an order status change shows on the
    next request; the polling endpoint stops at a final state; mutations refresh the
    cards.
  - Buy again and recommendations respect archived products, stock rules, sale price
    resolver and the sale-mode rule that nothing shows "not available".
  - Browsing history: recorded only for signed-in customers with the toggle on; cap of 50;
    retention delete; clear all; guests record nothing.
  - Coupons page: lists only the customer's own eligible private coupons and never leaks
    limits or other customers' use.
  - Message centre: in-app outbox rows attach to the right customer, unread count, mark
    read, retention scrub display.
  - Data export: requires password, rate limited, contains only the owner's data and no
    secrets. Account closure: refused with open orders, anonymises correctly, revokes
    sessions, frees the email, keeps orders anonymously.
  - check-account-routes covers every new route; maintenance mode blocks /account.
  - Performance guard: the dashboard summary uses a bounded number of queries.

DELIVERABLES
  1. Step 0 findings, then code in small reviewable commits (migration, summary function,
     dashboard UI, live order refresh, history and recommendations, coupons page, message
     centre, preferences and data pages, header, docs).
  2. Updated FEATURES.md (customer account section, new tables, file map, evidence) and the
     field-help registry entries for any new form fields if that system exists.
  3. A list of every storefront file changed or added and every new route, so I can review
     the visual diff, plus screenshots or a render description of the dashboard on desktop
     and mobile.
  4. npm test count (passed, failed, skipped), typecheck, build, all check scripts,
     npm audit, git log --oneline, git status (clean).

DEFINITION OF DONE
  - /account is a card dashboard whose every number and row comes live from the database
    for the signed-in customer and updates after every change.
  - Order status updates appear without a manual reload while the customer watches an
    in-flight order.
  - Customers can see their coupons, messages, browsing history and recommendations, manage
    communication preferences, download their data and close their account safely.
  - Nothing shown is invented: features Gadzio does not have do not appear.
  - No customer can ever see another customer's data.