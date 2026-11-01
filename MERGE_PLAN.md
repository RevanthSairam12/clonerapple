# MERGE_PLAN — retire the legacy `/admin` panel into Store Admin → **Website**

Status: **Phase A complete — awaiting answers to questions (a)–(h) in §10.**
No application code has been changed. The only new files are this plan and a read-only
counting script that will be deleted before Phase B.

Branch: `newbranchadminall`. Date: 2026-11-01.

---

## 0. Summary

There are two admin panels today:

| | Legacy CMS `/admin` | Store Admin `/store-admin` |
| --- | --- | --- |
| Identity table | `admin_users` | `store_admins` |
| Session table | `admin_sessions` | `store_admin_sessions` |
| Cookie | `admin_session` | `store_admin_session` |
| Roles | none (every user is equal) | `store_owner` ⊇ `store_admin` ⊇ `store_viewer` |
| 2FA | optional TOTP, fully built | **verified at login, but no enrolment UI** |
| Audit | none | `store_admin_audit`, DB-immutable |
| What it edits | `content_blocks` (43 collections) + `site_settings` (theme) | the shop |

The legacy panel is small (8 pages, 9 API routes, 9 library modules) but two of its
library modules are **shared infrastructure used by the rest of the app**: `db.ts` (68
importers) and `api-guard.ts` (103 importers). Removing the panel therefore starts with
relocating those primitives, not with deleting UI.

The storefront is not a risk area: the only reads are `src/lib/content.ts` (public Supabase
REST → `DATABASE_URL` fallback) and nothing in it changes. The merge changes *who writes*
`content_blocks` and *where the screens live*, not the data or the readers.

---

## 1. Phase A.1 — Legacy panel inventory

### 1a. Pages (`src/app/(admin)/admin/`)

| File | What it does | Depends on |
| --- | --- | --- |
| `layout.tsx` | Root layout, loads `admin.css`, `<html>` shell | `admin.css` |
| `login/page.tsx` | Login screen; redirects to `/admin` when a session exists | `lib/admin/auth.getSession`, `AdminLoginForm` |
| `(protected)/layout.tsx` | Session guard (`redirect('/admin/login')`), renders `AdminSidebar` grouped by site from `COLLECTIONS` | `collections`, `auth`, `AdminSidebar` |
| `(protected)/page.tsx` | Dashboard: collection cards + `AdminUiSwitcher` (homepage UI mode) | `collections`, `auth`, `AdminUiSwitcher` |
| `(protected)/content/[key]/page.tsx` | One collection editor; rejects unknown keys | `getCollection`, `getCollectionDefaults`, `getCollectionCurrentArt`, `CollectionEditor` |
| `(protected)/theme/page.tsx` | Theme form (7 settings) | `THEME_FIELDS`, `ThemeEditor` |
| `(protected)/security/page.tsx` | TOTP enrolment / disable + recovery code | `auth.getSession`, `AdminSecurityClient` |
| `admin.css` | `.admin-*` design system (≈ the whole legacy look) | — |

### 1b. API routes (`src/app/api/admin/`)

| Route | Method | What it does | Boundary / auth |
| --- | --- | --- | --- |
| `auth/login` | POST | email+password+TOTP, 5-fail/15-min lockout, sets `admin_session` | public, same-origin |
| `auth/logout` | POST | clears `admin_session` | `requireEditor` |
| `content` | GET/PUT/DELETE | list / upsert / **archive** a `content_blocks` row | `requireEditor` + `assertSameOrigin` + `validateLegacyContentWrite` |
| `settings` | GET/PUT/DELETE | theme read/upsert/delete, whitelisted to `THEME_SETTING_KEYS` | `requireEditor` + same-origin |
| `media` | POST | multipart upload → storage bucket `media`, row in **`store_media`**; returns `/api/admin/media/<id>` | `requireEditor` + same-origin |
| `media/[id]` | GET | public read: `store_media` first, then legacy `media`; 302 to CDN or bytea body + CSP | public by design |
| `totp/setup` | POST | new secret + QR data URI, pending on `admin_users` | `requireEditor` |
| `totp/enable` | POST | verify code, mark enabled, issue recovery code | `requireEditor` |
| `totp/disable` | POST | needs password, clears secret | `requireEditor` |

### 1c. Library (`src/lib/admin/*`) and who imports it

| Module | Importers | Verdict |
| --- | --- | --- |
| `db.ts` — postgres singleton (`max: 5`, SSL, `prepare:false`) | **68** (store-admin, account, checkout, orders, scripts) | **shared infrastructure — must move** |
| `api-guard.ts` — `assertSameOrigin`, `requireEditor` | **103** (`assertSameOrigin` almost everywhere) | **shared infrastructure — must move** |
| `storage.ts` — `storageConfigured`, `publicObjectUrl`, `uploadToStorage` | **5** (both media routes, `/api/media/[id]`, store-admin media) | **shared infrastructure — must move** |
| `totp.ts` — RFC 6238 helpers | **6**: legacy `totp/*` routes + security page + **`src/lib/store-admin/auth.ts` (`verifyTotp`)** + `tests/staff-auth-behavior.test.mjs` | must move (store-admin depends on it) |
| `auth.ts` — legacy login/session/lockout, and **`clientIp()`** | 8: legacy pages/routes + **`src/lib/store-admin/auth.ts` (`clientIp`)** | `clientIp` must move; the rest is removed |
| `boundary.ts` — `findCommerceFields`, `validateLegacyContentWrite`, `edu.` exemption | **1** (`api/admin/content`) + `check-admin-boundary.mjs` + `tests/admin-boundary.test.mjs` | moves to the new Website API |
| `collections.ts` — 43 schemas + `THEME_FIELDS` | 7 (legacy panel only) + `check-admin-boundary.mjs` | moves to Website |
| `defaults.ts` — code defaults for all 43 keys | 1 (legacy content page) | moves to Website |
| `cms-product-migration.ts` — product-import planner (no UI) | `scripts/migrate-cms-products.mjs`, `tests/cms-product-migration.test.mjs`, `check-admin-boundary.mjs` | unrelated to the panel; move to a neutral path |

### 1d. Components (`src/components/admin/`)

