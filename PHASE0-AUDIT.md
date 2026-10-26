# Phase 0 — Storefront data ownership and the admin boundary

**Completed:** 26 October 2026. This is the Phase 0 deliverable of
`dynamicpaln.md`: the legacy CMS was audited, product/commerce data was given
one owner (Store Admin), and the boundary between the two panels is now
enforced and tested.

**Short version.** The legacy CMS registry never contained a product, price,
SKU, stock, order, customer or shipping field outside the Education Store.
`cases.*` holds page furniture, the OPPO blocks hold marketing cards with no
commerce identifiers, and no homepage product carousel exists to re-point.
Phase 0 therefore concentrated on making that boundary explicit and durable:
a shared validator, a boundary check script, non-destructive archiving, a
merchandising collection owned by Store Admin, a one-way CMS → catalogue
migration planner, and a shared media source. No storefront route, layout or
copy changed.

---

## 1. Audit method

Read-only at first, against the working tree and the live database:

- `src/app/(admin)/admin/**` — the legacy CMS screens.
- `src/app/api/admin/**` — the legacy save, settings and media APIs.
- `src/lib/admin/*` — the `COLLECTIONS` registry, defaults and helpers.
- Every `content_blocks` row reachable through `.env.local`.
- The storefront readers that consume those keys (`src/lib/content.ts` and the
  page components).
- The two media paths: legacy `media` and Store Admin `store_media`.

The classification rule is the one in the plan: a field is **product/commerce**
when it carries a product identity, price, cost, SKU/variant, stock, discount,
order, payment, customer or shipping value. Campaign copy, links, imagery and
layout are **design/marketing** even when they advertise a product.

## 2. Audit table

`COLLECTIONS` currently declares 34 collections: 9 Apple, 3 Cases &
Protection, 11 OPPO and 11 Education Store. `THEME_FIELDS` declares 6 settings.
That is 143 non-Education field paths checked by
`scripts/check-admin-boundary.mjs`.

| Key / field(s) | What it controls | Classification | Decision |
|---|---|---|---|
| `apple.hero_tiles` — `heroTiles[].headline`, `subheadText`, `href`, `ctas[]`, `infoTooltip`, responsive `image*Src` | Homepage hero tile carousel copy, links and imagery | Design / marketing | Stays in legacy CMS |
| `apple.hero_video` — `image*Src`, `clips[].label/src/left/width` | Homepage hero image fallback and video clips | Design | Stays |
| `apple.promo_section` — `heading`, `promoTiles[]` copy, links, images | Homepage promo tiles | Design / marketing | Stays |
| `apple.ribbon` — `text`, `shopHref` | Announcement ribbon and its link | Design / marketing | Stays |
| `apple.locale_banner` — `copy`, `selectedLabel`, `continueLabel`, `continueHref` | Locale banner copy and links | Design | Stays |
| `apple.nav` — `searchPlaceholder`, `items[].label/href` | Search placeholder and nav labels/links | Design / marketing | Stays |
| `apple.footer` — `footnotesHtml`, `copyright`, `localeLabel`, `localeHref` | Footer copy and locale link | Design | Stays |
| `apple.gallery` — `heading`, `secondRowEnabled`, `items[].title`, `image*Src` | Homepage gallery headings and image tiles | Design / marketing | Stays |
| `apple.seo` — `title`, `description`, `ogTitle` | Homepage metadata | Design / marketing | Stays |
| `oppo.announce` — `text`, `linkLabel`, `linkHref` | OPPO announcement bar | Design / marketing | Stays |
| `oppo.nav` — `logoText`, `leftLinks[]`, `rightLinks[]` | OPPO site navigation | Design | Stays |
| `oppo.hero_slides` — `slides[].title/subtitle/image`, `learnMoreHref`, `buyNowHref` | OPPO hero carousel copy, imagery and links | Marketing | Stays — links only; no id, price or stock |
| `oppo.hot_sale` — `badge`, `title`, `tagline`, `image`, `learnLabel`, `buyLabel` | OPPO hero promotion | Marketing | Stays — no price, SKU or id |
| `oppo.products` — `items[].title/titleSup/image/descriptions/learnHref/buyHref` | Hand-authored OPPO product cards | Marketing | Stays by rule — no product id, price, stock or discount. Not a catalogue reference. |
| `oppo.offers` — `heading`, `items[].title/description/image/href` | OPPO offer tiles | Marketing | Stays |
| `oppo.explore` — `heading`, `items[].title/description/image/href` | OPPO explore tiles | Marketing | Stays |
| `oppo.support` — `heading`, `items[]` | OPPO support links | Marketing | Stays |
| `oppo.community` — `heading`, `viewAllLabel`, `tagline`, `cards[].title/subtitle/image` | OPPO community cards | Marketing | Stays |
| `oppo.footer` — `disclaimer1..3`, `tagline` | OPPO legal copy | Design | Stays |
| `oppo.seo` — `title`, `description` | OPPO metadata | Design / marketing | Stays |
| `cases.category_links` — `items[].label`, `items[].href` | Cases & Protection category tabs | Design / marketing | Stays. The old inline product override type was removed. |
| `cases.page_header` — `title`, `sortLabel` | Cases & Protection heading and sort label | Design | Stays |
| `cases.seo` — `title`, `description` | Cases & Protection metadata | Design / marketing | Stays |
| `edu.*` (11 collections) — hero, product nav, eight shelves, quick links; each card has `headline`, `tag`, `desc`, `price`, `image`, `href`, `dark`, `savingsBadge` | Education Store content, including display prices | Commerce-shaped, but Education Store | **Left alone by rule.** Exempt in the validator and the boundary checker. |
| Theme — `fontFamily`, `logoText`, `appleCopyright`, `oppoPrimaryColor`, `oppoGreenDark`, `oppoGreenLight` | Typography, logo text, colours, copyright | Design | Stays in legacy CMS |

