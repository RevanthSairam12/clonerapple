# Staging runbook — flows that need external services

Everything the security remediation could not verify without a running deployment, third-party
credentials or a second browser session. Each section is a tick-box checklist with exact commands and
the expected answer.

**Rules while running this**

- Staging or a local instance only. Nothing here is safe to rehearse on production.
- Never paste a secret, a full customer email or phone, an address, a payment value or a raw PayU
  response into a run log, a commit or a ticket. Logs below name variables and statuses only.
- No route URL, HTTP method or response shape should change during these tests. If one does, stop and
  record it — that is a regression.
- A step you cannot run is **NOT TESTED** with the reason. Never mark it passed from reading code.

Prerequisites for every section:

```bash
cd /c/Users/Abcom/Documents/clon/apple-clone
npm test && npx tsc --noEmit && npm run build   # baseline is green before you start
```

---

## 1. SMTP allow-list: the password never reaches a non-listed host

**What it proves.** `MAIL_ALLOWED_HOSTS` stops the server sending `MAIL_PASSWORD` to a host the owner
picked. A fake SMTP server on the same machine is the safe way to see whether a login attempt arrives.

**Interception is the point, not delivery.** Pointing the app at a *real* unrelated public SMTP server
would send that third party the login attempt. Use a local mail-trap container that accepts any
connection and logs what the client sends, and confirm nothing ever arrives at it from an unlisted host.

### Setup

- [ ] Start a mail trap that logs every SMTP command it receives:

  ```bash
  docker run --rm -d --name gadzio-mailtrap -p 2525:25 -p 1080:80 mailhog/mailhog
  # UI + SMTP message capture: http://127.0.0.1:1080
  # Raw protocol log (what the client said): docker logs -f gadzio-mailtrap
  ```

  (smtp4dev is an equivalent: `docker run --rm -d -p 2525:25 -p 5000:80 rnwood/smtp4dev`.)

- [ ] In a **scratch** `.env.local` for the test instance (never the repo's committed one, never
      production), set a throwaway password and a deliberate allow-list that does **not** contain the
      trap's host:

  ```bash
  MAIL_ALLOWED_HOSTS=smtp.example.invalid     # NOT 127.0.0.1 / localhost / gadzio-mailtrap
  MAIL_PASSWORD=scratch-not-real-password
  ```

- [ ] Start the instance:

  ```bash
  npm run dev     # or: npm run build && npm start
  ```

### Test A — a non-listed host must be refused before connecting

- [ ] Sign in to store admin as an **owner**. Open **Settings → Mail**.
- [ ] Set **SMTP host** to the trap: `127.0.0.1`, port `2525`, encryption `none` (development only),
      From email to a scratch address. Save.
