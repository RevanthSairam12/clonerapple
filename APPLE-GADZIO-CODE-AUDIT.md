# APPLE → GADZIO CODE AUDIT (Phase 2 Readiness)

**Report file:** `APPLE-GADZIO-CODE-AUDIT.md`
**Repository:** `C:\Users\Abcom\Documents\clon\apple-clone`
**Audit date:** 2026-10-08
**Audit type:** Read-only, fresh full-repository scan
**Predecessor document:** `APPLE-GADZIO-FULL-AUDIT.md` (Phase 0 / Phase 1)

---

## 1. Audit Status

| Item | Value |
| --- | --- |
| Audit completed | ✅ Yes |
| Scope | Whole repository, fresh scan (not a re-read of the previous audit) |
| Writes performed | **None** |
| Database writes performed | **None** (SELECT-only inspection) |
| Files created by this audit | **1** — `APPLE-GADZIO-CODE-AUDIT.md` |
| Files modified by this audit | **0** |
| Files deleted by this audit | **0** |
| Assets touched | **0** |
| Routes changed | **0** |
| Package files changed | **0** |
| Phases performed | **None** — Phase 2–6 are recommendations only |

**Method.** Every finding below was re-derived from the current working tree and the current database state. The predecessor audit was read first as historical context only; no predecessor finding was carried forward without re-verification. Each predecessor finding is classified in §3 as FIXED / STILL PRESENT / PARTIALLY FIXED / NO LONGER PRESENT / LEGITIMATE-KEEP / NOT RELEVANT / NEEDS FURTHER ACTION.

### 1.1 Scan scope (measured)

| Area | Files scanned |
| --- | ---: |
| `src/` | 148 |
| `public/sites/` (live) | 306 |
| `public/` root | 2 |
| `migrations/` | 9 |
| `scripts/` | 11 |
| Repo-root docs + config | 22 |
| **Total** | **498** |

Excluded from scanning (generated / vendored / duplicate): `public/sites.original-backup` (321 files, 64 MB), `node_modules/`, `.next/`, `.git/`, `.claude/worktrees/whimsical-jumping-valiant` (a second git worktree holding a full duplicate checkout).

### 1.2 Reference counts (measured, current tree)

| Metric | Count |
| --- | ---: |
| `src/` files containing `apple.com` URLs | **6** |
| `apple.com` URL occurrences in `src/` | **36** |
| Distinct `apple.com` destination URLs in `src/` | **31** |
| `apple.com` URLs in `scripts/` | 0 |
| `apple.com` URLs in `migrations/` | 0 |
| `src/` files matching `Apple` (capital) | 33 |
| `src/` lines matching `Apple` (capital) | 85 |
| `src/` files matching `apple` (case-insensitive) | 52 |
| CSS custom properties named `--ac-*` | 87 occurrences |
| Class/ID tokens named `ac-*` | 262 occurrences |

**Live-rendering Apple URLs: 0.** Every one of the 31 destination URLs is confined to (a) data modules replaced at runtime by CMS rows, (b) unreachable components, (c) admin-panel prefill defaults, or (d) the `TileCard` rewriter. Sections 5–8 detail how each can become live.

### 1.3 Database / CMS state (read-only, verified this session)

`content_blocks` — 6 rows, all `apple.*`:

| Key | Updated (UTC) | Contains "apple" | Renders Apple URL? |
| --- | --- | --- | --- |
| `apple.hero_tiles` | 2026-10-03T16:05:13Z | no | no — 2 tiles, all relative internal hrefs |
| `apple.hero_video` | 2026-09-28T04:54:45Z | no | no |
| `apple.promo_section` | 2026-09-14T04:07:33Z | no | no — **5 tiles**, Apple Card tile absent |
| `apple.ribbon` | 2026-10-03T16:05:15Z | no | no — student-pricing copy, internal `shopHref` |
| `apple.footer` | 2026-10-05T18:48:30Z | **yes** | no — legitimate compatibility footnote |
| `apple.gallery` | 2026-10-03T16:05:15Z | no | no — but `enabled: false`; **captions are Apple TV+ show copy** |

`site_settings` — **empty** (no theme rows; code defaults are live).

---

## 2. Executive Summary

**The Apple identity is gone from what a visitor sees today.** The homepage renders Gadzio copy, Gadzio branding, Gadzio destinations, and a Gadzio `<h1>`. Zero `apple.com` links are reachable by a user through any route in the app. Phase 1 achieved this.

**The Apple identity is not gone from the code that produces it.** What remains is not static residue but *machinery that re-creates Apple output under ordinary conditions*: a link rewriter that prefixes any non-internal href with `https://www.apple.com`, an admin schema with no concept of "internal link", admin prefill values whose title is literally `Apple` and whose link fields are literal `apple.com` URLs, a CMS row of Apple TV+ show captions one toggle from live, and a verbatim Apple India EMI strip sitting in a component fallback.

The decisive finding is **the admin/renderer contract mismatch**. The renderer decides "internal vs external" from a per-tile field named `internal`. The admin panel cannot read it, cannot write it, and does not know it exists. Any tile or CTA created through the admin panel therefore has no `internal` value, is treated as external, and is rewritten to `https://www.apple.com<href>` — **including plain relative Gadzio paths**. This is reachable by an editor adding a second CTA to an existing hero tile, with no destructive action and no warning.

Underneath that, the structural problem is that **de-branding was applied to content, not to the mechanism**. The mechanism — `apple.*` content keys, `www-apple-com-736d3707/root-8a5edab2` paths, `ac-*` namespaces, `currentBrand="apple"` — still names Apple everywhere. That is not a cosmetic complaint: those names are what makes the latent paths hard to see and easy to re-arm.

### Answer to the core question

> *Ignoring image/tile replacement work, exactly what code and data needs to be changed to fully remove the Apple-clone identity and prevent Apple-derived content from returning?*

**Four things, in this order:**

1. **Delete the Apple link rewriter and give the admin an explicit link model.** Remove `heroTileHref()` from `TileCard.tsx`; make `internal` a real, admin-editable field; default every new tile/CTA to internal. Without this, no amount of content de-branding prevents `https://www.apple.com/...` from appearing.
2. **Purge Apple URLs and Apple marketing copy from the code defaults that the admin writes into the database.** `src/lib/admin/defaults.ts` is the re-entry point: `APPLE_SEO_DEFAULTS.title = 'Apple'`, seven `apple.com` hrefs in `CASES_CATEGORY_LINKS_DEFAULTS`, `APPLE_RIBBON_DEFAULTS.shopHref`, `APPLE_LOCALE_BANNER_DEFAULTS.continueHref`. These are one "save" away from becoming live rows.
3. **Neutralise the two content fallbacks that contain Apple-derived copy** — `Ribbon.tsx`'s Apple India EMI/cashback paragraph and the Apple Card promo tile (with its `card.apple.com` apply link) — and clear the Apple TV+ captions out of the `apple.gallery` DB row.
4. **Migrate the names.** `apple.*` content keys, `www-apple-com-736d3707/root-8a5edab2` component paths, `ac-*` CSS namespace, `apple-clone` package name, `Apple Clone Admin` TOTP issuer, `gadzio_apple_cart_v1` storage key. This is the step that makes items 1–3 stay fixed.

Items 1–3 are small, high-value, and can ship independently. Item 4 is a wide, mechanical migration that should follow, not lead.

### Severity roll-up

| Severity | Count |
| --- | ---: |
| CRITICAL | 4 |
| HIGH | 6 |
| MEDIUM | 9 |
| LOW | 6 |
| LEGITIMATE-KEEP | 12 groups |
| FUNCTIONAL (bug, not branding) | 8 |

### Headline counts

| Measure | Count |
| --- | ---: |
| Code files requiring change | **18** |
| Data files requiring change | **6** |
| Database rows requiring change | **1** (`apple.gallery` captions) + 6 candidates for key rename |
| Admin default values requiring change | **13** distinct values across 5 default objects |
| Functional issues | **8** |
| Asset-only findings (excluded from required work) | **26 broken refs / 3 live** + 146 gallery images + 62 tile images |

---

## 3. Phase 1 Verification

Each Phase 1 item from `APPLE-GADZIO-FULL-AUDIT.md`, re-verified against the current tree.

| # | Phase 1 claim | Status now | Evidence |
| --- | --- | --- | --- |
| P1-1 | 15 `/in-edu` Apple URLs repointed to internal routes | **FIXED** | `grep -rE 'https?://[a-z.]*apple\.com' src/app/in-edu/` → 0 matches. `src/app/in-edu/store/page.tsx` metadata now Gadzio-branded. |
| P1-2 | Apple favicon replaced with `/gadzio_logo.png` | **FIXED** | `src/app/page.tsx:28-30` `icons: { icon: '/gadzio_logo.png' }`; `src/app/in-edu/store/page.tsx` likewise. |
| P1-3 | SF Pro fonts replaced with Inter | **FIXED** | `src/app/layout.tsx` loads Inter (300–900) + Mona Sans via Google Fonts. `FONT_FALLBACK` retains `-apple-system, BlinkMacSystemFont` — these are **CSS system-font keywords, not Apple assets** → LEGITIMATE-KEEP. |
| P1-4 | Footer trademark sentence removed from the live DB row | **FIXED** | `apple.footer` row content no longer carries the trademark sentence; `FOOTER_FOOTNOTES_HTML` in `data/footer.ts` reads "Compatibility with Qi2 wireless chargers and third-party devices…". The only remaining `apple` token in that row is the legitimate compatibility footnote. |
| P1-5 | Eligibility footnote rewritten | **FIXED** | Hero tooltip in `apple.hero_tiles` row reads "Verified students with a valid university email and student ID…" — Apple naming removed. |
| P1-6 | Hero tiles marked `internal: true` | **FIXED, but incomplete** | `data/tiles.ts` HERO_TILES 0–2 and PROMO_TILES 0–4 carry `internal: true`. **PROMO_TILES[5] (Apple Card) does not** → §5 C-4. |
| P1-7 | Homepage CTAs no longer point off-site | **FIXED for existing content** | Live DB rows use relative hrefs only. **Not fixed for future content** → §5 C-1/C-2. |
| P1-8 | Gallery disabled | **FIXED (as configuration)** | `apple.gallery` row has `enabled: false`; `page.tsx:60` fallback is `{ enabled: false }`. Re-enable is one toggle → §6 H-1. |
| P1-9 | Locale banner not shown | **FIXED by accident** | `AppleHomePage.tsx:57` `useState(false)` and nothing ever sets it `true`. Apple URLs unreachable — but the component and its data are intact → §6 H-4. |