| File | What it does | Fate |
| --- | --- | --- |
| `CollectionEditor.tsx` (752 lines) | Generic JSON-path editor: text/textarea/image/video/url/colour/boolean/select, lists with add/remove/reorder, upload to `/api/admin/media`, toast, reset=`DELETE` (archive), `beforeunload` guard | rebuild in Store Admin style |
| `ThemeEditor.tsx` (255 lines) | Theme form, inline `THEME_DEFAULTS`, live font preview | rebuild |
| `AdminSidebar.tsx` | Legacy nav grouped by site | replaced by Website group |
| `AdminLoginForm.tsx` | Legacy login form | deleted |
| `AdminSecurityClient.tsx` | TOTP enrolment UI | rebuild under My profile → Security |
| `AdminUiSwitcher.tsx` | Writes `homepageUiMode` (untracked, current WIP) | rebuild into Website → Theme |
| `json-path.ts` | `parsePath` / `getByPath` / `setByPath` | move as-is |

### 1e. Scripts, checkers, tests, hooks that reference the panel

| File | Reference | Action |
| --- | --- | --- |
| `scripts/check-admin-boundary.mjs` | imports `collections.ts` + `boundary.ts` by absolute path; asserts 7 invariants incl. "`api/admin/content` calls `validateLegacyContentWrite`" and the `store_media` insert | **repoint** at the new Website API/library (§8) |
| `scripts/check-store-admin-routes.mjs` | auto-discovers routes; needs new Website routes added to `EXPECTED_*` sets | extend |
| `scripts/create-editor.mjs` (`npm run db:create-editor`) | inserts/updates `admin_users` | retire; `create-store-admin.mjs` already exists |
| `scripts/release-waitlist-holds.mjs` | imports `src/lib/admin/db.ts` | repoint import |
| `scripts/migrate-cms-products.mjs` | imports `cms-product-migration.ts` | repoint import |
| `tests/admin-boundary.test.mjs` | imports `boundary.ts` | repoint |
| `tests/staff-auth-behavior.test.mjs` | imports `store-admin/auth` (which imports legacy `totp`/`clientIp`) | unaffected once primitives move |
| `tests/maintenance.test.mjs` | asserts `/admin`, `/admin/content`, `/api/admin/content` are always allowed | update to the new paths |
| `src/proxy.ts` | prefilter for `/admin` and mutating `/api/admin` using `admin_session` | delete those branches |
| `src/lib/storefront/maintenance.ts` | allow-list contains `/admin`, `/api/admin` | replace with `/store-admin/website`, `/api/store-admin/website` |
| `FEATURES.md` | documents the legacy panel, "three identity stores", boundary rules | rewrite §4 + diagram + evidence block |

---

## 2. Phase A.2 — Data inventory (counts only; no values, hashes or secrets read)

| Table | Rows | Notes |
| --- | --- | --- |
| `admin_users` | **1** | TOTP enabled on the single account |
| `admin_sessions` | **1**, 0 live | expired |
| `store_admins` | **2** | 1 `store_owner` active; 1 `store_admin` inactive; **0 with TOTP** |
| email overlap legacy↔store | **0** | no account to link by email |
| `content_blocks` | **6 live, 0 archived** | keys: `apple.footer`, `apple.gallery`, `apple.hero_tiles`, `apple.hero_video`, `apple.promo_section`, `apple.ribbon`; 1 distinct editor; none contains a `/api/admin/` URL |
| `site_settings` | **0** | theme is running entirely on code defaults |
| `media` (legacy) | **2** | both storage-backed, 0 bytea |
| `store_media` | **0** | 0 deleted, 0 legacy-URL rows |
| `seo_pages` | **14** | 0 filled (all empty) |
| `store_pages` | **8** | all `draft` |
| `store_settings` | 7 keys | `auto_confirm`, `cod_enabled`, `free_shipping_over`, `maintenance_enabled`, `order_start_number`, `pickup_enabled`, `trade_name` |

Consequences:

* **Nothing references `/api/admin/media/`** in stored content today, but `/api/admin/media/[id]`
  still has to keep resolving (hard constraint 6, and the 2 legacy `media` rows are reachable
  only through it).
* **37 of 43 collections have no stored row.** Their screens will show code defaults; "reset"
  is a no-op for them. No migration of values is needed at all — the merge is code-only.
* The theme has **zero stored values**, so the theme screen's round-trip test is
  "save → storefront changes → reset → storefront returns to defaults".
* Only **1 legacy account** exists, so account migration is one row.

---

## 3. Phase A.3 — Content map (43 collections + 7 theme settings)

Legend for **type**: T=text, A=textarea, I=image (incl. 7 responsive slots), V=video, U=url,
C=colour, B=boolean, S=select. "Commerce-shaped" = the schema would carry a commerce field
name (`validateLegacyContentWrite` is an exact-name matcher, so `priceDisplay`/`amountText`
pass; `edu.*` is exempt regardless).

### 3.1 Homepage `/` — Gadzio sections (new UI), **8 collections, all in the uncommitted WIP**

| Key | Fields | Lists | Consumer | Commerce? |
| --- | --- | --- | --- | --- |
| `gadzio.reviews` | B, T×3, A | `items` ≤9: T×2, A, T×2 | `GadzioReviewsSection` | no |
| `gadzio.in_the_wild` | B, T×2 | `items` ≤18: I, T×2, U | `GadzioInTheWild` | no |
| `gadzio.brand_bar` | B | `items` ≤12: T×2, U | `GadzioBrandBar` | no |
| `gadzio.diwali_campaign` | B, T×4, U, I | `items` ≤12: T×6, I, U | `GadzioDiwaliSection` | no |
| `gadzio.trust_badges` | B | `items` ≤6: T×2 (`icon` is free T), U | `GadzioTrustBar` | no |
| `gadzio.category_grid` | T, B | `items` ≤8: T×2, I, U, T | `GadzioCategoryGrid` | no |
| `gadzio.crowd_favorites` | T×3, U, B | `items` ≤12: T×2, I, U, T×3, T | `GadzioCrowdFavorites` | no |
| `gadzio.event_banner` | T, A, T, U, I, B | — | `GadzioEventBanner` | no |

### 3.2 Homepage `/` — classic sections, **9 collections**