## 3. The known suspects

**`cases.*`.** Only three keys exist, all page furniture. The old
`CasesProductOverride` type (inline name, subtitle, price, price display, image,
badge, href) was removed from
`src/components/sites/cases-protection/admin-overrides.ts`, so the legacy
editor can no longer express a product for that page. Any historical
`products`/`items` array still stored in a row is handled by the migration
planner (§6) — parsed only from `cases.*`, matched only by product id or variant
SKU, never written back by the legacy panel.

**Homepage product carousels.** None exist. The homepage is built from
`apple.hero_tiles`, `apple.hero_video`, `apple.promo_section`, `apple.ribbon`,
`apple.gallery` and `apple.footer`; those blocks carry copy, links and imagery
only. The live database holds exactly those six rows and no `cases.*`, `oppo.*`
or `edu.*` rows at all. There was therefore nothing on the homepage to re-point
in Phase 0. `product_collections` and the storefront read layer are in place so
Phase 1 can attach the first rail without another migration.

**OPPO price / SKU / product id / stock / discount.** None present. The
`oppo.products` cards are marketing copy with a `buyHref` link, not catalogue
records. They stay in the legacy CMS by rule: only commerce fields move.

**Any other non-Education commerce field.** None found in the registry, theme
settings, defaults or legacy APIs.

**Media.** The legacy `media` table and Store Admin's `store_media` already
write the same public Supabase Storage bucket. Phase 0 converged the writes:
the legacy uploader inserts `store_media` with `uploaded_by = 'cms:<id>'`, and
`/api/admin/media/[id]` resolves `store_media` first, then a legacy `media` row.
Existing `/api/admin/media/<id>` URLs keep working, including legacy `bytea`
rows, which still stream with the same CSP. There were 0 media rows at audit
time. One source, no duplicated editor.

## 4. What changed

**Step B — product/commerce data owned by Store Admin**

- `migrations/0033_storefront_collections.sql`: `product_collections`
  (`collection_key`, `product_id`, `position`, `is_active`), RLS enabled with no
  policies, plus `content_blocks.archived_at`. Additive only.
- `scripts/migrate-cms-products.mjs`: dry-run by default; `--commit` writes in
  one transaction. Maps legacy `cases.*` items to products/variants by product
  id or SKU, never by name. Database values win; only empty subtitle,
  description or badge is filled; a primary image is added only when the
  product has no live image; prices are reported, never written. Re-running is
  a no-op (`on conflict (id) do nothing` for images).