**New drift since Phase 1 (found by this audit, not previously reported):**

- `src/components/sites/edu-store/data/content.ts` — six previously-unreferenced exports (`HOW_TO_BUY_STEPS`, `SHOP_CATEGORIES`, `BTS_OFFERS`, `EDU_IN_ACTION`, `MAC_PRODUCTS`, `IPAD_PRODUCTS`) have been **removed**; `EDU_PRODUCTS` and `priceToNumber` are now **live exports** consumed by `src/lib/payu/catalog.ts:2` and `src/lib/search/searchService.ts:2`. This is a material change: edu product data is now on the payment and search paths.
- `data/tiles.ts` hero tile 0 artwork swapped to hand-edited `hero_banner1 (N).jpg` files (present on disk, untracked).
- `.agents/skills/apple-design/SKILL.md` (290 lines) is now present and untracked, pinned by `skills-lock.json`.
- 26 tile-image references in `data/tiles.ts` no longer resolve on disk (they exist only in `public/sites.original-backup`) → §15 F-3.

---

## 4. What Is Already Fixed

Confirmed clean; no action required for Apple-identity reasons.

| Area | Status |
| --- | --- |
| Homepage metadata | `title: 'Gadzio'`, Gadzio description, `metadataBase` set, `icons: /gadzio_logo.png` |
| Homepage `<h1>` | `AppleHomePage.tsx:66` — `<h1 className="ac-visuallyhidden">Gadzio</h1>` |
| `/in-edu/store` metadata | Gadzio title, Gadzio OG URL, Gadzio icon |
| Footer links | `data/footer.ts` — zero `apple.com` destinations |
| Nav links | `data/nav.ts` — no `apple.com` destinations; all items internal |
| Hero tile hrefs | All relative internal paths |
| Promo tile hrefs (0–4) | All relative internal paths |
| Live ribbon | Student-pricing copy, internal `shopHref` |
| Live footer row | Compatibility footnote only |
| Live gallery | `enabled: false` |
| Live locale banner | No row; component unreachable |
| Brand switcher visible text | Renders "Android" / "Gadzio" only |
| Search storage key | `gadzio_search_history_v1` — clean |
| `proxy.ts` | CSP + admin gate; no Apple URL rewriting |
| `migrations/` | Zero `apple.com` references |
| `scripts/` | Zero `apple.com` references |
| Public asset paths | All 269 referenced asset paths checked; 243 resolve (26 do not → §15 F-3) |

---

## 5. Critical Code/Data Changes Required

These are reachable through **ordinary, non-destructive use of the product**. They are the reason this audit's headline is "the machinery is still Apple-shaped", not "some strings remain".

---

### C-1 — `admin-overrides.ts` builds new CTA objects with no `internal` flag

- **Severity:** CRITICAL
- **State:** LATENT (reachable by normal admin editing — no destructive action required)
- **Required action:** CHANGE

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/admin-overrides.ts`
**Section symbol:** `mergeTile()` → `ctas` merge → the `if (!cta) { … }` branch (lines 118–124)

**Current behaviour.** When the override supplies more CTAs than the base tile has, the extra slots are constructed fresh:

```ts
if (!cta) {
  return {
    label: o?.label ?? '',
    href: o?.href ?? '#',
    ariaLabel: o?.label ?? null,
    variant: 'secondary' as const,
  };
}
```

`internal` is absent from the returned object. The existing-CTA branch (line 127) spreads `...cta`, so it *does* inherit `internal`. Only the new-slot branch loses it.

**Why it is dangerous.** `TileCard.tsx` treats a falsy `cta.internal` as "external" and routes the href through `heroTileHref()`, which prefixes `https://www.apple.com`. The admin schema (`TILE_ITEM_FIELDS`, `collections.ts:82-92`) exposes **two CTA slots on every tile unconditionally**. The live `apple.hero_tiles` row's first tile has only **one** CTA. An editor who fills the second CTA slot with `/in-edu/store` produces a link to `https://www.apple.com/in-edu/store` that opens in a new tab.

Note this defeats the `internal: true` protection on hero tiles: the *tile* is internal, but a *newly added CTA on it* is not.

**Required change.** Add `internal: true` to the constructed object (default to internal — a same-site link is the only sensible default for a storefront), and have the editor expose an explicit "external link" toggle so the external branch is opt-in and visible.

**Suggested Gadzio replacement.** `internal: o?.href ? o.href.startsWith('/') : true` — or unconditionally `internal: true` with an explicit admin toggle for genuine external links.

**Risk if unchanged.** Any editor action that adds a CTA can publish an `apple.com` link on the homepage. Silent, immediate, no warning.
**Priority:** P0

---

### C-2 — The admin panel has no link model; added tiles inherit the Apple Card template

- **Severity:** CRITICAL
- **State:** LATENT (reachable by normal admin editing)
- **Required action:** CHANGE

**Files:**
- `src/lib/admin/collections.ts` — `TILE_ITEM_FIELDS` (lines 82–92), used by `apple.hero_tiles` and `apple.promo_section`
- `src/components/sites/www-apple-com-736d3707/root-8a5edab2/admin-overrides.ts` — `mergeTiles()` (lines 140–150)

**Current behaviour.** Two compounding facts.

1. `TILE_ITEM_FIELDS` exposes label/href/subhead/image/tooltip fields. `grep -n "internal" src/lib/admin/collections.ts` returns **zero matches**. Neither the tile-level `internal` nor the CTA-level `internal` is readable or writable from the admin panel.

2. `mergeTiles()` clones the **last** base tile for any position beyond the base array:

```ts
const template = tiles[i] ?? tiles[tiles.length - 1];
```

For promo tiles the last base tile is `PROMO_TILES[5]` — **the Apple Card tile, the only tile with no `internal` flag** (§5 C-4). A tile added through the admin panel therefore inherits *undefined* `internal` and renders as an external link.

**Why it is dangerous.** Adding a promo tile is an ordinary content operation. The result is a homepage link to `https://www.apple.com/...` built from whatever relative path the editor typed. The editor sees nothing wrong: they typed `/shop/iphone/accessories/mobile-cases`, and the panel shows that back to them.

**Required change.** Add a boolean field `internal` to `TILE_ITEM_FIELDS` (default `true`), expose it for `ctas[n]` as well, and remove the "clone the last tile" fallback in favour of an explicit neutral tile template that is internal by default.

**Suggested Gadzio replacement.** A `booleanField('internal', 'Internal link', 'On = link stays on this site. Turn off only for a real external URL.')` present on every tile and CTA, defaulting on.

**Risk if unchanged.** Every tile an editor adds carries an `apple.com` link. This is the single most likely path by which Apple URLs return to production.
**Priority:** P0

---

### C-3 — `heroTileHref()` silently rewrites every non-internal href to `https://www.apple.com`

- **Severity:** CRITICAL
- **State:** LATENT (the function is the delivery mechanism for C-1, C-2 and C-4)
- **Required action:** REMOVE

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/TileCard.tsx`
**Section symbol:** module scope, lines 29–30

```ts
const heroTileHref = (href: string) =>
  href.startsWith('http') ? href : `https://www.apple.com${href}`;
```

Called at line 178 (`<a href={heroTileHref(cta.href)}>`) and line 207 (`<a href={heroTileHref(tile.href)}>`).

**Why it is dangerous.** This is the *only* place in the codebase that manufactures `apple.com` URLs, and it does so for the common case, not the exceptional one. A relative path — the normal shape of an internal link — is the *input that triggers the rewrite*. The function cannot distinguish "editor meant an Apple page" from "editor meant a Gadzio page"; it assumes Apple for everything that is not already absolute.

The block comment above it (lines 14–28) documents the risk accurately and even prescribes the fix ("Once Apple Card gets a real destination, delete this helper and pass `href` straight through"). That prescription is correct and should be executed as part of Phase 2, not deferred with Apple Card.

**Required change.** Delete `heroTileHref` and its two call sites; render `<Link>` for internal hrefs and the raw `href` for external ones. Then de-brand the `internal` field name itself (e.g. `external: true`) during the Phase 5 migration.

**Suggested Gadzio replacement.** No replacement — a plain pass-through. External links are already stored as absolute URLs and need no rewriting.

**Risk if unchanged.** Every latent path in C-1, C-2, C-4 and C-6 keeps a live delivery mechanism. Fixing the callers without deleting the rewriter leaves the trap armed for the next tile component.
**Priority:** P0

---

### C-4 — The Apple Card promo tile is the only tile without `internal`, and it is the clone template

- **Severity:** CRITICAL
- **State:** LATENT (one row deletion, or one admin "reset" away)
- **Required action:** REMOVE

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles.ts`
**Section symbol:** `PROMO_TILES` → index 5 (`"index": 5` at line 582)

