# Product options Phase 4 — filters that use the same data — 5 November 2026

**Implemented and offline-verified. No new migration, index or write path.**

## Done-when scenario

On a category page, choosing **iPhone 17** returns only products that carry an active
iPhone 17 option (or, for a product sold as one shared stock, list iPhone 17 as a
compatible device). The colour list under that choice contains only colours that exist
on those options, with counts. Both are asserted in
`tests/category-option-filters.test.mjs`, including a full `CollectionPage` render with
`?model=…`.

## What the customer gets

### 1. Three option filters, built from the same data

- **Phone model**, grouped by brand with a per-model count.
- **Colour**, as a named swatch, a hex decoration and a count.
- **Price**, in four bands: Under ₹1,000, ₹1,000–₹2,499, ₹2,500–₹4,999, ₹5,000 & above.

A value is only offered when at least one active option in that category matches it.
Each facet's counts are computed over the products that pass the *other* active filters,
so under a chosen model the colour and price lists describe exactly what can still be
shown. Unknown or stale values in the URL are dropped rather than producing an empty page.

### 2. How a product matches

- Products sold by options match a model through their active, non-retired option rows.
  A model that is deactivated, or whose brand is deactivated, is never a filter value and
  never matches.
- Products sold as one shared stock match through their compatibility list.
- Archived, inactive and draft products are excluded upstream by the catalogue read; the
  filter engine never sees them.

### 3. Cards follow the choice

With a model and/or colour chosen, a card shows that exact option's price — never
"From ₹X" — and that option's sale strike-through. A chosen colour shows that colour's
photo when one is linked, otherwise the product gallery. A matched but sold-out option
keeps the card in the grid and labels it **Stock not available** in normal mode; while a
sale is live the card is never marked unavailable.

### 4. URL, combination and clearing

The selection is stored as repeated `?model=`/`?colour=`/`?price=` params, written with
`history.replaceState` while preserving unrelated params. A shared link or a reload
restores the same grid. Values combine with OR inside a kind and AND across kinds.
**Clear all** (chips, sidebar and the empty state) empties both the URL and the grid. An
empty result says the filters matched nothing and offers the same clear action.

### 5. Search by model

The header search already indexes compatibility model names in each product's keywords,
so "iphone 17" matches a product whose active options or compatibility list include that
model. A deactivated model is not matched. Tests prove both directions; no search code
changed.

### 6. Performance and caching

The facets are computed from the catalogue the page already loads — still exactly 9
bounded queries, covered by the existing indexes on `product_device_models`,
`product_variant_colours` and `product_images`. The snapshot is cached for 30 seconds and
carries regular prices only; sale state is applied per request and the cache key moved to
`phase-b2-option-prices-v3`, so a sale can never be served from a stale cached price.

### 7. UI and accessibility

The new sections sit in the existing sidebar and the existing mobile drawer. Each control
is a real checkbox inside a labelled group; the Phone model section nests one
`role="group"` per brand with an `aria-label`. Chips name their filter and offer a remove
button; counts are text, not colour-only. Layout checked at 1440/768/390 through the
existing collection styles.

## Verification (5 November 2026)

| Check | Real result |
|---|---|
| `npm test` | **1,706 tests / 1,622 pass / 0 fail / 84 skipped** |
| New filter suite | **13/13 pass**, including the rendered page harness |
| Affected legacy suites | 82 pass, 1 skipped, 0 fail |
| `npm run typecheck` | pass |
| `npm run build` | pass (only the pre-existing external-lockfile warning) |
| `check:store-admin-routes` | all **122** routes guarded |
| `check:account-routes` / `check:admin-boundary` | pass |
| `check:notifications` | **3 pass / 5 fail** — mail and SMS unconfigured; no message sent |
| `npm audit` | **0 vulnerabilities** |
| Live read (read-only, one connection) | 6 categories / 15 products; 1 active device model, 0 compatibility links, 0 variant-model links, 0 colour links and 0 colour photos, so the model and colour sections correctly offer no values until options exist; price bands populated for all six categories |

No connection string, key or token was printed. Nothing was written; no migration or
index was applied. The 84 skips still need an approved disposable database.

## Pending gates

- Data entry: the live catalogue has no option rows yet, so the model and colour filters
  stay empty until products get options or compatibility links in store admin.
- Authenticated browser acceptance at 1440/768/390 with real option data.
- The 84 database-dependent tests remain skipped.
