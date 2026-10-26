# Apple → Gadzio Full Repository Audit

**PHASE 1 COMPLETE — 5 APPROVED FIXES APPLIED, RE-VERIFIED AGAINST THE LIVE REPOSITORY.**

This document began as the output of a complete read-only inspection of the repository at `C:\Users\Abcom\Documents\clon\apple-clone` (**Phase 0**). It has since been updated after **Phase 1**, in which exactly five findings were approved and fixed. Every status in this document reflects a **fresh read of the repository and the live database after those fixes**, not a manual edit of the earlier conclusions.

The distinction matters, so it is stated plainly:

- **Phase 0** modified nothing. It produced this report.
- **Phase 1** modified **9 source files and 1 database row** — nothing else. Every other finding in this document is still **open**, and is now collected in `## Remaining Findings — Not Approved` near the foot of this file.
- **No asset was added, deleted, renamed, or moved in either phase.** The Apple favicon and the five SF Pro font files are still on disk, untouched, exactly as Phase 0 found them. They are now *unreferenced* rather than *removed*.

---

## Audit Status

| Item | Value |
| --- | --- |
| Audit type | Full repository — Phase 0 READ-ONLY, Phase 1 read-verify after approved fixes |
| Audit date | 2026-10-06 |
| Phase 1 re-verification date | 2026-10-06 (this revision) |
| Repository root | `C:\Users\Abcom\Documents\clon\apple-clone` |
| Branch | `main` |
| Files scanned (Phase 0) | 497 |
| Files/directories excluded | 321 files (+ generated/derived trees) |
| Database | Inspected read-only in both phases; **1 row changed in Phase 1** (`apple.footer`, content only) |
| Source files modified in Phase 1 | **9** — see `## Phase 1 — Approved Fixes: Status` |
| Asset files modified/deleted/renamed/moved | **0** (in both phases) |
| Homepage layout/sections/animations/content changed | **No** |
| `/in-edu` layout/sections/animations changed | **No** |
| Homepage metadata changed | Yes — favicon `icons` entry only (approved as Fix 2) |
| Commits made | **0** |
| Files created | **1** — `APPLE-GADZIO-FULL-AUDIT.md` (this file) |
| Approved fixes applied | **5 of 5** |
| Approved fixes fully fixed | **5 of 5** (Fix 2 carries a documented asset-quality caveat) |
| Findings still open | **43** (42 REMAINING, 1 BLOCKED) — see `## Remaining Findings — Not Approved` |
| Status | **PHASE 1 COMPLETE — AWAITING REVIEW. NO FURTHER CHANGES AUTHORIZED.** |

---

## Phase 1 — Approved Fixes: Status

Exactly five findings were approved. Each is recorded below with its previous status, the change made, the files or database rows affected, its current status, and the evidence from this re-verification.

**Status vocabulary:** `FIXED` · `PARTIALLY FIXED` · `REMAINING` · `BLOCKED`.

### Fix 1 — `/in-edu` Apple external links

| Field | Detail |
| --- | --- |
| Previous status | ACTIVE — 15 live `apple.com` destinations rendering on `/in-edu/store` |
| Current status | **FIXED** |
| Files affected | `src/components/sites/edu-store/data/content.ts` (only) |

**What was changed.** All 15 Apple-owned destinations were repointed to routes that **already exist in this application**. No route was invented. The mapping:

| # | Old destination (Apple) | New destination (existing Gadzio route) |
| --- | --- | --- |
| 1 | `https://www.apple.com/in/retail` (`findStoreHref`) | `/support` |
| 2 | `https://music.apple.com/subscribe/student` | `/search` |
| 3 | `https://www.apple.com/in/education/college-students` | `/in-edu/store` |
| 4 | `https://www.apple.com/careers/in/students.html` | `/support` |
| 5 | `https://www.apple.com/in/education/success-stories` | `/support` |
| 6 | `https://developer.apple.com/learn` | `/search` |
| 7 | `https://www.apple.com/in-edu/shop/buy-iphone/iphone-18-pro` | `/search?q=Gadzio+Phone+18+Pro` |
| 8 | `https://www.apple.com/in-edu/shop/buy-iphone/iphone-17` | `/search?q=Gadzio+Phone+17` |
| 9 | `https://www.apple.com/in-edu/shop/buy-iphone/iphone-17e` | `/search?q=Gadzio+Phone+17e` |
| 10 | `https://www.apple.com/in-edu/shop/buy-iphone/iphone-air` | `/search?q=Gadzio+Phone+Air` |
| 11 | `https://www.apple.com/in/apple-intelligence` | `/search` |
| 12 | `https://www.apple.com/in/today/event/spotlight-apple-intelligence?cid=…` | `/search` |
| 13 | `https://www.apple.com/in/icloud` | `/search` |
| 14 | `https://www.apple.com/in/retail` ("Find a Store" quick link) | `/support` |
| 15 | `https://secure.store.apple.com/in-edu/shop/order/list` ("Order Status") | `/support#order-help` |

The Apple campaign tracking parameter on item 12 (`cid=rem-in-taa-store-edu-spotlight-ai`) is gone with the URL. The file header comment and the closing note were rewritten to state that all destinations are in-app Gadzio routes.

**Verification result.** `grep` for `apple.com` across `src/components/sites/edu-store/` and `src/app/in-edu/` returns **one** hit — a source *comment* at `content.ts:541` reading "no third-party or apple.com URLs remain". It is not rendered and not a link. **Zero live Apple URLs render on `/in-edu`.** The rendered `/in-edu/store` HTML was fetched from a production server during Phase 1 and confirmed to contain no `apple.com` string and no `https://` outbound link. Every replacement destination returns HTTP 200.

**Caveat carried forward.** Most of the 15 cards now point at `/search` or `/support` because the destination those cards *describe* (a product page, an order list) does not exist in this application. The links are honest and on-site, but they are placeholders. The correct long-term destination is the subject of the still-open `/in-edu` dead-route finding.

### Fix 2 — Apple favicon

| Field | Detail |
| --- | --- |
| Previous status | ACTIVE — Apple's logo served as the favicon on `/` and `/in-edu/store` |
| Current status | **FIXED** (with a documented asset-quality caveat — see below) |
| Files affected | `src/app/page.tsx`, `src/app/in-edu/store/page.tsx` (only) |
| Assets affected | **None deleted.** `…/seo/favicon.ico` remains on disk, unreferenced. |

**What was changed.** The `metadata.icons.icon` entry on both routes was repointed from Apple's `.ico` to `/gadzio_logo.png`, an existing Gadzio brand asset that was already present in `public/` and already used by the other six routes. No new artwork was fabricated.

**Verification result.** All **8** `metadata.icons` blocks in the application now read `icon: '/gadzio_logo.png'`:

```text
src/app/page.tsx                                     icon: '/gadzio_logo.png'
src/app/in-edu/store/page.tsx                        icon: '/gadzio_logo.png'
src/app/in/shop/iphone/accessories/airpods-case/…    icon: '/gadzio_logo.png'
src/app/in/shop/iphone/accessories/cable-plug-case/… icon: '/gadzio_logo.png'
src/app/in/shop/iphone/accessories/cases-protection/ icon: '/gadzio_logo.png'
src/app/in/shop/iphone/accessories/mobile-cases/…    icon: '/gadzio_logo.png'
src/app/in/shop/iphone/accessories/power-adapter-cable/… icon: '/gadzio_logo.png'
src/app/in/shop/iphone/accessories/wired-earphones/… icon: '/gadzio_logo.png'
```

Rendered homepage HTML emits `<link rel="icon" href="/gadzio_logo.png"/>` and contains no reference to `favicon.ico`. Apple's logo is no longer served as this site's icon on any route.

**Caveat — this is a `PARTIALLY FIXED` asset, not a finished one.** `public/gadzio_logo.png` is a **184×61 horizontal wordmark**, verified by reading the PNG header. A favicon is displayed in a square slot (16×16, 32×32, 180×180); a 3:1 wordmark is downscaled into an illegible smear at tab size. The *trademark* problem is fixed — Apple's logo is gone. The *usability* problem is not: Gadzio currently has no legible square icon. **Producing a square Gadzio favicon (or an `.ico`/PNG set) remains an open dependency**, recorded under `## Remaining Findings — Not Approved`. The existing Apple `favicon.ico` was deliberately **not deleted**, since removal was not approved and would be destructive if a rollback were needed.

### Fix 3 — SF Pro fonts

| Field | Detail |
| --- | --- |
| Previous status | ACTIVE — Apple's SF Pro loaded globally via 5 `@font-face` blocks, plus 5 stylesheet font stacks naming SF Pro |
| Current status | **FIXED** |
| Files affected | `src/app/apple-clone.css`, `src/app/in-edu/store/edu-store.css`, `src/app/auth/auth.css`, `src/app/in/shop/iphone/accessories/cases-protection/cases.css`, `src/components/sites/accessories/accessory-category.css` |
| Assets affected | **None deleted.** All 5 `.woff2` files remain on disk, no longer registered. |

**What was changed.** All five `@font-face` blocks were removed from `apple-clone.css`, and every font stack that named SF Pro was revised. The replacement is a font that was **already loaded in this repository** — `Inter`, served site-wide from the Google Fonts `<link>` in `src/app/layout.tsx` (weights 300–900), and already named as a fallback in two of the affected stylesheets. No new font was added and no network dependency was introduced.

The three `apple-clone.css` type tokens are now:

```css
--ac-font-text:    "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
--ac-font-display: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
--ac-font-footer:  "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
```

`"Myriad Set Pro"` and `"SF Pro Icons"` were dropped from the footer stack (the Phase 0 styling finding, absorbed into this fix). The stale header comment describing the `@font-face` blocks was corrected.

**Deliberately retained:** `-apple-system` and `BlinkMacSystemFont`. These are **legitimate platform font keywords that resolve to whatever UI font the operating system provides** — they are not Apple-owned font files and no Apple font is downloaded or served through them. They were retained as instructed.

**Not changed:** no font size, weight, line-height, letter-spacing, or spacing value was altered anywhere. The type scale is byte-identical to Phase 0; only the `font-family` resolution changed.

**Verification result.** `grep` for `SF Pro`, `SFPro`, `sf-pro`, `Myriad`, and `SF Pro Icons` across `src/` returns **zero** matches. `grep` for `@font-face` across `src/` returns **zero** matches. The built CSS was inspected directly and confirmed to contain 0 `@font-face` rules, no `sf-pro` substring, and the token values quoted above. The rendered pages load `fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900` and no other webfont.

**Residual, disclosed for accuracy.** The strings `SF Pro` / `sf-pro` still appear inside `.next/cache/turbopack/*.sst`. That is Turbopack's **regenerable build cache** — derived state, not source, not served — and it is cleared by a clean rebuild. It is not a live reference.

### Fix 4 — Apple trademark statement in the footer database content

| Field | Detail |
| --- | --- |
| Previous status | ACTIVE — a live `content_blocks` row (`apple.footer`) rendered "Apple, iPhone, MagSafe, Mac, and iPad are trademarks of Apple Inc." on every page using the shared footer |
| Current status | **FIXED** |
| Files affected | **None** — this was a content/database change only, exactly as specified |
| Database row affected | `content_blocks` → key `apple.footer` → field `footnotesHtml` (only) |

**What was changed.** The single trademark-attribution sentence was removed from `footnotesHtml` in the live row:

```text
BEFORE:  … promotional offers are subject to change without notice. Apple, iPhone,
         MagSafe, Mac, and iPad are trademarks of Apple Inc.

AFTER:   … promotional offers are subject to change without notice.
```

Nothing else in the row was touched. Verified field-by-field after the write:

| Field | Value | Changed? |
| --- | --- | --- |
| `footnotesHtml` | Trademark sentence removed; all other footnote text preserved | **Yes** — the approved change |
| `copyright` | `Copyright © 2026 Gadzio Inc. All rights reserved.` | No — byte-identical |
| `localeLabel` | `India` | No — byte-identical |
| `localeHref` | `/` | No — byte-identical |

A guarded one-off script was used for the write. It refused to run unless the exact sentence was found verbatim, refused to write if `trademarks of Apple Inc` survived anywhere in the resulting HTML, and refused if any other field differed. It was run once, succeeded, and was then **deleted** — it is not in the repository.

**The footer was not redesigned.** No markup, layout, column, link, or style was touched. The `GlobalFooter` component is unchanged.

**Verification result.** A read-only query of `content_blocks` confirms `apple.footer` no longer matches `/trademarks of Apple Inc/i` (row `updated_at` = `2026-10-05T18:48:30Z`). The rendered homepage HTML contains no `trademarks of Apple Inc` and still contains `Copyright © 2026 Gadzio Inc. All rights reserved.`

**Deliberately retained — and this is the point of the fix.** The compatibility sentence was **kept**, because it is legitimate nominative use, not an attribution:

> "Compatibility with MagSafe chargers, Qi2 wireless charging, and Apple devices varies by model"

This names Apple products to describe *what the accessories fit*, which is the permitted use. Verified present in the row and in the rendered HTML after the change. The rest of the fix follows exactly the model the code fallback in `data/footer.ts` already set: a compatibility statement, with no party named as a trademark owner beneath Gadzio's copyright line.

### Fix 5 — Apple-copied education eligibility text

| Field | Detail |
| --- | --- |
| Previous status | ACTIVE — Apple's education-store eligibility sentence reproduced verbatim as the storefront's legal footnote |
| Current status | **FIXED** (copy rewritten — but see the honest note on reachability below) |
| Files affected | `src/components/sites/edu-store/data/content.ts` (only) |

**What was changed.** Apple's verbatim sentence —

```text
'Education pricing is available to current and newly accepted college students,
 their parents, and teachers and staff at qualifying institutions.'
```

— was replaced with original Gadzio wording that states the same operational fact without reusing Apple's sentence structure:

```ts
export const FOOTNOTES = [
  'Gadzio student offers are available to eligible college students. Eligibility may be verified before an offer is applied.',
];
```

The new sentence is shorter, makes no claim about a program Gadzio is not running, and does not mirror Apple's clause order ("current and newly accepted… their parents, and teachers and staff at qualifying institutions"). No Apple URL is referenced in it.

**Verification result.** `grep` for the old sentence and for its distinctive fragments returns zero matches anywhere in `src/`. The old wording is gone.

**Honest caveat — this fix changed text that is currently not rendered.** The `FOOTNOTES` constant **is not imported by anything.** `EduStorePage.tsx` imports only `HERO`, `PRODUCT_NAV`, `QUICK_LINKS`, `SHELVES`, and the `EduCard` type. A reference count across `src/` returns **0 importers** for `FOOTNOTES` (and for six other exports in the same file: `HOW_TO_BUY_STEPS`, `SHOP_CATEGORIES`, `BTS_OFFERS`, `EDU_IN_ACTION`, `MAC_PRODUCTS`, `IPAD_PRODUCTS`).

Phase 0 classified this finding ACTIVE, on the assumption that the constant rendered. **That classification was wrong**, and the re-verification corrects it. The copied text was never on screen; it was dead code in a data module.

This does not diminish the fix — the infringing text is gone from the repository, which was the ask — but it means the fix removed a **latent** liability rather than a visible one, and it means `content.ts` still carries a substantial amount of unreferenced material. Whether `FOOTNOTES` should be wired into the page (so `/in-edu` actually shows eligibility terms, which it currently does not) or deleted is a product decision, recorded under `## Remaining Findings — Not Approved`.

---

## Executive Summary

**What Phase 1 changed.** Five findings were approved and fixed: the 15 Apple destinations on `/in-edu` (repointed to existing in-app routes), the Apple-logo favicon (repointed to the existing Gadzio logo asset), the SF Pro typeface (replaced with Inter, which was already loaded site-wide), the Apple Inc. trademark sentence in the live footer database row (removed, compatibility sentence retained), and Apple's verbatim education eligibility sentence (rewritten as Gadzio copy).

**What that did to the numbers.** The 15 `/in-edu` destinations are gone, and `secure.store.apple.com` and `developer.apple.com` went with them. A re-grep of the working tree counts **46 `apple.com` occurrences remaining in `src/`** — **31 URL strings** (none of which renders) and **15 mentions inside source comments**. Live Apple URLs rendering on `/in-edu` fell from **15 → 0**. `@font-face` rules in `src/` fell from **5 → 0**. SF Pro references in `src/` fell from **5 stylesheets + 3 tokens → 0**. Live database rows carrying an Apple trademark attribution fell from **1 → 0**.

**What Phase 1 did not do.** No asset was deleted, renamed, or moved — the Apple `favicon.ico` and all five SF Pro `.woff2` files remain on disk, now *unreferenced* rather than *removed*. The homepage's layout, sections, animations, imagery, and content are untouched; the only homepage file changed was its `metadata.icons` entry. The `ac-*` namespace, the `www-apple-com-736d3707` asset directory, the Apple Card tile data, the locale banner, the admin labels, `package.json`, and the CMS namespaces were all left exactly as they were, per the phase's explicit exclusions.

**What remains.** Every finding not in the approved five is still open and is collected in `## Remaining Findings — Not Approved`. The largest concentrations are three: (1) the **latent activatable content** — `icons.tsx` `GALLERY_LOGOS` (six Apple service wordmarks including the Apple glyph), the Apple Card tile in `tiles.ts`, `gallery.ts` (18 Apple URLs, 146 images), `locale-banner.ts`, the `Ribbon.tsx` fallback, and the `TileCard.tsx` apple.com href rewriter, all of which light up on a single admin save; (2) the **naming layer** — the `www-apple-com-736d3707` asset path served in every image URL, the `ac-`/`--ac-*` CSS namespace, and the `apple.*` CMS keys; and (3) the **admin prefills** in `defaults.ts`, which are one click away from becoming live data.

**The structural point Phase 0 established still governs.** `content_blocks` holds 6 rows and `site_settings` is empty. Where a row exists, the code's Apple-derived defaults never render; where no row exists, they do. This is why the `/in-edu` route (no `edu.*` rows) was the highest-risk surface, and why the `defaults.ts` prefills are a live hazard rather than dead code. Phase 1 fixed what rendered; it did not change the override architecture that decides what renders next.

