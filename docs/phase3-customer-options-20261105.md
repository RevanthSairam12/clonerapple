# Product options Phase 3 — the customer product page — 5 November 2026

Phase 3 of `PRODUCT_OPTIONS_FINAL_PLAN.md` makes the customer choose the exact
option before buying, shows the exact price, stock and photos for that option,
and carries that option and its photo into the bag, checkout, order, receipt
and invoice.

Work sits on `backup/phase2-options-table-20261105`, on top of the Phase 2
commits (`340850d` … `036173f`). Nothing has been committed for Phase 3 yet.

## Done-when scenario

> A customer can choose iPhone 16 and Red, see the red photos and ₹100, choose
> Black, see the black photos and ₹120, and the bag and the order show exactly
> that.

This is covered by the shared rules and executed in
`tests/customer-option-selection.test.mjs` (exact row, price per row, gallery
per colour) and `tests/selected-variant-stock.test.mjs` (the order snapshots the
model, colour, price and photo it sold).

## What a customer sees

### 1. Two steps: model first, then colour

`src/components/shop/OptionSelector.tsx` renders:

- a **model** step (`fieldset`/`legend` + `role="radiogroup"` of
  `role="radio"` buttons) when the active rows have a device model or another
  named option (Wattage, Size…), labelled with that option's own name;
- a **colour** step of named swatches (hex is decoration only) once a model is
  chosen, listing only colours that model actually has;
- a single step for colour-only products, and only the model step for products
  with no colours.

The rules live in `src/lib/storefront/option-selection.ts` and are pure:
`optionSteps`, `resolveOptionVariant`, `selectModel`, `optionPrice`,
`optionStock`, `galleryForSelection`, `optionSelectionFromSearch`,
`optionQuery`. A combination the catalogue does not supply is never offered, and
`resolveOptionVariant` returns exactly one row or nothing — Add to Bag and Buy
Now refuse instead of substituting a sibling option.

`ProductDetailPage.tsx` and `AccessoryDetailPage.tsx` both use it. The server
passes `initialModel` / `initialColour` from `?model=` / `?colour=`; the page
keeps those parameters current with `history.replaceState` (no server round
trip), so a shared link restores the model, colour, price and photos.

### 2. Colour photos

`galleryForSelection` puts the chosen colour's photos first (primary photo
first, then their stored order, hover photos excluded) and falls back to the
product's default photos when that colour has none. With no colour it shows the
defaults. The page resets to index 0 when the selection changes and preloads the
chosen gallery with `new window.Image()`, so a swatch click shows the right
photo without a gap. The gallery box keeps its aspect ratio, so switching photos
never shifts the layout. Alt text is the stored photo alt, else
`"<product> — <colour>"`.

Every photo is reachable as a thumbnail group (`role="group"`,
`aria-label="Product photos"`, `aria-pressed`, `aria-label="Show photo N: …"`).

### 3. Price, availability and Add to Bag describe the selected row

Before a choice, `optionPrice` shows the **cheapest exact row's amount**, not a
"From ₹X" range, so the first price a customer sees is a real buyable amount
(the card/detail headline matches). Once a row is chosen the amount is that
row's own price. A strike-through appears only when the row being displayed —
the selected row, or the cheapest row before a choice — is on sale and its
regular price is higher. The shown price is the price the row is charged: the
tests assert `shown.unitPaise === row.pricePaise` for every row. Catalogue
`priceDisplay` (`src/lib/catalog/storefront.ts`) follows the same rule: the
minimum amount with no "From" prefix; `priceFrom` remains a metadata flag.

Availability follows the locked rules in
`src/lib/storefront/availability-rules.ts`:

- **Normal mode:** a sold-out exact row stays visible, is `disabled`, and says
  **"Stock not available"**. It cannot be added.
- **Sale mode:** nothing is disabled or marked unavailable. Stock is checked
  only at Add to Bag, Buy Now and Pay. A refusal names the exact option
  ("Out of stock for this option.").

### 4. Accessibility and responsive layout

`fieldset` + `legend` for each step, `role="radiogroup"`/`role="radio"` with
`aria-checked`, colour names as text (never colour alone), an `sr-only`
`aria-live="polite"` announcement of the chosen model, colour, price and stock,
44px-minimum targets, and wrap-friendly layout at 390 px with no fixed widths.