| Key | Fields | Lists | Consumer | Commerce? |
| --- | --- | --- | --- | --- |
| `apple.hero_tiles` | — | `heroTiles` ≤6: T, A, T, 2×CTA (T+U), T, 7×I | `HeroSection` (old UI only) | no |
| `apple.hero_video` | 7×I, B | `clips` ≤3: T, V, T, T | `HeroSection` (old UI only) | no |
| `apple.promo_section` | T | `promoTiles` ≤12: same as hero tile | `PromoSection` (both UI modes) | no |
| `apple.ribbon` | A, U, B | — | `Ribbon` (both modes) | no |
| `apple.locale_banner` | A, T, T, U | — | `LocaleBanner` — **renders only when `bannerVisible` is true, and nothing ever sets it true → currently unreachable** | no |
| `apple.nav` | T (search placeholder) | `items` ≤14: T+U | `GlobalNav` | no |
| `apple.footer` | A (HTML), T, T, U | — | `GlobalFooter` | no |
| `apple.gallery` | T (hint says "not currently displayed"), B | `items` ≤16: T + 7×I | `EndlessEntertainmentGallery`; **no row ⇒ `{enabled:false}` ⇒ hidden** | no |
| `apple.seo` | T, A, T | — | `src/app/page.tsx` `generateMetadata` | no |

### 3.3 OPPO `/android`, **11 collections — ALL DEAD** (route is a "Coming Soon" page; no OPPO component exists; 0 stored rows)

`oppo.announce`, `oppo.nav`, `oppo.hero_slides`, `oppo.hot_sale`, `oppo.products`,
`oppo.offers`, `oppo.explore`, `oppo.support`, `oppo.community`, `oppo.footer`, `oppo.seo`.
Field sets range from one `logoText` to a 16-item product grid. Recommendation: **remove the
editor entries, keep the (empty) key names in the schema constants as `legacy` entries** so a
future OPPO revival does not collide, and archive any row that turns up later.

### 3.4 Education Store `/in-edu/store`, **12 collections**

| Key | Fields | Lists |
| --- | --- | --- |
| `edu.hero` | T, T | — |
| `edu.product_nav` | — | `items` ≤14 cards |
| `edu.shelf_savings` | T, T, B | `cards` ≤20 |
| `edu.shelf_ways_to_save` | T, T, B | `cards` ≤8 |
| `edu.shelf_difference` | T, T, B | `cards` ≤8 |
| `edu.shelf_accessories` | T, T, B | `cards` ≤6 |
| `edu.shelf_potential` | T, T, B | `cards` ≤8 |
| `edu.shelf_more_to_love` | T, T, B | `cards` ≤14 |
| `edu.shelf_experience` | T, T, B | `cards` ≤8 |
| `edu.quick_links` | — | `items` ≤10 (T+U) |
| `edu.seo` | T, A | — |

Card fields (shared): T headline, T tag, A desc, **T `price`**, I, U, B dark, B savingsBadge.
Commerce-shaped by name but **exempt by `edu.` prefix** (unchanged by this task).

### 3.5 Cases & Protection `/in/shop/iphone/accessories/cases-protection`, **3 collections**

`cases.category_links` (list ≤14), `cases.page_header` (T×2), `cases.seo` (T+A). No commerce fields.

### 3.6 Theme (`site_settings`), 7 fields

| Field | Type | Read by | Status |
| --- | --- | --- | --- |
| `homepageUiMode` | S `new`/`old` | `/` → `GadzioHomePage` | **live** |
| `fontFamily` | S `SITE_FONT_NAMES` | `src/app/layout.tsx` (`next/font` allow-list) | **live** |
| `appleCopyright` | T | `/` footer (overrides `apple.footer.copyright`) | **live** |
| `logoText` | T | nothing (OPPO nav is gone) | **dead** |
| `oppoPrimaryColor` | C | `layout.tsx` emits `--oppo-green*` on `.oppo-root`, which no longer exists | **dead** |
| `oppoGreenDark` | C | same | **dead** |
| `oppoGreenLight` | C | same | **dead** |

---

## 4. Phase A.4 — UI changes and drift

### 4a. What changed since the legacy panel was built (evidence)

* **The "UI changes" are the current uncommitted working tree** (confirmed):
  * 8 new homepage sections under `src/components/{banner,brands,categories,crowd-favorites,diwali,reviews,trust,ugc}/`
    and their `gadzio.*` schemas added to `src/lib/admin/collections.ts` + `defaults.ts` (both
    `M` in `git status`).
  * `GadzioHomePage` now has a `uiMode: 'new' | 'old'` switch (new mode renders the Gadzio
    sections, old mode the classic showcase).
  * `AdminUiSwitcher` (untracked) flips `homepageUiMode` from the legacy dashboard.
  * `src/app/page.tsx` reads 16 keys and applies `appleCopyright` over the footer.
* Committed drift since the panel: account dashboard, browsing history, coupons, in-app
  messages (commits `c312c87`, `a6a2af3`, `855fd4c`, `ea07511`, `92053e8`), order result pages,
  checkout, search, collection pages — none of them read `content_blocks`, so the merge does
  not touch them.
* `/android` was replaced by a Coming Soon page; the whole OPPO component tree was deleted.

### 4b. Schema vs storefront today

**Dead keys / fields the storefront never reads** (safe to drop from the editor; stored rows
are never rewritten):

1. All 11 `oppo.*` collections (0 stored rows).
2. Theme `logoText`, `oppoPrimaryColor`, `oppoGreenDark`, `oppoGreenLight` (0 stored values).
3. `apple.locale_banner` — reachable in code but unreachable in UI (`bannerVisible` is
   initialised `false` and never set `true`). Keep the key; mark the screen "not shown".
4. `apple.gallery.heading` — schema's own hint says "not currently displayed".
5. `apple.hero_tiles` / `apple.hero_video` — **only rendered in `uiMode: 'old'`**. Keep, but
   label them "Old UI only" so nobody edits them expecting the new homepage to change.

**Copy the storefront reads that the editor cannot edit** (drift gaps, candidates for §9
"added fields" — subject to decision **h**):

| Where | Hard-coded today |
| --- | --- |
| `GadzioHeroSection` | entire hero (kicker, headline, subhead, 2 CTAs, hero image) — component takes **no props** |
| `GlobalFooter` | legal row, directory headings not covered by `apple.footer` |
| `GadzioEventBanner` etc. | defaults are in code and *are* overridable — no gap |
| Order/checkout/account pages | functional copy, not marketing — out of scope |

**Type/limit changes:** none. Limits are unchanged; the only additions are the 8 `gadzio.*`
schemas (already present in the WIP).

### 4c. Legacy design system → Store Admin design system

