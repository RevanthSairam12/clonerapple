# Gadzio: Simple product options, final plan (models, colours, price and stock in one table)

**This file replaces `PRODUCT_OPTIONS_SIMPLE_PLAN.md`. Delete the old file from the repo so the agent reads only this one.**

**Goal:** an owner adds a product, picks phone models and colours from two shared lists, types a price and a stock number for each real combination in ONE table on the product page, and publishes. Customers pick a model and a colour, see that colour's photo, the right price and availability, and can filter category pages by phone model and colour using the same data.

**How to use this file**
1. Save it in the repo root as `PRODUCT_OPTIONS_FINAL_PLAN.md` and commit it, so the agent can always re-read it.
2. Paste the starter message (at the bottom) once per phase. Phases run in order. Each ends with a report and the agent waits for you to say "continue".
3. This plan replaces Phase F1 of `PRODUCT_EDITOR_FINISH.md`. Phases F0 (secure the work), F2 (real-database acceptance) and F3 (rollout) of that file still apply and are reused in Phase 0 and Phase 6.

---

## Decisions already made (the agent must not ask these again)

| Topic | Decision |
|---|---|
| Device Model Catalogue | Bulk **CSV import** and bulk **paste** are both supported. Owners can add, rename, deactivate and manage models. |
| Seeding | **Never seed or invent device models.** No migration, script, fixture outside a throwaway test schema, or default data may create a phone model. Every model in the catalogue comes from an owner. |
| Option price editing | **Unlocked.** Each option can have its own price and sale price, every change is audited, and every change is kept in a price history. |
| Sold-out option, normal mode | Shown **disabled with "Stock not available"**. Never hidden. |
| Sold-out option, sale mode | Never disabled or marked unavailable in the UI; the stock check happens only at Add to Bag, Buy Now and Pay. |
| Per-colour photos | **Yes.** Selecting a colour switches the gallery to that colour's photos. |

## The idea in one picture

```text
SHARED LISTS (set up once by an owner, reused by every product)
  Phone models:  Apple -> iPhone 15, iPhone 16, iPhone 17, iPhone 18 ...
  Colours:       Black #000000, Red #D32F2F, Blue #1565C0 ...

ONE PRODUCT (everything on the product page)
  Gadzio Back Case   base price Rs 100
    Options table (one row per thing you really sell)
      Model        Colour   SKU          Price   Stock   Active
      iPhone 16    Red      GBC-16-RED   100     10      yes
      iPhone 16    Black    GBC-16-BLK   120     5       yes
      iPhone 17    Black    GBC-17-BLK   120     8       yes
    Photos per colour: Red photos, Black photos, plus default photos

CUSTOMER
  Picks model, then colour -> sees that colour's photos, that row's price and availability
  Category page filter: "Phone model: iPhone 17" and "Colour: Black"
  -> built from the same table, so filters and the product page always agree
```

## Words used in this plan (one meaning each)

| Word | Meaning |
|---|---|
| **Model** | An exact phone from the shared list (for example iPhone 17) |
| **Colour** | A colour from the shared list, with a name and a hex code |
| **Option** | One row in the product's table: a model and/or colour (or another choice such as wattage) that a customer can buy |
| **Stock** | How many of that option you have |
| **Base price** | The product's default price, used by any option whose price is blank |

No product types, field mappings or starter setup are needed for any of this. They stay available under Advanced.

## How this differs from today

| Today (per your guide) | New |
|---|---|
| Six sections; price, options and stock on different steps | Price, options and stock are one table |
| Option prices are locked | Each option has its own price and sale price, audited, with history |
| Two stock modes you must switch deliberately | In options mode, stock is always per row; the parent count is hidden |
| Compatible devices and sellable options are two ideas | The models in the table ARE the compatibility; "fits several devices with one shared stock" stays as an advanced switch |
| Colours are free text | Shared colour list with hex code and no spelling duplicates |
| One gallery per product | Photos per colour, switching when the customer picks a colour |
| Filters are not built from model data | Category and search filters read the same options and models |
| Phone models typed one at a time | Bulk paste and CSV import by owners, with preview |