---

## Phase 0 — Original Read-Only Audit

Everything from this point to `## Remaining Findings — Not Approved` is the Phase 0 report, with each affected finding's status updated to reflect Phase 1. Findings that Phase 0 raised and Phase 1 did not touch are marked **REMAINING** and restated in full in the Remaining Findings section.

This repository began as a verbatim clone of a live `www.apple.com` page (captured as `www-apple-com-736d3707` / `root-8a5edab2`) and has been progressively rebranded into **Gadzio**, a student-led mobile-accessories and everyday-tech brand. The rebrand is well advanced: the homepage's rendered copy, the footer, the navigation labels, the product catalog, and the legal disclaimers are all Gadzio-owned text. The Gadzio homepage design is intact and should be preserved; nothing in this report proposes changing how it looks.

The Phase 0 audit found that the **display-copy layer was clean but the delivery layer was not**. What remained Apple-derived fell into four groups:

1. **Proprietary Apple assets still shipped and served.** The site favicon was Apple's actual logo (visually verified), and five SF Pro font files were loaded globally through `@font-face`. Both were Apple-owned property, both were served on live routes, and both reached the homepage. — **Both addressed in Phase 1 (Fixes 2 and 3); the asset *files* remain on disk, unreferenced.**
2. **Live outbound links to Apple-owned domains.** `/in-edu/store` rendered 15 `apple.com` destinations on user-visible cards, including a link labelled "Find a Gadzio Store" that navigated to `apple.com/in/retail` and an "Order Status" link pointing at `secure.store.apple.com`. — **Fixed in Phase 1 (Fix 1).**
3. **Verbatim Apple content captured in data files.** The gallery, tile, icon, and locale-banner data files carry explicit "verbatim from https://www.apple.com/" header comments and reuse Apple-owned filenames, SVG wordmarks (including the Apple glyph), and an Apple Card promo tile. Most of these are **overridden by database rows** and therefore not rendered — but a single admin save, or one `enabled: true` flip, would put them on the homepage. — **REMAINING.**
4. **Internal naming and namespaces that record the clone's origin.** The shipped asset path `/sites/www-apple-com-736d3707/...` appears in every rendered image URL, the CSS still uses the `ac-` Apple prefix and `--ac-*` variables, and the `apple.*` content-block namespace is live in the CMS. — **REMAINING.**

Critically, the audit established the **ACTIVE vs LATENT boundary from the live database**, not from guesswork. `content_blocks` holds 6 rows; `site_settings` is empty. Where the database supplies a row, the code's Apple-derived defaults never render. Where no row exists (`edu.*`, `cases.*`, `apple.seo`, `apple.nav`, `apple.locale_banner`, `oppo.seo`), the code defaults **do** render — which is exactly why `/in-edu` was the highest-risk surface in the repository.

The existing Gadzio homepage design must be preserved. The items that touch it (favicon, fonts, asset path segment) are identity and licensing issues, not design issues, and can be addressed without altering a single pixel of layout.

---

## Audit Scope

**In scope — audited:**

| Area | Detail |
| --- | --- |
| Application source | `src/` — 148 files (app router, components, lib, styles) |
| Live public assets | `public/sites/` (excluding backups) — 306 files |
| Root public assets | `public/` top level — 2 files |
| Database migrations | `migrations/` — 9 files |
| Utility scripts | `scripts/` — 11 files |
| Repository root | 21 top-level files (config, docs, env examples) |
| Database / CMS | `content_blocks`, `site_settings` — read-only inspection |
| Routes | Every `page.tsx` / `route.ts` under `src/app` |
| Shared components | `GlobalNav`, `GlobalFooter`, `FloatingBrandSwitcher`, auth, cart, search, checkout |
| Stylesheets | All `*.css` under `src/`, including `apple-clone.css` (imported globally) |
| SEO / metadata | Every `metadata` / `generateMetadata` export; favicon, OG images, sitemap, robots, manifest, JSON-LD |
| Special deep audit | `/in-edu/store` and its full import/dependency graph |

**Search terms swept** (case-insensitive, across source, styles, data, config, docs, and file/path names):
`Apple`, `apple.com`, `iPhone`, `iPad`, `Mac`, `MacBook`, `AirPods`, `Apple Watch`, `Apple Music`, `Apple TV`, `Apple Arcade`, `Apple Fitness`, `iCloud`, `AppleCare`, `Apple Card`, `App Store`, `Apple Pay`, `Apple Intelligence`, `Apple Pencil`, `MagSafe`, `AirTag`, `HomePod`, `Siri`, `Retina`, `Lightning`, `Thunderbolt`, `SharePlay`, `one more thing`, `California`, `Cupertino`, `Infinite Loop`, `Apple Park`, `Think different`, and the CSS/DOM namespace markers `ac-`, `--ac-`, `globalnav`, `globalfooter`, `sosumi`, `ribbon`, `SF Pro`, `Myriad Set`.

**Also detected by structure rather than by keyword** (the word "Apple" is absent):
- Copied marketing and legal phrasing (student-pricing eligibility language, footnote wording, ribbon copy)
- Navigation and footer structures (wordmark slots, flyout group shape, directory column layout)
- Store and Education terminology ("Education Store", "Specialist", "Trade In", "Personal Setup", "Education savings")
- CSS class and ID naming (`ac-gf-*`, `ac-globalnav`, `#globalnav`, `#ac-globalfooter`)
- Data structures and URL patterns (`?q=airpods+pro`, `?q=magsafe`)
- Asset paths and filenames (`store-card-40-airpods-5-202609.webp`, `promo_logo_apple_card__*.png`)
- Metadata, schema, fallbacks, defaults, and disabled/conditional components

**Method:** direct file reads, targeted ripgrep sweeps, visual verification of the favicon, static analysis of the content-override path, and a read-only query of the live CMS tables. Where a subagent report and a direct file read disagreed, the direct file read was treated as authoritative and the discrepancy is noted in the relevant finding.

---

## Excluded From Audit

The following were **deliberately not audited**, per the exclusion rule. Historical copies are irrelevant to what the live application serves.

| Path | Reason | Size/count |
| --- | --- | --- |
| `public/sites.original-backup/` | Backup of the captured Apple site (matches the `*.original-backup` exclusion rule) | 321 files, 64 MB |
| `.next/` | Derived build output; regenerated from the same source on every build, so auditing it would duplicate source findings and describe a build artifact rather than the repository | generated |
| `node_modules/` | Third-party dependencies (contract for Next.js docs is read from here but nothing is authored here) | — |
| `.git/` | Version-control internals; object store of already-committed history | — |
| `public/sites/www-apple-com-736d3707/root-8a5edab2/images/FireShot/` | Screen-capture set of the **OPPO** site (not Apple); inspected by filename and found to contain no Apple content | 11 PNG |

**Live-reference exception applied:** `public/sites.original-backup/` is *not* referenced by any route, component, or stylesheet in the live application. The live asset root is `public/sites/www-apple-com-736d3707/root-8a5edab2/` (no `.original-backup` segment). This report therefore audits the live root and mentions the backup only here.

No other `backup/`, `backups/`, `archive/`, `archives/`, `.backup/`, `.backups/`, `*.bak`, `*.backup`, `*.old`, `*.orig`, `old/`, `legacy/`, `original/`, or `previous/` directory was found in the repository.

---

## Severity Summary

Counts are Phase 0 findings, with Phase 1 outcomes overlaid. "Resolved" means the approved fix was applied and re-verified.

| Severity | Phase 0 count | Resolved in Phase 1 | Open now |
| --- | --- | --- | --- |
| CRITICAL | 8 | 4 (favicon, SF Pro, 15 `/in-edu` URLs, footer trademark row) | 4 |
| HIGH | 15 | 2 (4 stylesheet SF Pro stacks, `/in-edu` eligibility footnote) | 13 |
| MEDIUM | 13 | 0 | 13 |
| LOW | 5 | 1 (Myriad Set Pro footer stack — absorbed into Fix 3) | 4 |
| LEGITIMATE-KEEP | 6 groups | — | 6 groups (unchanged) |

| Primary status | Phase 0 count | Note |
| --- | --- | --- |
| ACTIVE (rendered / reachable now) | 14 | 5 of these are now resolved |
| LATENT (not rendered, activatable) | 6 | unchanged — no latent content was touched |
| INTERNAL ONLY (build/admin/docs, never served) | 17 | unchanged |
| LEGITIMATE (keep) | 6 groups | unchanged |

**Phase 0 → Phase 1 deltas**

| Metric | Phase 0 | Now | Δ |
| --- | --- | --- | --- |
| `apple.com` occurrences in live `src/` (re-grepped) | 51 | **46** — 31 URL strings + 15 comment mentions | see note |
| — of which, `www.apple.com` URLs | 29 | 12 | −17 |
| — of which, `tv.apple.com` URLs | 9 | 9 | 0 |
| — of which, `music.apple.com` URLs | 4 | 3 | −1 |
| — of which, `fitness.apple.com` URLs | 3 | 3 | 0 |
| — of which, `apps.apple.com` URLs | 3 | 3 | 0 |
| — of which, `secure.store.apple.com` URLs | 1 | 0 | −1 |
| — of which, `developer.apple.com` URLs | 1 | 0 | −1 |
| — of which, `card.apple.com` URLs | 1 | 1 | 0 |
| Apple URLs rendering on `/in-edu/store` | **15** | **0** | **−15** |
| `@font-face` rules in `src/` | 5 | **0** | −5 |
| Stylesheet font stacks naming SF Pro | 5 | **0** | −5 |
| Apple-owned fonts shipped | 5 files | 5 files on disk, **0 registered** | unreferenced |
| Apple-logo assets served on live routes | 1 (`favicon.ico`) | **0** | unreferenced on disk |
| Apple service wordmark SVGs | 6 (`GALLERY_LOGOS`) | 6 | 0 — LATENT |
| Apple-owned videos shipped | 3 (~1.9 MB) | 3 | 0 — LATENT |
| Live DB rows containing Apple references | 2 of 6 | **1 of 6** (`apple.gallery`) | −1 |
| `/in-edu/store` open findings | 12 | **6** (5 fixed, 1 legitimate) | −5 fixed |

> **Note on the URL row.** Phase 0's 51 counted only URL strings; the current 46 counts every occurrence of the string `apple.com`, comments included. The two bases are not comparable, so no clean delta exists and none is claimed. The like-for-like comparison that *is* meaningful is the line below it: Apple URLs rendering on `/in-edu/store` went **15 → 0**, and the eight Phase 0 host totals can be read against the twelve/three/three/three/nine/one now listed in `## Apple URLs / External Links`.

---

## Critical Findings

### [CRITICAL] Apple's logo is the site favicon, served on the homepage and /in-edu

> **STATUS: FIXED in Phase 1 (Fix 2).** Both `icons` entries now point at `/gadzio_logo.png`. Apple's `favicon.ico` is no longer referenced by any route and remains on disk, undeleted. See `## Phase 1 — Approved Fixes: Status` → Fix 2. **Caveat:** the Gadzio asset used is a 184×61 wordmark, so no legible square favicon exists yet — that remains open under `## Remaining Findings — Not Approved`.

**File:** `public/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico`
**Location:** Referenced from `src/app/page.tsx:27` and `src/app/in-edu/store/page.tsx:36`
**Status:** ~~ACTIVE~~ → **FIXED**
**Current value/reference:**
```ts
// src/app/page.tsx  — BEFORE
icons: { icon: '/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico' },

// src/app/page.tsx  — AFTER
icons: { icon: '/gadzio_logo.png' },
```
The file is 22,382 bytes. It was decoded and viewed during this audit: it is **Apple's logo** — the bitten-apple glyph — not a generic or Gadzio mark. It is still on disk (22382 B, confirmed by stat during Phase 1 re-verification) but is now referenced by nothing.
**Why it matters:** A favicon is the single most-visible brand identifier in a browser: it appears in the tab, in bookmarks, in history, and in every shared link preview. Serving Apple's logo as Gadzio's favicon is direct use of Apple's trademark in a commercial context and is the clearest passing-off risk in the repository. It also directly contradicted the footer's own trademark notice disclaiming any Apple affiliation.
**Recommended action (Phase 0):** Replace the favicon with a Gadzio mark (a Gadzio-logo derived `.ico`/PNG set) and update both `icons` entries to point at it. Leave the existing file on disk until replacement artwork exists. Do not delete yet.
**Action taken (Phase 1):** Both `icons` entries repointed to the existing `/gadzio_logo.png`. Files left on disk as instructed.
**Homepage impact:** Direct (the tab icon — no layout change)
**/in-edu impact:** Direct (icon only)

### [CRITICAL] Apple's proprietary SF Pro fonts are shipped and loaded globally

> **STATUS: FIXED in Phase 1 (Fix 3).** All five `@font-face` blocks removed; all font stacks now resolve to `Inter` (already loaded site-wide from `src/app/layout.tsx`), with `-apple-system` / `BlinkMacSystemFont` retained as legitimate system keywords. Zero `@font-face` rules and zero SF Pro references remain in `src/`. The five `.woff2` files remain on disk, unregistered and undeleted. See `## Phase 1 — Approved Fixes: Status` → Fix 3.

**File:** `public/sites/www-apple-com-736d3707/root-8a5edab2/fonts/` (`sf-pro-display_bold.woff2`, `sf-pro-display_regular.woff2`, `sf-pro-display_semibold.woff2`, `sf-pro-text_regular.woff2`, `sf-pro-text_semibold.woff2`)
**Location (Phase 0):** `@font-face` declarations at `src/app/apple-clone.css:26-63`; consumed via `--ac-font-text` / `--ac-font-display` / `--ac-font-footer` at `src/app/apple-clone.css:90-92`
**Status:** ~~ACTIVE~~ → **FIXED**
**Current value/reference:**
```css
/* Phase 0 — src/app/apple-clone.css:22-23 */
/* SF Pro Text / SF Pro Display — © Apple Inc., downloaded from the target */

@font-face {
  font-family: 'SF Pro Display';
  src: url('/sites/www-apple-com-736d3707/root-8a5edab2/fonts/sf-pro-display_regular.woff2') format('woff2');
  ...
}
```
`apple-clone.css` is imported by `src/app/globals.css`, so these faces were registered on **every route in the application**, homepage included. After Phase 1 the file contains no `@font-face` block at all; the block above is retained here as the Phase 0 record.
**Why it matters:** SF Pro is Apple's proprietary typeface, licensed by Apple for Apple's own use and for distribution only under Apple's platform terms. Redistributing the `.woff2` files from a public directory is redistribution of Apple-owned font software. The file's own comment was an admission of provenance and copyright ("© Apple Inc., downloaded from the target"). This was the most clear-cut copyright exposure in the repository after the logo.
**Recommended action (Phase 0):** Replace with a licensed or open typeface (e.g. Inter, which is metrically close and openly licensed), update the `@font-face` blocks and the three `--ac-font-*` variables, and remove the font files from `public/` once a replacement is in place. Do not delete the files yet.
**Action taken (Phase 1):** The `@font-face` blocks were **removed entirely** rather than repointed — Inter was already being served site-wide by the Google Fonts `<link>` in `src/app/layout.tsx`, so no `@font-face` rule was needed. All five font stacks and the three `--ac-font-*` tokens revised to `Inter` + system fallbacks. `"Myriad Set Pro"` and `"SF Pro Icons"` dropped. Font files left on disk as instructed.
**Residual:** the strings `SF Pro` / `sf-pro` persist only in `.next/cache/turbopack/*.sst` — regenerable build cache, not source, not served.
**Homepage impact:** Direct (typeface resolution only — no size, weight, or spacing changed)
**/in-edu impact:** Direct (typeface resolution only)

### [CRITICAL] Fifteen live Apple-owned URLs render on /in-edu/store

> **STATUS: FIXED in Phase 1 (Fix 1).** All 15 destinations repointed to existing in-app Gadzio routes (`/support`, `/search`, `/search?q=Gadzio+Phone+…`, `/in-edu/store`, `/support#order-help`). `apple.com` occurrences in the `edu-store` / `in-edu` tree are now **0 live URLs**. See `## Phase 1 — Approved Fixes: Status` → Fix 1 for the full mapping.

**File:** `src/components/sites/edu-store/data/content.ts`
**Location:** Lines 61, 283, 369, 382, 388, 395, 412, 430, 446, 454, 476, 483, 490, 498, 499
**Status:** ~~ACTIVE~~ → **FIXED**
**Current value/reference (Phase 0 — all removed):**
```ts
61:  findStoreHref: 'https://www.apple.com/in/retail',
283: href: "https://music.apple.com/subscribe/student",
369: href: "https://www.apple.com/in/education/college-students",
382: href: "https://www.apple.com/careers/in/students.html",
388: href: "https://www.apple.com/in/education/success-stories",
395: href: "https://developer.apple.com/learn",
412: href: "https://www.apple.com/in-edu/shop/buy-iphone/iphone-18-pro",
430: href: "https://www.apple.com/in-edu/shop/buy-iphone/iphone-17",
446: href: "https://www.apple.com/in-edu/shop/buy-iphone/iphone-17e",
454: href: "https://www.apple.com/in-edu/shop/buy-iphone/iphone-air",
476: href: "https://www.apple.com/in/apple-intelligence",
483: href: "https://www.apple.com/in/today/event/spotlight-apple-intelligence?cid=rem-in-taa-store-edu-spotlight-ai",
490: href: "https://www.apple.com/in/icloud",
498: href: 'https://www.apple.com/in/retail',
499: href: 'https://secure.store.apple.com/in-edu/shop/order/list',
```
These were confirmed ACTIVE because no `edu.*` row exists in `content_blocks`, so the code values rendered. Two were especially damaging: line 61 was rendered under the visible label **"Find a Gadzio Store"** (`HERO.findStoreLabel`, line 60) but resolved to Apple's retail locator, and line 499 was rendered under the label **"Order Status"** but resolved to Apple's order-management system — inviting a Gadzio customer to enter order details at an Apple URL. Line 483 carried an Apple campaign tracking parameter (`cid=rem-in-taa-store-edu-spotlight-ai`).
**Why it matters:** These sent Gadzio's users to Apple's own commerce and marketing properties under Gadzio-written labels. That is both an affiliation/intent-to-mislead problem and a user-trust problem, and it is the reverse of the usual failure mode — instead of Apple content appearing on a Gadzio site, Gadzio users were being handed to Apple.
**Recommended action (Phase 0):** Repoint all 15 destinations to real in-app routes (or to clearly-labelled non-Apple destinations). The file's own closing comment (lines 539-543) already acknowledges this as deferred work. Do not change anything yet.
**Action taken (Phase 1):** All 15 repointed to routes verified to exist in the application's route manifest; each destination confirmed HTTP 200. The "Order Status" card now goes to `/support#order-help` and "Find a Store" to `/support`.
**Carried forward:** most cards now land on `/search` or `/support` because the page each card describes does not exist yet — see `## Remaining Findings — Not Approved` → `/in-edu` dead routes.
**Homepage impact:** None
**/in-edu impact:** Direct (fixed)