- Store Admin → **Collections** (`/store-admin/collections`,
  `/api/store-admin/catalog/collections`): add, remove (archive), reorder.
  Guarded by `requireStoreRole('store_admin')` and `assertSameOrigin`; audited
  as `catalog.collection.*`.
- `src/lib/storefront/collections.ts`: server-only read layer with a cache tag.
  Database membership wins whole; the caller's coded/CMS list is used only when
  the collection is empty, so removing a product in Store Admin cannot be undone
  by an old list.

**Step C — commerce stripped from the legacy panel**

- `src/lib/admin/boundary.ts`: `validateLegacyContentWrite()` rejects a write
  when any non-Education block contains a commerce-shaped key at any depth.
- `/api/admin/content` validates before every save and **archives** a block
  instead of deleting it (`archived_at = now()`); saving it again restores it.
- Content readers ignore archived rows (Supabase REST and `DATABASE_URL`
  paths), and the admin dashboard counts only live rows.
- The legacy media uploader and picker use the shared media source.
- Editor screens continue to show design/marketing fields only; no product
  editor was added there.

**Step D — proof**

- `scripts/check-admin-boundary.mjs` (also `npm run check:admin-boundary`)
  fails if a non-Education legacy field is commerce-shaped, a legacy route
  writes a commerce table, the content route loses or bypasses the validator,
  the content route deletes rows, the media route stops using `store_media`,
  migration 0033 loses its RLS/archive shape, or the legacy tree references
  `product_collections`.
- `tests/admin-boundary.test.mjs`, `tests/product-collections.test.mjs` and
  `tests/cms-product-migration.test.mjs` cover rejection and acceptance shapes,
  ordering, empty-collection fallback, admin reorder validation, migration
  idempotence/RLS, dry-run default, DB-wins and no-name-matching rules.

**Not changed**

- No storefront page, route, layout, class name or copy.
- Education Store content, screens and keys.
- The three identity stores and their cookies.
- Checkout pricing: still resolved fail-closed from the database.
- No content row was deleted.

## 5. What this now guarantees

- The legacy `/admin` panel can no longer change a product name, price, stock,
  variant, order or customer through content. A commerce-shaped payload is
  rejected with a field path such as `items[0].price`.
- Store Admin is the only place catalogue and merchandising data is written,
  through role-guarded, same-origin, audited routes.
- Losing a content row is reversible: archive, then save again or clear
  `archived_at`.
- If the database is unreachable or a collection is empty, the storefront falls
  back to the coded/CMS list and never renders an empty rail.

## 6. Verification

| Check | Result |
|---|---|
| `npm test` | **284 tests, 284 pass, 0 fail** (249 before Phase 0) |
| `node scripts/check-store-admin-routes.mjs` | **All 84 store-admin routes are guarded** |
| `node scripts/check-setting-lists.mjs` | all 12 settings tables readable, 72 notification cells |
| `node scripts/check-admin-boundary.mjs` | 143 legacy fields checked, 11 Education collections exempt, 9 legacy routes, 23 legacy source files — passes |
| `npm run typecheck` | clean |
| `npm run build` | succeeds; `/store-admin/collections` and its API build |
| `npm run db:migrate` | applied `0033_storefront_collections.sql` |
| `node scripts/migrate-cms-products.mjs` | dry run: 0 `cases.*` blocks, 0 items, 0 planned writes (expected — none exist) |

## 7. Caveats and what Phase 1 still owns

- **No storefront consumer yet.** The homepage has no product carousel, so the
  collection reader has nothing to attach to. This is deliberate: Phase 0
  supplies the ownership and API; Phase 1 wires the first rail.
- **Listing and detail pages still render from code** (`FEATURES.md` §2.2–2.4).
  Phase 0 did not move them, per the no-visual-change rule.
- **Education Store display prices remain in `edu.*`** and are exempt. Moving
  them is explicitly out of scope.
- **OPPO marketing cards remain in content.** They carry no commerce data, so
  the boundary leaves them alone.