---

## Common rules (apply to every phase)

1. This file is self-contained. Never print secret values (database URLs, keys, passwords); report names and counts only.
2. Report findings before changing code. Each phase: inspect, build, test, then a short report with real results; stop and wait for me to say "continue".
3. You may ask me decisions with AskUserQuestion: up to 4 questions per call, 2 to 4 options, your recommendation first and marked "(Recommended)". Do not ask what is in "Decisions already made" or what you can find in the code. If I do not answer, take the conservative option for anything that moves money or deletes data and record it in `OPTIONS_NOTES.md`.
4. Do not apply migrations, seeds or backfills, write to real business tables, or run the real-database fixtures without my explicit approval of the exact target. Tell me the database host name (never the full URL or credentials) and row counts first. Never lose work: keep uncommitted changes, never use destructive git commands.
5. The server is authoritative for price, stock and status. The price shown must equal the price charged. All money is integer paise; times use the database clock.
6. Migrations are additive and numbered after the current last file; row level security on every new table; existing orders, stock movements, SKUs, variants, price rows and audit rows are never rewritten or deleted. Data migrations are idempotent and dry-run first with counts reported.
7. Reuse what already exists (device models, variants, stable identities, SKU rules, stock movements, reservations, checkout resolution, retirement and replacement, the price-change guard). Do not build a second device list or a second stock engine.
8. Customer-facing UI matches the home page style (header, footer, fonts, colours, spacing, buttons, cards), responsive at 1440, 768 and 390 px, accessible (contrast, keyboard, labels; a colour swatch always also shows its name, never colour alone; every photo has alt text). Admin UI uses plain words, help text on every field, no jargon. Every store-admin API keeps its role check and same-origin check on changes and writes an audit row without secrets or personal data.
9. Do not touch the Education Store. Keep sale mode, coupons, shipping charge, reservations, maintenance mode and notifications working.
10. DB-backed tests must really run and may only write to a throwaway schema or a disposable database I approve. Report passed, failed and skipped; a skipped test is not a pass.
11. Every phase ends with the full `npm test`, typecheck, build, all check scripts, `npm audit`, `git log --oneline` and `git status`. Update `FEATURES.md` with real results. If an API or quota error interrupts you, stop and tell me the exact step you reached.

---

## Phase 0: Audit and safety (read-only, plus saving the work)

1. If `PRODUCT_EDITOR_FINISH.md` Phase F0 is not done, do it first: commit the uncommitted work in logical commits, push to a backup branch (not main), run the full suite and build, and report.
2. Report what exists today, with file names: the variants and options tables (columns for model, colour, hex, price, sale price, SKU, stock), the device models and brands tables and their management screen and APIs, how colour and hex are stored now, how photos are stored and linked to a product and whether any link to a variant or colour exists, the product editor sections and which one holds options, price and stock, the **price lock** on option prices (what exactly it blocks, in the UI, the API and the database, and what unlocking it requires), price history today (is there a table, does it carry an option id), the stock modes and how an owner switches them, the storefront selector and gallery, how category page filters work today (if at all), search, and how checkout and the order line resolve a variant.
3. State which of these already work end to end and which do not: per-option price in the cart, checkout and PayU amount; per-option stock claim and release; model-specific variants; retirement and replacement; the availability endpoint per variant.
4. List the unapplied migrations (0055 to 0057 and any since) and everything that fails closed without them.
5. Write `OPTIONS_NOTES.md` with the findings, the gaps against this plan, and the plan for each phase. Then ask me ONLY the questions that are still open:
   - Can store admins add a model or colour inline from the product page (create only), while owners alone rename, deactivate and manage? (Recommended: yes.)
   - Maximum size of a CSV or paste import. (Recommended: 2,000 rows and 1 MB.)
   - When an option price change is large, require a confirmation: for example a drop of more than 50 percent, a rise of more than 100 percent, or a price below cost. (Recommended: yes, as a confirmation, never a block.)