### [CRITICAL] Apple-logo SVG paths are embedded in the gallery wordmark set

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/icons.tsx`
**Location:** `GALLERY_LOGOS` export
**Status:** LATENT
**Current value/reference:**
```tsx
// header comment: "verbatim SVG paths from the target"
// "Content is verbatim from https://www.apple.com/ (captured 2026-08-20)"
GALLERY_LOGOS = { music: {...}, arcade: {...}, fitness: {...}, tv: {...}, ... }
```
The set contains six verbatim Apple service wordmarks — Apple Music, Apple Arcade, Apple Fitness+, Apple TV and siblings — each reproduced as raw SVG path data, including the Apple glyph path itself. These are vector reproductions of Apple trademarks and logos, not merely product names.
**Why it matters:** Reproducing a logo in vector form is the same trademark use as reproducing the bitmap, and the header comment states plainly that the artwork was copied from Apple's site. LATENT status does not materially reduce the risk here: the artwork is committed to source and will render the moment `apple.gallery` is enabled (see the Database/CMS section — the row currently has `enabled: false`).
**Recommended action:** Remove the Apple wordmarks from `GALLERY_LOGOS` and design Gadzio-owned equivalents, or drop the logo row from the gallery entirely. Do not delete the file yet.
**Homepage impact:** Possible
**/in-edu impact:** None

### [CRITICAL] Apple Card promotional tile with Apple-owned artwork and apply URL

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles.ts`
**Location:** `hero`/`promo` tile definitions, Apple Card entry (~lines 580-662)
**Status:** LATENT
**Current value/reference:**
```ts
href: '/apple-card/',
applyHref: 'https://card.apple.com/...',
image: '.../promo_logo_apple_card__*.png',
alt: 'Apple Card, front, Apple logo in top left',
```
The tile names Apple Card explicitly, links to Apple's card application flow at `card.apple.com`, ships Apple Card product photography, and its alt text states in words that the Apple logo is visible in the image.
**Why it matters:** This is the most complete Apple-branded artifact in the repository — trademark (Apple Card), logo (named in alt text), product imagery, and a live financial-services application URL. It is LATENT only because the live `apple.hero_tiles` row supplies 2 tiles and `apple.promo_section` supplies 5, so `tiles.ts` is not reached. A single admin edit that clears or shortens the DB row re-activates it.
**Recommended action:** Remove the Apple Card tile from the default data file, or replace it with a Gadzio financing tile. Do not change it yet.
**Homepage impact:** Possible
**/in-edu impact:** None

### [CRITICAL] Live database footer renders an Apple Inc. trademark attribution

> **STATUS: FIXED in Phase 1 (Fix 4).** The trademark-attribution sentence was removed from the `apple.footer` row's `footnotesHtml` in the live database. The compatibility sentence ("Compatibility with MagSafe chargers, Qi2 wireless charging, and Apple devices varies by model") was **deliberately retained** as legitimate nominative use. `copyright`, `localeLabel`, and `localeHref` are byte-identical to Phase 0. `GlobalFooter` and the footer layout were not touched. See `## Phase 1 — Approved Fixes: Status` → Fix 4.

**File:** `content_blocks` table → key `apple.footer` (row exists; rendered by `src/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter.tsx`)
**Location:** Footer footnote HTML in the stored row
**Status:** ~~ACTIVE~~ → **FIXED**
**Current value/reference (Phase 0 — the removed sentence):**
```html
... Compatibility with MagSafe chargers, Qi2 wireless charging, and
Apple devices varies by model ...                       <-- KEPT (nominative use)
... Apple, iPhone, MagSafe, Mac, and iPad are trademarks of Apple Inc. ...   <-- REMOVED
```
The same row's `copyright` field reads `"Copyright © 2026 Gadzio Inc. All rights reserved."` — so a single footer simultaneously claimed Gadzio copyright and attributed trademarks to Apple Inc.
**Why it matters:** This was live, rendered text on every page that used the shared footer, including the homepage and `/in-edu`. Naming "Apple Inc." as a trademark owner inside a footer whose copyright line belongs to Gadzio is a direct, visible statement about a relationship that does not exist.
**Recommended action (Phase 0):** Rewrite the footnote to use nominative fair use only — a compatibility statement naming the products ("iPhone", "iPad", "Mac", "MagSafe") without asserting or implying Apple Inc. as an associated party, and without a bare trademark-attribution sentence sitting under a Gadzio copyright. Because this is a **database row**, the change must be made as content, not as a code edit; the code fallback in `data/footer.ts` is already clean.
**Action taken (Phase 1):** The attribution sentence was removed from `footnotesHtml` via a guarded one-off script (run once, then deleted). The compatibility sentence was kept. A field-by-field comparison after the write confirmed `copyright`, `localeLabel`, and `localeHref` were unmodified. Re-verified read-only: the row no longer matches `/trademarks of Apple Inc/i` and does still contain the compatibility sentence.
**Homepage impact:** Direct (fixed)
**/in-edu impact:** Direct (fixed)

### [CRITICAL] README documents the assets as Apple's copyrighted property, unlicensed

**File:** `README.md`
**Location:** Asset-provenance notes near the Apple asset directories
**Status:** INTERNAL ONLY
**Current value/reference:**
```text
... assets captured from www.apple.com ...
... © Apple Inc. ... not licensed for redistribution ...
```
**Why it matters:** The README is a written record, in the repository, that the project knows the shipped assets are Apple's and are not licensed for redistribution. It is INTERNAL ONLY — not served to users — but it is discoverable by anyone with repository access, and it converts an arguable oversight into documented knowledge. If the assets above are removed, this text must be updated in the same pass or it will describe a state that no longer exists.
**Recommended action:** Once the Apple-owned assets are replaced, rewrite this section to describe the new Gadzio-owned assets. Until then, leave it as an accurate record. Do not edit now.
**Homepage impact:** None
**/in-edu impact:** None

---

## High Findings

### [HIGH] The shipped asset path contains "www-apple-com-736d3707" in every rendered image URL

**File:** `public/sites/www-apple-com-736d3707/root-8a5edab2/` (asset root)
**Location:** Every image, font, and favicon reference across `src/`
**Status:** ACTIVE
**Current value/reference:**
```text
/sites/www-apple-com-736d3707/root-8a5edab2/images/...
/sites/www-apple-com-736d3707/root-8a5edab2/fonts/sf-pro-display_regular.woff2
/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico
```
**Why it matters:** These paths are served verbatim to the browser. Anyone who opens DevTools, saves a page, or right-clicks an image sees `www-apple-com-736d3707` in the URL. It announces the clone's origin on every page load and is trivially discoverable, independently of any visible branding.
**Recommended action:** Introduce a neutral asset root (e.g. `public/sites/gadzio/`) and update the references. This is a path-only change and does not alter any rendered design.
**Homepage impact:** Direct (URLs only; no visual change)
**/in-edu impact:** None

### [HIGH] Locale banner carries verbatim Apple copy and three apple.com URLs

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/locale-banner.ts`
**Location:** Banner copy and link set
**Status:** LATENT
**Current value/reference:**
```ts
// Apple-style country/region chooser copy, verbatim
// https://www.apple.com/in/  ·  https://www.apple.com/in/shop/goto/store  ...
```
**Why it matters:** No `apple.locale_banner` row exists in the database, so this renders only if the banner is enabled or a row is created — but nothing currently guards it beyond the DB's silence. It contains both Apple-derived phrasing and three live Apple URLs.
**Recommended action:** Rewrite copy as Gadzio's own and repoint the URLs, or remove the file if the banner is not part of the Gadzio design.
**Homepage impact:** Possible
**/in-edu impact:** None

### [HIGH] Ribbon fallback reproduces Apple India education EMI and cashback wording

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/Ribbon.tsx`
**Location:** Default ribbon copy constants
**Status:** LATENT
**Current value/reference:**
```text
Apple India student-pricing / EMI / cashback phrasing (code fallback)
```
**Why it matters:** The live `apple.ribbon` row already supplies de-branded student-pricing text with an internal `shopHref`, so the Apple-derived fallback does not render today. It remains in source as the value that renders the moment the row is cleared.
**Recommended action:** Replace the fallback with the same de-branded text the live row uses.
**Homepage impact:** Possible
**/in-edu impact:** None

### [HIGH] Default tile data uses Apple product names and Apple-owned imagery

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles.ts`
**Location:** Hero and promo tile arrays
**Status:** LATENT
**Current value/reference:**
```ts
image: '.../images/tiles/hero_macbook_air_m5__eb1idggd120y_large.jpg'
headline: 'iPhone' / 'MacBook Air' / 'iPad' / 'AirPods' / 'Apple Watch' ...
```
Filenames are Apple's own CDN asset names. Some entries are de-branded (`"Case for AirPods"` in the live promo row), but the file's defaults are not.
**Why it matters:** The live `apple.hero_tiles` row (2 tiles) and `apple.promo_section` row (5 tiles) override these defaults, so today's homepage is clean. The file is nonetheless the fallback for a cleared row, and it is the largest single concentration of Apple product naming in the codebase.
**Recommended action:** Bring the defaults in line with the de-branded live rows.
**Homepage impact:** Possible
**/in-edu impact:** None

### [HIGH] Admin SEO defaults ship title "Apple" and Apple's verbatim meta description

**File:** `src/lib/admin/defaults.ts`
**Location:** `APPLE_SEO_DEFAULTS` (~lines 194-196)
**Status:** INTERNAL ONLY
**Current value/reference:**
```ts
title: 'Apple',
description: "<Apple's verbatim homepage meta description>",
```
**Why it matters:** This is the admin editor's prefill, so it is never served — verified by reading `src/lib/content.ts` (below) and confirming that the homepage's `buildMetadata()` calls `getContent('apple.seo', {})` with an empty-object fallback, meaning the DB row is the only source and the default is unreachable from the public page. The risk is indirect but real: an admin opening the SEO editor sees a prefilled "Apple" title and can save it with one click, which then becomes a live `apple.seo` row and overwrites the Gadzio title.
**Recommended action:** Change the prefill to Gadzio's actual SEO title and description so an accidental save is harmless.
**Homepage impact:** Possible (only via admin save)
**/in-edu impact:** None

### [HIGH] Admin defaults contain apple.com category links and "Apple (IN)" SEO strings

**File:** `src/lib/admin/defaults.ts`
**Location:** Accessory category links (~lines 471-478); cases SEO (~lines 501-503)
**Status:** INTERNAL ONLY
**Current value/reference:**
```ts
shopHref: 'https://www.apple.com/in/shop/goto/store'   // ~line 135
// ~lines 471-478: seven apple.com accessory category URLs
title: 'Cases & Protection - iPhone Accessories - Apple (IN)'   // ~line 501
description: "Shop iPhone cases and protection from Apple..."    // ~line 503
```
**Why it matters:** Verified unreachable from the live page: `src/app/in/shop/iphone/accessories/cases-protection/page.tsx` requests `cases.seo`, `cases.category_links`, `cases.page_header`, and `cases.products` — all with `{}` fallbacks — and no `cases.*` row exists in `content_blocks`. Same one-click-save risk as the SEO defaults above.
**Recommended action:** Replace the prefill URLs with in-app category routes and rewrite the two SEO strings as Gadzio's own.
**Homepage impact:** None
**/in-edu impact:** None

### [HIGH] Package manifest identifies the project as an Apple clone

**File:** `package.json`
**Location:** `name` and `description`
**Status:** INTERNAL ONLY
**Current value/reference:**
```json
"name": "apple-clone",
"description": "... Apple ... clone ..."
```
**Why it matters:** Not served to users, but it is the project's identity in lockfiles, CI logs, deployment dashboards, and to any collaborator. It contradicts the Gadzio positioning the rest of the repository is moving toward.
**Recommended action:** Rename to a Gadzio identifier in a dedicated commit, coordinated with lockfile regeneration.
**Homepage impact:** None
**/in-edu impact:** None

### [HIGH] Admin panel surfaces Apple branding in navigation and headings

**File:** `src/app/(admin)/...` admin routes and collection definitions
**Location:** Admin nav items and section headings
**Status:** ACTIVE (admin-only surface)
**Current value/reference:**
```text
"Apple Homepage"  ·  "Apple Clone Studio"  ·  "The Apple Store difference"  ·  "Apple TV / Music gallery"
```
**Why it matters:** Reached only by authenticated staff, but these labels are visible during ordinary content editing and reinforce a brand identity the storefront no longer uses. One of them ("The Apple Store difference") also mirrors `content.ts`'s shelf heading, which has already been de-branded to "The Gadzio Store difference" — so the admin and the storefront currently disagree.
**Recommended action:** Relabel the admin sections to match the Gadzio terminology already in use on the storefront.
**Homepage impact:** None
**/in-edu impact:** None

### [HIGH] Two-factor enrolment names the issuer "Apple Clone Admin"

**File:** Admin TOTP enrolment (issuer string passed to the authenticator library)
**Location:** Admin auth setup
**Status:** INTERNAL ONLY
**Current value/reference:**
```text
issuer: 'Apple Clone Admin'
```
**Why it matters:** This string is written into staff authenticator apps, where it persists on personal devices indefinitely and is visible on the lock screen of every enrolled admin. Hard to retract once enrolled.
**Recommended action:** Change the issuer to "Gadzio Admin". Note that existing enrolments will keep the old label on already-provisioned devices and may need re-enrolment.
**Homepage impact:** None
**/in-edu impact:** None

### [HIGH] Four additional stylesheets specify SF Pro as the font family

> **STATUS: FIXED in Phase 1 (Fix 3).** All four stylesheets, plus the three `--ac-font-*` tokens in `apple-clone.css`, now lead with `'Inter'`. Zero SF Pro references remain in `src/`. `-apple-system` / `BlinkMacSystemFont` were retained as legitimate system-font keywords. See `## Phase 1 — Approved Fixes: Status` → Fix 3.

**File:** `src/app/in-edu/store/edu-store.css`, plus `auth.css`, `cases.css`, `accessory-category.css`
**Location:** `edu-store.css:24` and the equivalent `font-family` declarations in the others
**Status:** ~~ACTIVE~~ → **FIXED**
**Current value/reference (Phase 0):**
```css
font-family: 'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, ...;
```
**Current value/reference (now):**
```css
/* edu-store.css:24 */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif;

/* cases.css:21 / accessory-category.css:22 */
--cp-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif;
```
**Why it mattered:** Even after the `@font-face` blocks were removed, these stacks requested SF Pro by name. On a Mac or iPhone — the majority of this brand's likely audience — macOS/iOS would satisfy the request with the locally installed SF Pro, so the proprietary typeface kept rendering through the fallback chain. This finding is the reason the Phase 0 report insisted all five stacks and the three variables change together; Phase 1 did exactly that.
**Recommended action (Phase 0):** When the typeface is replaced, update these four stacks as well as the three `--ac-font-*` variables. The `-apple-system` and `BlinkMacSystemFont` entries are legitimate system-font keywords and may stay.
**Action taken (Phase 1):** All four stacks revised to lead with `'Inter'`; SF Pro removed from every stack entirely. `-apple-system` and `BlinkMacSystemFont` retained as instructed.
**Homepage impact:** None
**/in-edu impact:** Direct (fixed)

### [HIGH] Auth screen renders an "App Store" badge

**File:** `src/components/auth/AuthForm.tsx`
**Location:** Lines 279-283
**Status:** ACTIVE
**Current value/reference:**
```tsx
<span ...>App Store</span>   // rendered badge, alongside Google Play / AppGallery siblings (L285-295)
```
**Why it matters:** "App Store" is an Apple trademark and the badge is rendered on the live sign-in screen, next to genuinely third-party store badges. It reads as a claim that the app is distributed through Apple's store. (Note: one automated pass reported this file as clean; a direct read of lines 279-295 confirmed the badge is present. The direct read governs.)
**Recommended action:** Rename the badge to the actual distribution channel, or remove it if Gadzio has no iOS presence.
**Homepage impact:** None
**/in-edu impact:** None