| Legacy | Store Admin equivalent | Work |
| --- | --- | --- |
| `.admin-*` CSS (≈300 lines) | `sa-*` classes in `globals.css` / `store-admin.css` | rewrite, delete `admin.css` |
| `AdminSidebar` (grouped by site) | `NAV_GROUPS` in `StoreAdminShell.tsx` (single source) | add one group |
| custom toast | Store Admin toast (`SettingsForm`/`MediaLibrary` pattern) | reuse |
| `window.confirm` on reset | Store Admin confirm dialog | reuse |
| plain `<input>` blocks | `sa-field` / `sa-label` / `sa-hint` / `sa-input` | reuse |
| no help text system | `SettingFieldDescriptor.help` → `sa-hint` | use `FieldSchema.hint` (already populated on most fields) |
| no validation | inline `sa-notice` / field error | add plain-word validation |
| no version info | `content_blocks.updated_at/updated_by` + audit | add "last edited by/at" |
| no media picker | Media library screen exists (`/store-admin/media`) but has **no picker** | build a picker dialog on top of `GET /api/store-admin/media` |

No shared **field-help registry** exists (no `check-field-help` script in `package.json`), so
constraint 8's fallback applies: `FieldSchema.hint` → `sa-hint` under each field.

### 4d. Confirmed by the full consumer audit (field-level)

These are the drift items the rebuild must respect. They are **not** storefront changes; they
are corrections to the editor so that "open, save, nothing edited" cannot change the page.

**Fields the storefront never reads (drop from the editor, keep stored rows):**

| Field | Evidence |
| --- | --- |
| `apple.footer.footnotesHtml` | old footer that rendered it is commented out; `GlobalFooter` ignores it |
| `apple.gallery.heading` | registry admits it; the section renders `GALLERY_META.headline` instead |
| `apple.hero_video.clips[].label` | schema says "for reference only"; never read |
| `cases.page_header.sortLabel` | declared in schema + override type; "Sort by:" is hard-coded |
| `gadzio.reviews.items[].rating` | card always renders five stars |
| `gadzio.brand_bar.items[].name` (except index 0 `FEASTABLES`), `items[].subhead` | wordmarks are hard-coded; subhead never rendered |
| theme `logoText`, `oppoPrimaryColor`, `oppoGreenDark`, `oppoGreenLight` | no consumer |
| all 11 `oppo.*` keys | no component, `/android` is Coming Soon |
| `edu.hero` | `EduHero` is commented out in `EduStorePage` |

**Prefill vs component-default divergence — the no-op-save trap (must fix in Phase B):**