**Done when:** the work is saved on a backup branch, the report is on the page, and I have answered the open questions.

---

## Phase 1: Shared lists - Device model catalogue and Colours

Goal: two shared lists that are easy to fill, hard to mess up, and available from inside the product page.

### 1A. Device model catalogue (reuse the existing screens, tables and relationships)

1. **Owner management.** Owners can add brands and models, rename them (stable identities and every product reference are unchanged), deactivate and reactivate them, set the sort order, and see which products use a model. Inline add from the product page follows my answer in Phase 0. Every change is audited.
2. **Bulk paste.** A box where an owner pastes one model per line and chooses the brand once, or pastes "Brand, Model" lines. Preview before anything is saved: which rows are new, which already exist (shown as "Already in the list"), which are near-duplicates ("Did you mean iPhone 16 Pro?"), and which are invalid, each with a plain reason. The owner confirms; only the new valid rows are created.
3. **Bulk CSV import.** A downloadable CSV template and an upload for owners with these columns: `brand`, `model`, optional `sort_order`, optional `active` (yes or no). Rules: UTF-8, header row required, trimmed values, size limit per my Phase 0 answer, rejected file with a clear message if the header or encoding is wrong. The same preview step as paste (new, existing, near-duplicate, invalid, with row numbers), a downloadable error report CSV for rejected rows, and an explicit confirm. Applying creates only new rows; it never overwrites an existing model's name or status. Re-uploading the same file changes nothing the second time.
4. **CSV export.** Owners can export the current catalogue as CSV. Cells that start with `=`, `+`, `-` or `@` are neutralized so the file cannot run a formula when opened in a spreadsheet; imports apply the same check.
5. **Duplicate prevention everywhere** (paste, CSV, single add, inline add): compare on a normalized form (lowercase, ignore spaces, hyphens and punctuation, same brand). Exact duplicates are blocked; near matches get "Did you mean...?".
6. **No invented data.** No migration, script, default or fixture may create a phone model or brand outside a throwaway test schema. A test must fail if any seed creates one.
7. **Safety:** owner only for bulk actions, rate limited, same-origin checked, one audit row per batch with counts (not the full text), atomic apply, a batch that fails midway leaves nothing half-created. Deactivating a model hides it from new selections and from new filters but never changes existing options, orders or stock; a model used by active options shows a clear warning that lists them.

### 1B. Colours (new shared list, additive migration with row level security)

1. Fields: name, hex code (validated, stored uppercase, for example `#D32F2F`), sort order, active. A Colours page in Store Admin with the same owner management, bulk paste ("Red #D32F2F" per line), CSV import and export, duplicate prevention on normalized name and on identical hex, and inline **Add colour** inside the product page (per my Phase 0 answer).
2. Existing free-text colour values on variants are linked to the shared list by a dry-run-first, idempotent script that proposes matches by normalized name and hex, reports conflicts, and never changes a variant's SKU, price or stock; unmatched colours stay as they are and are listed for me.
3. Swatches wherever colours are chosen use the hex code plus the name as text.

### 1C. Tests
Paste and CSV preview and confirm; template and error report; wrong header, wrong encoding, oversized file, formula-looking cells; exact and near duplicates; re-import is a no-op; owner versus store admin permissions; atomic apply under a forced failure; deactivation effects; no seeded models anywhere; hex validation; colour text migration idempotent; inline add keeps the product draft; audit rows.

**Done when:** an owner can paste or upload a list of iPhone models and a list of colours and review a preview, they appear with no duplicates, and nothing was invented by the system.

---

## Phase 2: The product page - one Options, price and stock table

Goal: replace the separate price, options and stock steps with one clear section.