### [HIGH] Gallery content is Apple's, verbatim, with Apple service URLs

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/gallery.ts` and `public/sites/www-apple-com-736d3707/root-8a5edab2/images/gallery/` (146 files)
**Location:** Gallery item definitions and the images they reference
**Status:** LATENT
**Current value/reference:**
```ts
// 15 apple.com service URLs across tv.apple.com (9), music.apple.com (4),
// apps.apple.com (1), fitness.apple.com (3), with itunes.apple.com-style
// tracking parameters; header comment states content is verbatim from apple.com
```
**Why it matters:** The live `apple.gallery` row has `enabled: false`, so none of this renders. It is a complete, ready-to-enable copy of Apple's services gallery — artwork, URLs, and copy — that would light up on a single admin toggle.
**Recommended action:** Determine whether a gallery is part of the intended Gadzio homepage. If not, the row can stay disabled and the data file can be left; if yes, the content must be replaced with Gadzio material.
**Homepage impact:** Possible
**/in-edu impact:** None

### [HIGH] `/in-edu` stylesheet header still names "Apple Education Store (India)"

**File:** `src/app/in-edu/store/edu-store.css`
**Location:** Line 2 (header comment); line 185 (sprite comment: "Apple ships each sticker as a horizontal sprite sheet")
**Status:** INTERNAL ONLY (comments are not served, but the SF Pro stack on line 24 is — see the CRITICAL font finding)
**Current value/reference:**
```css
/* Apple Education Store (India) — page-scoped styles */
/* Apple ships each sticker as a horizontal sprite sheet */
```
**Why it matters:** Comments in a shipped stylesheet are stripped or minified in production but remain in the source repository and in any source map. They identify the page's provenance, which is precisely what the rest of the `/in-edu` de-branding work has tried to undo.
**Recommended action:** Reword the two comments. Trivial change, no rendering impact.
**Homepage impact:** None
**/in-edu impact:** Direct (as documentation)

### [HIGH] `/in-edu` store-card artwork filenames are Apple's own asset names

**File:** `src/components/sites/edu-store/data/content.ts` (image paths) and `public/sites/edu-store/images/store-cards/`
**Location:** Throughout `PRODUCT_NAV`, `SHELVES`
**Status:** ACTIVE
**Current value/reference:**
```text
store-card-40-airpods-5-202609.webp
store-card-40-applecare-202606.webp
store-card-40-apple-creator-studio-202606.webp
store-card-40-bts-apple-music-202607.webp
store-card-40-bts-apple-college-202607.jpg
store-card-50-apple-intelligence-202609.webp
store-card-13-appletv-nav-202210.webp
store-card-13-airtags-nav-202601_GEO_IN.webp
... (34 Apple-named files referenced from live shelves)
```
**Why it matters:** The visible headlines are de-branded ("Gadzio Book Air", "Gadzio Pad", "Gadzio Watch Ultra 4"), but the underlying filenames are Apple's. They appear in the page source, in DevTools, and in the browser's download dialog. The date-stamped Apple naming convention (`-202606`, `_GEO_IN`) also makes the artwork's provenance obvious on inspection.
**Recommended action:** Rename the referenced files to neutral Gadzio names and update the paths, or fold this into the asset-root change recommended above so both are done once.
**Homepage impact:** None
**/in-edu impact:** Direct

### [HIGH] `/in-edu` eligibility footnote is Apple's verbatim education wording

> **STATUS: FIXED in Phase 1 (Fix 5) — with a corrected classification.** The copied sentence is gone, replaced with original Gadzio wording. **However, re-verification established that the `FOOTNOTES` constant is not imported by anything**, so this text was never rendered. Phase 0 classified it ACTIVE; the correct classification was LATENT (dead code). See `## Phase 1 — Approved Fixes: Status` → Fix 5.

**File:** `src/components/sites/edu-store/data/content.ts`
**Location:** `FOOTNOTES`, lines 505-507
**Status:** ~~ACTIVE~~ → **FIXED** (was in fact unreferenced, not rendered)
**Current value/reference (Phase 0 — removed):**
```ts
'Education pricing is available to current and newly accepted college students,
 their parents, and teachers and staff at qualifying institutions.'
```
**Current value/reference (now):**
```ts
export const FOOTNOTES = [
  'Gadzio student offers are available to eligible college students. Eligibility may be verified before an offer is applied.',
];
```
**Why it matters:** This is Apple's education-store eligibility sentence reproduced verbatim. It is both copied text and a legal statement about a program Gadzio is not running.
**Recommended action (Phase 0):** Write Gadzio's own eligibility and verification terms, reflecting whatever program Gadzio actually operates. This is a legal-copy decision, not a mechanical substitution.
**Action taken (Phase 1):** Original Gadzio wording written, deliberately shorter and structurally unlike Apple's sentence (no "current and newly accepted… their parents, and teachers and staff at qualifying institutions" clause chain).
**Correction to the Phase 0 record.** The Phase 0 report stated this rendered "as the storefront's legal footnote". **It did not.** A reference count across `src/` returns **0 importers** of `FOOTNOTES`; `EduStorePage.tsx` imports only `HERO`, `PRODUCT_NAV`, `QUICK_LINKS`, `SHELVES`, and the `EduCard` type. Six sibling exports in the same file (`HOW_TO_BUY_STEPS`, `SHOP_CATEGORIES`, `BTS_OFFERS`, `EDU_IN_ACTION`, `MAC_PRODUCTS`, `IPAD_PRODUCTS`) are likewise unreferenced. The fix removed a latent liability from the repository rather than a visible one — still worth doing, but the Phase 0 severity characterisation was too strong. Whether `FOOTNOTES` should be wired into `/in-edu` (which currently displays no eligibility terms at all) or deleted is an open product decision.
**Homepage impact:** None
**/in-edu impact:** None (the text was never rendered); the repository is nonetheless cleaner

---

## Medium Findings

### [MEDIUM] Apple's `ac-` CSS namespace and `#globalnav` / `#ac-globalfooter` IDs remain in shipped DOM

**File:** `src/app/apple-clone.css` and the `www-apple-com-736d3707` component tree
**Location:** Class and ID selectors throughout; `#globalnav`, `#globalnav-curtain`, `#ac-globalfooter`, `.ac-gf-sosumi`
**Status:** ACTIVE
**Current value/reference:**
```css
#globalnav { ... }
#ac-globalfooter { ... }
.ac-gf-sosumi { ... }
--ac-font-text: ...;
```
**Why it matters:** These are Apple.com's own class and ID conventions, shipped in the DOM and stylesheet of every page. A developer or auditor inspecting the page sees Apple's naming system. No user-visible identity leaks directly, but the namespace is a persistent structural fingerprint.
**Recommended action:** A rename to a Gadzio prefix (`gz-`, `--gz-*`) is mechanical but wide-reaching; scope it deliberately and verify against the shared components. Low user-visible benefit, so treat as a later-stage cleanup.
**Homepage impact:** Possible (CSS-only; no visual change if done carefully)
**/in-edu impact:** Possible

### [MEDIUM] `FloatingBrandSwitcher` uses `'apple'` as a brand identifier

**File:** `src/components/common/FloatingBrandSwitcher.tsx`
**Location:** Lines 8-12 (prop type and comment), line 42 (default), line 45
**Status:** INTERNAL ONLY
**Current value/reference:**
```tsx
/** 'apple' means currently on Gadzio/Apple site (switcher links to Android).
 *  'oppo' means currently on Android/OPPO site (switcher links to Gadzio). */
currentBrand?: 'apple' | 'oppo';
export function FloatingBrandSwitcher({ currentBrand = 'apple' }: ...) {
  const isApple = currentBrand === 'apple';
```
Rendered text is clean — the control displays only "Android" and "Gadzio" and links to `/android` and `/`.
**Why it matters:** The internal identifier and its comment equate "Gadzio site" with "Apple site". This is the one place in the codebase where the identity conflation is stated outright. Not user-visible, but it is the semantic anchor that makes other Apple naming look intentional.
**Recommended action:** Rename the variant to `'gadzio'` and update the comment. Touches every call site, so schedule it with the broader naming pass.
**Homepage impact:** Possible (prop rename only)
**/in-edu impact:** None

### [MEDIUM] CMS content-block namespace is `apple.*`

**File:** `content_blocks` table keys, consumed across `src/app/page.tsx` and admin collections
**Location:** `apple.hero_tiles`, `apple.hero_video`, `apple.promo_section`, `apple.ribbon`, `apple.locale_banner`, `apple.nav`, `apple.footer`, `apple.gallery`, `apple.seo`
**Status:** INTERNAL ONLY (keys are not rendered)
**Current value/reference:**
```ts
getContent('apple.hero_tiles', ...)
getContent('apple.footer', ...)
getContentMany({ gallery: ['apple.gallery', { enabled: false }] })
```
**Why it matters:** The homepage's content is stored under an `apple.*` namespace in the database. Renaming these keys requires a coordinated data migration plus code change and is out of scope for a read-only pass — but it should be tracked, because it is the one Apple-derived identifier that lives in data rather than in the repository and therefore cannot be fixed by a code change alone.
**Recommended action:** Plan a key-rename migration (e.g. `apple.*` → `gadzio.*`) with the code change deployed in the same release. Do not attempt ad hoc.
**Homepage impact:** Possible (data layer)
**/in-edu impact:** None

### [MEDIUM] Navigation flyout links carry Apple product query strings

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/nav.ts`
**Location:** Lines 132, 143, 172-173, 210-214, 225, 264-265, 306
**Status:** INTERNAL ONLY (query strings are in the URL bar when used, but labels are de-branded)
**Current value/reference:**
```ts
href: "/search?q=magsafe+charger"     // label: "Qi2 Magnetic Charger"
href: "/search?q=airpods+4"           // label: "Gadzio Buds 4 (Active Noise Cancellation)"
href: "/search?q=airpods+pro"         // label: "Gadzio Buds Pro 2"
href: "/search?q=earpods+usb-c"       // label: "Gadzio Buds Wired (USB-C)"
href: "/search?q=lightning+cable"     // label: "USB-C to Legacy Connector Cable"
href: "/search?q=thunderbolt"         // label: "40Gbps (USB-C) Pro Cable"
href: "/search?q=airtag"              // label: "Gadzio Tag Holders & Key Rings"
```
**Why it matters:** The visible labels have been carefully de-branded — "Gadzio Buds 4", "Gadzio Tag" — but the query strings still say `airpods`, `earpods`, `airtag`, and `magsafe`, and those appear in the address bar. The de-branding is therefore cosmetic at the URL level. The search backend must also be checked before these are changed, or the de-branded query will return no results.
**Recommended action:** Align the search keywords with the Gadzio product vocabulary, after confirming the search index covers the new terms.
**Homepage impact:** None
**/in-edu impact:** None

### [MEDIUM] Search service returns Apple product copy

**File:** `src/lib/search/searchService.ts`
**Location:** Search result copy and the product-data references
**Status:** ACTIVE
**Current value/reference:**
```text
Apple product naming appearing in search results and descriptions
```
**Why it matters:** Search results are a user-visible surface that the earlier de-branding passes did not cover. This is the most likely place for a user to encounter an Apple product name that the navigation and catalog no longer use.
**Recommended action:** Audit the search copy against the de-branded catalog vocabulary and align.
**Homepage impact:** None
**/in-edu impact:** None

### [MEDIUM] Cart storage key embeds the Apple name

**File:** Cart context (`src/lib/cart/...`)
**Location:** `STORAGE_KEY`
**Status:** INTERNAL ONLY
**Current value/reference:**
```ts
const STORAGE_KEY = 'gadzio_apple_cart_v1';
```
**Why it matters:** Written to every visitor's `localStorage`. Not visible in the UI, but readable by any script on the origin and by anyone who opens DevTools. Renaming it will orphan existing carts unless a read-migration is included.
**Recommended action:** Rename with a migration read (`gadzio_apple_cart_v1` → new key) so existing bags survive.
**Homepage impact:** None
**/in-edu impact:** None

### [MEDIUM] Checkout fallback line item names an Apple product with MagSafe

**File:** `src/components/checkout/CheckoutForm.tsx` (fallback item constant)
**Location:** Default/fallback line item
**Status:** LATENT
**Current value/reference:**
```text
'iPhone 17 Silicone Case with MagSafe - Black'
```
**Why it matters:** Renders only when the real cart data is unavailable, so it is a fallback path rather than normal flow — but it would surface an Apple product name at the most sensitive point in the funnel, the checkout screen.
**Recommended action:** Replace with a Gadzio catalog item name.
**Homepage impact:** None
**/in-edu impact:** None

### [MEDIUM] Missing asset `category-iphone.png` referenced from three live sites

**File:** `public/sites/edu-store/images/category-iphone.png` (does not exist)
**Location:** `src/lib/search/searchService.ts:156`; `SearchResultsView` / `SearchPageView.tsx:56` (fallback); `CartPageView.tsx:71` (fallback)
**Status:** ACTIVE (currently producing a broken image / 404 on those surfaces)
**Current value/reference:**
```ts
'/sites/edu-store/images/category-iphone.png'   // referenced; file absent on disk
```
**Why it matters:** An Apple-named asset that is both referenced and missing — so it is a live 404 as well as an Apple-branded path. This is a functional bug independent of the rebrand.
**Recommended action:** Supply a correctly named Gadzio placeholder image and update the three references together. Do not simply restore an Apple-named file.
**Homepage impact:** None
**/in-edu impact:** None

### [MEDIUM] Two earlier audit documents sit in the repository root

**File:** `APPLE-BRAND-AUDIT.md`, `REPOSITORY-APPLE-AUDIT-2026-10-03.md`
**Location:** Repository root
**Status:** INTERNAL ONLY
**Current value/reference:**
```text
APPLE-BRAND-AUDIT.md
REPOSITORY-APPLE-AUDIT-2026-10-03.md
```
**Why it matters:** These are prior audit artifacts, not application files. They are Apple-titled documents in the root that will be swept up by any keyword search of the repository, and they may now be stale relative to the current code.
**Recommended action:** Decide whether to keep, consolidate into this report, or archive them once the cleanup is complete. Do not delete now.
**Homepage impact:** None
**/in-edu impact:** None

### [MEDIUM] `skills-lock.json` pins an `apple-design` skill

**File:** `skills-lock.json`
**Location:** Locked skill entries
**Status:** INTERNAL ONLY
**Current value/reference:**
```json
"apple-design"
```
**Why it matters:** Tooling metadata, not application content. It records a dependency whose name references Apple; worth noting for completeness, no user impact.
**Recommended action:** Rename or drop the skill reference if the skill is not in use.
**Homepage impact:** None
**/in-edu impact:** None

### [MEDIUM] OPPO brand-switcher styles use an `-apple` class suffix

**File:** OPPO site stylesheet
**Location:** `.oppo-brand-switcher-apple`
**Status:** INTERNAL ONLY
**Current value/reference:**
```css
.oppo-brand-switcher-apple { ... }
```
**Why it matters:** The OPPO-side stylesheet names its counterpart brand "apple" rather than "gadzio", matching the `FloatingBrandSwitcher` identifier issue above.
**Recommended action:** Rename alongside the switcher prop rename.
**Homepage impact:** None
**/in-edu impact:** None

---

## Low Findings

### [LOW] Migration file comments reference `apple.*` content keys

**File:** `migrations/` (comment lines introducing the content-block tables)
**Location:** Table/seed comments
**Status:** INTERNAL ONLY
**Current value/reference:**
```sql
-- apple.hero_tiles, apple.promo_section, ...
```
**Why it matters:** Documentation of the `apple.*` namespace in schema history. Follows from the CMS namespace finding; no independent risk.
**Recommended action:** None required. Historical migrations should not be rewritten.
**Homepage impact:** None
**/in-edu impact:** None

### [LOW] `apple-clone.css` header comments describe the capture source

**File:** `src/app/apple-clone.css`
**Location:** Lines 2-3, 14, 22-23
**Status:** INTERNAL ONLY
**Current value/reference:**
```css
/* www.apple.com/ clone · site: www-apple-com-736d3707 · page: root-8a5edab2 */
/* breakpoints ... (Apple's) */
/* SF Pro Text / SF Pro Display — © Apple Inc., downloaded from the target */
```
**Why it matters:** The filename itself and these comments document the clone. Line 22-23 is the clearest single statement of asset provenance in the codebase and should be revised once the fonts are replaced.
**Recommended action:** Rename the file to a Gadzio stylesheet name and rewrite the header comments as part of the CSS namespace pass.
**Homepage impact:** None
**/in-edu impact:** None

### [LOW] Footer data file comments reference the Apple footer structure

**File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/footer.ts`
**Location:** Lines 1-3, line 43
**Status:** INTERNAL ONLY
**Current value/reference:**
```ts
// Hand-maintained Gadzio footer content (de-brand pass).
/** The whole .ac-gf-sosumi block, verbatim — its ul/ol nesting sets its height. */
```
The file's *content* is clean: Gadzio copyright, internal directory links, PayU/UPI payment copy. Only the comments and the `.ac-gf-sosumi` class name retain Apple references.
**Recommended action:** Reword line 43 when the CSS namespace is renamed. Line 1-3 is already accurate and can stay.
**Homepage impact:** None
**/in-edu impact:** None

### [LOW] Hero video assets use Apple's "bts" (back-to-school) capture naming

**File:** `public/sites/www-apple-com-736d3707/root-8a5edab2/videos/` — `bts-solo-01-largetall_2x.webm`, `bts-solo-02-...`, `bts-solo-03-...`
**Status:** LATENT
**Current value/reference:**
```text
bts-solo-01-largetall_2x.webm   (3 files, ~1.9 MB total)
```
**Why it matters:** No live data row references these videos — `apple.hero_video` exists in the database but its `enabled` field is undefined, so the hero video does not render. The files are shipped but unused, and their names follow Apple's back-to-school campaign convention.
**Recommended action:** Decide whether the hero video is part of the Gadzio homepage. If not, the files and the unused DB row can be removed together in a later pass.
**Homepage impact:** Possible
**/in-edu impact:** None

### [LOW] `open_graph_logo.png` is an unbranded placeholder

**File:** `public/sites/www-apple-com-736d3707/root-8a5edab2/seo/open_graph_logo.png`
**Location:** Referenced by `src/app/page.tsx:26` as the OG image
**Status:** ACTIVE
**Current value/reference:**
```ts
images: ['/sites/www-apple-com-736d3707/root-8a5edab2/seo/open_graph_logo.png'],
```
The image itself is a generic placeholder and carries no Apple marks — but it lives in the `www-apple-com-...` directory and is the image shown when the homepage is shared. Not an Apple-content problem; a branding-opportunity problem.
**Recommended action:** Replace with a Gadzio social card when convenient, alongside the asset-root change.
**Homepage impact:** Direct (share previews)
**/in-edu impact:** None

---

## /in-edu Deep Audit

**Route:** `/in-edu/store` → `src/app/in-edu/store/page.tsx` → `EduStorePage` (`src/components/sites/edu-store/EduStorePage.tsx`) → data (`src/components/sites/edu-store/data/content.ts`) + styles (`src/app/in-edu/store/edu-store.css`).