`defaults.ts` (the editor's prefill) does **not** always equal the component's own fallback.
Saving the prefill with no edits would therefore change the live page. Confirmed for
`gadzio.trust_badges` (e.g. "FREE SHIP $75+" vs "FREE SHIPPING OVER ₹999"),
`gadzio.category_grid` (prefill adds BESTSELLER/NEW badges), `gadzio.in_the_wild` (subheading),
and `apple.hero_video` (prefill omits `enabled`, and the stage requires `enabled === true`).
Because only 6 `apple.*` rows exist and **zero `gadzio.*` rows**, realigning `defaults.ts` to
the component defaults changes nothing stored and nothing rendered — it only makes the
editor truthful. The no-op-save test in §13 will assert this per collection.

**Schema bugs to correct:**

| Bug | Fix |
| --- | --- |
| `gadzio.crowd_favorites` edits `priceDisplay`, but the card reads `item.price`; `defaults.ts` writes `price` | rename the field to `priceDisplay` in the component (`priceDisplay ?? price` fallback) **or** keep the stored `price` key and expose it read-only. Do **not** add a `price` field: it is a commerce field name and the boundary would reject every save of that collection |
| `apple.nav` `items[].href` is ignored for the six built-in menus | label the field in the UI as "label only — link fixed for built-in items" |
| `apple.nav` / `apple.footer` only apply on `/` (Edu and Cases render the header/footer without overrides) | correct `sitePaths` so "View on site" does not over-promise |
| `cases.seo` is not read by `/shop/...` (static metadata) | correct `sitePaths` / note it |
| `fontFamily` does not reach sections with inline `transducer` font | hint text: "affects global text; some homepage sections set their own face" |
| Theme saves never call `revalidatePath`; only the 4 force-dynamic content pages are guaranteed fresh | the new theme API calls `revalidatePath('/', 'layout')` |

**Hard-coded marketing copy with no editor key** (candidates for decision **h**; the
recommendation is to leave them out of scope and only label them in the docs):

`GadzioHeroSection` (entire hero), header promo strip + drawer labels, mega-menu flyouts
(`data/nav.ts`), footer statement/disclaimer/legal links/payment list, Diwali rail label
"FESTIVE RELEASES & EXCLUSIVES", `Ribbon`'s "Shop" label, `CollectionPage`'s "Order on
WhatsApp" / "Sort by:" / "Brand & Trademark Notice".

---

## 5. Phase A.5 — Store Admin inventory (target)

* **Shell**: `src/components/store-admin/StoreAdminShell.tsx` is the *only* sidebar. Groups:
  Overview, Sales, Catalog, Customers, Insights, Settings. Exact-membership role filtering
  (`roles: [...]` on an item), pinning, global search, storefront link in the footer.
* **Auth**: `src/lib/store-admin/auth.ts` — `requireStoreRole(...requirements)` (rank-based),
  `getStoreSession`, `STORE_SESSION_COOKIE_NAME = 'store_admin_session'`, **bcrypt password
  compare**, **TOTP + recovery-code verify at login already implemented**, `must_change_password`
  gate, `clientIp` + `verifyTotp` borrowed from `src/lib/admin/*`.
* **Staff**: `store_admins` already has `totp_secret`, `totp_enabled`, `recovery_hash`,
  `is_active`, `must_change_password`, `removed_at`, `last_login_at`; `/store-admin/settings/staff`
  manages accounts but has **no TOTP enrolment UI** → decision (c) is cheap.
* **Profile**: `/store-admin/profile` (`ProfilePanel`) — name, phone, password, signed-in
  devices. No security/2FA section yet.
* **Audit**: `writeAudit()` in `src/lib/store-admin/audit.ts`, `store_admin_audit` (append-only
  trigger), IP/UA hashed, PII masked. `/store-admin/audit-log` (owner+admin).
* **Media**: `/store-admin/media` + `GET/POST /api/store-admin/media` → `store_media`, public
  URL `/api/media/<id>`.
* **Settings**: generic `SettingsForm` driven by `settings-rules.ts`
  (`SettingFieldDescriptor { key, label, kind, limit, default, section, help?, options?, locked? }`)
  and `setting-lists.ts` (`pages` → `store_pages`, `seo` → `seo_pages`). Sections: business,
  orders, payments, coupons, mail, storefront, maintenance; owner-only = keys starting
  `maintenance_`.
* **Pattern to copy for every new route**: `assertSameOrigin(request)` → `requireStoreRole(...)`
  → work → `writeAudit({ actorId, actorEmail, action, entity, entityId, before, after, route,
  status, request })` → `revalidatePath(...)` → JSON.

---

## 6. Phase A.6 — Overlaps and conflicts

| # | Overlap | Today's behaviour | Resolution (decision **e**) |
| --- | --- | --- | --- |
| O1 | **Two media uploads**: `/api/admin/media` (legacy) and `/api/store-admin/media` | Both write `store_media`; legacy returns `/api/admin/media/<id>`, store-admin returns `/api/media/<id>` | One upload path (store-admin); legacy URL stays as a **read** route |
| O2 | **Two SEO editors**: `apple.seo` / `cases.seo` / `edu.seo` in legacy vs `seo_pages` in Settings → Content | Storefront reads **only** `content_blocks`; `seo_pages` is stored but never consumed (14 empty rows) | Recommendation: `content_blocks` is the source of truth; `seo_pages` marked "not used by the storefront" with a link |
| O3 | **Three copyright/identity editors**: `apple.footer.copyright`, theme `appleCopyright`, Settings → Business (`trade_name`) | `/` uses `appleCopyright` when set, else `apple.footer.copyright`; `trade_name` is used elsewhere | Recommendation: footer copyright stays in Website → Theme; remove the duplicate field from `apple.footer`; business identity stays in Settings → Business |
| O4 | **Logo text**: theme `logoText` (dead) vs nav brand mark in code | nothing reads `logoText` | Remove field |
| O5 | **Dead colour settings** `oppo*` vs real CSS | `layout.tsx` emits vars nothing consumes | Remove fields (keep values in DB) |
| O6 | **Login copy** in Settings → Storefront | not read by the auth UI (copy is hard-coded) | Out of scope unless you say otherwise — note only |
| O7 | **Maintenance** in Settings (only one implementation) | fine | none |
| O8 | **"Media library" nav entry** (Catalog) vs a future Website → Media | one screen, two links would confuse | Website overview links *to* `/store-admin/media`; no duplicate nav item |
| O9 | **Audit** — legacy has none | all new actions audited | none |

---

## 7. Phase A.7 — Classification

### 7a. Moves as is (logic unchanged, new home)

| Item | Source | Target | Risk | Tests |
| --- | --- | --- | --- | --- |
| DB pool | `src/lib/admin/db.ts` | `src/lib/platform/db.ts` | low (mechanical, 68 files) | typecheck, build, full suite |
| Same-origin guard | `src/lib/admin/api-guard.ts` | `src/lib/platform/api-guard.ts` (+ drop `requireEditor`) | low (103 files) | `check:store-admin-routes`, same-origin tests |
| Storage helpers | `src/lib/admin/storage.ts` | `src/lib/platform/storage.ts` | low | media tests |
| TOTP helpers | `src/lib/admin/totp.ts` | `src/lib/platform/totp.ts` (drop `admin_users`-specific bits) | low | `staff-auth-behavior`, new TOTP tests |
| `clientIp` | `src/lib/admin/auth.ts` | `src/lib/platform/client-ip.ts` | low | lockout tests |
| Collection schemas | `src/lib/admin/collections.ts` | `src/lib/website/collections.ts` | low | `check:admin-boundary` |
| Code defaults | `src/lib/admin/defaults.ts` | `src/lib/website/defaults.ts` | low | editor round-trip |
| Boundary | `src/lib/admin/boundary.ts` | `src/lib/website/boundary.ts` (keep `validateLegacyContentWrite` exported) | low | `tests/admin-boundary` |
| JSON path helpers | `src/components/admin/json-path.ts` | `src/lib/website/json-path.ts` | low | unit |
| Product-import planner | `src/lib/admin/cms-product-migration.ts` | `src/lib/catalogue/product-import.ts` | low | `cms-product-migration.test` |
| Public media read | `src/app/api/admin/media/[id]` | **same URL** (thin, source-guarded) | none | new redirect test |

### 7b. Rebuild in Store Admin style

| Item | Source | Target | Risk | Tests |
| --- | --- | --- | --- | --- |
| Collection editor | `CollectionEditor.tsx` | `src/components/store-admin/website/CollectionEditor.tsx` | **high** (752 lines of behaviour) | save/validate/archive/reorder/commerce-reject per collection |
| Theme editor | `ThemeEditor.tsx` | `website/ThemeForm.tsx` | medium | save → storefront changes → reset |
| Dashboard | `(protected)/page.tsx` | `/store-admin/website` overview | medium | renders saved-override metadata |
| Sidebar | `AdminSidebar` | `NAV_GROUPS` Website group | low | nav role filtering test |
| Security/TOTP | `AdminSecurityClient` | `/store-admin/profile` → Security | medium | enrol/verify/recovery/disable |
| UI-mode switch | `AdminUiSwitcher` | Website → Theme (`homepageUiMode` select) | low | theme round-trip |
| Media picker | — (none existed) | `website/MediaPicker.tsx` over `GET /api/store-admin/media` | medium | pick/upload/alt |

### 7c. Replace with an existing Store Admin feature

| Legacy behaviour | Replaced by |
| --- | --- |
| Login / logout / session / lockout | `requireStoreRole`, `store_admin_session`, `(protected)` layout, `/store-admin/login` with `?next=` |
| TOTP setup/enable/disable routes | `/api/store-admin/profile/totp/*` (same `totp.ts` helpers; login already verifies) |
| Media upload endpoint | `POST /api/store-admin/media` |
| "Recent activity" | `/store-admin/audit-log` |
| Reset (archive) | same `content_blocks` archive semantics, new route |
| Site-wide settings table | `site_settings` (unchanged), read by `getThemeSettings()` |

### 7d. Remove as dead

| Item | Why |
| --- | --- |
| 11 `oppo.*` schema entries | route is Coming Soon, no component, 0 rows |
| Theme `logoText`, `oppoPrimaryColor`, `oppoGreenDark`, `oppoGreenLight` | no consumer |
| `apple.gallery.heading` | schema says "not currently displayed" |
| `apple.footer.footnotesHtml` | renderer commented out; footer ignores it |
| `apple.hero_video.clips[].label`, `cases.page_header.sortLabel`, `gadzio.reviews.items[].rating`, `gadzio.brand_bar.items[].subhead` | never read (§4d) |
| `edu.hero` | `EduHero` is commented out in `EduStorePage` |
| `src/app/(admin)/**` | replaced |
| 8 mutating `/api/admin/*` routes | replaced (410) |
| `src/lib/admin/auth.ts` | replaced |
| `AdminSidebar`, `AdminLoginForm`, `admin.css` | replaced |
| `scripts/create-editor.mjs` + `db:create-editor` | `create-store-admin.mjs` exists |
| legacy `/admin` branches in `proxy.ts` | replaced |

### 7e. Keep for compatibility

| Item | Why |
| --- | --- |
| 308 redirects `/admin`, `/admin/login`, `/admin/content/:key`, `/admin/theme`, `/admin/security` | bookmarks, stored links |
| `GET /api/admin/media/[id]` | hard constraint 6; 2 legacy rows |
| `GET /api/media/[id]` | storefront `<img>` URLs |
| `admin_users`, `admin_sessions` tables | decision **f**; not dropped here |
| `content_blocks` archive-instead-of-delete | hard constraint 4 |
| `validateLegacyContentWrite` export name | `check-admin-boundary` + tests keep working |
| `edu.` exemption | hard constraint 3 |

### 7f. Needs my decision

| # | Question | Recommended |
| --- | --- | --- |
| a | Who may edit website content / theme | admin+owner edit content; viewer read; theme owner-only |
| b | Legacy admin accounts | copy bcrypt hash + link by email; one new `store_admin`; no forced reset |
| c | TOTP | keep, add enrolment UI to My profile → Security, migrate the 1 secret |
| d | Education editor | move into Website unchanged (code untouched) |
| e | Overlap source of truth | content_blocks wins for SEO/copyright; remove duplicates from the other screen |
| f | Old tables | keep `admin_users`/`admin_sessions`, no export/drop in this task |
| g | Old URLs | 308 redirects |
| h | UI drift | follow current storefront + current Store Admin design; no new editable fields beyond `gadzio.*` already in the WIP |

*Answers received for a–d are recorded in §10.2 and supersede the recommendations above
(notably: **owner only**, not admin+owner).*

---

## 8. Proposed Website navigation and URL map

### 8.1 Sidebar (single source: `StoreAdminShell.tsx`)

New group **`Website`**, placed **between Insights and Settings** (it is site-wide config,
not commerce). Every item is role-filtered by the same exact-membership rule.

```
Overview      Sales   Catalog   Customers   Insights   ── Website ──      Settings
                                                        Website overview
                                                        Content
                                                        Theme                (owner only, per a)
                                                        ── links to: Media library, Audit log, Pages & SEO
```

| Item | href | Roles (recommended) | Icon |
| --- | --- | --- | --- |
| Website overview | `/store-admin/website` (exact) | all | `grid` |
| Content | `/store-admin/website/content` | all (edit: **owner only**, per a) | `layers` |
| Theme | `/store-admin/website/theme` | all (edit: **owner only**, per a) | `image` (or new `palette`) |

No separate Media nav item (O8); no separate Security item (lives in My profile).

### 8.2 URL map

| Old | New | Mechanism |
| --- | --- | --- |
| `/admin` | `/store-admin/website` | 308 `redirects()` |
| `/admin/login` | `/store-admin/login?next=/store-admin/website` | 308 |
| `/admin/content/:key` | `/store-admin/website/content/:key` | 308 (wildcard) |
| `/admin/theme` | `/store-admin/website/theme` | 308 |
| `/admin/security` | `/store-admin/profile#security` | 308 |
| `POST /api/admin/*` (all mutating) | — | **410 Gone** catch-all, plain message |
| `GET /api/admin/media/:id` | unchanged | kept |
| `POST /api/admin/media` | `POST /api/store-admin/media` | 410 on old |
| `PUT/DELETE /api/admin/content` | `GET/PUT/DELETE /api/store-admin/website/content[/:key]` | 410 on old |
| `GET/PUT/DELETE /api/admin/settings` | `GET/PUT/DELETE /api/store-admin/website/theme` | 410 on old |
| `POST /api/admin/auth/*` | `/api/store-admin/auth/*` | 410 on old |
| `POST /api/admin/totp/*` | `/api/store-admin/profile/totp/*` | 410 on old |

Next.js route precedence makes `src/app/api/admin/media/[id]/route.ts` win over an
`src/app/api/admin/[...rest]/route.ts` 410 catch-all, so the two coexist in one file tree.

### 8.3 New Store Admin API surface

| Route | Methods | Guard | Notes |
| --- | --- | --- | --- |
| `/api/store-admin/website/content` | GET | `requireStoreRole()` | collections + saved-override metadata (key, updated_at, updated_by, archived) |
| `/api/store-admin/website/content/[key]` | GET, PUT, DELETE | GET any role; PUT/DELETE **`store_owner`** (per a) | `validateLegacyContentWrite` on PUT; DELETE = archive; `assertSameOrigin`; `writeAudit`; `revalidatePath('/')` + site path |
| `/api/store-admin/website/theme` | GET, PUT, DELETE | GET any; PUT/DELETE `store_owner` (per a) | whitelist `THEME_SETTING_KEYS`; audit; `revalidatePath('/', 'layout')` |
| `/api/store-admin/profile/totp/setup\|enable\|disable` | POST (c) | own account only | reuses `platform/totp.ts` |

`check-store-admin-routes.mjs` gains these in `EXPECTED_READ_ONLY_ROUTES`,
`EXPECTED_OWNER_ROUTES` (theme) and `EXPECTED_MUTATING_ROUTES`.

---

## 9. Proposed account migration (decision **b**, **c**)

Counts: **1 legacy admin**, **0 email overlap**, **2 store admins** (1 owner active, 1 admin
inactive), **0 store admins with TOTP**.

`scripts/migrate-legacy-admins.mjs` (additive, idempotent, **dry-run by default**):

1. Read `admin_users` (id, lower(email), name, password_hash, totp_secret, totp_enabled).
2. Normalise email; match `store_admins` by `lower(email)`.
3. If matched → **skip** (never overwrite password, role, TOTP).
4. If not matched → `insert` into `store_admins` with the chosen role, `password_hash` copied
   verbatim (bcryptjs on both sides → the same password keeps working), `totp_secret`/
   `totp_enabled`/`recovery_hash` copied if decision (c) keeps TOTP, `is_active = true`,
   `must_change_password = false` (or `true` if you choose the temporary-password option).
5. Print `created` / `linked` / `skipped` counts and the **email local-part only**; never a hash,
   secret, token or full email.
6. `--apply` writes; no `--apply` is a dry run. Wrap in one transaction.

Because the single legacy account uses TOTP, copying the secret means that person signs in to
Store Admin with the same password **and** the same authenticator entry — no re-enrolment, no
lockout.

---

## 10. Questions (asked now; answers recorded below)

### 10.1 Questions

* **(a)** Which Store Admin roles may edit website content and theme?
* **(b)** What happens to the 1 legacy admin account?
* **(c)** TOTP in Store Admin?
* **(d)** The `edu.*` editor?
* **(e)** SEO / footer / logo: which screen is the single source of truth?
* **(f)** Drop `admin_users` / `admin_sessions`?
* **(g)** Old `/admin` URLs: redirect or gone?
* **(h)** Current uncommitted storefront/UI work: commit a checkpoint before the merge?

### 10.2 Answers

**a. Website roles — OWNER ONLY.** Only `store_owner` may save website content or theme.
`store_admin` and `store_viewer` are read-only in the Website group. Implemented as one
helper (`canEditWebsite(role)`) used by every new route and by the editor UI; `requireStoreRole()`
still guards every route, and mutations additionally require `store_owner`.

**b. Legacy admin account — MIGRATE; the existing owner account is the reference identity.**
First answer: use the existing admin owner account rather than inventing another login.
Clarified in (f): *"copying the 1 legacy admin into store_admins, including the TOTP secret
… still happens in this task."* Reconciled decision:

* One `store_admins` row is created from the single `admin_users` row: same bcrypt
  `password_hash`, same `totp_secret` / `totp_enabled` / `recovery_hash`, same name,
  `is_active = true`, `must_change_password = false` (the password keeps working).
* **Role: `store_owner`** — inferred, because answer (a) restricts website editing to owners
  and this is the account that edits the website. The existing active owner account is left
  untouched; the script takes `--role`, so this can be changed before the commit that applies
  it if you meant `store_admin`.
* Counts on first run: `created: 1, linked: 0, skipped: 0`; on any later run the same email is
  skipped, never overwritten.
* Never prints the email in full, the hash, the secret or the recovery code; never exports a
  table to a file.

**c. TOTP — KEEP, with safeguards.** Build enrolment on My profile → Security, reusing
`totp.ts`, and keep TOTP optional for staff. Required safeguards:
1. Secret is copied without ever being printed, stored the same way as the legacy secret
   (plaintext column — the legacy value is not encrypted), and a generated code must verify
   before the old panel is removed.
2. Enrolment shows the QR code and setup key **once**, requires a valid code before enabling,
   and requires the current password to disable.
3. One-time backup codes at enrolment, stored hashed, shown once; a `store_owner` can turn off
   another staff member's 2FA (audited) so nobody is permanently locked out.
4. Rate-limit code attempts per account and reject a code already used in the same time
   window (no replay).
5. Audit every enable, disable and owner reset with no secrets in the audit row.

> **Interaction with (b):** because (b) now migrates the account, the secret is copied into
> the new `store_admins` row in the same transaction as the password hash. Before the old
> panel is removed, the migration prints `TOTP copied and verified: yes/no` by generating a
> code from the stored secret and checking it through the same verification path the login
> uses. The secret itself is never printed or logged.

**d. Education editor — MOVE INTO WEBSITE UNCHANGED.** The 12 `edu.*` collections appear as an
"Education store" tab under Website → Content, same fields. `/in-edu/store` and its components
are not touched; the `edu.` commerce exemption is unchanged. (Note the audit finding that
`edu.hero` is currently dead because `EduHero` is commented out — the editor keeps the key,
marked "not currently rendered".)

**e. Overlaps — WEBSITE WINS, THE OTHERS ARE LABELLED.**

* Per-page SEO stays in Website (`apple.seo`, `cases.seo`, `edu.seo`) because that is what the
  storefront reads. Settings → Pages & SEO (`seo_pages`, 14 empty rows) is relabelled
  "not used by the storefront" with a link to the Website content screen. Nothing is deleted.
* Footer copyright stays editable in Website → Content; the Theme copyright is labelled as the
  homepage override (which is exactly how the reader behaves).
* Dead duplicates are removed from the editor: theme `logoText`, the three `oppo*` colours,
  `apple.footer.footnotesHtml` (§4d). Stored values are never touched.
* Login copy in Settings → Storefront is left alone and noted as unused.

**f. Old tables — KEEP NOW, DROP IN A LATER APPROVED TASK.** Neither table is altered, read,
exported or dropped in this task. Written follow-up, in this order:

1. Confirm the migrated account has signed in successfully to Store Admin for **at least a
   week** (check `last_login_at` and the audit log).
2. Take a **verified backup** (restore-test it) of `admin_users` and `admin_sessions`.
3. A small additive migration **blanks the credential columns** (`password_hash`,
   `totp_secret`, `totp_enabled`, `recovery_hash`) — an unused table must not hold live
   credentials.
4. Later, in a **separate migration you approve at that moment**, drop both tables.

Until then **nothing may read or write them**: the legacy login/session code is deleted in the
removal commit, and a test fails if any file under `src/` or `scripts/` references
`admin_users` or `admin_sessions`. The one exception is the one-off migration script while it
is still being run; it is deleted in the same removal commit, after which the test asserts
zero references. No table is exported to a file in the repo and no contents are printed.

**g. Old URLs — 308 PAGES, 410 APIs**, with these safeguards:

1. Before any 410 ships, search the repo (code, scripts, `package.json`, docs, CI files) and
   Settings → Social & analytics integration URLs for callers of `/api/admin/*`, and **report
   what was found**. If anything outside the admin UI calls one, stop and report rather than
   break it.
2. **Redirect-map test** covering `/admin`, `/admin/login`, `/admin/content/<every collection
   key>`, `/admin/theme`, `/admin/security`, and unknown `/admin/*` → Website overview. The
   308s ship only once every mapping is verified.
3. 410 returns a short plain message ("This admin panel has moved to Store Admin") with
   `Cache-Control: no-store`, and counts hits (route + status only; no IP, UA or personal
   data).
4. `GET /api/admin/media/:id` and `GET /api/media/:id` stay working and source-guarded; a test
   fails if either stops resolving an existing stored media id (the 2 legacy ids included).
5. Maintenance allow-list and route checkers are updated so none reference removed paths.

**h. Starting point — CHECKPOINT FIRST.** One commit of the current working tree (excluding
`MERGE_PLAN.md`, which gets its own docs commit, and excluding any scratch file) so every
later step is a clean diff. The checkpoint changes nothing.

### 10.3 Decisions taken without an answer

_None yet — you are available._

---

## 11. Risks

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Shared primitives (`db`, `api-guard`) are imported by 171 files; moving them touches the whole app | **high** | one mechanical commit, import-path-only, full suite + typecheck + build before anything else; no logic edits in that commit |
| The current UI work is uncommitted | **high** | checkpoint commit first (§12 step 0), so every later step is revertible and the WIP cannot be lost in a conflict |
| Rebuilding a 752-line editor loses behaviour (unsaved guard, reorder, archive semantics) | **high** | port behaviour field-type by field-type; per-collection tests; side-by-side manual check; keep the old panel until the separate removal commit |
| Storefront output changes | **high** | no reader changes; no-op-save comparison per collection; `force-dynamic` keeps it immediate |
| **Opening a collection and saving with no edits changes the page**, because `defaults.ts` diverges from the component defaults (§4d) | **high** | realign `defaults.ts` first (no stored `gadzio.*` rows, so no data/visual change), then run the no-op-save test per collection |
| Commerce boundary regression | **high** | `check-admin-boundary.mjs` repointed, not deleted; `tests/admin-boundary` unchanged; `edu.` exemption intact |
| Legacy media URLs stop resolving | medium | keep `GET /api/admin/media/[id]` as a compatibility route + test |
| Two identity systems during the transition | medium | stop issuing `admin_session` in the compatibility step; redirects send users to Store Admin login |
| Audit rows leak PII/secrets | medium | `writeAudit` masks PII; new calls pass ids + changed field names only |
| Port 3000 `next dev` + ad-hoc DB scripts hit the 15-session pooler cap | low | every new script `max: 1`, `prepare: false`, `sql.end()` |
| Uncommitted `tmp/inventory-counts.mjs` and `AUDIT_*.md` files pollute the tree | low | delete the tmp script; leave the user's docs untracked |

---

## 12. Rollback plan

Every step is its own commit; reverting any one is safe.

* **Steps 0–7** are additive. `git revert` removes the new screens/routes without touching
  data or the storefront.
* **Step 8 (redirects / 410 / stop issuing `admin_session`)** is config + one catch-all route;
  revert restores the old panel exactly (it still exists at that point).
* **Step 10 (remove the old panel)** is the only destructive commit. It deletes code only —
  no migrations, no drops — and deletes `scripts/migrate-legacy-admins.mjs` after the
  migration has been applied and verified. `git revert` restores the full legacy panel.
* **No table is dropped and no legacy table is read, written, exported or blanked** (decision
  f). `content_blocks` rows are only ever archived. The credential-blanking and drop steps
  are a written follow-up, not part of this task.
* **The migrated `store_admins` row** is additive: deleting it leaves `admin_users` untouched
  and the password/TOTP secret recoverable only by re-running the (now deleted) script from
  git history — so verify the account works before step 10.
* Backups: take a Supabase snapshot before step 9.

---

## 13. Order of work (commits)

| # | Commit | Contents |
| --- | --- | --- |
| 0 | `chore: checkpoint current storefront and UI work` | the current working tree (pending answer **h**); excludes this plan + the tmp script |
| 1 | `refactor(platform): move shared db/api-guard/storage/totp primitives` | mechanical path move; all checks green; no behaviour change |
| 2 | `feat(accounts): migrate legacy admin, website role rule, TOTP enrolment` | `scripts/migrate-legacy-admins.mjs` (dry-run → apply, creates 1 `store_owner`, copies hash + TOTP secret, verifies a code), `canEditWebsite(role)`, `/api/store-admin/profile/totp/*`, profile → Security with backup codes, owner reset, rate limit + replay guard, audit |
| 3 | `feat(store-admin): website section shell and overview` | nav group, `/store-admin/website`, metadata query |
| 4 | `feat(store-admin): website content list and editor` | list + `[key]` editor + APIs (boundary, archive, audit, revalidation) |
| 5 | `feat(store-admin): website theme screen` | theme API + form + live storefront revalidation |
| 6 | `feat(store-admin): media picker for website fields` | picker over the existing media library |
| 7 | `chore(website): align editor with current storefront` | keep `gadzio.*`; realign `defaults.ts` with component defaults; fix `crowd_favorites` price field; drop dead OPPO/colour/logo/footnotes/rating/sortLabel fields; mark old-UI-only, never-shown and education-hero keys; correct `sitePaths` (stored rows untouched) |
| 8 | `feat(compat): redirects, 410s and legacy media read` | caller audit report (repo + Settings → analytics URLs); `next.config.ts` 308 map + map test (incl. every collection key and unknown paths); `/api/admin/[...rest]` 410 with `no-store` + hit counter; stop issuing `admin_session`; `GET /api/admin/media/:id` and `/api/media/:id` resolution tests |
| 9 | `chore(infra): route checkers, boundary checker, maintenance tests` | `check-store-admin-routes`, `check-admin-boundary`, `tests/maintenance`, script import paths, dead-reference test for `admin_users` / `admin_sessions` |
| 10 | `chore(admin): remove the legacy panel` | delete `src/app/(admin)`, mutating `api/admin`, legacy auth/sidebar/login/css, `create-editor.mjs`; **revertible** |
| 11 | `docs: FEATURES.md + MERGE_PLAN decisions` | one admin identity, Website section, redirect table, evidence block |

Verification gate before commit 10 (shift.md step 7): for all 43 collections, load the
storefront page, save a no-op, compare output; save a small change and watch it appear at
once; reset it; round-trip the theme; sign in with the migrated account. Then commit 10.

---

## 14. Before/after deliverables (filled during Phase B)

| Old URL | New URL |
| --- | --- |
| _pending Phase B_ | |

| Editor fields added | Editor fields removed |
| --- | --- |
| _pending Phase B_ | _pending Phase B_ |