1. **Sell by** selector: *One item* (single price and stock, as today), *By colour*, *By model*, *By model and colour*, *By another option* (a free name such as "Wattage" with values such as 25W and 35W). Stock is entered per row in every options mode; the parent stock box is hidden and the product can never count the same units twice.
2. **Pick models and colours** from the shared lists (search, group by brand, "select all for this brand" as a convenience that is never pre-applied, inline Add model and Add colour). Nothing is selected by default.
3. **The table** (one row per real combination): Model, Colour (swatch and name), SKU (auto-suggested from an editable pattern, unique across every current and retired SKU), Price, Sale price, Stock, Active, History, Remove. A blank price means "use the base price" and shows that price in grey. Warnings in plain words: no price, zero stock, duplicate SKU.
4. **Fast entry:** "Set the same price for all", "Set price by colour" (Red 100, Black 120), "Set stock for all", paste from a spreadsheet, and keyboard-friendly navigation. Adding a colour or model later proposes only the missing combinations; a cap of 60 generated rows at a time with a clear message; new rows start inactive until I enter stock and turn them on.
5. **Option pricing, unlocked and audited:**
   - Store admins and owners can edit each option's price and sale price; viewers cannot. Remove the lock in the UI, the API and anywhere else it exists, and explain in `OPTIONS_NOTES.md` exactly what was changed.
   - Effective price = option price, else base price. The sale price must be above 0 and below that option's effective price (plain-word error otherwise). Sale price applies only while sale mode is live.
   - **Price history:** every change to an option's price or sale price appends a history row (option id, old and new price, old and new sale price, who, when, optional reason). It is append-only, shown on the row under "History" and in a product price history list, and never edited or deleted. Each change also writes an audit row.
   - **Large-change confirmation** per my Phase 0 answer: a clear confirmation before saving a drop or rise beyond the limit, or a price below cost, never a block.
   - The price-change guard continues to protect customers: a cart holding an option whose price changed is re-priced and the customer must review before paying; the price shown always equals the price charged.
   - Every consumer uses the one shared price resolver: product page, category cards ("From Rs X" when prices differ), search, cart, checkout, PayU amount, order line (the price actually charged is stored per option), coupons (on line totals), shipping threshold (on line totals), POS (shows the option's effective price as a reference; staff still type any price), reports and invoices.
6. **Stock:** every change is an append-only movement with a reason (opening count, correction, receipt). The product shows total stock and the count of active options. A stale save never overwrites another editor's change (conflict message, draft kept).
7. **Photos per colour:** in the same section, each colour used by the product has a **Photos** button to attach photos from the Media screen (or add new), set the main one and order them, with alt text per photo. Photos belong to the product and the colour, not to a model, so they appear for every model in that colour. A colour with no photo falls back to the product's default photos. Removing a photo from a colour never deletes the file or the other uses of it.
8. **Rules kept from the current system:** stable identities, saved SKUs never silently rewritten, "Remove" on a saved row archives it (and replacing creates a new identity) without deleting orders, stock history, price history or SKUs; a model used by active options cannot be removed from the product (the message names the options); reserved units are respected when stock is lowered.
9. **Existing products:** products with options open in the same table; single-stock products stay "One item" and change nothing; anything that does not fit (for example tracked stock on both parent and options) is flagged "Needs review" and never silently altered. Dry-run report first.
10. **Plain words everywhere** ("Limit my stock", "In stock", "Held in checkouts", "Available to buy"). Add "Duplicate product" (copies details, description, chosen models and colours and colour photos into a new draft with new SKUs, zero stock and no price history).
11. **Tests:** every "Sell by" mode; generator limits and missing-only behaviour; SKU uniqueness against retired SKUs; price precedence; price by colour; unlocked permissions (admin and owner yes, viewer no); price history rows for every change and none for no-ops; append-only history; large-change confirmation; the price shown equals the price charged for every option and every consumer; price-change guard after an edit; stock movements; colour photos attach, order and fall back; archive and replace; the removal message; existing-product display; duplicate product; stale-save conflicts; draft kept across steps.

**Done when:** I can create the "red = 100, black = 120" case with a stock number and photos for each colour on one page, save, reopen it unchanged, and see every price change in its history.

---

## Phase 3: The customer product page

1. A two-step selector: **Model** first, then **Colour** (swatches with their names). Only the rows I made active are offered; combinations that do not exist are not offered. If a product sells by colour only or by model only, only that step shows.
2. **Colour photos:** selecting a colour switches the gallery to that colour's photos immediately (main photo first, then the rest, with their alt text); with no colour chosen, the default photos show; a colour with no photos keeps the default gallery. Fast and without layout shift (reserve the gallery size; preload the next photo); the cart line, order line and order summary show the photo of the chosen colour, and the order stores that photo reference as a snapshot.
3. The price (and strike-through if a sale price is live), availability and add-to-bag button always describe the exact selected row. Before the customer chooses, show "From Rs X" when prices differ.
4. **Availability rules (locked):** in normal mode a sold-out option stays visible but is **disabled with "Stock not available"** and cannot be added; in sale mode nothing is disabled or marked unavailable and the stock check happens only at Add to Bag, Buy Now and Pay ("Out of stock" or "Only N left" for that exact option).
5. The bag, checkout, order, receipt and invoice carry the exact option (SKU, model, colour, price charged) as a snapshot, so renaming a model or replacing an option never changes an old order.
6. Responsive at 390 px, keyboard and screen reader friendly (the selected colour is announced by name); the selection (model and colour) is in the URL so it can be shared and the photos match when the link is opened.
7. **Tests:** selector states; gallery switching and fallback; price and availability per row in normal and sale mode; the disabled "Stock not available" state in normal mode; the add-to-bag action cannot substitute another option; the price shown equals the price charged; snapshot of option and photo on the order; URL round trip; accessibility structure.

**Done when:** a customer can choose iPhone 16 and Red, see the red photos and 100, choose Black, see the black photos and 120, and the bag and the order show exactly that.

---

## Phase 4: Filters that use the same data

1. **Category pages:** filters for **Phone model** (grouped by brand), **Colour** (swatches with names) and **Price**. A filter value appears only if at least one active option in that category matches it, with a count. Choosing filters narrows the products, shown with the usual cards ("From Rs X", or the price for the chosen model and colour; with a colour filter active the card shows that colour's photo when it has one). Filters combine; a "Clear all" link; the choice lives in the URL; an empty result has a clear message.
2. **Rules:** a product matches a model filter when it has an active option for that model (or, for products set to "fits several devices with one shared stock", when that model is in its compatibility list). Deactivated models do not appear as filter values. In normal mode a sold-out match stays listed and shows "Stock not available" on its card; in sale mode it is never marked.
3. **Search:** typing "iphone 17" in the header search matches products by model (this ties into the search suggestions in `PHASES_UX_FIXES.md`, C2).
4. **Performance:** filter lists and counts come from bounded, indexed queries (the database pool is small), cached briefly but never across sale states; index additions go in an additive migration reviewed before applying.
5. **UI:** matches the existing category page style; a filter drawer on mobile; accessible controls.
6. **Tests:** filter lists contain only values that exist in that category; counts are correct; combinations; sold-out behaviour in both modes; archived, inactive and draft products never match; deactivated models never listed; colour photo on cards; URL round trip; query count is bounded.

**Done when:** on a category page, choosing "iPhone 17" shows only products that actually have iPhone 17 options, and the colour filter shows only colours that exist for that choice.

---

## Phase 5: Inventory and orders stay correct

Check and fix, with real tests:
1. Checkout claims stock for the EXACT option, releases it exactly once on payment failure, cancellation, expiry and auto-cancel, and consumes it without a second deduction after verified payment; a late or duplicate callback never deducts or releases twice; returns and refunds restock only the right option, never more than was sold.
2. Two buyers of the last unit of one option produce one order; different options never block each other.
3. Low-stock warnings, the Stock and Low-stock reports and the Sale page work per option; the orders list, order detail, packing slip and invoice show model and colour; POS lets staff pick the model and colour and type any price, using that option's stock.
4. Admin shows total stock per product and per option, with movement history, and price history per option.
5. A price edit never changes an existing order, a coupon redemption already reserved, or a reservation already held; the next purchase uses the new price.
6. **Tests** for every path above on a real database (see Phase 6); offline tests alone are not enough here.

**Done when:** every stock number in the admin matches what the ledger says after every kind of order outcome, and every price an order was charged matches its stored line.

---

## Phase 6: Real-database proof, guide and rollout

1. Reuse `PRODUCT_EDITOR_FINISH.md` Phase F2: a disposable database that I provide, a migration rehearsal on a copy of the real data (including the new migrations from Phases 1 and 2), the approved integration fixture, real concurrency checks and an authenticated end-to-end browser run: an owner imports models by CSV and pastes colours, creates the red 100 and black 120 case with stock and colour photos, publishes; a customer filters by model, picks a colour (the gallery switches), checks out in test mode with simulated PayU callbacks; stock changes only for that option; the admin shows the price history.
2. Reuse Phase F3: a written rollout plan with backup, maintenance window, migration order, smoke checks, rollback limits and a first-week watch list.
3. Write the one-page owner guide "Add a product with models and colours" with screenshots (including the CSV import), replacing the long guide (move the old material to an Advanced appendix), and update all in-app help text to the plain vocabulary.
4. Final evidence in `FEATURES.md`: test counts, check results, migrations in order, and anything not built.

---

## Decisions still open (the agent asks these in Phase 0)

| Question | Suggestion |
|---|---|
| Can store admins add a model or colour inline (create only)? | Yes; owners alone rename, deactivate and manage |
| Maximum import size | 2,000 rows and 1 MB |
| Confirmation for large price changes | Yes, a confirmation (never a block) for a drop over 50 percent, a rise over 100 percent, or a price below cost |
| Cap on generated option rows | 60 at a time |
| "Fits several devices with one shared stock" | Keep as an advanced switch on the product |

## What only you can do
1. Enter the phone model list (paste or CSV) and the colour list; the system will not create any model for you.
2. Provide a disposable database for Phase 6 and approve its manifest; never the live store database.
3. Take and verify a backup of the real database before any production migration.
4. Provide the colour photos and enter real stock numbers through the new table after rollout.

## Starter message

```text
Read PRODUCT_OPTIONS_FINAL_PLAN.md in the repo root (it replaces PRODUCT_OPTIONS_SIMPLE_PLAN.md).
Follow its Common rules and its "Decisions already made". Do Phase 0 only: secure the work if
it is not already on a backup branch, report what exists today, write OPTIONS_NOTES.md, and ask
me only the decisions still open. Do not change product code yet. Stop and wait for me to say
"continue".
```

For later phases, replace "Phase 0" with the next phase number.

## Manual checks after each phase
- **1:** paste five phone models; upload a small CSV with one duplicate spelling ("iPhone16 pro") and check the preview warns you; upload the same file again and check nothing changes; try a CSV cell starting with `=`; add colours with hex codes.
- **2:** create a case with models and colours; type Red 100 and Black 120; give each row a stock number and photos per colour; save and reopen; change a price and open History.
- **3:** open the product as a customer on a phone-sized window; pick a model, then Red, then Black and watch the photos, price and availability change; set one option's stock to 0 and check it shows "Stock not available" and is disabled.
- **4:** on the category page choose a model filter and a colour filter; check only real combinations appear and the card shows the colour's photo.
- **5:** buy the last unit of one option in two browsers at once; check only that option's stock changes and only one order succeeds; edit a price while a cart holds the item and check the customer is asked to review.