- [ ] Go to **Settings → Notifications** (or the mail check panel) and run **Verify mail connection**.
      The equivalent API call, if you prefer curl (replace the cookie with your own):

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' \
    -X POST "$BASE_URL/api/store-admin/mail-check" \
    -H "Origin: $BASE_URL" -H 'Content-Type: application/json' \
    -H "Cookie: store_admin_session=$SESSION" \
    -d '{"action":"verify-mail"}'
  ```

- [ ] Expect the response code `not_configured` and the message
      `mail not configured (SMTP host is not in MAIL_ALLOWED_HOSTS)`.
- [ ] **The decisive check** — the trap must show **no connection at all**:

  ```bash
  docker logs gadzio-mailtrap 2>&1 | tail -6
  # expect: no new "CONNECT" / "HELO" / "AUTH" lines since you started watching
  ```

  If a `CONNECT` arrives but no `AUTH`, the connection was made before the host check — record that;
  the requirement is that the *password* never arrives, and an `AUTH` line would falsify it.

**Pass:** `not_configured`, and no `AUTH` (ideally no `CONNECT`) reaches the trap.
**Fail:** any `AUTH` or password handshake reaches the trap.

### Test B — a listed host works (proves the test is not passing for the wrong reason)

- [ ] Restart the instance with the trap on the allow-list:

  ```bash
  MAIL_ALLOWED_HOSTS=127.0.0.1
  ```

- [ ] Repeat **Verify mail connection**. Expect a connection attempt in the trap log, and a result of
      `ok` or `bad_credentials` (the trap may not accept the login) — either proves the allow-list
      admitted the host and the client connected.
- [ ] Do **not** run `test-email`; it sends a real message.

### Cleanup

- [ ] Restore the Mail settings to their previous values.
- [ ] `docker stop gadzio-mailtrap`
- [ ] Remove the scratch `MAIL_ALLOWED_HOSTS` / `MAIL_PASSWORD` from the test instance's environment.

Record: `MAIL_ALLOWED_HOSTS` in effect (host names only), the two result codes, and whether the trap
saw a connection/AUTH.

---

## 2. PayU sandbox

Requires sandbox `PAYU_KEY`, `PAYU_SALT`, `PAYU_ENV=test` and a `PAYU_RETURN_SECRET` of at least 32
characters on the staging instance. The return-link token is an HMAC of `v1|<txnid>|<expiry>` with a
**30-minute** TTL (`src/lib/payu/return-link.ts:22`). **Without `PAYU_RETURN_SECRET` no token is issued
and every `?rt=` link is refused** — do not record the flow as failing if that variable is missing;
record it NOT TESTED instead.

### 2a. One full payment

- [ ] Add one inexpensive product to the bag and start checkout. Complete the sandbox payment.
- [ ] The browser lands on `/order/success` (or `/order/processing`) with `?txnid=…&rt=…`.
- [ ] In **Store admin → Orders**, the order is `PAID` and the stock for the purchased variant moved.
- [ ] Record: order status, and that the amount shown matches the product price.

### 2b. The page after a valid return shows only order number, status and amount

- [ ] On the result page, with DevTools open, confirm the visible summary is exactly: order number,
      status, amount. No items, no address, no email, no payment identifiers.
- [ ] Sign out (or open a private window) and open the `?rt=` link from the address bar. The summary
      still shows, and still shows no items or address.
- [ ] Request the result page **without** the token and without a session
      (`/order/status?txnid=<txnid>`): expect the single **"Order status unavailable"** card for both
      an existing and a nonexistent reference (L-7).

### 2c. Replaying the link after the 30-minute window is rejected

No waiting required — a sandbox token is just an HMAC, and the live instance signs with the same
secret. Mint an expired token with the app's own signer and confirm the page refuses it.

- [ ] In the repo, with `PAYU_RETURN_SECRET` exported to the same value the staging instance uses:

  ```bash
  node --input-type=module -e "
    const { createHmac } = await import('node:crypto');
    const { issueReturnToken } = await import('./src/lib/payu/return-link.ts').catch(() => ({}));
    const txnid = process.argv[1];
    const expiry = Math.floor(Date.now()/1000) - 60;           // expired one minute ago
    const token = createHmac('sha256', process.env.PAYU_RETURN_SECRET)
      .update('v1|' + txnid + '|' + expiry).digest('base64url');
    console.log('/order/success?txnid=' + encodeURIComponent(txnid) + '&rt=' + encodeURIComponent(token));
  " <txnid>
  ```

  (If importing the `.ts` file fails under bare Node, run the same snippet with `npx tsx` or compute it
  in a REPL — the HMAC input is exactly `v1|<txnid>|<expiry>`.)

- [ ] Open the printed path in a **signed-out** private window. Expect **"Order status unavailable"**.
- [ ] Repeat with `expiry = Math.floor(Date.now()/1000) + 300` (a valid five-minute token). Expect the
      order summary. This proves the rejection above was the expiry, not a broken link.
- [ ] Also try a valid token for a **different** txnid against this order's URL: expect unavailable
      (the token is bound to the reference).
- [ ] Never print the secret or the token in a run log — the URL above contains a token; do not paste it.

### 2d. A duplicate webhook is a no-op

The webhook is PayU's server-to-server notification (`POST /api/payu/webhook`); the response is a small
payload-free `{ "status": "ok" }` and a repeat is treated as a duplicate
(`src/lib/payu/process-response.ts:480-482`).

- [ ] Take the notification body the sandbox delivered (from the PayU sandbox dashboard, or a recorded
      staging request — never from production).
- [ ] Send it to staging on purpose:

  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE_URL/api/payu/webhook" \
    -H 'Content-Type: application/x-www-form-urlencoded' --data-binary @payload.form
  ```