**Current behaviour.** The tile carries:
- `"href": "/apple-card/"` (no `/apple-card` route exists in `src/app/`)
- CTA href `https://card.apple.com/apply/application?referrer=cid%3Dapy-200-10000036&start=false`
- `headlineLogo` and artwork from `promo_logo_apple_card__*` / `promo_apple_card__*`
- alt text naming "Apple Card" and "Apple logo"
- subhead "Get up to 3% Daily Cash back with every purchase."

The live `apple.promo_section` row supplies **5** `promoTiles`, so this tile is not rendered today.

**Why it is dangerous.** Three independent re-activation paths:

1. Deleting or resetting the `apple.promo_section` row falls back to the 6-tile code template — Apple Card returns, with a `card.apple.com` apply button and `/apple-card/` resolving through C-3 to `https://www.apple.com/apple-card/`.
2. `mergeTiles()` uses this tile as the clone template for every added promo tile (C-2).
3. The admin's promo-tile list permits `maxItems: 12`; an editor extending the list past five positions pulls this tile in as the template for positions 5+.

**Required change.** Delete `PROMO_TILES[5]` and all six `promo_apple_card__*` / six `promo_logo_apple_card__*` references. There is no Gadzio equivalent to substitute — the correct action is removal, not replacement.

**Suggested Gadzio replacement.** None. If a sixth promo slot is wanted later, create it through the admin panel with Gadzio content.

**Risk if unchanged.** Any row reset, deletion, or list extension re-publishes an Apple Card advertisement with a live Apple application link.
**Priority:** P0

---

## 6. High Priority Code/Data Changes

---

### H-1 — The live `apple.gallery` DB row contains Apple TV+ show marketing copy

- **Severity:** HIGH
- **State:** DATABASE + LATENT (one admin toggle from live)
- **Required action:** CHANGE

**Location:** `content_blocks` → key `apple.gallery` → `value.items[].title`

**Current behaviour.** The row is `enabled: false`, but its five captions are verbatim Apple TV+ show copy:

| # | Caption | Source |
| --- | --- | --- |
| 1 | "The hit comedy is back and Tedder than ever." | Ted Lasso |
| 2 | "Anya Taylor-Joy is a grifter running for her life after a heist goes sideways." | Apple TV+ film |
| 3 | "Every Grand Prix™, live and on demand—all in one place, all year long." | F1 on Apple TV |
| 4 | "The truth lies in the past." | Apple TV+ series |
| 5 | "Watch every club, every match, live—all season long." | MLS Season Pass |

Every `imageSrc` override in the row is `""` ("blank = keep original"), so re-enabling the gallery pulls artwork from `data/gallery.ts` — which is 100% `apple.com` asset URLs (§6 H-3).

**Why it is dangerous.** This is Apple content *in the live database*, in the same row as the enable/disable flag. It is not code that could be deleted in a refactor; it persists until someone clears it. One toggle in the admin panel publishes five Apple TV+ advertisements with Apple-hosted artwork.

**Required change.** Clear or replace the five captions with Gadzio content. If the gallery has no Gadzio purpose, delete the row entirely — `page.tsx:60` already falls back to `{ enabled: false }`, so deletion is safe.

**Suggested Gadzio replacement.** Gadzio accessory/editorial captions, or row deletion.

**Risk if unchanged.** A single toggle publishes an Apple TV+ marketing carousel.
**Priority:** P1

---

### H-2 — `GALLERY_LOGOS` contains three Apple service wordmarks drawn with the Apple glyph path

- **Severity:** HIGH
- **State:** LATENT (referenced by `data/gallery.ts`, rendered only when the gallery is enabled)
- **Required action:** REMOVE

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/icons.tsx`
**Section symbol:** `GALLERY_LOGOS` (line 57) → entries `music`, `arcade`, `fitness`

**Current behaviour.** Three SVG wordmarks ("Apple Music", "Apple Arcade", "Apple Fitness+") whose glyphs include the Apple logo path verbatim. `data/gallery.ts` selects them by name (`"logo": "music" | "arcade" | "fitness"`). File header lines 1–2 read "verbatim SVG paths from the target" / "verbatim from https://www.apple.com/".

**Why it is dangerous.** These are Apple's own trademarks rendered as vector art — the highest-fidelity form of Apple-owned UI identity in the repository. They cannot be de-branded by editing text; the paths must be removed.

**Required action.** Delete the three entries. Any consumer resolving `logo` to a missing key must degrade gracefully; verify the gallery's logo lookup has a null/undefined guard before removing (if it does not, add one — that guard is itself a required change).

**Suggested Gadzio replacement.** None. Gadzio has no equivalent service marks.
**Priority:** P1

---

### H-3 — `data/gallery.ts` holds 18 live `apple.com` URLs with Apple tracking parameters

- **Severity:** HIGH
- **State:** LATENT (gated by `apple.gallery.enabled`)
- **Required action:** REMOVE

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/gallery.ts`
**Section symbol:** `TV_GALLERY_ITEMS`, `FAM_GALLERY_ITEMS`

**Current behaviour.** 18 destination URLs across five Apple domains, each carrying `itscg=10000` and an `itsct=…` campaign token:

| Domain | Count |
| --- | ---: |
| `tv.apple.com` | 9 |
| `music.apple.com` | 3 |
| `apps.apple.com` | 3 |
| `fitness.apple.com` | 3 |

The `itsct` values (`atv-apl_hp-stream_now--220622`, `am-apl_hp-listen_now--240326`, `afp-apl_hp-watch_now--240326`, `aa-apl_hp-play_now--240326`) are Apple's own homepage campaign identifiers — attribution parameters that credit traffic to the apple.com homepage. Publishing them would send Gadzio visitors into Apple's analytics as apple.com homepage referrals.

**Required change.** Delete both arrays' URLs, or delete the gallery data module. This is the item most likely to be mistaken for "just artwork" — it is not; it is routing and attribution.

**Suggested Gadzio replacement.** None unless the gallery is repurposed with Gadzio destinations (e.g. `/in-edu/store`, category pages).
**Priority:** P1

---

### H-4 — Locale banner: three `apple.com` URLs and verbatim Apple copy, unreachable but one line from live

- **Severity:** HIGH
- **State:** DEAD-CODE (unreachable today) + LATENT
- **Required action:** REMOVE (and fix the dead state deliberately)

**Files:**
- `data/locale-banner.ts` — `options[0].href`, `options[1].href`, `continueHref`, all `https://www.apple.com/…`; `copy` is verbatim Apple copy ("Choose another country or region to see content specific to your location and shop online.")
- `LocaleBanner.tsx` — renders those hrefs at lines 63 and 75, defaulting to the data module when no override is supplied
- `AppleHomePage.tsx:57` — `const [bannerVisible, setBannerVisible] = useState(false)`

**Current behaviour.** `bannerVisible` starts `false`; the only writer is `onDismiss` → `setBannerVisible(false)`. There is no `useEffect` and no code path that sets it `true`. **The locale banner has never rendered and cannot render.** Its three Apple URLs are unreachable.

**Why it is dangerous.** This is a benign accident, not a design. The component, its data and its three Apple destinations are fully intact; one line (`useState(true)`, or a `useEffect` restoring a dismissed-banner preference) makes it live. The `apple.locale_banner` collection is `disablable: true` and its admin prefill (`APPLE_LOCALE_BANNER_DEFAULTS.continueHref`) is `https://www.apple.com/in/` — so an admin saving that form writes an Apple URL into a live row.

**Required change.** Choose deliberately: either delete `LocaleBanner.tsx` + `locale-banner.ts` + the `apple.locale_banner` collection (recommended — the banner serves an Apple country-selector purpose Gadzio does not have), or de-brand the data and fix the visibility logic so the dead state is intentional rather than accidental. Do not leave it as-is.

**Suggested Gadzio replacement.** None — deletion. If a region notice is ever needed, it should offer Gadzio's own market.
**Priority:** P1

---

### H-5 — `Ribbon.tsx` fallback is verbatim Apple India promotional copy

- **Severity:** HIGH
- **State:** LATENT (active whenever `apple.ribbon` has no `text`)
- **Required action:** REPLACE

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/Ribbon.tsx`
**Section symbol:** the `text ? … : …` false branch (lines 45–78)

**Current behaviour.** When `content?.text` is unset, the component renders:

> "Get up to **6 months of No Cost EMI***** plus up to **₹15000 instant cashback**‡ on selected products with eligible cards. Shop ›"

with footnote anchors to `#footnote-*` and `#footnote-‡`. The component's own doc comment (lines 15–16) states: *"Matches Apple India (apple.com/in) promotional copy."*

The live `apple.ribbon` row supplies student-pricing text, so this copy is not on screen today. It renders the moment the row is deleted, the text is cleared, or an admin saves the form with an empty text field.

**Why it is dangerous.** The EMI/cashback figures and the footnote markers are Apple India's offer terms. Publishing them at a different merchant states offer conditions that do not exist — a consumer-protection exposure, not merely a branding one.

**Required change.** Replace the fallback with Gadzio's own offer text and matching footnote anchors, or make an absent `text` render nothing (the safest default for an offer strip).

**Suggested Gadzio replacement.** Either render `null` when `text` is empty, or Gadzio's actual current offer with a `#footnote` anchor that exists in the Gadzio footer.
**Priority:** P1

---

### H-6 — Admin prefill defaults carry `Apple` titles and 10 literal `apple.com` URLs

- **Severity:** HIGH
- **State:** CONFIGURATION (admin prefill — becomes live data on save)
- **Required action:** REPLACE

**File:** `src/lib/admin/defaults.ts`
**Section symbol:** the `DEFAULTS` registry (lines 510–518) and its five `apple.*` entries