### 5. Snapshots: the bag, order, receipt and invoice keep what was sold

- The client sends only `variantId`. The server resolves price, model, colour,
  SKU and photo inside `resolveCartItemsFromDbUsing` after the stock locks, so a
  snapshot cannot be forged or chosen from stale client data.
- `migrations/0061_order_item_option_snapshot.sql` adds plain-text snapshot
  columns to `order_items` (no foreign keys): `variant_device_model_id`,
  `variant_device_model_name`, `variant_colour_id`, `variant_colour_name`,
  `variant_colour_hex`, `image_url`, `image_alt`. Renaming or retiring a model,
  colour or photo never changes an old order.
- `createOrder` checks `information_schema.columns` for the new columns. If
  0061 is not applied it runs the previous insert unchanged; checkout and
  payment never fail because of the migration.
- The account order detail, receipt, `OrderDocument` (invoice) and the
  store-admin order read the snapshot first and fall back to the live label
  for orders created before 0061 (`src/lib/orders/option-snapshot.ts`).

### 6. Deliberate absence of "Only N left"

The storefront payload intentionally carries no stock counts (`on_hand`,
`reserved`, `lowStockThreshold`, `availableStock` are excluded and the public
availability API hides them). A per-option "Only N left" would have to expose
an exact count, so it is **not shown**. `isLowOptionStock` always returns
false, and a purchase of an exhausted row says "Out of stock for this option."
This is a presentation consequence of the locked no-counts invariant, recorded
here so it is not mistaken for a missing feature.

## Verification (5 November 2026)

| Check | Actual result |
| --- | --- |
| `npm test` | **1,693 tests: 1,609 passed, 0 failed, 84 skipped, 0 cancelled** |
| `npm run typecheck` | Passed (`tsc --noEmit`, no output) |
| `npm run build` | Passed; static and dynamic routes generated (same set as Phase 2) |
| `check:store-admin-routes` | **122 routes guarded** |
| `check:account-routes` | **21 account APIs and 11 pages** pass |
| `check:admin-boundary` | Passed |
| `npm audit --json` | **0 vulnerabilities** (info/low/moderate/high/critical all 0) |
| `git diff --check` | Clean; LF→CRLF advisories only |

New and extended tests:

- `tests/customer-option-selection.test.mjs` (14) — steps, model-only and
  colour-only, exact-row resolution and refusals, model switching, cheapest
  headline and sale price, shown equals charged, normal vs sale availability, gallery
  switching and fallback, URL round trip, rendered markup (radiogroups,
  disabled "Stock not available", no disabled state in sale mode, names and the
  live announcement), and the page's reserved gallery, preload and URL sync.
- `tests/order-option-snapshot.test.mjs` (4) — snapshot label/colour/photo
  helpers and the receipt/invoice/detail/admin rendering paths.
- `tests/selected-variant-stock.test.mjs` — two new cases: 0061 present writes
  the exact model/colour/price/photo and never rewrites it; 0061 absent keeps
  the previous insert and still reserves stock.
- `tests/order-items.test.mjs` and `tests/payu-db-pricing.test.mjs` — snapshot
  mapping on parent and variant lines.
- Existing suites were updated where the customer flow changed shape
  (`purchase-ui-actions`, `stock-behaviour`, `checkout-phaseA`,
  `customer-document-routes`, `shared-reference-retention`, the payment
  catalogue fixture, and the source assertions in
  `customer-variant-inventory` / `storefront-phase3`); no production guard was
  weakened to make a test pass.

## Pending gates

- **Migrations 0055–0061 are applied** (2026-11-05) to the live Supabase
  database after the user approved that exact target. 0055–0057 had already
  been applied; 0058–0061 were applied in this session. No order has been
  placed since, so no order yet stores an option/photo snapshot. See
  `docs/migrations-pending.md` for the target, row counts and verification.
- **No database integration run.** SQL-backed option tests remain part of the
  84 skipped tests.
- **No authenticated browser acceptance.** The selector is proven by rendering
  the real component in the offline fixture, not by a signed-in session against
  a live database.
- **No commit or push was made for Phase 3.** Stop and await "continue".