- [ ] Expect `200` the first time. Send it **again unchanged**.
- [ ] Expect `200` again, and confirm in Store admin that: the order status did not change twice, no
      second stock movement exists for that order, and no second payment row was created.
- [ ] Record: first and second status code, and the two "unchanged" observations.

---

## 3. Storefront smoke test after the `products` grant change

0064 replaced the table-wide `SELECT` on `products` with a grant on 30 display columns. The app reads
`products` on the **owner connection** (`DATABASE_URL`), not through the publishable key, so nothing
should change — this proves it.

Run with DevTools open on the Network tab; every page must return `200` and render.

- [ ] **Home** — `/` — product tiles render with images and prices.
- [ ] **Category** — `/in/shop/iphone/accessories/mobile-cases` (and one more, e.g.
      `/in/shop/iphone/accessories/cases-protection`) — the grid and its filters render.
- [ ] **Product** — open one product from the grid (`/shop/product/<productId>`) — photos, specifications
      and options render; choose a model and colour and watch the price update.
- [ ] **Search** — `/search?q=case` — results render, no error card.
- [ ] **Cart / bag** — add one item, open `/cart` (and `/bag`) — the item, quantity and totals match.
- [ ] **Checkout start** — sign in as a scratch customer, go from the bag to `/checkout` — the address
      form and order summary render. **Stop before paying** unless you are doing section 2.
- [ ] In every page's Network tab, confirm **no** `rest/v1/products` request is made by the storefront
      (the app reads through the server). If one appears, record it — it would now be subject to the
      30-column grant.

**Pass:** every page renders, no console errors, no failed requests.
**Fail:** any page throws, a price or image is missing, or an error card appears.

---

## 4. Inventory concurrency: two checkouts for the last unit

The stock claim is a `SELECT … FOR UPDATE` followed by a conditional decrement
(`src/lib/payu/stock.ts:18-35, 122-127`): the second transaction must see zero remaining stock and be
refused.

### Setup

- [ ] Pick a product variant and set its stock to **exactly 1** through
      **Store admin → Stock** (use the guided stock-move screen; it is audited).
- [ ] Use **two different customer accounts** (or one signed-in and one guest) in two browsers.
      The same account in two tabs can share a cart and invalidate the test.

### Run

- [ ] Browser A: add the product to the bag and go to checkout. Do **not** pay yet.
- [ ] Browser B: do the same.
- [ ] Start both checkouts **as close together as possible** — a real race needs both in flight. If
      your test harness can fire the two `payu/initiate` (or the stock-claiming) requests in parallel,
      use that instead of clicking twice by hand.
- [ ] Pay on **both** if the flow lets you (sandbox), or drive both to the point where stock is claimed.

### Expect

- [ ] Exactly **one** order reaches `PAID` (or `PROCESSING`); the other is refused with
      `stock-unavailable` (a 4xx on the checkout/initiate call, or a "no longer available" message).
- [ ] Stock for the variant is now **0**, not `-1`.
- [ ] Store admin shows **one** stock movement for the sale, not two.
- [ ] The refused customer's cart still holds the item and can be repriced.

**Pass:** one success, one clean refusal, stock `0`.
**Fail:** two orders sold, stock negative, or a 500 instead of a refusal.

### Cleanup

- [ ] Return the variant's stock to its previous value through the stock-move screen (audited, as
      required).

---

## Run log template

Copy this per run. Statuses and codes only — no secrets, tokens, cookies, customer contact data or
payment values.

| Section | Date | Environment | Result | Evidence (codes / observations) | Notes |
|---------|------|-------------|--------|----------------------------------|-------|
| 1. SMTP allow-list A | | | | | |
| 1. SMTP allow-list B | | | | | |
| 2a. PayU payment | | | | | |
| 2b. Summary shape | | | | | |
| 2c. Expired token | | | | | |
| 2d. Duplicate webhook | | | | | |
| 3. Storefront smoke | | | | | |
| 4. Last-unit race | | | | | |

Anything that could not be run:

| Section | Reason (NOT TESTED) |
|---------|---------------------|
| | |