**Current behaviour.** These values prefill the admin editor. They do not render directly, but the editor writes back what it shows, so **any save of these forms publishes the prefilled Apple values as a live row.**

| Object | Line | Apple value |
| --- | ---: | --- |
| `APPLE_SEO_DEFAULTS` | ~194 | `title: 'Apple'`; `ogTitle: 'Apple'`; description "Discover the innovative world of Apple and shop everything iPhone, iPad, Apple Watch, Mac, and Apple TV…" |
| `APPLE_RIBBON_DEFAULTS` | ~135 | `shopHref: 'https://www.apple.com/in/shop/goto/store'` |
| `APPLE_LOCALE_BANNER_DEFAULTS` | 138–143 | `continueHref` inherited from `LOCALE_BANNER.continueHref` = `https://www.apple.com/in/` |
| `APPLE_NAV_DEFAULTS` | 145–149 | Derived from `NAV_ITEMS` (currently clean, but inherited wholesale — a future `nav.ts` Apple destination propagates automatically) |
| `CASES_CATEGORY_LINKS_DEFAULTS` | 471–478 | **7** `apple.com` hrefs |
| `CASES_SEO_DEFAULTS` | 501–503 | `title: 'Cases & Protection - iPhone Accessories - Apple (IN)'`; description "Shop iPhone cases and protection from Apple…" |

The SEO default is the sharpest edge: `apple.seo` has **no row**, so `page.tsx` currently renders the correct Gadzio metadata. The moment an editor opens the Homepage SEO form and saves it, the page title becomes `Apple` and the meta description becomes Apple's.

**Required change.** Replace all 13 values with Gadzio equivalents. `APPLE_SEO_DEFAULTS` must match `page.tsx`'s existing hardcoded fallback (`'Gadzio'` + the Gadzio `DESCRIPTION`) so the admin and the code agree.

**Suggested Gadzio replacement.**
- `APPLE_SEO_DEFAULTS` → the same values already in `page.tsx:13-27`
- `CASES_CATEGORY_LINKS_DEFAULTS` → `/in/shop/iphone/accessories/cases-protection`-family internal routes
- `CASES_SEO_DEFAULTS` → Gadzio title/description
- `APPLE_RIBBON_DEFAULTS.shopHref` / `APPLE_LOCALE_BANNER_DEFAULTS.continueHref` → internal routes (or remove with the locale banner)

**Risk if unchanged.** Every admin form save is an opportunity to publish Apple titles and Apple URLs. This is the highest-frequency re-entry point in the codebase.
**Priority:** P1

---

## 7. Medium Priority Changes

---

### M-1 — Admin panel labels and descriptions name Apple as the site

- **Severity:** MEDIUM · **State:** INTERNAL-ONLY · **Required action:** RENAME
- **File:** `src/lib/admin/collections.ts`

| Line | Current | Suggested |
| ---: | --- | --- |
| 79 | `/* ---- Apple site */` | `/* ---- Gadzio homepage */` |
| 171 | `/* — Apple homepage (route: /) — */` | `/* — Gadzio homepage (route: /) — */` |
| 241 | `'Global Nav (all Apple pages)'` | `'Global Nav (all Gadzio pages)'` |
| 251 | `'Global Footer (all Apple pages)'` | `'Global Footer (all Gadzio pages)'` |
| 265 | `'The Apple TV / Music gallery carousel copy and layout.'` | `'The entertainment carousel copy and layout.'` |
| 463 | `'Edu Store — The Apple Store Difference'` | `'Edu Store — Why Buy From Gadzio'` |
| 464 | `'"The Apple Store difference." — the reasons-to-shop-with-us rail.'` | `'The reasons-to-shop-with-us rail.'` |
| 491 | `'Edu Store — The Apple Experience'` | `'Edu Store — The Gadzio Experience'` |
| 492 | `'"The Apple experience." — apps and services.'` | `'Apps and services.'` |
| 580 | `{ path: 'appleCopyright', label: 'Apple footer copyright' }` | `{ path: 'gadzioCopyright', label: 'Footer copyright' }` |

**Why it matters.** The last one is not cosmetic: `appleCopyright` is a **theme-settings key** consumed by `page.tsx:78`. Renaming it is a data migration (see §14 and §19 Phase 5).

**Note.** `ThemeEditor.tsx:12` already holds the correct *value* (`'Copyright © 2026 Gadzio. All rights reserved.'`) — only the key name is Apple-derived.

---

### M-2 — TOTP issuer is `Apple Clone Admin`, written into every staff authenticator app

- **Severity:** MEDIUM · **State:** ACTIVE (internal-facing) · **Required action:** CHANGE
- **File:** `src/lib/admin/totp.ts` — `const ISSUER = 'Apple Clone Admin';`

**Why it matters.** This string is displayed in Google Authenticator / Authy / 1Password on every admin's phone. It is the most frequently *seen* Apple reference in the product. Changing it also changes the expected TOTP label — existing enrolments must be re-enrolled or the issuer change coordinated, so treat this as a small migration, not a one-line edit.

**Suggested replacement.** `'Gadzio Admin'`.

---

### M-3 — Cart storage key is `gadzio_apple_cart_v1`

- **Severity:** MEDIUM · **State:** ACTIVE · **Required action:** MIGRATE
- **File:** `src/lib/cart/CartContext.tsx:39` — `const STORAGE_KEY = 'gadzio_apple_cart_v1';`
Referenced at lines 53 (hydrate), 71 (save), 80 (storage listener), 160 (remove).

**Why it matters.** It is customer-visible via devtools and, more practically, it is the one identifier that a partial migration could break: renaming the key without a read-migration **empties every live cart**. The predecessor audit's instruction was *do not perform this migration*; that still stands. When it is performed, hydrate from the old key and write to the new one for one release.

**Suggested replacement.** `gadzio_cart_v1` (with a one-time read of `gadzio_apple_cart_v1`).

---

### M-4 — "App Store" badge rendered alongside Google Play and AppGallery

- **Severity:** MEDIUM · **State:** ACTIVE (user-visible) · **Required action:** REMOVE
- **File:** `src/components/auth/AuthForm.tsx:279-295`

**Current behaviour.** A dark-badge SVG labelled "App Store" sits between the genuine Google Play and AppGallery badges. Apple neither publishes via the App Store for a third-party storefront nor endorses this one; the badge implies an Apple distribution channel that does not exist.

**Required change.** Remove the badge and its SVG. Google Play and AppGallery are legitimate (real, unrelated third-party platforms). One of the three does not belong.

---

### M-5 — Brand-switcher prop value is the literal string `'apple'`

- **Severity:** MEDIUM · **State:** ACTIVE (internal value; rendered text is clean) · **Required action:** RENAME
- **File:** `src/components/common/FloatingBrandSwitcher.tsx`

`currentBrand?: 'apple' | 'oppo'` with default `'apple'`; `const isApple = currentBrand === 'apple'`; caller passes `currentBrand="apple"` (`GlobalNav.tsx:355`). Comment: *"'apple' means currently on Gadzio/Apple site."*

**Why it matters.** Low user impact (rendered text is "Android"/"Gadzio"), but it is a public prop contract naming the wrong brand. Rename to `'gadzio' | 'oppo'` and update the caller.

**Note.** The `'oppo'` value is legitimate — OPPO is a real third-party brand the site resells.

---

### M-6 — Component directory path encodes the source URL