**Dependency graph inspected:** the route file, the page component, the full 543-line data module, the 585-line stylesheet, `GlobalNav`, `GlobalFooter`, `FloatingBrandSwitcher`, the 49 files under `public/sites/edu-store/images/`, and the CMS keys the page requests.

**Key structural fact that raises `/in-edu`'s risk:** the page requests `edu.hero`, `edu.product_nav`, `edu.quick_links`, `edu.shelf_*`, and `edu.seo`. **No `edu.*` row exists in `content_blocks`.** Because `getContent(key, fallback)` returns the caller's fallback when no row is found, every value in `content.ts` is the value that renders. Unlike the homepage — where six DB rows override the code defaults — `/in-edu` has no override layer. Its data file **is** its content.

### What `/in-edu` does well (de-branding already complete)

The display-copy pass is thorough and should be recognized before the remaining items are listed:

- **Product names are Gadzio's**: "Gadzio Book Air", "Gadzio Book Neo", "Gadzio Pad", "Gadzio Pad Air", "Gadzio Pad Pro", "Gadzio Pad Mini", "Gadzio Watch Series 12", "Gadzio Watch Ultra 4", "Gadzio Watch SE 3", "Gadzio Mini", "Gadzio Studio", "Gadzio One", "Gadzio Phone 18 Pro", "Gadzio Phone 17", "Gadzio Buds 5", "Gadzio Buds Max 2", "Gadzio Tag".
- **Service names are Gadzio's**: "Gadzio Music", "Gadzio TV", "Gadzio Arcade", "Gadzio Cloud+", "Gadzio Intelligence", "Gadzio Assistant", "GADZIOCARE+", "Gadzio Creator Studio", "Gadzio Specialist", "Gadzio Trade In".
- **Shelf headings are Gadzio's**: "The Gadzio Store difference.", "Endless potential.", "The Gadzio experience." — these correspond to admin labels that have *not* been updated, so the admin/storefront mismatch is the admin's problem, not the page's.
- **The nav categories are generic**: Books, Pads, Phones, Watches, Buds, Tags, TV 4K, Speakers, Accessories.
- **The file documents its own position honestly** (lines 539-543): display copy is de-branded, destinations are deliberately left pointing at third-party URLs, and retargeting is deferred.

### `/in-edu` findings

Status column shows the **current** state after Phase 1. Rows 1, 2, 3, 4 and 6 were in the approved five and are closed.

| # | Severity | Item | Location | Status |
| --- | --- | --- | --- | --- |
| 1 | CRITICAL | 15 live apple.com destinations, including "Find a Gadzio Store" → `apple.com/in/retail` and "Order Status" → `secure.store.apple.com` | `content.ts:61,283,369,382,388,395,412,430,446,454,476,483,490,498,499` | **FIXED** (Phase 1) |
| 2 | CRITICAL | Favicon is Apple's logo | `src/app/in-edu/store/page.tsx` `icons` | **FIXED** (Phase 1) |
| 3 | CRITICAL | Apple Inc. trademark footnote in shared footer | live `apple.footer` DB row | **FIXED** (Phase 1) |
| 4 | HIGH | SF Pro in the page's font stack | `edu-store.css:24` | **FIXED** (Phase 1) |
| 5 | HIGH | 34 Apple-named store-card artwork files referenced from live shelves | `content.ts` image paths | REMAINING |
| 6 | HIGH | Apple's verbatim education eligibility footnote | `content.ts` `FOOTNOTES` | **FIXED** (Phase 1) — was dead code |
| 7 | HIGH | Stylesheet header/comment names "Apple Education Store (India)" | `edu-store.css:2,185` | REMAINING (INTERNAL) |
| 8 | MEDIUM | Page inherits `GlobalNav` / `GlobalFooter` from the Apple-clone component tree | `EduStorePage.tsx` | REMAINING (ACTIVE) |
| 9 | MEDIUM | Internal `/in-edu/...` card links have no route on disk (dead links) | `content.ts` — e.g. `/in-edu/shop/buy-mac/macbook-air/macbook-air-with-m5-chip` | REMAINING (broken) |
| 10 | MEDIUM | Tag vocabulary echoes Apple service names one character away ("GADZIOCARE+", "Gadzio Creator Studio", "Gadzio Cloud+") | `content.ts` tags | REMAINING |
| 11 | LOW | Hero utility links carry no de-branding note despite pointing off-site | `content.ts:47-62` | REMAINING (now partly obsolete — see below) |
| 12 | LOW | `aria-label="Education Store"` and rail labels are generic and fine | `EduStorePage.tsx` | LEGITIMATE (unchanged) |

**Net change: 12 findings → 5 fixed · 6 open · 1 legitimate (no action).** The six still open are rows 5, 7, 8, 9, 10 and 11; row 12 was classified LEGITIMATE in Phase 0 and stays that way. Finding 11 is now largely moot: the hero utility links no longer point off-site, so the missing de-branding note it flagged no longer describes a real condition.

**Post-Phase-1 re-verification of this route.** `grep` for `apple.com` across `src/components/sites/edu-store/` and `src/app/in-edu/` returns exactly **one** hit — a source comment at `content.ts:541` stating "no third-party or apple.com URLs remain". It is not rendered, not a link, and not a URL. `grep` for `SF Pro` / `@font-face` across the same tree returns **zero**. The rendered `/in-edu/store` HTML was fetched from a production server and confirmed to contain no `apple.com` and no Apple favicon path.

**Finding 9 in detail — dead internal routes.** Distinct `/in-edu/...` hrefs still appear across `PRODUCT_NAV`, `SHELVES`, and `QUICK_LINKS` (e.g. `/in-edu/shop/buy-mac`, `/in-edu/shop/buy-ipad/ipad-pro`, `/in-edu/shop/accessories/all/education-savings`, `/in-edu/shop/browse/overlay/store/specialist`). Only `/in-edu/store` exists as a route. **This finding is now more load-bearing than it was in Phase 0**, because Phase 1 repointed the 15 off-site cards onto `/search` and `/support` precisely to avoid these missing routes. The cards no longer leave the site, but the destinations they describe still do not exist. Building these routes (or removing the cards) is the natural next step.

**Finding 10 in detail — tag vocabulary.** The tags are de-branded in spelling but not in structure: `GADZIOCARE+` mirrors AppleCare+, `Gadzio Creator Studio` mirrors Apple Creator Studio, `Gadzio Cloud+` mirrors iCloud+, `Gadzio Music` / `Gadzio TV` / `Gadzio Arcade` mirror the Apple One bundle, and the "Gadzio One" product name mirrors Apple One. This is a judgement call rather than a clear infringement — the names are Gadzio's own — but it keeps the Apple product architecture legible to anyone who knows it. Flagged for awareness, not necessarily for change.

**Inherited shared components.** `/in-edu` renders `<GlobalNav bannerVisible={false} />` and `<GlobalFooter />` imported from `src/components/sites/www-apple-com-736d3707/root-8a5edab2/`. It therefore inherits every finding attached to those components. **After Phase 1, two of those inherited findings are resolved on this route**: the footer's Apple Inc. trademark row (Fix 4) and the SF Pro stacks (Fix 3). The `ac-`/`#globalnav` namespace inheritance remains. The `FloatingBrandSwitcher` is not rendered on this route.

**Imagery verified.** 49 files exist under `public/sites/edu-store/images/` and the referenced store-card images resolve — `/in-edu` imagery renders correctly today. This is not a broken-image situation (the one exception, `category-iphone.png`, is referenced from search and cart, not from `/in-edu`).

**SEO/metadata.** `page.tsx` requests `edu.seo`; no such row exists, and the page falls back to `{}`, so Next.js falls back to the root layout metadata. The page therefore currently inherits the site's default title rather than having its own — worth noting for the SEO pass, though not an Apple-identity issue.

---

## Active Apple References

Rendered or reached on a live route today. **Phase 1 status is marked per row.**

| # | Reference | File / Location | Phase 1 |
| --- | --- | --- | --- |
| 1 | ~~Apple logo favicon~~ | `src/app/page.tsx`, `src/app/in-edu/store/page.tsx` | **FIXED** — now `/gadzio_logo.png` |
| 2 | 5 SF Pro font files on disk | `public/.../fonts/` | **UNREFERENCED** — not deleted, not registered |
| 3 | ~~`@font-face` registration, global~~ | `src/app/apple-clone.css` | **FIXED** — 0 `@font-face` rules remain |
| 4 | ~~`--ac-font-text/display/footer` → "SF Pro"~~ | `src/app/apple-clone.css` | **FIXED** — now `"Inter", -apple-system, …` |
| 5 | ~~SF Pro stack (4 more stylesheets)~~ | `edu-store.css`, `auth.css`, `cases.css`, `accessory-category.css` | **FIXED** — all lead with `'Inter'` |
| 6 | ~~15 apple.com destinations on `/in-edu`~~ | `content.ts` | **FIXED** — 0 live Apple URLs on the route |
| 7 | ~~"Apple, iPhone, MagSafe, Mac, and iPad are trademarks of Apple Inc."~~ | live `apple.footer` DB row | **FIXED** — sentence removed |
| 8 | MagSafe/Apple-device compatibility sentence | live `apple.footer` DB row | **KEPT (legitimate)** — nominative use |
| 9 | "App Store" badge | `src/components/auth/AuthForm.tsx:279-283` | REMAINING |
| 10 | 34 Apple-named store-card images | `content.ts` + `public/sites/edu-store/images/store-cards/` | REMAINING |
| 11 | ~~Apple's verbatim eligibility footnote~~ | `content.ts` `FOOTNOTES` | **FIXED** — rewritten (was dead code) |
| 12 | `www-apple-com-736d3707` in every rendered asset URL | asset root + all references | REMAINING |
| 13 | `ac-` classes, `--ac-*` vars, `#globalnav`, `#ac-globalfooter` | `apple-clone.css`, shared components | REMAINING |
| 14 | Apple product copy in search results | `src/lib/search/searchService.ts` | REMAINING |
| 15 | Open Graph image in Apple-named directory | `src/app/page.tsx` | REMAINING (the image itself is unbranded) |
| 16 | Apple-named artwork filenames on `/in-edu` | `content.ts` image paths | REMAINING |
| 17 | `apple.*` CMS namespace (live rows) | `content_blocks` | REMAINING |
| 18 | Missing Apple-named asset (404) | `category-iphone.png` refs | REMAINING |

**Live Apple URLs rendering to a user: 0.** Of the 46 `apple.com` occurrences that remain in `src/`, none reaches a user on any route — 31 are URL strings confined to latent data files, admin prefills and one href rewriter, and 15 are the word `apple.com` inside source comments. This is the single largest change Phase 1 made.

---

## Latent Apple References

Not rendered now, but present in code and activatable by a DB row, a flag, an admin save, or a fallback path.

| # | Reference | File / Location | Activation path |
| --- | --- | --- | --- |
| 1 | 6 Apple service wordmark SVGs (incl. Apple glyph) | `.../root-8a5edab2/icons.tsx` → `GALLERY_LOGOS` | `apple.gallery.enabled` → `true` |
| 2 | Apple Card tile + `card.apple.com` + logo artwork | `.../data/tiles.ts` (~580-662) | `apple.hero_tiles` / `apple.promo_section` row cleared |
| 3 | Apple product-named hero/promo tiles | `.../data/tiles.ts` | row cleared |
| 4 | Apple services gallery — 15 apple.com URLs, 146 images | `.../data/gallery.ts` | `apple.gallery.enabled` → `true` |
| 5 | Locale banner verbatim copy + 3 apple.com URLs | `.../data/locale-banner.ts` | `apple.locale_banner` row created |
| 6 | Ribbon Apple India EMI/cashback wording | `.../root-8a5edab2/Ribbon.tsx` | `apple.ribbon` row cleared |
| 7 | `https://www.apple.com` href rewriter | `.../root-8a5edab2/TileCard.tsx:29-30` | any relative href passed that is not already absolute |
| 8 | Hero video (Apple "bts" campaign files) | `public/.../videos/` | `apple.hero_video.enabled` set true |
| 9 | `'iPhone 17 Silicone Case with MagSafe - Black'` | `CheckoutForm.tsx` fallback | cart data unavailable |
| 10 | Admin SEO prefill `title: 'Apple'` + verbatim description | `src/lib/admin/defaults.ts:194-196` | admin saves the SEO form |
| 11 | Admin apple.com category links + "Apple (IN)" | `src/lib/admin/defaults.ts:135,471-478,501-503` | admin saves the cases form |

