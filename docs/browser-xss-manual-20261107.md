# Browser-level XSS check — manual procedure

Two stored values are rendered into a browser by the app:

1. **A notification body**, authored in store admin and shown in the customer inbox by
   `MessageBody` (`src/components/account/MessageBody.ts`).
2. **A theme colour**, authored in the website editor and emitted into the root layout's `<style>`
   block (`src/app/layout.tsx:45-47`), after `safeThemeColor()`.

Both are covered by unit tests that inspect the generated HTML
(`tests/security-h2-message-xss.test.mjs`, `tests/security-l4-theme-colours.test.mjs`). Those tests
prove the escaping; they do not prove a browser executes nothing. This page is the browser-level step.

Playwright is **not** a dependency of this repo, so nothing new was installed.

---

## Automated option (already available)

`scripts/browser-xss-check.mjs` does the browser-level check without adding a dependency: it renders
the real `MessageBody` and the real layout style block, loads them in a local Chrome/Edge/Chromium via
`--headless --dump-dom`, and asserts:

- a **positive control** (`<img onerror>` inserted raw) *does* set `window.__xss` — otherwise the
  harness cannot detect XSS and the run fails;
- the hostile message body leaves `window.__xss` undefined and its string appears literally;
- the hostile theme colour never reaches the style block, and the coded fallback `#006D2E` is the
  computed value of `--oppo-green`.

```bash
node scripts/browser-xss-check.mjs
# exit 0 = every check passed, 1 = a check failed, 2 = no browser found
# BROWSER_PATH=/path/to/chrome node scripts/browser-xss-check.mjs   # override the lookup
```

Last run: **2026-11-07**, Chrome on Windows, **9 of 9 checks passed**.

The script renders isolated HTML fixtures, not a running app. When a staging build with a database is
available, also do the end-to-end procedure below — it covers the path from the editor through the
database to the rendered page.

---

## End-to-end procedure (staging, with a database)

### 0. Before you start

- Use a **staging** deployment only. Both payloads are stored in the database; on production they
  would be live until removed.
- If `DRIVER=log`, no mail is sent anywhere. If mail delivery is live, the outbox worker may try to
  send the notification — do not set `mail_status=on` for this test.
- Keep the browser DevTools Console open. `window.__xss` will be `undefined` unless something went
  wrong; that is the expected result.

### 1. The message body

1. Sign in to store admin as an **owner** and open
   **Settings → Automated messages** (or **Email templates**).
2. Create or edit one message and set its body to exactly:

   ```
   <img src=x onerror=window.__xss=1>
   ```

   Save it.
3. Sign in to the storefront **as the customer account the message is addressed to** (the inbox
   shows messages for that user). The test account in the memory notes is a test editor account; use
   whichever customer was the recipient for the scratch test.
4. Open **Account → Messages** (`/account/messages`) and find the message.
5. In the Console, evaluate:

   ```js
   window.__xss        // => undefined
   ```

6. In the Elements panel, inspect the message container. It must contain the string as **text**, not
   an `<img>` element. Selecting the node must show a text node, and the Network panel must show no
   request for `x`.

**Pass:** `window.__xss` is `undefined`, no `<img>` element exists, no request for `x` was made.
**Fail:** anything executes, an element is created, or the Network panel shows a request.

### 2. The theme colour

1. As an **owner**, open **Store admin → Website → Theme**.
2. Set a colour field (e.g. the primary colour) to exactly:

   ```
   red;}</style><script>window.__xss=1</script>
   ```

   The field validates on save and should reject it. Note which happened:
   - **Rejected on save** — the write seam holds. Continue to step 3 anyway to prove the read seam.
   - **Accepted** — continue; the read seam must still neutralise it.
3. If it was accepted, load any storefront page and in the Console evaluate:

   ```js
   window.__xss                                  // => undefined
   getComputedStyle(document.documentElement)
     .getPropertyValue('--oppo-green').trim()    // => #006D2E  (the coded fallback)
   document.querySelectorAll('script').length    // unchanged from before the edit
   ```

4. Inspect the `<style>` element in `<head>`. It must contain only valid
   `--oppo-green: <hex>; …` declarations, with no `</style>` and no `<script>` inside it.
5. **Clean up.** Restore the original colour whether the value was accepted or rejected, and confirm
   the page renders with the intended colour again.

**Pass:** no execution, the fallback colour is computed, no extra `<script>` node.
**Fail:** the value broke out of the style block, a script node appeared, or a colour other than the
fallback was applied to the token.

---

## What to record

| Item | Where |
|------|-------|
| Date, environment, browser and version | the run log |
| Both payloads and both outcomes | the run log |
| `window.__xss` value and `--oppo-green` computed value | the run log |
| Any cleanup performed | the run log |

Never record a customer email, a session cookie, a token or a connection string in the run log.

---

## Why this is a manual step and not a test

The end-to-end path needs a running app, a database and a signed-in customer session. The repo has no
browser automation dependency, and adding Playwright would change `package.json` and the install
footprint for one check. `scripts/browser-xss-check.mjs` covers the same escaping guarantees in a real
engine without that cost; the procedure above covers the remaining gap (editor → database → page).