- **Severity:** MEDIUM · **State:** INTERNAL-ONLY · **Required action:** RENAME
- **Paths:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/` (~30 files) and the mirrored `public/sites/www-apple-com-736d3707/root-8a5edab2/` (306 files)

**Why it matters.** Every import specifier, every asset path in every data module, and every admin `sitePaths` reference repeats an Apple hostname. It makes Apple the name of the primary namespace of the codebase. The hash suffixes (`736d3707`, `8a5edab2`) are scraper artefacts with no meaning.

**Required change.** Rename to something like `src/components/sites/gadzio/home/`. This is mechanically wide (≈30 imports + 269 asset paths) and belongs in Phase 5 as a single automated pass, not incrementally.

---

### M-7 — Content keys are namespaced `apple.*`

- **Severity:** MEDIUM · **State:** ACTIVE + DATABASE · **Required action:** MIGRATE
- **Files:** `src/app/page.tsx` (8 keys), `src/lib/content.ts`, `src/lib/admin/collections.ts` (9 keys), `src/lib/admin/defaults.ts` (9 keys), `src/app/in-edu/store/page.tsx`

**Why it matters.** The key `apple.seo` is the wire format between the CMS and the homepage. It is also the reason the latent paths are hard to audit: `apple.gallery.enabled === false` reads as neutral configuration when the underlying content is Apple TV+ (H-1). Renaming to `home.*` / `gadzio.*` is a DB + code migration that must be atomic (rename rows and code in one deploy, or read both keys for one release).

**Do not** change keys before §5 C-1/C-2/C-3 are fixed — the rename touches the same files and would obscure the review.

---

### M-8 — Homepage OG image path is the Apple asset path

- **Severity:** MEDIUM · **State:** ACTIVE · **Required action:** REPLACE
- **File:** `src/app/page.tsx:26` — `images: ['/sites/www-apple-com-736d3707/root-8a5edab2/seo/open_graph_logo.png']`

**Why it matters.** The asset at `<meta property="og:image">` is what every social share preview of the Gadzio homepage displays. Its path names Apple, and its content is an Apple-era brand asset (content is asset work — excluded per §17 — but the *reference* is a required code change).

**Correction of the predecessor audit's framing.** The previous audit noted this as "code references Apple asset" — accurate. The stronger point is that this is the most externally distributed single reference in the repository: it is fetched by every social crawler.

**Required change.** Repoint to a Gadzio OG image once one exists. Also note the adjacent bug: `metadataBase: new URL('http://localhost:3000')` (§15 F-4).

---

### M-9 — `/in-edu/store` content links point at 38 non-existent routes

- **Severity:** MEDIUM · **State:** DEAD-CODE · **Required action:** INVESTIGATE
- **File:** `src/components/sites/edu-store/data/content.ts`

38 distinct `/in-edu/shop/...` hrefs, several containing literal `apple-watch` path segments. No `/in-edu/shop/*` route exists (the route tree has only `/in-edu/store`).

**Why it matters.** Two reasons. First, these are dead links in a page that otherwise renders correctly — every "How to buy" and category link 404s. Second, the `apple-watch` segments are the clearest remaining example of Apple product naming inside a Gadzio path.

**Required change.** Decide per link: repoint to the Gadzio category routes (`/in/shop/iphone/accessories/*`) or remove. Do **not** create `/in-edu/shop/...` routes — the predecessor spec explicitly forbids it.

---

## 8. Low Priority Changes

| # | Finding | File / symbol | State | Action |
| --- | --- | --- | --- | --- |
| L-1 | Header comments state content is "verbatim from https://www.apple.com/" | `data/tiles.ts:1-3`, `data/gallery.ts:1-2`, `data/locale-banner.ts:1-2`, `icons.tsx:1-2` | INTERNAL-ONLY | REPLACE with a provenance note that does not assert verbatim copying |
| L-2 | Comment "Apple ID-style sign-in/sign-up" | `src/lib/user-auth.ts:7` | INTERNAL-ONLY | Reword |
| L-3 | Comments "Apple Education Store (India) — page-scoped styles" / "Apple ships each sticker as a horizontal sprite sheet" | `src/app/in-edu/store/edu-store.css:2, :185` | INTERNAL-ONLY | Reword |
| L-4 | Comment asserts Apple India copy is the source of truth | `Ribbon.tsx:15-16` | INTERNAL-ONLY | Reword (pairs with H-5) |
| L-5 | Comment "Page shell for the www.apple.com/ clone" | `AppleHomePage.tsx:25` | INTERNAL-ONLY | Reword |
| L-6 | CSS comment in footer data referencing `.ac-gf-sosumi` | `data/footer.ts:43` | INTERNAL-ONLY | Resolve during the §13 namespace migration |

**Severity rationale.** None of these render. They are recorded because each is a *justification* for Apple-shaped code sitting next to the Apple-shaped code, and because leaving them makes a future reviewer assume the verbatim-copy provenance is still intended.

---

## 9. `/in-edu` Audit

| Item | Finding |
| --- | --- |
| Metadata | ✅ Clean — Gadzio title, Gadzio OG URL, `/gadzio_logo.png` |
| Apple URLs | ✅ Zero (`grep` over `src/app/in-edu/` → 0 matches) |
| Render path | ✅ Fully code-driven — **no `edu.*` rows exist in `content_blocks`** |
| Content keys read | `edu.hero`, `edu.product_nav`, `edu.quick_links`, `edu.seo`, plus 7 × `edu.shelf_*` |
| **`edu.shelf_*` editable?** | ❌ **No admin collection exists** for the seven `edu.shelf_*` keys (collections define only `edu.hero`, `edu.product_nav`, `edu.quick_links`, `edu.seo`). The page reads keys an editor can never write → §15 F-5 |
| `edu.seo` row | Absent — code default renders. `EDU_SEO_DEFAULTS` is registered, so a form save would publish it |
| Brand tokens | ✅ All Gadzio — `GADZIOCARE+`, `GADZIO CLOUD+`, `GADZIO CREATOR STUDIO`, `GADZIO FOR UNIVERSITY`, `GADZIO SPECIALIST`, `GADZIO TRADE IN`, `Today at Gadzio` |
| Dead links | ⚠️ 38 distinct `/in-edu/shop/...` hrefs → §7 M-9 |
| Trademark safety | ✅ No Apple naming in rendered copy |
| CSS | ⚠️ Comments only → §8 L-3 |

**Conclusion.** `/in-edu` is the cleanest surface in the repository: no Apple URLs, no Apple naming in rendered copy, correct metadata, correct brand tokens. Its two real problems are functional (dead links, uneditable shelves), not branding.

---

## 10. Admin/CMS Audit

| Item | Severity | Finding |
| --- | --- | --- |
| **No `internal` link field** | CRITICAL | `TILE_ITEM_FIELDS` exposes no internal/external control → §5 C-2 |
| **New CTA loses `internal`** | CRITICAL | `mergeTile` new-slot branch omits it → §5 C-1 |
| **No `internal` control for new tiles** | CRITICAL | `mergeTiles` clones the Apple Card tile → §5 C-2 / C-4 |
| **`apple.seo` prefill is `'Apple'`** | HIGH | One SEO form save retitles the homepage → §6 H-6 |
| **7 `apple.com` hrefs in cases defaults** | HIGH | `CASES_CATEGORY_LINKS_DEFAULTS` → §6 H-6 |
| **Locale-banner prefill is apple.com** | HIGH | `APPLE_LOCALE_BANNER_DEFAULTS.continueHref` → §6 H-6 |
| **Ribbon prefill `shopHref` apple.com** | HIGH | `APPLE_RIBBON_DEFAULTS` → §6 H-6 |
| **Gallery re-enable is one toggle** | HIGH | Row holds Apple TV+ copy → §6 H-1 |
| **Apple labels throughout** | MEDIUM | 10 labels/descriptions → §7 M-1 |
| **`appleCopyright` theme key** | MEDIUM | Consumed by `page.tsx:78`; value already correct → §7 M-1 |
| **TOTP issuer** | MEDIUM | `'Apple Clone Admin'` shown in authenticator apps → §7 M-2 |
| **`apples.shelf_*` uneditable** | FUNCTIONAL | Page reads keys no collection exposes → §15 F-5 |
| `site_settings` | ✅ | Empty — code defaults are live |
| Admin auth gate | ✅ | `proxy.ts` cookie gate + 401 on mutating `/api/admin`; no Apple reference |
| Admin SEO keys per site | ✅ | `sitePaths` correctly scopes `apple.*` to `/`, `edu.*` to `/in-edu/store`, `oppo.*` to `/android` |

**Structural conclusion.** The admin panel is where Apple re-enters. Every HIGH finding above is a *prefill* or a *toggle* — the panel does not contain Apple content so much as it is configured to write Apple content. Fixing `defaults.ts` (H-6) and adding the `internal` field (C-1/C-2) removes the entire class.

---

## 11. Search / Cart / Checkout Audit

| # | Item | Severity | State | Finding |
| --- | --- | --- | --- | --- |
| S-1 | `searchService.ts:53` | LOW | DEAD-CODE | Keyword `'apple'` in the search-term list. Harmless if Gadzio sells compatible accessories, but it is a bare Apple token whose only effect is to match Apple queries. Remove unless deliberately retained. |
| S-2 | `searchService.ts:153-156` | FUNCTIONAL | ACTIVE | `name: 'iPhone Cases & Protection Store'` with `image: '/sites/edu-store/images/category-iphone.png'` — **the image file does not exist on disk.** Renders a broken search-result thumbnail. |
| S-3 | `searchService.ts:244` | LOW | ACTIVE | `POPULAR_SEARCH_LINKS` includes `{ label: 'iPhone 17 Silicone Cases', href: '/search?q=silicone' }`. Product name → LEGITIMATE. Flagged only so the decision is deliberate. |
| S-4 | `CheckoutForm.tsx:27-52` | MEDIUM | LATENT | Fallback cart item `name: 'iPhone 17 Silicone Case with MagSafe - Black'` (line 34). Renders only when a cart line is malformed — but if it does, the customer sees a hardcoded product they never added. |
| S-5 | `CartContext.tsx:39` | MEDIUM | ACTIVE | Storage key `gadzio_apple_cart_v1` → §7 M-3 |
| S-6 | `searchTracker.ts:11` | ✅ | — | `gadzio_search_history_v1` clean |
| S-7 | `/search` route | ✅ | — | No Apple URLs |

**Product-name policy applied.** `iPhone`, `MagSafe`, `AirPods` as *compatibility* terms are LEGITIMATE-KEEP (§16). S-2, S-4 and S-5 are flagged for the defects that accompany the names — a missing image, a hardcoded fallback, an Apple-named key — not for the names.

---

## 12. SEO / Metadata Audit

| Surface | Current | Severity | Action |
| --- | --- | --- | --- |
| `/` title | `'Gadzio'` (code) | ✅ | — |
| `/` description | Gadzio accessory copy | ✅ | — |
| `/` OG title/siteName | `'Gadzio'` | ✅ | — |
| `/` OG URL | `https://gadzio.in/` | ✅ | — |
| **`/` OG image** | `/sites/www-apple-com-736d3707/root-8a5edab2/seo/open_graph_logo.png` | MEDIUM | REPLACE → §7 M-8 |
| **`metadataBase`** | `http://localhost:3000` | FUNCTIONAL | CHANGE → §15 F-4 |
| `/` favicon | `/gadzio_logo.png` | ✅ | — |
| `apple.seo` row | Absent — code default renders | ✅ | but prefill is `'Apple'` → §6 H-6 |
| `/in-edu/store` | Gadzio title + OG URL + icon | ✅ | — |
| `/terms` | Names Apple Inc. as trademark owner + non-affiliation statement | LEGITIMATE | KEEP → §16 |
| JSON-LD | None found | ✅ | — |
| Robots | Admin routes `index: false, follow: false` | ✅ | — |

**Note on `metadataBase`.** `http://localhost:3000` is baked into the module-level `metadata` object at `page.tsx:15`. Relative OG image URLs resolve against it, so in production the OG image URL is emitted as `http://localhost:3000/...` and no crawler can fetch it. This is a live SEO defect independent of branding.

---

## 13. CSS / Namespace Audit

| Token | Count | Severity | Assessment |
| --- | ---: | --- | --- |
| `--ac-*` custom properties | 87 | MEDIUM | `ac` = Apple Clone. Purely internal, zero user impact. Wide mechanical rename (must be atomic — a partial rename silently drops styling). |
| `ac-*` classes / ids | 262 | MEDIUM | Same. Includes `.ac-sosumi`, `.ac-gf-sosumi`, `.ac-button`, `.ac-footnote-number`, `.ac-visuallyhidden`, `.ac-root`. |
| `#globalnav` | — | LOW | Structural id, brand-neutral name. `GlobalNav` also reads/uses `#globalnav-curtain`, `globalnav-submenu-*`. LEGITIMATE-KEEP unless the markup is touched anyway. |
| `#ac-globalfooter` | — | MEDIUM | `GlobalFooter.tsx:31`. Apple-prefixed id. |
| `am:` / `anav:` / `al:` breakpoints | — | LEGITIMATE | Tailwind aliases. Neutral. |
| `-apple-system`, `BlinkMacSystemFont` | — | LEGITIMATE-KEEP | CSS system-font keywords — universal, not an Apple asset. |

**Guidance.** Do not split this migration. Renaming `--ac-*` in one file and `ac-*` in another leaves the page unstyled with no error. Treat as a single Phase 5 pass with a visual diff.

---

## 14. Configuration / Package Audit

| # | File | Current | Severity | Action |
| --- | --- | --- | --- | --- |
| G-1 | `package.json` | `"name": "apple-clone"` | MEDIUM | RENAME to `gadzio-storefront` |
| G-2 | `package.json` | `"description": "Pixel-perfect clone of the apple.com homepage"` | MEDIUM | REPLACE |
| G-3 | `README.md:1` | `# apple.com homepage clone` | MEDIUM | REPLACE |
| G-4 | `README.md:26-30` | Describes `apple-clone.css` and `AppleHomePage.tsx` | LOW | UPDATE after §13/§7 M-6 |
| G-5 | `README.md:60-62` | "© Apple Inc." / "assets aren't licensed for" redistribution | LOW | Investigate licensing intent; do not silently delete a licence statement |
| G-6 | **`README.md:66`** | **"Outbound links still point at apple.com, so clicking a CTA navigates off-site."** | MEDIUM | **STALE AND WRONG.** This was true before Phase 1. It is now false and actively misleading — a maintainer reading it would conclude the Apple-link problem is known and accepted. Correct it. |
| G-7 | `skills-lock.json` | Pins `apple-design` from `emilkowalski/skills` | LOW | Decide: remove the pin, or keep and document. It installs Apple design guidance into the skills directory. |
| G-8 | `.agents/skills/apple-design/SKILL.md` | 290 lines, untracked | LOW | Same decision as G-7 |
| G-9 | `scripts/fix-apple-destinations.mjs`, `fix-footer-row.mjs`, `inspect-apple-keys.mjs` | Phase 1 migration/audit helpers; self-guarded read-only | LEGITIMATE | Keep or archive. Apple-named, but historically accurate and harmless. |
| G-10 | `.claude/worktrees/whimsical-jumping-valiant` | Second git worktree — a full duplicate checkout | MEDIUM | INVESTIGATE. It doubles the surface of any future grep-based audit and can silently serve stale code if a tool resolves against it. Remove when no longer needed. |
| G-11 | `public/sites.original-backup` | 321 files / 64 MB | LOW | Same as G-10 — it also holds the pre-deletion copies of the 26 missing tile images (§15 F-3), which is why the missing-file check must exclude it. |
| G-12 | `next.config.*`, `tsconfig.json`, `proxy.ts` | No Apple references | ✅ | — |

---

## 15. Functional Bugs

Bugs found during the audit that are **not** branding issues. Recorded because they affect the same files and should be batched with the Phase 2 work.

| # | Bug | File / line | Severity | Detail |
| --- | --- | --- | --- | --- |
| **F-1** | Apple URL injection via new CTA slot | `admin-overrides.ts:118-124` + `TileCard.tsx:29-30` | CRITICAL | §5 C-1. A second CTA added to the live hero tile 0 renders `https://www.apple.com/in-edu/store`. |
| **F-2** | Apple URL injection via added tile | `admin-overrides.ts:140-150` + `collections.ts:82-92` | CRITICAL | §5 C-2. Every tile an editor adds inherits the Apple Card template's missing `internal`. |
| **F-3** | 26 tile-image references do not resolve on disk | `data/tiles.ts` | MEDIUM | **3 of them are live.** `4_iph_case_small.jpg` / `6_iph_case_small_2x.jpg` / `2_iph_case_medium_2x.jpg` belong to promo tile 4 ("Mobile Cases"), which the live DB row renders with blank image overrides — so the code images are used. On disk the equivalents are `4_iph_case__small.jpg`, `6_cases_iph_small_2x.jpg`, `2_iph_case__medium_2x.jpg`: **single-vs-double underscore and a renamed prefix.** The other 23 (hero tile 2 "MacBook Air" ×10, Apple Card ×12, plus 1) belong to unrendered tiles. Fixing the three filename mismatches is a text edit in `tiles.ts`, not image work. |
| **F-4** | `metadataBase` is `http://localhost:3000` | `page.tsx:15` | MEDIUM | Production OG image URLs point at localhost; social previews cannot fetch them. |
| **F-5** | `/in-edu/store` reads 7 `edu.shelf_*` keys that no admin collection exposes | `src/app/in-edu/store/page.tsx:14-20` vs `collections.ts:428-513` | LOW | Shelf content is unreachable from the CMS. Either add the collections or stop reading the keys. |
| **F-6** | Locale banner is unreachable by construction | `AppleHomePage.tsx:57` | LOW | `bannerVisible` can never become `true`. Dead component + dead data + 3 Apple URLs. Decide: delete or wire up. |
| **F-7** | Search category image missing | `searchService.ts:156` | LOW | `/sites/edu-store/images/category-iphone.png` does not exist → broken thumbnail. |
| **F-8** | Ribbon footnote anchors `#footnote-*` / `#footnote-‡` | `Ribbon.tsx:50, 60` | LOW | Anchor targets are not verified to exist in the rendered page. Only reachable via the Apple-copy fallback (H-5), which is itself being replaced — resolve together. |

**Not counted as bugs** (verified clean): duplicate route trees `/shop/iphone/accessories/cases-protection` and `/in/shop/iphone/accessories/cases-protection` both exist and are intentional; all DB-row hrefs resolve to real routes; all 243 of the 269 referenced asset paths that are not in F-3 resolve on disk.

---

## 16. Legitimate Apple References — KEEP

Explicitly **not** findings. Recorded so they are not "cleaned up" by mistake.

**1. Product compatibility terms.** iPhone, iPad, Mac, MacBook, AirPods, Apple Watch, Apple Pencil, MagSafe, AirTag, Qi2, Lightning, Thunderbolt, "Apple devices". Gadzio sells accessories for these products; naming them is accurate and necessary. Applies to `data/nav.ts` search terms (`magsafe+charger`, `airpods+4`, `airtag`, `thunderbolt`, `earpods+usb-c`, `iphone+17`), product names in `searchService.ts` and `CheckoutForm.tsx`, and PDP copy.

**2. Anti-affiliation trademark statements.** `ProductDetailPage.tsx:659-661`, `CasesProtectionPage.tsx:268-270`, `airpods-case.ts:38`, `mobile-cases.ts:44`, `power-adapter-cable.ts:34`, `wired-earphones.ts:35`. These disclaim affiliation and assert third-party ownership of the marks — legally protective, not a branding defect. *Recommend a one-time legal review; do not remove as part of a de-branding pass.*

**3. `src/app/terms/page.tsx:78`.** Names Apple Inc. as trademark owner with an explicit non-affiliation statement. Same reasoning as (2).

**4. `FONT_FALLBACK` in `layout.tsx`.** `-apple-system, BlinkMacSystemFont` are CSS system-font keywords, not Apple assets or services.

**5. `currentBrand="oppo"`.** OPPO is a genuine third-party brand the site resells. The `/android` route is a real product surface.

**6. Icon and asset directories named for scraped Apple pages** — recorded under §7 M-6 as a rename candidate, but the *asset filenames* themselves (`hero_macbook_air_m5__*`, `promo_apple_card__*`) are asset work → §17.

**7. `scripts/fix-apple-destinations.mjs` / `fix-footer-row.mjs` / `inspect-apple-keys.mjs`.** Historically accurate Phase 1 tooling; read-only and guarded.

**8. `#globalnav`, `am:` / `anav:` / `al:` breakpoints.** Brand-neutral names.

**9. `.ac-*` CSS namespace — judgement call.** Internal-only with zero user impact. Listed as MEDIUM (§13) for completeness, not because it is visible. Deferring it entirely is a defensible decision.

**10. `/shop/iphone/accessories/*` route paths.** Product-category routing, accurate and useful.

**11. Genuine Google Play and AppGallery badges** (`AuthForm.tsx`) — real third-party platforms. Only the "App Store" badge is the finding (§7 M-4).

**12. Chinese/Hindi or regional locale strings** in the locale data — not an Apple identity issue.

---

## 17. Asset Work — Explicitly Excluded

Per the audit brief, image/tile/artwork replacement is **not** required code work and is **not** counted in the change totals. Recorded only where code or data still *references* an asset.

**Excluded from the change plan:**

| Category | Volume | Note |
| --- | ---: | --- |
| Gallery artwork | 146 images | Consumer of §6 H-3 URLs |
| Tile artwork | 62 images | Includes the 26 unresolved references in §15 F-3 |
| Store-card artwork (edu) | 49 images | All referenced store-cards resolve (0 missing, 0 orphaned) |
| Videos | 3 | Back-to-School hero stage |
| Fonts | 5 | SF Pro files remain on disk but are no longer loaded (`layout.tsx` uses Inter) |
| Favicon | 1 | Superseded by `/gadzio_logo.png`; retained |
| OG image | 1 | Content excluded; its **path reference** is §7 M-8 |
| `public/sites.original-backup` | 321 files / 64 MB | Pre-deletion archive; holds copies of the 26 images in §15 F-3 |

**Code/data items that merely *reference* assets and ARE in scope** (already counted): §6 H-2 (`icons.tsx` SVG wordmarks — vector art in code, removable by edit), §6 H-3 (`gallery.ts` URLs), §7 M-8 (OG image path), §15 F-3 (three filename mismatches).

**Explicitly out of scope:** visual redesign, artwork replacement, photo selection, the `hero_banner1 (N).jpg` hand-edits, and whether the tile art still looks like Apple's.

---

## 18. Exact Files That Need Changes

### 18.1 Code files (18)

| # | File | Current problem | Section symbol | Current behaviour | Required change | Suggested Gadzio replacement | Risk | Pri |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `…/root-8a5edab2/TileCard.tsx` | Rewrites any non-internal href to `apple.com` | module scope `heroTileHref`, lines 29-30; callers 178, 207 | Relative href → `https://www.apple.com<href>` | REMOVE helper + 2 call sites | Pass href through; `<Link>` if internal | Every C-1/C-2/C-4 path keeps its delivery mechanism | P0 |
| 2 | `…/root-8a5edab2/admin-overrides.ts` | New CTA objects omit `internal` | `mergeTile` → `if (!cta)` branch, lines 118-124 | New CTA renders external → apple.com | Add `internal: true`; expose as admin field | Default internal; explicit toggle for real external links | Silent apple.com links on normal editing | P0 |
| 3 | `…/root-8a5edab2/admin-overrides.ts` | Added tiles clone the Apple Card tile | `mergeTiles`, lines 140-150 | Extra tiles inherit missing `internal` | Neutral internal-by-default template | New `EMPTY_TILE` template | Every added tile → apple.com | P0 |
| 4 | `src/lib/admin/collections.ts` | No `internal` field anywhere | `TILE_ITEM_FIELDS`, lines 82-92 | Admin cannot read/write link intent | Add `booleanField('internal', …)` for tiles + ctas | Default on | Editors cannot prevent apple.com links | P0 |
| 5 | `…/root-8a5edab2/data/tiles.ts` | Apple Card tile (index 5), no `internal` | `PROMO_TILES[5]`, from line 582 | `card.apple.com` apply CTA, `/apple-card/`, Apple art | DELETE the tile | None — removal | Row reset re-publishes Apple Card | P0 |
| 6 | `src/lib/admin/defaults.ts` | Apple titles + 10 apple.com hrefs | `DEFAULTS` registry, lines 510-518 | Prefills admin; save → live row | REPLACE 13 values | Match `page.tsx` Gadzio values | Every SEO/link form save publishes Apple | P1 |
| 7 | `…/root-8a5edab2/icons.tsx` | 3 Apple wordmarks with Apple glyph | `GALLERY_LOGOS`, line 57 | Renders Apple trademarks as SVG | REMOVE + add null guard in consumer | None | Apple-owned UI identity | P1 |
| 8 | `…/root-8a5edab2/Ribbon.tsx` | Verbatim Apple India EMI copy | false branch, lines 45-78 | Renders when `text` unset | REPLACE or render null | Render null on empty | Publishes Apple's offer terms as Gadzio's | P1 |
| 9 | `…/root-8a5edab2/LocaleBanner.tsx` | 3 apple.com hrefs, unreachable | lines 63, 75; `AppleHomePage.tsx:57` | Dead but intact | DELETE component + data + collection | None | One line makes 3 Apple URLs live | P1 |
| 10 | `…/root-8a5edab2/data/gallery.ts` | 18 apple.com URLs + Apple tracking params | `TV_GALLERY_ITEMS`, `FAM_GALLERY_ITEMS` | Latent, gated by `enabled` | DELETE URLs | Gadzio destinations if repurposed | Attribute traffic to apple.com | P1 |
| 11 | `…/root-8a5edab2/data/locale-banner.ts` | 3 apple.com URLs + verbatim Apple copy | `LOCALE_BANNER` | Feeds #9 | DELETE | None | Same as #9 | P1 |
| 12 | `src/lib/admin/collections.ts` | 10 Apple labels/descriptions | lines 79, 171, 241, 251, 265, 463, 464, 491, 492, 580 | Admin UI names Apple | RENAME | See §7 M-1 table | `appleCopyright` is a theme key → migration | P2 |
| 13 | `src/lib/admin/totp.ts` | `ISSUER = 'Apple Clone Admin'` | `ISSUER` const | Shown in authenticator apps | CHANGE | `'Gadzio Admin'` | Re-enrolment coordination | P2 |
| 14 | `src/lib/cart/CartContext.tsx` | `gadzio_apple_cart_v1` | `STORAGE_KEY`, line 39 | localStorage key | MIGRATE (read old, write new) | `gadzio_cart_v1` | Naive rename empties live carts | P2 |
| 15 | `src/components/auth/AuthForm.tsx` | "App Store" badge | lines 279-295 | Implies an Apple channel | REMOVE badge | None | Implied false distribution | P2 |
| 16 | `src/components/common/FloatingBrandSwitcher.tsx` | prop value `'apple'` | type/default/`isApple`/`GlobalNav.tsx:355` | Internal value; UI text clean | RENAME | `'gadzio' \| 'oppo'` | Public prop contract | P2 |
| 17 | `src/app/page.tsx` | Apple OG image path; `apple.*` keys; localhost `metadataBase` | line 15; line 26; `getContentMany` 49-60 | OG image under Apple path; keys Apple-named | REPLACE path; MIGRATE keys; fix base | Gadzio OG image; `home.*` keys; real origin | Social previews broken (F-4) | P2 |
| 18 | `…/root-8a5edab2/AppleHomePage.tsx` | Clone-shell comment; dead banner state | line 25; line 57 | Documents Apple provenance | Reword; resolve F-6 | — | Misleads future maintainers | P3 |

### 18.2 Data files (6)

| # | File | Problem | Required change | Pri |
| --- | --- | --- | --- | --- |
| D-1 | `…/root-8a5edab2/data/tiles.ts` | Apple Card tile; 26 unresolved image refs; 3 live filename mismatches | Delete tile 5; fix 3 filenames; purge Apple art refs | P0 |
| D-2 | `…/root-8a5edab2/data/gallery.ts` | 18 apple.com URLs, `itscg`/`itsct` params | Delete arrays' URLs | P1 |
| D-3 | `…/root-8a5edab2/data/locale-banner.ts` | 3 apple.com URLs + Apple copy | Delete | P1 |
| D-4 | `src/components/sites/edu-store/data/content.ts` | 38 dead `/in-edu/shop/*` hrefs incl. `apple-watch` segments | Repoint or remove (do **not** create routes) | P2 |
| D-5 | `…/root-8a5edab2/data/nav.ts` | Comments only; search terms are LEGITIMATE | Comment de-brand; keep terms | P3 |
| D-6 | `…/root-8a5edab2/data/footer.ts` | Comments only | Comment de-brand | P3 |

### 18.3 Database (read-only findings)

| # | Row | Problem | Required change | Pri |
| --- | --- | --- | --- | --- |
| DB-1 | `apple.gallery` | 5 Apple TV+ show captions in a live row | Clear captions, or delete the row (safe — fallback is `{enabled:false}`) | P1 |
| DB-2 | `apple.footer` | Contains "Apple" — legitimate compatibility footnote | KEEP | — |
| DB-3 | `apple.hero_tiles`, `apple.hero_video`, `apple.promo_section`, `apple.ribbon` | Content is clean; **keys** are Apple-named | No content change. Key rename is part of the §7 M-7 migration | P2 |
| DB-4 | `site_settings` | Empty | No action | — |

### 18.4 Config / package / docs (7)

`package.json` (name, description) · `README.md` (incl. the stale line 66) · `skills-lock.json` · `.agents/skills/apple-design/` · `.claude/worktrees/whimsical-jumping-valiant` · `public/sites.original-backup` · `src/app/layout.tsx` (no change — system-font keywords are legitimate).

---

## 19. Recommended Phase Order

**Nothing below has been performed.** These are recommendations.

### Phase 2 — Code/data cleanup (do this first; small, high-value, independently shippable)

1. Delete `heroTileHref` and its call sites (§5 C-3).
2. Add `internal` to the admin schema and default it to `true` (§5 C-1, C-2; §18 code files 2–4).
3. Delete the Apple Card tile (§5 C-4).
4. Purge Apple URLs and Apple copy from `defaults.ts` (§6 H-6).
5. Delete `GALLERY_LOGOS` Apple wordmarks (§6 H-2) and the `gallery.ts` / `locale-banner.ts` URLs (§6 H-3, H-4).
6. Replace the `Ribbon.tsx` fallback (§6 H-5).
7. Fix the three live filename mismatches (§15 F-3) and `metadataBase` (§15 F-4).

**Exit criteria:** an editor cannot produce a gadget link to `apple.com` through any admin action; zero `apple.com` URL strings remain in `src/`; the homepage renders identically.

### Phase 3 — `/in-edu` functional

- Resolve the 38 dead `/in-edu/shop/*` hrefs (§7 M-9).
- Add `edu.shelf_*` collections or stop reading those keys (§15 F-5).
- Fix the missing search category image (§15 F-7).

**Exit criteria:** no 404s from `/in-edu/store`; shelf content editable or deliberately code-only.

### Phase 4 — Admin/default protection

- Clear the Apple TV+ captions from the `apple.gallery` row (§6 H-1).
- Remove the "App Store" badge (§7 M-4).
- Remove/replace the Apple-named admin labels (§7 M-1).
- Change the TOTP issuer with a coordinated re-enrolment (§7 M-2).
- Decide the gallery's future: keep (re-caption + re-art) or delete the row and the module.

**Exit criteria:** no admin surface names Apple; no DB row contains Apple-derived content.

### Phase 5 — Naming / namespace migration (single atomic pass per namespace)

- `apple.*` content keys → `home.*` / `gadzio.*` (code + DB in one deploy, or dual-read for one release).
- `www-apple-com-736d3707/root-8a5edab2` → `sites/gadzio/home/` (≈30 imports + 269 asset paths).
- `--ac-*` / `ac-*` → `gz-*` (87 + 262 occurrences, one pass, visual diff).
- `gadzio_apple_cart_v1` → `gadzio_cart_v1` with a read-migration.
- `appleCopyright` theme key rename.
- `currentBrand: 'apple'` → `'gadzio'`.
- `package.json` name/description; README rewrite.

**Exit criteria:** `grep -ri apple src/` returns only §16 legitimate references.

### Phase 6 — Final verification

Run the §20 checklist. Confirm the counts in §1.2 move to: `apple.com` URLs in `src/` = 0; files with `Apple` = only §16 legitimate.

---

## 20. Final Verification Checklist

Run after each phase.

**Code**
- [ ] `grep -rE 'https?://[a-z.]*apple\.com' src/` → **0 matches** (present: 36 in 6 files)
- [ ] `grep -rn 'heroTileHref' src/` → **0 matches**
- [ ] `grep -n 'internal' src/lib/admin/collections.ts` → **≥1 match** (present: 0)
- [ ] `grep -rn "APPLE_SEO_DEFAULTS" -A4 src/lib/admin/defaults.ts` → title is `'Gadzio'`
- [ ] `grep -rn "apple\.card\|card\.apple\.com\|apple-card" src/` → 0 matches

**Data**
- [ ] `PROMO_TILES` length is 5 (present: 6)
- [ ] `grep -c 'apple_card' src/.../data/tiles.ts` → 0
- [ ] `gallery.ts` and `locale-banner.ts` contain no `apple.com`

**Database** (read-only check via `node scripts/inspect-apple-keys.mjs`)
- [ ] `apple.gallery` contains no Apple TV+ captions (or the row is absent)
- [ ] No row contains Apple *marketing* copy (the compatibility footnote in `apple.footer` is allowed)
- [ ] `site_settings` still empty, or contains only Gadzio values

**Behaviour — manual, with the admin panel open**
- [ ] Add a second CTA to hero tile 0 with href `/in-edu/store` → link target is `/in-edu/store`, **not** `https://www.apple.com/in-edu/store`
- [ ] Add a new promo tile with a relative href → link target is that relative path
- [ ] Save the Homepage SEO form without editing → page title stays `Gadzio`
- [ ] Toggle the gallery on → no Apple TV+ caption or apple.com artwork appears
- [ ] Delete the `apple.promo_section` row temporarily → no Apple Card tile appears
- [ ] Clear the `apple.ribbon` text → no EMI/cashback copy appears

**Assets**
- [ ] All referenced image paths resolve (present: 26 unresolved, 3 live)
- [ ] The three live mismatches (`4_iph_case_small.jpg`, `6_iph_case_small_2x.jpg`, `2_iph_case_medium_2x.jpg`) are corrected in `tiles.ts`

**Metadata**
- [ ] Rendered OG image URL is absolute and on the production origin (present: `http://localhost:3000/...`)
- [ ] `view-source` on `/` shows no `apple.com`

**Repository hygiene**
- [ ] `git status` shows only intended changes
- [ ] No file outside the stated scope was touched
- [ ] `.claude/worktrees/whimsical-jumping-valiant` removed or confirmed intentional
- [ ] `README.md:66` no longer claims outbound links point at apple.com

---

## 21. Remaining Questions / Decisions

These cannot be settled from the code. Each blocks or reshapes a phase.

1. **Does Gadzio want the entertainment gallery at all?**
   The gallery is a Netflix-for-Apple-services carousel. If Gadzio has no equivalent, delete the row *and* `data/gallery.ts` *and* `EndlessEntertainmentGallery.tsx` *and* `GALLERY_LOGOS` — one decision retires findings H-1, H-2, H-3 and a chunk of §13. If it is wanted, it needs Gadzio content and destinations, which is asset work plus copywriting. **Blocks Phase 4.**

2. **Does Gadzio need a country/region selector?**
   If not, delete the locale banner outright (H-4, F-6). If yes, it needs Gadzio's markets and a working visibility rule. **Blocks Phase 2 item 6.**

3. **Is the SEO default supposed to be `'Gadzio'`, or a longer title?**
   `page.tsx` uses `'Gadzio'`; `Apple_SEO_DEFAULTS` uses `'Apple'`. The replacement must be one of these two, and a decision is needed on whether the homepage title should stay a bare brand name. **Blocks Phase 2 item 4.**

4. **How far does the namespace migration go?**
   `ac-*` CSS, `apple.*` keys, the `www-apple-com-*` directory and the `os`/`am:` breakpoints are all internal with zero user impact. A defensible position is: fix everything user-visible and everything that can re-publish Apple content (Phases 2–4), and defer Phase 5 indefinitely. The cost of deferring is that Apple stays the name of the codebase and the next audit must re-derive this map. **Decision required before Phase 5.**

5. **What is the cart-storage migration policy?**
   `gadzio_apple_cart_v1` holds live customer carts. Renaming without dual-read empties them. Confirm whether carts may be dropped (accepting empty carts once) or must be migrated. **Blocks Phase 5.**

6. **Do the anti-affiliation statements need legal review?**
   §16 items 2 and 3 are protective, not defective. They should be reviewed once by counsel and then left alone — not swept up in a de-branding pass. **Confirm ownership of this review.**

7. **Is `README.md`'s licence statement intentional?**
   "© Apple Inc." and "the assets aren't licensed for redistribution" (lines 60-62) read like a genuine licensing caution. Do not delete without confirming intent. **Blocks Phase 5 README rewrite.**

8. **Should `skills-lock.json` / `.agents/skills/apple-design/` stay?**
   They install Apple design guidance into the agent skills directory. Harmless to the shipped product; relevant to how future work is generated. **Decision required.**

9. **Should the 26 unresolved tile references be fixed or pruned?**
   Three are live and should be fixed by correcting filenames in `tiles.ts` (a text edit, not image work). The other 23 belong to tiles that (a) should be deleted (Apple Card) or (b) are dormant (MacBook Air hero). Pruning is likely correct, but confirm the MacBook Air hero is not planned for re-activation. **Blocks Phase 2 item 7.**

10. **What is `.claude/worktrees/whimsical-jumping-valiant`?**
    A full duplicate checkout inside the repo. It doubles grep surface and can serve stale code to tooling. Confirm whether it is live work or residue. **Blocks repository-hygiene sign-off.**

---

## Appendix A — Audit Integrity Statement

**Files created by this audit:** `APPLE-GADZIO-CODE-AUDIT.md` — and nothing else.

**No source file, CSS file, data file, configuration file, package file, route, asset, image, font, video, or database row was created, modified, moved, renamed, or deleted by this audit.**

**Database access was SELECT-only.** The inspection used the repository's own self-guarded read-only helper (`scripts/inspect-apple-keys.mjs`, which refuses to run if any query in it grows a write statement) plus a read-only inline query. No INSERT, UPDATE, DELETE, ALTER, DROP, CREATE or TRUNCATE was issued. Row contents were read to characterise current behaviour — not altered.

**No Phase 2–6 work was performed.** §19 is a recommendation.

### Pre-existing working-tree state (NOT caused by this audit)

Recorded for completeness. These changes were present before this audit began and were not touched by it.

| State | Count | Notes |
| --- | ---: | --- |
| Deleted (`D`) | 98 | Predominantly `public/sites/**` tile artwork — the working-tree deletion set behind §15 F-3 |
| Modified (`M`) | 29 | Includes `README.md`, `src/app/page.tsx`, `src/app/layout.tsx`, `TileCard.tsx`, `admin-overrides.ts`-adjacent data files, `defaults.ts`, `collections.ts`, `proxy.ts`, and the Phase 1 CSS files |
| Untracked (`??`) | 60 | Includes `src/app/{auth,bag,cart,checkout,search,support,terms,privacy,order,shop}/`, `src/lib/{cart,payu}/`, `src/components/{auth,cart,checkout,search,shop}/`, `migrations/0008_users.sql`, `migrations/0009_orders.sql`, the audit markdown files, `.agents/`, `.claude/`, `skills-lock.json` |

**Important:** the `M` entries on files this audit also names as findings (`TileCard.tsx`, `defaults.ts`, `collections.ts`, `src/app/page.tsx`) are **pre-existing Phase 1 work in the working tree**, not edits from this audit. This audit read those files; it did not write them. Any diff review should compare against the same baseline that existed before this session.

### Scan provenance

Every finding was derived from the working tree as it exists on disk at 2026-10-08, and from a live SELECT against `content_blocks` and `site_settings`. The predecessor document (`APPLE-GADZIO-FULL-AUDIT.md`) was read for context only; all eight of its Phase 1 claims were independently re-verified (§3), and four material drifts since its writing were found and recorded (§3, closing note).