**Note on item 7** — `TileCard.tsx:29-30`:
```ts
const heroTileHref = (href) => href.startsWith('http') ? href : `https://www.apple.com${href}`;
```
Any tile given a root-relative href (e.g. `/in-edu/store`) is silently rewritten to an absolute `apple.com` URL. This is the mechanism by which a future tile could start pointing off-site without anyone writing an Apple URL.

---

## Internal-Only Apple References

Never served to users; visible only in source, build tooling, admin surfaces, or the repository itself.

| # | Reference | File / Location |
| --- | --- | --- |
| 1 | `package.json` name `apple-clone` + description | `package.json` |
| 2 | `APPLE_SEO_DEFAULTS` with `title: 'Apple'` | `src/lib/admin/defaults.ts:194-196` |
| 3 | 8 apple.com URLs in admin prefill | `src/lib/admin/defaults.ts:135,471-478` |
| 4 | `'Cases & Protection - iPhone Accessories - Apple (IN)'` | `src/lib/admin/defaults.ts:501-503` |
| 5 | Admin nav/heading labels ("Apple Homepage", "Apple Clone Studio", "The Apple Store difference", "Apple TV / Music gallery") | `src/app/(admin)/...` |
| 6 | TOTP issuer `'Apple Clone Admin'` | admin auth setup |
| 7 | `STORAGE_KEY = 'gadzio_apple_cart_v1'` | cart context |
| 8 | `currentBrand: 'apple'` + comment equating Gadzio with Apple | `src/components/common/FloatingBrandSwitcher.tsx:8-12,42,45` |
| 9 | `.oppo-brand-switcher-apple` | OPPO stylesheet |
| 10 | `apple.*` content-block keys | `content_blocks` |
| 11 | `?q=airpods+*`, `?q=earpods+*`, `?q=airtag`, `?q=magsafe`, `?q=lightning`, `?q=thunderbolt` | `.../data/nav.ts:132,143,172-173,210-214,225,264-265,306` |
| 12 | `apple-clone.css` header comments + `© Apple Inc.` font notice | `src/app/apple-clone.css:2-3,14,22-23` |
| 13 | `.ac-gf-sosumi` comment in footer data | `.../data/footer.ts:43` |
| 14 | `migrations/` comments | `migrations/*.sql` |
| 15 | `APPLE-BRAND-AUDIT.md`, `REPOSITORY-APPLE-AUDIT-2026-10-03.md` | repository root |
| 16 | `skills-lock.json` → `apple-design` | `skills-lock.json` |
| 17 | `scripts/fix-apple-*.mjs`, `scripts/inspect-apple-keys.mjs` | `scripts/` |
| 18 | Component/file names `AppleHomePage`, `apple-clone.css` | `src/` |
| 19 | `www-apple-com-736d3707` / `root-8a5edab2` directory names | `src/components/sites/`, `public/sites/` |
| 20 | README asset-provenance note (`© Apple Inc.`, unlicensed) | `README.md` |

---

## Copyright / Legal Findings

| # | Severity | Item | Basis | Phase 1 status |
| --- | --- | --- | --- | --- |
| 1 | CRITICAL | Apple logo used as favicon | Trademark use of Apple's primary mark | **FIXED** — repointed to `/gadzio_logo.png`; Apple `.ico` unreferenced on disk |
| 2 | CRITICAL | 5 SF Pro `.woff2` files redistributed from `public/` | Redistribution of Apple's licensed font software; file comment states "© Apple Inc." | **FIXED (unreferenced)** — no `@font-face` remains, so nothing is downloaded; files still on disk, so redistribution exposure is reduced but not eliminated |
| 3 | CRITICAL | `GALLERY_LOGOS` SVG wordmarks incl. Apple glyph | Reproduction of Apple logos in vector form; header states "verbatim from https://www.apple.com/" | REMAINING (LATENT) |
| 4 | CRITICAL | Apple Card tile — brand, artwork, apply URL | Trademark + product imagery + financial-services destination | REMAINING (LATENT) |
| 5 | CRITICAL | Footer trademark attribution naming Apple Inc. under a Gadzio copyright | Statement of a relationship that does not exist | **FIXED** — attribution sentence removed from the live row; compatibility sentence kept |
| 6 | HIGH | `/in-edu` eligibility footnote verbatim | Copied legal/eligibility text | **FIXED** — rewritten as Gadzio copy (text was unreferenced) |
| 7 | HIGH | `/in-edu` ribbon/tile marketing copy (Apple India EMI, cashback) | Copied marketing and financial-offer language | REMAINING (LATENT) |
| 8 | HIGH | Gallery/tiles/nav data with "verbatim" headers | Copied content and structure, documented as such | REMAINING (LATENT) |
| 9 | HIGH | README records the assets as Apple's and unlicensed | Documented knowledge of unlicensed use | REMAINING (INTERNAL) |
| 10 | MEDIUM | `ac-`/`--ac-*`/`globalnav` naming system | Structural copying of Apple's CSS architecture | REMAINING (ACTIVE) |
| 11 | LEGITIMATE | "Apple, iPhone, MagSafe, Mac, iPad" **as compatibility references only** | Nominative fair use | UNCHANGED — the Phase 1 footer fix deliberately preserved this |

**Phase 1 outcome: 3 of the 5 CRITICAL items and 1 HIGH item are closed.** The two remaining CRITICAL items (3 and 4) are both **LATENT** — they are not rendered, but are activatable by a single admin action.

**Legal note.** This section records what the repository contains and where. It is not legal advice, and it deliberately does not quantify exposure or predict outcomes. Findings 3-8 involve Apple-owned marks, copyrighted works, or copied text used in a commercial storefront, and require new copy or artwork to be produced rather than a mechanical substitution.

**One asymmetry, now partly resolved.** The `apple.footer` footnote previously disclaimed Apple affiliation *and* named Apple Inc. as a trademark owner beneath a Gadzio copyright line. **Phase 1 removed the attribution and kept the disclaimer**, which is the correct shape: a defensible compatibility statement is needed, an attribution line is not. This is the one place where the fix brought the live data into line with the code fallback in `data/footer.ts`, which had modelled the right approach all along.

**A note on finding 2's residual.** Removing the `@font-face` blocks stops the fonts being **served**, which is the live harm. It does not remove the files from `public/`, so the files themselves are still redistributed in the repository and still reachable by direct URL (`/sites/www-apple-com-736d3707/root-8a5edab2/fonts/sf-pro-*.woff2`). Deleting them was **not** approved and was therefore not done. If the goal is to eliminate the redistribution exposure as well as the serving exposure, the files need a separate, explicitly approved deletion.

---

## Apple URLs / External Links

**Total `apple.com` occurrences in live `src/`: 46** — re-grepped against the working tree, not carried over.

> **Correction to an earlier figure in this report.** An intermediate revision of this audit stated the post-fix total as **36**, arrived at by subtracting the 15 `/in-edu` destinations from Phase 0's 51. That subtraction was never re-verified against the tree, and it is wrong. The re-grep gives **46 occurrences**, of which **31 are URL strings** and **15 are the words "apple.com" inside source comments**. Phase 0's 51 was counted on a different basis, so a like-for-like Phase 0/now delta cannot be reconstructed from the tree alone — the code has changed. The figure below is what is actually in `src/` today.

**Split of the 46:**

| Kind | Count | Notes |
| --- | --- | --- |
| URL strings — a host a user or the app could actually fetch | **31** | Data files, the href rewriter, and admin prefills |
| Prose in source comments — the literal text `apple.com` | **15** | Never parsed, never rendered; e.g. `TileCard.tsx`'s explanation of what its rewriter does |

**The 31 URL strings, by host:**

| Host | Count | Where | Renders to a user? |
| --- | --- | --- | --- |
| `www.apple.com` | 12 | admin prefills (8), locale banner (3), TileCard rewriter (1) | **No** — admin-only or latent |
| `tv.apple.com` | 9 | `.../data/gallery.ts` | No — `apple.gallery.enabled = false` |
| `music.apple.com` | 3 | `gallery.ts` | No — gallery disabled |
| `fitness.apple.com` | 3 | `gallery.ts` | No — gallery disabled |
| `apps.apple.com` | 3 | `gallery.ts` | No — gallery disabled |
| `card.apple.com` | 1 | `data/tiles.ts` (Apple Card apply CTA) | No — the live tiles row overrides it |
| `secure.store.apple.com` | 0 | — | **Removed by Fix 1** |
| `developer.apple.com` | 0 | — | **Removed by Fix 1** |

**The 31 URL strings, by file:**

| File | URLs | Nature |
| --- | --- | --- |
| `.../root-8a5edab2/data/gallery.ts` | 18 | LATENT gallery data (9 `tv.`, 3 `music.`, 3 `apps.`, 3 `fitness.`) |
| `src/lib/admin/defaults.ts` | 8 | Admin editor prefill only — never rendered |
| `.../root-8a5edab2/data/locale-banner.ts` | 3 | LATENT — no `apple.locale_banner` row exists |
| `.../root-8a5edab2/TileCard.tsx` | 1 | The `https://www.apple.com${href}` href rewriter |
| `.../root-8a5edab2/data/tiles.ts` | 1 | LATENT Apple Card apply CTA |

**The 15 comment mentions, by file:** `apple-clone.css` 1 · `page.tsx` 2 · `content.ts` 1 · `AppleHomePage.tsx` 1 · `data/footer.ts` 1 · `data/gallery.ts` 1 · `data/locale-banner.ts` 1 · `data/tiles.ts` 2 · `icons.tsx` 1 · `Ribbon.tsx` 1 · `TileCard.tsx` 2.

**Files that no longer contain the string at all:** `src/components/sites/edu-store/data/content.ts` holds one — a comment at line 541 asserting no apple.com URLs remain. `src/app/in-edu/` and `src/components/sites/edu-store/` contain nothing else.

**No `apple.com` URL renders on any route.** This was the primary goal of Phase 1 and it is met. `grep` for `SF Pro` and for `@font-face` across `src/` both return **0**.

**Verified absent:** no `apple.com` URL in `public/sites` JavaScript, JSON, or CSS. No `sitemap.ts`, `robots.ts`, `manifest.json`, `apple-icon`, or JSON-LD / structured-data block anywhere in `src/app`. No `itunes.apple.com` link in any live route.

**`/in-edu` destinations — the Phase 1 result**, for the record:

| Card label | Phase 0 destination | Now |
| --- | --- | --- |
| "Find a Gadzio Store" (hero) | `https://www.apple.com/in/retail` | `/support` |
| "Find a Store" (quick links) | `https://www.apple.com/in/retail` | `/support` |
| "Order Status" (quick links) | `https://secure.store.apple.com/in-edu/shop/order/list` | `/support#order-help` |
| "Gadzio Music Student Plan comes with Gadzio TV for free." | `https://music.apple.com/subscribe/student` | `/search` |
| "Top class. In every class." | `https://www.apple.com/in/education/college-students` | `/in-edu/store` |
| "Set your sights high." | `https://www.apple.com/careers/in/students.html` | `/support` |
| "Explore success stories." | `https://www.apple.com/in/education/success-stories` | `/support` |
| "Brush up on code." | `https://developer.apple.com/learn` | `/search` |
| "Gadzio Phone 18 Pro" | `https://www.apple.com/in-edu/shop/buy-iphone/iphone-18-pro` | `/search?q=Gadzio+Phone+18+Pro` |
| "Gadzio Phone 17" | `https://www.apple.com/in-edu/shop/buy-iphone/iphone-17` | `/search?q=Gadzio+Phone+17` |
| "Gadzio Phone 17e" | `https://www.apple.com/in-edu/shop/buy-iphone/iphone-17e` | `/search?q=Gadzio+Phone+17e` |
| "Gadzio Phone Air" | `https://www.apple.com/in-edu/shop/buy-iphone/iphone-air` | `/search?q=Gadzio+Phone+Air` |
| "Gadzio Intelligence and Gadzio Assistant..." | `https://www.apple.com/in/apple-intelligence` | `/search` |
| "Explore Gadzio Intelligence" | `https://www.apple.com/in/today/event/spotlight-apple-intelligence?cid=…` | `/search` |
| "All the storage you need..." | `https://www.apple.com/in/icloud` | `/search` |

**One non-URL string remains.** `content.ts:541` contains the literal text `apple.com` inside a source comment — "no third-party or apple.com URLs remain". It is documentation, not a link, and it does not render. It is left in place deliberately rather than reworded to make a `git grep -i apple` sweep look cleaner.

---

## Apple Styling / UI Identity

**Layout and visual design.** The Gadzio homepage design is intentionally Apple-derived in structure — that is the established premise of the project and is outside the scope of what this audit recommends changing. The Gadzio mark, the color system, the footer, and the visible copy are all Gadzio's. **No redesign is recommended.**

What remains structurally Apple's:

| # | Item | Location | Phase 1 status |
| --- | --- | --- | --- |
| 1 | `ac-` class prefix | `apple-clone.css` + shared components | REMAINING (ACTIVE) |
| 2 | `--ac-*` custom properties | `apple-clone.css` and throughout | REMAINING (ACTIVE) |
| 3 | `#globalnav`, `#globalnav-curtain` IDs | Global nav | REMAINING (ACTIVE) |
| 4 | `#ac-globalfooter`, `.ac-gf-sosumi` | Global footer | REMAINING (ACTIVE) |
| 5 | Apple breakpoints (735 / 834 / 1069) as `am:` / `anav:` / `al:` | Tailwind theme | REMAINING (ACTIVE) |
| 6 | ~~SF Pro font stack~~ | 5 stylesheets | **FIXED** — all now `'Inter', -apple-system, …` |
| 7 | Flyout group structure (elevated group + region labels) | `.../data/nav.ts` | REMAINING (ACTIVE) |
| 8 | ~~`Myriad Set Pro` in the footer font stack~~ | `apple-clone.css` `--ac-font-footer` | **FIXED** — removed with the Phase 1 font pass |

**Resolved in Phase 1: items 6 and 8.** The remaining six are all CSS-namespace or structural items, which the phase explicitly excluded.

Item 7 is worth a note: the nav's `NavWordmark` type and `region`/`elevatedGroup` fields model Apple's global-nav flyout. Every `wordmark.paths` array is currently **empty** (`viewBox: "0 0 1 1"`, `paths: []`), which is why no Apple wordmarks render in the nav today. The structure that would hold them is intact and populated with empty slots.

Item 8, resolved: `"Myriad Set Pro"` was named as a fallback in `--ac-font-footer`. It was never shipped — no Myriad files exist in `public/` — so it could only render on a machine that had it installed. It is now gone from the stack entirely, along with `"SF Pro Icons"`.

---

## Apple Assets / Fonts / Videos / Images

**Apple-owned assets currently shipped**

All files below were confirmed **still present on disk** during Phase 1 re-verification. None was deleted, renamed, or moved — the approved fixes changed *references*, not files.

| Asset | Path | Size | Phase 1 status |
| --- | --- | --- | --- |
| Favicon (Apple logo) | `public/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico` | 22,382 B | **Unreferenced** — no route points at it; file intact on disk |
| SF Pro Display Bold | `.../fonts/sf-pro-display_bold.woff2` | — | **Unreferenced** — no `@font-face` remains |
| SF Pro Display Regular | `.../fonts/sf-pro-display_regular.woff2` | — | **Unreferenced** |
| SF Pro Display Semibold | `.../fonts/sf-pro-display_semibold.woff2` | — | **Unreferenced** |
| SF Pro Text Regular | `.../fonts/sf-pro-text_regular.woff2` | — | **Unreferenced** |
| SF Pro Text Semibold | `.../fonts/sf-pro-text_semibold.woff2` | — | **Unreferenced** |
| Open Graph image | `.../seo/open_graph_logo.png` | 16,205 B | ACTIVE — generic placeholder, Apple-named directory only (REMAINING) |
| Hero videos (Apple "bts") | `.../videos/bts-solo-0{1,2,3}-largetall_2x.webm` | ~1.9 MB total | LATENT — no live reference (REMAINING) |
| Gallery images | `.../images/gallery/` | 146 files | LATENT — `apple.gallery.enabled = false` (REMAINING) |
| Tile images | `.../images/tiles/` | 62 files | LATENT — hero/promo rows override (REMAINING) |
| Store-card images (Apple-named) | `public/sites/edu-store/images/store-cards/` | 34 referenced from live shelves | ACTIVE on `/in-edu` (REMAINING) |
| Education page imagery | `public/sites/edu-store/images/` | 49 files total | ACTIVE on `/in-edu` (REMAINING) |

**Gadzio logo.** `public/gadzio_logo.png` — 2,499 bytes, **184×61** (verified by reading the PNG IHDR header). This is the asset Phase 1 pointed the favicon at. It is a genuine Gadzio brand mark already present in `public/`, which is why nothing was fabricated — but its 3:1 aspect ratio makes it a poor favicon, and no square Gadzio icon exists in the repository. **This is an open dependency.**

**Clean assets.** `public/` root contains `gadzio_logo.png` and `index.html` — no Apple content. The `FireShot/` subdirectory under the live asset root holds OPPO screen captures, not Apple material.

**Fonts — the fallback exposure is closed.** Phase 0 warned that removing the `@font-face` blocks alone would be insufficient, because the four additional stylesheets naming `'SF Pro Display'` / `'SF Pro Text'` first would still resolve to locally installed SF Pro on macOS and iOS. **All five stacks and all three `--ac-font-*` variables were changed together**, so that path is closed: no stack in the application names SF Pro any longer, and `-apple-system` / `BlinkMacSystemFont` resolve to the platform UI font rather than to SF Pro by name.

**Videos.** The three `.webm` files are shipped but referenced by nothing in live data (`apple.hero_video` exists as a row but has no `enabled` value, so the hero video does not render). They are dead weight and Apple-campaign-named, but carry no trademark content themselves — the lowest-priority asset item.

---

## SEO / Metadata Findings

| # | Severity | Item | Location | Phase 1 status |
| --- | --- | --- | --- | --- |
| 1 | CRITICAL | Apple logo favicon in `metadata.icons` | `src/app/page.tsx` | **FIXED** — now `/gadzio_logo.png` |
| 2 | CRITICAL | Apple logo favicon in `/in-edu` metadata | `src/app/in-edu/store/page.tsx` | **FIXED** — now `/gadzio_logo.png` |
| 3 | HIGH | OG image served from Apple-named directory | `src/app/page.tsx` | REMAINING (the image itself is an unbranded placeholder) |
| 4 | HIGH | Admin SEO prefill `title: 'Apple'` + Apple's verbatim description | `src/lib/admin/defaults.ts` | REMAINING (INTERNAL) |
| 5 | HIGH | Admin cases SEO `'... - Apple (IN)'` + "from Apple" description | `src/lib/admin/defaults.ts` | REMAINING (INTERNAL) |
| 6 | MEDIUM | `/in-edu` requests `edu.seo`; no row exists, so it inherits root metadata | `src/app/in-edu/store/page.tsx` | REMAINING (ACTIVE) |
| 7 | LOW | OG image is an unbranded placeholder | `.../seo/open_graph_logo.png` | REMAINING (ACTIVE) |

**The homepage title is currently correct.** `src/app/page.tsx` calls `buildMetadata()`, which reads `getContent('apple.seo', {})`. The fallback is an empty object, so when no `apple.seo` row exists the spread contributes nothing and the literal `title: 'Gadzio'` stands. Verified: no `apple.seo` row exists in `content_blocks`. The homepage title today is Gadzio's. The risk is prospective, via the admin prefill (finding 4).

**Phase 1 note on the favicon entries.** The two CRITICAL metadata findings are closed. Re-verification found that the application actually declares `metadata.icons` in **eight** places, not two — the six accessory-category route files already used `/gadzio_logo.png` and were never affected. All eight now read `icon: '/gadzio_logo.png'`, so the fix is uniform across the application rather than applying only to the two routes Phase 0 identified.

**Absent by design and verified absent:** no `sitemap.ts`, no `robots.ts`, no `manifest.json`, no `apple-icon` convention file, no `opengraph-image` convention file, and no JSON-LD or structured-data `<script>` anywhere in `src/app`. Nothing to remediate; noted so the absence is not mistaken for an unexamined area.

---

## Database / CMS Findings

**Inspection method (Phase 0):** read-only query via `scripts/inspect-apple-keys.mjs` — a script that self-guards against writes (it refuses to run if any statement body matches a write pattern) and selects from `content_blocks` and `site_settings` only. **No row was inserted, updated, or deleted during Phase 0.**

**Inspection method (Phase 1):** one **approved** content write — the `apple.footer` row's `footnotesHtml` field — performed by a guarded one-off script that refused to write unless the exact target sentence was present verbatim, refused if `trademarks of Apple Inc` survived, and refused if any other field differed. It was run once, succeeded, and was then **deleted**. Every subsequent database read in this revision was read-only.

**`content_blocks` — 6 rows (unchanged in count):**

| Key | Content summary | Apple references | Phase 1 |
| --- | --- | --- | --- |
| `apple.footer` | Gadzio footer; copyright "© 2026 Gadzio Inc."; `localeLabel` "India"; `localeHref` "/" | ~~"Apple, iPhone, MagSafe, Mac, and iPad are trademarks of Apple Inc."~~ **removed**; MagSafe/Apple-device compatibility sentence **kept** | **UPDATED** (Fix 4) |
| `apple.gallery` | Gallery config, **`enabled: false`** (verified), 5 `items`, `heading` empty, `secondRowEnabled: false`; all image `src` fields are empty strings | **5 verbatim Apple TV+ marketing taglines** in the item titles ("The hit comedy is back and Tedder than ever.", "Anya Taylor-Joy is a grifter running for her life after a heist goes sideways.", "Every Grand Prix™, live and on demand…", "The truth lies in the past.", "Watch every club, every match, live—all season long."). No `apple.com` URL and no trademark string in the row. | unchanged — inspected read-only in Phase 1 |
| `apple.hero_tiles` | 2 tiles: "Semester, unlocked." → `/in-edu/store`; "Everyday Essentials" → `/shop/iphone/accessories/cases-protection`. Alt text empty. | None | unchanged |
| `apple.hero_video` | Video config, `enabled` undefined | None | unchanged |
| `apple.promo_section` | Heading "Explore Accessories", 5 de-branded tiles incl. "Case for AirPods" | "AirPods" in one tile headline (compatibility framing) | unchanged |
| `apple.ribbon` | De-branded student-pricing text, internal `shopHref` | None | unchanged |

**Re-verified after Phase 1:**

| Check | Result |
| --- | --- |
| `apple.footer` matches `/trademarks of Apple Inc/i` | **false** |
| `apple.footer` contains the compatibility sentence | **true** |
| `apple.footer.copyright` | `Copyright © 2026 Gadzio Inc. All rights reserved.` — byte-identical to Phase 0 |
| `apple.footer.localeLabel` / `localeHref` | `India` / `/` — byte-identical to Phase 0 |
| `apple.footer.updated_at` | `2026-10-05T18:48:30Z` |
| Rows carrying an Apple reference | **1** (down from 2) — `apple.gallery`, disabled |
| `apple.gallery.enabled` | `false` (confirmed by query). `apple.com` URLs inside the row: **0**. `Apple Inc` in the row: **0**. What it does hold is 5 verbatim Apple TV+ taglines — a copy issue, not a URL or trademark one, and invisible while the row is disabled |
| Rows containing the string `apple.com` | **0 of 6** |
| Rows containing `Apple Inc` | **0 of 6** |

**`site_settings` — empty.**

**This is the finding that governs the whole report.** Because these six rows exist, the following code defaults do **not** render:

- `data/tiles.ts` — Apple product names, Apple Card tile, Apple CDN filenames
- `Ribbon.tsx` — Apple India EMI/cashback fallback copy
- `data/gallery.ts` — Apple services gallery (`enabled: false`)
- `data/locale-banner.ts` — no row, but no activation either

And because **no** `apple.seo`, `apple.nav`, or `apple.locale_banner` row exists, and **no** `edu.*` or `cases.*` row exists, the code values for those keys **do** render. That is why `/in-edu` was the highest-risk route — and why Fix 1, which rewrote those code values, was the highest-value change in Phase 1.

**Architectural note — the override chain.** `src/lib/content.ts` defines the rule that makes the above true:

```ts
export async function getContent<T>(key: string, fallback: T): Promise<T> {
  const value = await getContentRaw<T>(key);
  return value ?? fallback;
}
```

The function returns the **caller's** fallback — never a value from `defaults.ts`. `defaults.ts` values exist only to prefill the admin editor. This distinction caused an early misclassification during the Phase 0 audit (several `defaults.ts` apple.com URLs were initially flagged as live leaks) and was corrected by reading `content.ts` and the consuming pages directly. It determines the severity of every `defaults.ts` finding: they are prefill hazards, not live leaks — but the prefill is one admin click away from becoming live data.

**A second instance of the same pattern, found in Phase 1.** The same reasoning that governs `defaults.ts` also applies to unreferenced *exports*: `content.ts`'s `FOOTNOTES` constant was classified ACTIVE in Phase 0 on the assumption that it rendered, but a reference count proves nothing imports it. **An export existing is not the same as an export rendering**, and the Phase 0 audit did not apply that check consistently. Phase 1's re-verification corrected the one instance that mattered for an approved fix. The six sibling exports it exposed (`HOW_TO_BUY_STEPS`, `SHOP_CATEGORIES`, `BTS_OFFERS`, `EDU_IN_ACTION`, `MAC_PRODUCTS`, `IPAD_PRODUCTS`) are recorded under `## Remaining Findings — Not Approved`.

---

## Legitimate References That Can Remain

These are **LEGITIMATE-KEEP**. They describe compatibility, interoperability, or third-party products, and none of them claims or implies an Apple affiliation. Removing them would make the storefront less accurate, not safer — a shop that sells phone cases must be able to say which phones they fit.

| # | Category | Examples | Locations |
| --- | --- | --- | --- |
| 1 | Product compatibility names | "iPhone", "iPad", "Apple Watch", "AirPods", "Apple Pencil", "MagSafe" used to describe what an accessory fits | accessory data files, `CasesProtectionPage`, `ProductDetailPage` |
| 2 | Compatibility footnotes | "Compatibility with Qi2 wireless chargers and third-party devices varies by model — check each product page" | `data/footer.ts:31`, live footer row |
| 3 | System font keywords | `-apple-system`, `BlinkMacSystemFont` | all font stacks |
| 4 | Consumer-facing product catalog | Gadzio's own case, charger, and cable products named by the device they fit | `src/lib/products/`, search index |
| 5 | Third-party platform names | "Google Play", "AppGallery" (genuine distribution channels) | `AuthForm.tsx:285-295` |
| 6 | Internal query parameters used as search terms | `?q=iphone+17`, `?q=iphone+16` where the label is a Gadzio product | `data/nav.ts:264-265` |

**On category 1, an important precision.** The distinction that holds up is between *using a name to describe what a product fits* and *using a name, logo, or typeface as your own branding*. "Case for AirPods" is the former and is fine. Apple's logo as the favicon is the latter and is the single most serious finding in this repository. Most of what remains in the codebase falls clearly on one side or the other; the tag vocabulary on `/in-edu` (finding 10 in that section) is the one genuine grey area, and it is flagged rather than condemned.

---

## Files That Need Changes

Grouped by change type, not by severity, so the work can be sequenced. **Items marked ✅ were completed in Phase 1 and re-verified. Everything else is untouched.**

**A. Asset replacement (no code logic changes)**
- ⬜ `public/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico` — replace with a Gadzio favicon. **Still referenced by nothing (Phase 1 removed the reference) but still on disk.** The immediate replacement needed is a *square* Gadzio icon; see the open dependency in `## Remaining Findings — Not Approved`.
- ⬜ `public/sites/www-apple-com-736d3707/root-8a5edab2/fonts/sf-pro-*.woff2` (5 files) — remove once the typeface is replaced. **No longer loaded by any `@font-face`, but still shipped and still reachable by direct URL.** Deletion was not approved in Phase 1.
- ⬜ `public/sites/www-apple-com-736d3707/root-8a5edab2/seo/open_graph_logo.png` — replace with a Gadzio social card
- ⬜ `public/sites/edu-store/images/store-cards/*` (34 referenced files) — rename to Gadzio names
- ⬜ `public/sites/edu-store/images/category-iphone.png` — supply (currently a 404)

**B. Metadata and configuration**
- ✅ `src/app/page.tsx` — `icons` → `/gadzio_logo.png` (**done, Fix 2**)
- ✅ `src/app/in-edu/store/page.tsx` — `icons` → `/gadzio_logo.png` (**done, Fix 2**)
- ⬜ `src/app/page.tsx` — `images` (OG image, still in the Apple-named directory)
- ⬜ `src/lib/admin/defaults.ts` — SEO prefill, `shopHref`, category links, cases SEO
- ⬜ `package.json` — `name`, `description`
- ⬜ `skills-lock.json` — `apple-design` entry

**C. Stylesheet fonts and namespace**
- ✅ `src/app/apple-clone.css` — `@font-face` blocks removed, `--ac-font-*` tokens rewritten, stale header comment corrected (**done, Fix 3**)
- ✅ `src/app/in-edu/store/edu-store.css` — font stack rewritten (**done, Fix 3**); comment at L2/L185 still names Apple (⬜ remaining)
- ✅ `src/components/auth/auth.css`, cases stylesheet, accessory-category stylesheet — font stacks rewritten (**done, Fix 3**)
- ⬜ `src/app/apple-clone.css` — `ac-`/`--ac-*` namespace, header comment still naming `www.apple.com`
- ⬜ OPPO stylesheet — `.oppo-brand-switcher-apple`

**D. Content and copy**
- ✅ `src/components/sites/edu-store/data/content.ts` — 15 Apple URLs repointed (**done, Fix 1**); eligibility footnote rewritten (**done, Fix 5**)
- ✅ live `apple.footer` DB row — trademark attribution removed, compatibility sentence retained (**done, Fix 4**)
- ⬜ `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/gallery.ts` — if the gallery is kept
- ⬜ `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/locale-banner.ts` — if the banner is kept
- ⬜ `src/components/sites/www-apple-com-736d3707/root-8a5edab2/Ribbon.tsx` — fallback copy
- ⬜ `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles.ts` — defaults
- ⬜ `src/components/sites/www-apple-com-736d3707/root-8a5edab2/icons.tsx` — `GALLERY_LOGOS`
- ⬜ `src/components/auth/AuthForm.tsx` — "App Store" badge
- ⬜ `src/lib/search/searchService.ts` — product copy
- ⬜ `README.md` — asset-provenance section

**E. Renames (higher risk — touch many call sites)**
- ⬜ `src/components/sites/www-apple-com-736d3707/root-8a5edab2/` — directory rename
- ⬜ `src/app/apple-clone.css` — file rename
- ⬜ `src/components/common/FloatingBrandSwitcher.tsx` — `'apple'` variant rename
- ⬜ `src/components/sites/www-apple-com-736d3707/root-8a5edab2/TileCard.tsx` — remove the apple.com href rewriter
- ⬜ cart `STORAGE_KEY`
- ⬜ TOTP issuer string
- ⬜ admin labels
- ⬜ `apple.*` DB content keys (requires migration)

**Phase 1 summary: 9 source files + 1 database row changed. Zero files in section A, D (data files other than `content.ts`), or E were touched — those were all explicitly excluded from this phase.**

---

## Files That Do NOT Need Changes

Verified clean. Listed so the scope of the eventual cleanup is bounded.

**Content and data**
- `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/footer.ts` — Gadzio footer, internal links, PayU/UPI copy, clean copyright. Only comment and `.ac-gf-sosumi` class on L43 (a namespace item, tracked above).
- `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/nav.ts` — labels, headings, and all flyout copy are de-branded; wordmark slots are empty. Only findings are the `?q=` search terms.
- `src/components/common/FloatingBrandSwitcher.tsx` — **rendered text is clean** (displays only "Android" and "Gadzio"; links to `/android` and `/`). Only the internal prop identifier needs work.
- `src/components/sites/edu-store/EduStorePage.tsx` — component logic, aria-labels, and structure are clean.
- Legal pages (`/terms`, `/privacy`) — Gadzio-written.
- Product catalog data — Gadzio products with legitimate compatibility references.

**Verified absent (nothing to fix)**
- No `sitemap.ts`, `robots.ts`, `manifest.json`, `apple-icon`, or `opengraph-image` convention file
- No JSON-LD or structured data
- No `apple.com` URL in any `public/sites` JS/JSON/CSS
- No Apple wordmark rendered in the nav (all `paths: []`)
- No Apple content in `public/` root, `index.html`, or the OPPO site
- No `itunes.apple.com` link in any live route

**Excluded by rule (not audited, not needing changes)**
- `public/sites.original-backup/` (321 files) — historical copy, unreferenced by the live app
- `.next/`, `node_modules/`, `.git/`

---

## Recommended Cleanup Order

Ordered so that each stage reduces risk without creating a broken intermediate state. **Phase 1 completed a subset of Stage 1 and Stage 2; the rest is untouched.**

**Stage 0 — decide, before touching anything**
Confirm the intended Gadzio brand identity: the typeface that replaces SF Pro (**decided — Inter**), whether the hero video and gallery are part of the homepage, and whether `/in-edu` continues to exist as a route at all. Several findings below are conditional on those answers, and doing them out of order means doing them twice.

**Stage 1 — stop serving Apple-owned property (highest value, lowest risk)**
1. ✅ Replace the favicon; update the `icons` entries. — **Done (Fix 2).** Caveat: the replacement is a wordmark, so a square Gadzio icon is still owed.
2. ⬜ Replace the OG image.
3. ✅ Replace the SF Pro `@font-face` blocks, the three `--ac-font-*` variables, and the four additional font stacks **in one pass**. — **Done (Fix 3).** All five stacks and all three variables changed together, so the macOS/iOS local-SF-Pro fallback path is closed.
4. ✅ Remove `"Myriad Set Pro"` from the footer font variable. — **Done (absorbed into Fix 3).**

Stage 1 items 1, 3 and 4 eliminated the two CRITICAL asset findings. Item 2 (OG image) remains. Post-change regression check on footer, nav, and `/in-edu` heading weights: **passed** — `tsc --noEmit` exit 0, production build exit 0, all routes emitted, and the rendered pages verified to load Inter and no SF Pro.

**Stage 2 — close the live off-site leakage**
5. ✅ Repoint the 15 apple.com destinations on `/in-edu`. — **Done (Fix 1).** Phase 0 flagged this as blocked on the dead `/in-edu/*` routes; Phase 1 resolved that tension by repointing to `/search` and `/support`, which exist. The underlying dead-route problem is still open (Stage 5).
6. ✅ Rewrite the live `apple.footer` DB row: drop the Apple Inc. attribution, keep only a compatibility statement. — **Done (Fix 4)**, staged as a content change with a guarded one-off script.

**Stage 3 — remove the latent activatable content**
7. ⬜ `icons.tsx` `GALLERY_LOGOS`; `tiles.ts` (Apple Card and defaults); `gallery.ts` and the `apple.gallery` row; `locale-banner.ts`; `Ribbon.tsx` fallback; `TileCard.tsx` href rewriter.
8. ⬜ `defaults.ts` admin prefills — so that no future admin save can reintroduce any of the above. **This is now the highest-value remaining stage**, because Phase 1 closed the live surfaces and these are the paths by which a live surface could reopen.

**Stage 4 — naming and namespaces (do last, highest churn)**
9. ⬜ Asset directory rename (`www-apple-com-736d3707` → neutral).
10. ⬜ `apple-clone.css` rename, `ac-`/`--ac-*`/`#globalnav`/`#ac-globalfooter` namespace.
11. ⬜ `FloatingBrandSwitcher` prop, OPPO class, cart storage key (with migration), TOTP issuer, admin labels, `package.json`, `skills-lock.json`, `README.md`.
12. ⬜ `apple.*` → `gadzio.*` content-key migration — code and data in the same release.

**Stage 5 — functional repairs that surfaced during the audit**
13. ⬜ The dead `/in-edu/*` routes (**now the reason most `/in-edu` cards point at `/search`**); the missing `category-iphone.png`; `/in-edu`'s missing `edu.seo` metadata.
14. ⬜ Decide the fate of the unreferenced `content.ts` exports (`FOOTNOTES`, `HOW_TO_BUY_STEPS`, `SHOP_CATEGORIES`, `BTS_OFFERS`, `EDU_IN_ACTION`, `MAC_PRODUCTS`, `IPAD_PRODUCTS`) — wire into the page or delete.

**Caution for Stage 4 in particular.** The directory rename and the CSS namespace change touch nearly every file. They should each be their own commit, verified independently, and **must not** be combined with the Stage 3 content and asset work — a broken intermediate state in a rename that large is very hard to diagnose if content changes are mixed in.

---

## Verification Checklist

### Phase 0 confirmations (historical — this was the read-only audit)

- [x] **No existing file was modified.** Every change in Phase 0 was a read.
- [x] **No database content was modified.** `content_blocks` and `site_settings` were read through a self-guarding read-only script; no INSERT, UPDATE, or DELETE was issued.
- [x] **No asset was deleted, renamed, or moved.**
- [x] **The homepage was not changed.**
- [x] **`/in-edu` was not changed.**
- [x] **Backup and archive directories were skipped.** `public/sites.original-backup/` (321 files, 64 MB) excluded by rule.
- [x] **The only newly created file is `APPLE-GADZIO-FULL-AUDIT.md`.**
- [x] **Nothing was fixed.** Every Phase 0 finding was a proposal.
- [x] **No automated replacement or migration script was run.**
- [x] **No commits were made.**

**One Phase 0 disclosure, for completeness.** To verify that `favicon.ico` is genuinely Apple's logo rather than a generic icon, the file was decoded and a temporary PNG written to `.audit-tmp/favicon_check.png`, viewed, and then deleted along with the directory. It was removed immediately; `.audit-tmp/` does not exist and does not appear in `git status --porcelain`.

### Phase 1 confirmations (the approved fixes)

- [x] **Exactly five findings were changed** — the five approved. Nothing else.
- [x] **9 source files were modified**, all within the approved scope:
  `src/components/sites/edu-store/data/content.ts`, `src/app/page.tsx`, `src/app/in-edu/store/page.tsx`, `src/app/apple-clone.css`, `src/app/in-edu/store/edu-store.css`, `src/app/auth/auth.css`, `src/app/in/shop/iphone/accessories/cases-protection/cases.css`, `src/components/sites/accessories/accessory-category.css` — plus the one database row below.
- [x] **Exactly 1 database row was updated** — `content_blocks` → `apple.footer` → `footnotesHtml`. No insert, no delete, no other field.
- [x] **No asset was added, deleted, renamed, or moved.** Verified by stat: `favicon.ico` (22,382 B) and all five `sf-pro-*.woff2` files are still present. They are now unreferenced, not removed.
- [x] **The homepage layout, sections, animations, imagery, and content were not changed.** The only homepage file edited was its `metadata.icons` entry (Fix 2).
- [x] **No homepage imagery was changed** — the favicon fix required no artwork change, since `gadzio_logo.png` already existed.
- [x] **No unrelated component was modified.**
- [x] **The project was not renamed.** `package.json` untouched.
- [x] **No CSS namespace was cleaned up.** `ac-*`, `--ac-*`, `#globalnav`, and `#ac-globalfooter` are exactly as they were.
- [x] **No asset directory was renamed.** `www-apple-com-736d3707` is unchanged.
- [x] **No latent Apple asset was removed.** `gallery.ts`, `tiles.ts`, `icons.tsx`, `locale-banner.ts`, and the videos are untouched.
- [x] **Apple Card / gallery / default tile data was not modified.**
- [x] **The locale banner was not modified.**
- [x] **Admin panel Apple labels were not modified.**
- [x] **Internal CMS namespaces were not modified.** The `apple.*` keys are unchanged.
- [x] **Compatibility references were preserved.** "MagSafe", "iPhone", "iPad", "AirPods", and the footer compatibility sentence are all intact.
- [x] **No backup folder was touched.**
- [x] **No new routes were created.**
- [x] **No unrelated improvements were made.**
- [x] **The Gadzio visual design was preserved.** No font size, weight, line-height, letter-spacing, colour, spacing, layout, or animation value was altered. Only font *family* resolution changed.
- [x] **`git status` was reviewed.** The working tree contains many pre-existing modifications from work that predates this session (e.g. `GlobalNav.tsx`, `data/nav.ts`, `data/tiles.ts`, `TileCard.tsx`, `defaults.ts`, `collections.ts`, `proxy.ts`, `layout.tsx`, `EduStorePage.tsx`) and a set of deleted `public/sites/**` images. **Those are not Phase 1 edits** and were not touched by Phase 1.

### Technical verification results

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | **exit 0** |
| `npm run build` | **exit 0**, all routes emitted |
| `@font-face` rules remaining in `src/` | **0** |
| `SF Pro` / `sf-pro` / `Myriad` / `SF Pro Icons` matches in `src/` | **0** |
| `apple.com` occurrences in `src/` | **46** (31 URL strings + 15 comment mentions) — **none renders to a user** |
| `apple.com` occurrences in the `edu-store` / `in-edu` trees | **1** — a source comment at `content.ts:541`, not a link |
| Rendered homepage HTML: Apple URLs | **none** |
| Rendered homepage HTML: `<link rel="icon">` | `/gadzio_logo.png` |
| Rendered homepage HTML: `trademarks of Apple Inc` | **absent** |
| Rendered homepage HTML: `Copyright © 2026 Gadzio Inc.` | **present** |
| Rendered homepage HTML: compatibility sentence | **present** |
| Rendered homepage HTML: webfont link | `fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900` |
| Rendered `/in-edu/store` HTML: Apple URLs | **none** |
| Rendered `/in-edu/store` HTML: favicon | `/gadzio_logo.png` |
| Built CSS: `@font-face` rules | **0** |
| Built CSS: `--ac-font-text` | `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif` |
| Destination routes `/support`, `/support#order-help`, `/search?q=Gadzio+Phone+18+Pro`, `/in-edu/store` | **all HTTP 200** |
| Database: `apple.footer` matches `/trademarks of Apple Inc/i` | **false** |
| Database: `apple.footer` other fields unchanged | **confirmed** |

**Method.** Verification was performed against a **real production server** (`npx next start`), by fetching and inspecting rendered HTML — not by static analysis alone. The server was stopped afterwards and confirmed down.

**Residual, disclosed.** The strings `SF Pro` / `sf-pro` still appear inside `.next/cache/turbopack/*.sst` — Turbopack's regenerable build cache. Not source, not served, cleared by a clean rebuild.

### Pre-flight checks for the next approved phase

- [ ] Working tree is clean before starting each stage
- [ ] Each stage is its own commit
- [ ] Stage 3 verified by inspecting the homepage with each `apple.*` row temporarily disabled
- [ ] Stage 4 verified by a full-route smoke test
- [ ] `git grep -i apple` returns only the LEGITIMATE-KEEP set when finished

---

## Remaining Findings — Not Approved

Every finding below was raised by the Phase 0 audit and was **not** in the approved five. None of them was changed. This section exists so the Phase 1 fixes do not erase the rest of the audit from view.

**Statuses:** `REMAINING` (open, as before) · `BLOCKED` (cannot be done without a decision, an asset, or a migration).

### A. Latent content that becomes live on a single admin action

These are the highest-value remaining items, because they are not currently rendered but are one save away from being rendered. Phase 1 closed the live surfaces; these are the paths that reopen them.

| # | Finding | Location | Status |
| --- | --- | --- | --- |
| 1 | Six Apple service wordmark SVGs including the Apple glyph, reproduced as raw SVG path data, with a "verbatim from https://www.apple.com/" header | `.../root-8a5edab2/icons.tsx` → `GALLERY_LOGOS` | REMAINING — activates if `apple.gallery.enabled` → true |
| 2 | Apple Card tile: brand name, product photography, `card.apple.com` apply URL, alt text naming the Apple logo | `.../data/tiles.ts` | REMAINING — activates if a tiles DB row is cleared |
| 3 | Apple services gallery: 18 Apple URLs (9 `tv.`, 3 `music.`, 3 `apps.`, 3 `fitness.`) plus 1 comment mentioning apple.com; 146 images | `.../data/gallery.ts` + `public/.../images/gallery/` | REMAINING — `apple.gallery.enabled = false` |
| 4 | Apple product-named hero/promo tile defaults with Apple CDN filenames | `.../data/tiles.ts` | REMAINING — rows currently override |
| 5 | Locale banner: verbatim Apple copy + 4 `apple.com` URLs | `.../data/locale-banner.ts` | REMAINING — no `apple.locale_banner` row exists |
| 6 | Ribbon fallback reproducing Apple India education EMI/cashback wording | `.../root-8a5edab2/Ribbon.tsx` | REMAINING — `apple.ribbon` row currently overrides |
| 7 | `https://www.apple.com` href rewriter — silently converts any root-relative tile href into an absolute apple.com URL | `.../root-8a5edab2/TileCard.tsx` | REMAINING — the mechanism by which a future off-site link appears without anyone writing an Apple URL |
| 8 | Hero videos using Apple's "bts" campaign filenames | `public/.../videos/` (3 `.webm`, ~1.9 MB) | REMAINING — `apple.hero_video.enabled` undefined |
| 9 | Checkout fallback line item `'iPhone 17 Silicone Case with MagSafe - Black'` | `CheckoutForm.tsx` | REMAINING — renders only if cart data is unavailable |

**Item 7 is the one to watch.** It is the reason Phase 1's Fix 1 could be undone from a different file: nothing in `content.ts` writes an Apple URL any more, but a tile given a relative href would still be rewritten to one.

### B. Admin prefills — one click from becoming live data

| # | Finding | Location | Status |
| --- | --- | --- | --- |
| 10 | `APPLE_SEO_DEFAULTS` with `title: 'Apple'` and Apple's verbatim meta description | `src/lib/admin/defaults.ts` | REMAINING — unreachable from the public page, but an admin save would create a live `apple.seo` row |
| 11 | 8 `apple.com` URLs in the accessory-category prefill + `shopHref` | `src/lib/admin/defaults.ts` | REMAINING — same one-click risk on the `cases.*` form |
| 12 | `'Cases & Protection - iPhone Accessories - Apple (IN)'` + "from Apple" description | `src/lib/admin/defaults.ts` | REMAINING |
| 13 | Admin nav/heading labels: "Apple Homepage", "Apple Clone Studio", "The Apple Store difference", "Apple TV / Music gallery" | `src/app/(admin)/…` | REMAINING — admin-only surface |

Note on item 13: "The Apple Store difference" now disagrees with the storefront, which renders "The Gadzio Store difference." The admin and the storefront say different things about the same section.

### C. Naming, namespaces, and identity

Explicitly deferred by the phase instructions.

| # | Finding | Location | Status |
| --- | --- | --- | --- |
| 14 | `/sites/www-apple-com-736d3707/root-8a5edab2/…` appears in **every rendered image URL** | asset root + all references | REMAINING — the most trivially discoverable Apple reference left in the live product |
| 15 | `ac-` class prefix, `--ac-*` custom properties, `#globalnav`, `#ac-globalfooter`, `.ac-gf-sosumi` | `apple-clone.css` + shared components | REMAINING — explicitly excluded ("do not clean up `ac-*` yet") |
| 16 | `apple.*` CMS content-block keys | `content_blocks` (6 rows) | REMAINING — requires a coordinated migration; explicitly excluded |
| 17 | `FloatingBrandSwitcher` uses `'apple'` as a brand identifier; its comment equates "Gadzio site" with "Apple site" | `src/components/common/FloatingBrandSwitcher.tsx` | REMAINING — rendered text is clean; only the internal identifier |
| 18 | `.oppo-brand-switcher-apple` class | OPPO stylesheet | REMAINING |
| 19 | `STORAGE_KEY = 'gadzio_apple_cart_v1'` written to every visitor's `localStorage` | cart context | REMAINING — needs a read-migration or existing carts are orphaned |
| 20 | TOTP issuer `'Apple Clone Admin'` written into staff authenticator apps | admin auth setup | REMAINING — hard to retract once enrolled; may need re-enrolment |
| 21 | `package.json` `name: "apple-clone"` + description | `package.json` | REMAINING — explicitly excluded ("do not modify package.json yet") |
| 22 | `apple-clone.css` filename and header comment naming `www.apple.com` | `src/app/apple-clone.css:1-3` | REMAINING |
| 23 | Component/file names `AppleHomePage`, the `www-apple-com-736d3707` directory | `src/` | REMAINING |
| 24 | `skills-lock.json` pins an `apple-design` skill | `skills-lock.json` | REMAINING |
| 25 | `migrations/` comments referencing `apple.*` keys | `migrations/*.sql` | REMAINING — historical migrations should not be rewritten |
| 26 | `scripts/fix-apple-*.mjs`, `scripts/inspect-apple-keys.mjs` | `scripts/` | REMAINING |
| 27 | Prior audit docs `APPLE-BRAND-AUDIT.md`, `REPOSITORY-APPLE-AUDIT-2026-10-03.md` | repository root | REMAINING — may now be stale relative to this report |
| 28 | README asset-provenance notes recording the assets as Apple's and unlicensed | `README.md` | REMAINING — still an accurate record of the files still on disk |

### D. Live-but-secondary surfaces

| # | Finding | Location | Status |
| --- | --- | --- | --- |
| 29 | "App Store" badge rendered on the live sign-in screen, beside genuine Google Play / AppGallery badges | `src/components/auth/AuthForm.tsx` | REMAINING — a rendered Apple trademark |
| 30 | 34 Apple-named store-card artwork files referenced from live `/in-edu` shelves (`store-card-40-airpods-5-202609.webp`, `…-applecare-…`, `…-apple-intelligence-…`) | `content.ts` + `public/sites/edu-store/images/store-cards/` | REMAINING — visible in page source and the browser's save dialog |
| 31 | Apple product copy in search results | `src/lib/search/searchService.ts` | REMAINING |
| 32 | Nav flyout query strings still Apple-branched: `?q=airpods+4`, `?q=airpods+pro`, `?q=earpods+usb-c`, `?q=airtag`, `?q=magsafe`, `?q=lightning+cable`, `?q=thunderbolt` under Gadzio labels | `.../data/nav.ts` | REMAINING — labels are de-branded, URLs are not; the search index must be checked before changing |
| 33 | Open Graph image served from the Apple-named directory | `src/app/page.tsx` | REMAINING — the image itself is an unbranded placeholder |
| 34 | `/in-edu` stylesheet comments naming "Apple Education Store (India)" and "Apple ships each sticker…" | `edu-store.css` L2, L185 | REMAINING — comments only, no rendering impact |
| 35 | `/in-edu` tag vocabulary mirrors the Apple product architecture: `GADZIOCARE+`, `Gadzio Creator Studio`, `Gadzio Cloud+`, `Gadzio Music/TV/Arcade`, `Gadzio One` | `content.ts` tags | REMAINING — a judgement call, flagged not condemned |

### E. Assets still on disk

Phase 1 removed the *references*; it did not remove the *files*, because deletion was not approved.

| # | Asset | Path | Status |
| --- | --- | --- | --- |
| 36 | Apple's logo as `favicon.ico` — 22,382 B, still reachable by direct URL | `public/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico` | REMAINING (unreferenced) |
| 37 | Five SF Pro `.woff2` files — no longer loaded, still redistributed in `public/` and still reachable by direct URL | `public/.../fonts/sf-pro-*.woff2` | REMAINING (unreferenced) |
| 38 | 146 gallery images + 62 tile images + 3 videos, all Apple-captured, all unreferenced by live data | `public/sites/www-apple-com-736d3707/root-8a5edab2/images/`, `…/videos/` | REMAINING (latent) |

**On items 36 and 37.** The live harm — Apple's logo served as this site's icon, and Apple's font software downloaded by every visitor — is **stopped**. The redistribution harm is not: the files are still in the repository and still fetchable at their public paths. Closing that requires an explicitly approved deletion, which Phase 1 did not have and did not take.

### F. Open dependency created by Phase 1

| # | Finding | Status |
| --- | --- | --- |
| 39 | **Gadzio has no square favicon.** `public/gadzio_logo.png` is a **184×61** wordmark (verified). Pointing the favicon at it removes Apple's logo, but a 3:1 image downscaled into a 16×16 tab slot is illegible. A square Gadzio icon — ideally an `.ico`/PNG set at 16/32/180 px — needs to be produced. | **BLOCKED** — requires artwork, which this phase could not fabricate |

### G. Functional defects (not Apple-identity issues)

| # | Finding | Location | Status |
| --- | --- | --- | --- |
| 40 | `/in-edu` card links point at `/in-edu/shop/...` paths with no route on disk | `content.ts` | REMAINING — **now more visible**, since Phase 1 routed the 15 off-site cards onto `/search` and `/support` to avoid these very paths |
| 41 | `category-iphone.png` referenced from three live files and absent on disk — a live 404 | `searchService.ts`, `SearchPageView.tsx`, `CartPageView.tsx` | REMAINING |
| 42 | `/in-edu` requests `edu.seo`; no row exists, so it inherits root metadata instead of having its own | `src/app/in-edu/store/page.tsx` | REMAINING |
| 43 | Seven unreferenced exports in `content.ts`: `FOOTNOTES`, `HOW_TO_BUY_STEPS`, `SHOP_CATEGORIES`, `BTS_OFFERS`, `EDU_IN_ACTION`, `MAC_PRODUCTS`, `IPAD_PRODUCTS` — none is imported by anything | `src/components/sites/edu-store/data/content.ts` | REMAINING — **discovered during Phase 1**; `/in-edu` currently displays no eligibility terms at all, because `FOOTNOTES` is never rendered |

### Not approved, and correctly so

Nothing in `## Legitimate References That Can Remain` was changed: product compatibility names ("iPhone", "iPad", "AirPods", "MagSafe", "Apple Pencil"), the Qi2/third-party compatibility footnote, the `-apple-system` / `BlinkMacSystemFont` system font keywords, the genuine third-party platform names ("Google Play", "AppGallery"), and the internal `?q=iphone+17` search terms where the label is a Gadzio product. Phase 1 preserved the footer compatibility sentence for exactly this reason.

**The final measure of this phase:** **43 findings remain open** — 42 `REMAINING`, 1 `BLOCKED` (item 39, the square favicon) — and **not one of them was changed.** Phase 1 fixed five findings and stopped. Where a Phase 1 fix has made one of these more consequential, the row says so (items 7, 13, 40).

---

## Final Status

**Total files scanned (Phase 0):** 497 (`src/` 148 · live `public/sites/` 306 · `public/` root 2 · `migrations/` 9 · `scripts/` 11 · repo root 21)
**Total excluded:** 321 files / 64 MB (`public/sites.original-backup/`), plus generated trees (`.next/`, `node_modules/`, `.git/`)

**Phase 1 changes:** 9 source files + 1 database row (`apple.footer.footnotesHtml`) + 0 assets
**Approved fixes:** 5 of 5 applied · 5 of 5 verified · 1 carries a documented asset-quality caveat (Fix 2)

**Findings by severity (Phase 0):** CRITICAL 8 · HIGH 15 · MEDIUM 13 · LOW 5 · LEGITIMATE-KEEP 6 groups
**Resolved by Phase 1:** 4 CRITICAL · 2 HIGH · 1 LOW

**Apple URLs:** **46 `apple.com` occurrences** remain in live `src/` — **31 URL strings** and **15 comment mentions**. By host, the URL strings are 12 `www.apple.com`, 9 `tv.apple.com`, 3 `music.apple.com`, 3 `fitness.apple.com`, 3 `apps.apple.com`, 1 `card.apple.com`. **0 of them render to a user** (was 15). `secure.store.apple.com` and `developer.apple.com` were eliminated by Fix 1.
**Live Apple URLs on `/in-edu/store`:** **0** (was 15)
**Copyright / legal references:** 11 total (5 CRITICAL, 4 HIGH, 1 MEDIUM, 1 LEGITIMATE). **4 closed by Phase 1** — the favicon, the font serving, the footer trademark attribution, and the copied eligibility text. **2 CRITICAL remain** — both latent (gallery wordmarks, Apple Card tile).
**Branding labels:** 20 internal-only naming items (**all remaining**); live Apple-bearing labels reduced from 2 to 1 — "Find a Gadzio Store" → apple.com is fixed, the "App Store" badge remains.
**Assets:** 5 fonts (**shipped but unregistered**) · 1 favicon (Apple logo, **unreferenced on disk**) · 1 OG image · 3 videos · 208 gallery/tile images (latent) · 34 Apple-named store-card images (active on `/in-edu`) · 1 missing (404). **0 assets added, deleted, renamed, or moved.**
**Metadata references:** 7 findings; **2 CRITICAL favicon findings closed** across all 8 `metadata.icons` blocks; admin SEO prefill and OG image remain.
**Database findings:** 6 `content_blocks` rows inspected read-only against the live database in this revision; **1 row updated** (`apple.footer`); rows carrying an Apple reference reduced from 2 to 1 — `apple.gallery`, which is `enabled: false` and whose only Apple content is 5 verbatim TV+ taglines (no URL, no trademark string). `apple.com` and `Apple Inc` appear in **0 of 6** rows. `site_settings` empty.
**`/in-edu` findings:** 12 → **6 open** (5 closed: 3 CRITICAL, 2 HIGH; 1 legitimate, no action)

**Open items carried forward:** 43 (see `## Remaining Findings — Not Approved`)

**Five things to decide next:**

1. **Gadzio needs a square favicon.** The trademark problem is fixed; the usability problem is not. This is the only item Phase 1 left *worse in appearance* than it found it — a legible Apple logo was replaced by an illegible Gadzio wordmark at 16×16. It should be the first thing fixed.
2. **Do the five `.woff2` files and Apple's `favicon.ico` get deleted?** They are unreferenced but still shipped and still reachable by direct URL. Deletion needs its own explicit approval.
3. **Does the latent gallery/tiles/locale-banner/Ribbon content get removed, or does the `apple.gallery` row simply stay disabled?** Until one of those happens, a single admin save can put Apple's wordmarks and the Apple Card tile back on the homepage.
4. **Does `/in-edu/store` stay as a route** — and if so, who writes the destination pages it links to? Most of its cards now land on `/search` or `/support` because the pages they describe do not exist.
5. **Does the naming pass happen?** The `www-apple-com-736d3707` path segment is still in every rendered image URL, and the `ac-*` namespace is untouched, exactly as the phase required.

**The homepage and `/in-edu` render as they did before Phase 1, with four exceptions, all approved and all verified.** The tab icon is Gadzio's instead of Apple's; the typeface is Inter instead of SF Pro; the footer no longer attributes trademarks to Apple Inc.; and `/in-edu`'s cards stay on-site instead of leaving for apple.com. No layout, section, animation, or copy on the homepage was changed. No asset was touched. No commit was made.

**STATUS: PHASE 1 COMPLETE — AWAITING REVIEW**

The five approved fixes are applied and re-verified against the live repository and the live database. **No further change is authorized.** `## Remaining Findings — Not Approved` lists everything else that was raised and deliberately left alone; tell me which of those — individually, or as a stage — you want to approve next, and I will treat that as the only authorization to modify anything further.
