# FINAL READ-ONLY REPOSITORY AUDIT — Apple Reference Inventory
**Repo:** `apple-clone` (Gadzio de-brand project) · **Date:** 2026-10-03 · **Mode:** strictly read-only (no file modified, renamed, deleted, or rewritten; DB accessed via SELECT only; `DATABASE_URL` never printed)

---

## 1. EXECUTIVE SUMMARY

The repository is **NOT Apple-free**. The core user funnel (homepage hero, ribbon, promo section, edu-store destinations, /android switcher targets, checkout, footer copyright) is de-branded and the live DB rows carry zero Apple destinations. What remains is concentrated in **four surfaces**:

1. **The global footer (`data/footer.ts`) is still the original Apple IA.** It is the single biggest ACTIVE leak: it renders on `/` (and every page that reuses `GlobalFooter`: edu-store, search, shop pages). Its DB override row (`apple.footer`) only replaces `copyright`, `localeHref`, and `footnotesHtml` — **the link columns are code-only**, so 5 absolute Apple URLs (`account.apple.com`, `apps.apple.com`, `investor.apple.com`, `locate.apple.com`, `www.icloud.com`), 1 `tel:1-800-MY-APPLE`, 29 Apple-branded link labels, 11 dead `/us/shop/goto/*` relatives and ~7 other Apple-era relative paths (`/retail/`, `/apple-card/`, `/airtag/`, `/choose-country-region/`) ship to every visitor today. Verified against live production HTML, not just code.
2. **The nav flyout** contains one ACTIVE-on-click Apple URL (`support.apple.com` "Apple Support" link) plus a top-level item whose data `href` is `support.apple.com` but renders as a button (no anchor emitted) — and 12 nav quick-links point at `/order/lookup`, a route that **does not exist** (404, Apple-era leftover).
3. **Gated/latent Apple destinations** remain: 18 `tv/music/apps/fitness.apple.com` hrefs in `gallery.ts` (section disabled in DB *and* code default — re-enabling in admin reactivates them), the Apple Card promo tile (`card.apple.com` apply URL + the `heroTileHref` helper that fabricates `https://www.apple.com/apple-card/` — hidden only while the 5-tile DB promo row survives), and the dead LocaleBanner's 3 `www.apple.com` hrefs.
4. **Apple copy/branding residue** outside the funnel: footer/nav column titles and labels ("Apple Store", "About Apple", "Apple Support"…), edu-store user copy ("Apple Education in Action" eyebrow, "Apple Education Pricing…", "bring your institution ID to an **Apple Store**", "Apple M4" chips), `/android` switcher drawer ("Apple Store" badge + "Shop Mac, iPad, iPhone…"), page metadata (description "for iPhone, iPad, Mac, and Apple Watch"; og-image/favicon served from `/sites/www-apple-com-…/seo/`), admin UI labels ("Apple Homepage", "Apple Clone Studio", TOTP issuer "Apple Clone Admin"), package name `apple-clone`, README (incl. one now-**false** line claiming CTAs still go off-site), `apple-clone.css` and the `www-apple-com-736d3707/root-8a5edab2` asset directory names, SF Pro fonts, 24+24 Apple-named asset filenames, and `promo_apple_card__…` strings embedded in EXIF metadata of 12 JPEGs.

Legitimate/nominative references are large but appropriate: trademark notices (7 files + DB footnotes), product compatibility vocabulary (iPhone 300, AirPods 111, iPad 108, MagSafe 88, MacBook 41 …), `-apple-system` CSS stacks (technical, not branding).

Build verification: `tsc --noEmit` exit 0; `next build` exit 0, 46 routes, 27 static — **no build artifacts left in the repo working tree beyond the pre-existing `tsconfig.tsbuildinfo`** (regenerated timestamps are generated files, not repo content edits).

Verdict: **the homepage design was not changed by prior cleanup passes** (hero/promo/ribbon render identically with internal hrefs); completion requires footer/nav work (the deferred tier), not a redesign.

---

## 2. ACTIVE — reachable by a user right now

| # | Destination / text | file:line | Component / surface | How reached |
|---|---|---|---|---|
| A1 | `https://account.apple.com/` (label "Manage Your Apple Account") | `src/…/root-8a5edab2/data/footer.ts:127` | GlobalFooter "Account" column | Every page with footer; rendered as anchor (DB row does not override columns) |
| A2 | `https://apps.apple.com/us/app/apple-store/id375380948` ("App Store") | `footer.ts:209` | GlobalFooter "Apple Store" column | Same |
| A3 | `https://investor.apple.com/` ("Investors") | `footer.ts:359` | GlobalFooter "About Apple" column | Same |
| A4 | `https://locate.apple.com/` ("other retailer") + `tel:1-800-692-7753` / text "1-800-MY-APPLE" | `footer.ts:386` (`shopHtml`) | GlobalFooter via `dangerouslySetInnerHTML` (`GlobalFooter.tsx:112`) | Same; confirmed in live HTML |
| A5 | **`https://www.icloud.com`** (label "iCloud.com" — Apple URL with **no "apple" text**; would be missed by a plain `apple` grep) | `footer.ts:135` | GlobalFooter "Account" column | Same |
| A6 | `https://support.apple.com/` (label "Apple Support", elevated flyout link) | `src/…/data/nav.ts:329` | GlobalNav Support flyout | Click "Support" top-nav item (client-rendered panel) |
| A7 | 29 Apple-branded labels/titles + column headers "Apple Store", "Apple Wallet", "About Apple", "Apple Values", "For Education" etc. | `footer.ts` (lines across 49–411) | GlobalFooter | Visible text on every footer render |
| A8 | 11 × `/us/shop/goto/*` + `/retail/`, `/retail/geniusbar/`, `/apple-card/`, `/airtag/`, `/choose-country-region/` — Apple-era same-origin paths with **no matching route → 404** | `footer.ts:53,84-85,89,93,106,131,189,192-193,213,217,221,225,229,233,237,254,399,411` + DB `apple.footer.localeHref` `/choose-country-region/` | GlobalFooter region selector | Clicked → Next 404 page |
| A9 | 12 × `/order/lookup` — Apple-era path, route does not exist → 404 | `nav.ts:154,315,330`, `NavSearchPanel.tsx:170`, `searchService.ts:186` | Nav flyouts, search panel, search results | Click "Track Your Orders" anywhere |
| A10 | Page metadata: description "…for iPhone, iPad, Mac, and Apple Watch…", og image + favicon from `/sites/www-apple-com-736d3707/…/seo/*` | `src/app/page.tsx:11,24,27` | Homepage `<head>` / search-engine preview | Every crawler & link preview |
| A11 | Meta desc (AirPods / Apple Pencil Pro) + favicon path (www-apple dir) | `src/app/in-edu/store/page.tsx:16,26` | edu-store `<head>` | Same |
| A12 | `/android` brand-switcher drawer (Apple side): badge "Apple Store", desc "Shop Mac, iPad, iPhone, Apple Watch, AirPods, and student education pricing.", chips 💻 Mac / 📱 iPhone / 🎓 Student | `src/components/common/FloatingBrandSwitcher.tsx:48,51,116-118` (mounted `GlobalNav.tsx:355` with `currentBrand="apple"`, mirrored on `/android`) | Floating switcher on every homepage visit | Click switcher |
| A13 | Edu-store visible copy: "Apple Education in Action" (eyebrow + `aria-label`), "Apple Education Pricing is available…", "…bring your institution ID to an **Apple Store**", `chip: 'Apple M4'` ×6, `Apple A14 Bionic`, "AppleCare+", `Apple Watch` label, "Apple M4" bodies | `src/components/sites/edu-store/EduStorePage.tsx:323,326,373`; `data/content.ts:10-11,47,58,69,84,96,105,116,161-164,172,184,193,195` | `/in-edu/store` | Visit page |
| A14 | TM notice paragraphs (intentional legal copy) | `src/app/terms/page.tsx:78`; `src/components/shop/ProductDetailPage.tsx:659-661`; `cases-protection/CasesProtectionPage.tsx:268-270`; accessories pages `airpods-case:38`, `mobile-cases:44`, `power-adapter-cable:34`, `wired-earphones:35`; DB `apple.footer.footnotesHtml` | Shop/legal surfaces | Bottom of pages |
| A15 | Admin-visible strings: page title "Apple Homepage", "Apple Clone Studio", "Global Nav (all Apple pages)" | `src/app/admin/…/layout.tsx:17`, `page.tsx:10`, `AdminSidebar.tsx:39`, `collections.ts` | `/admin` (auth-gated) | Log in |
| A16 | TOTP issuer **"Apple Clone Admin"** — displayed inside users' authenticator apps | `src/lib/admin/totp.ts:25` (`ISSUER`) | `/admin/security` 2FA setup | Already-enrolled authenticators |
| A17 | Search synonyms `'apple'`, `'apple silicon'` (query keywords, not displayed) | `src/lib/search/searchService.ts:53,80` | `/search` | Internal matching only |

## 3. LATENT — dormant code/rows that re-activate Apple destinations

| # | Payload | Location | Dormant because | Reactivation path |
|---|---|---|---|---|
| L1 | **18 hrefs** — `tv.apple.com` ×9, `music.apple.com` ×3, `apps.apple.com` ×3, `fitness.apple.com` ×3 (gallery card links) | `src/…/data/gallery.ts:35,107,179,251,323,395,467,539,611,686,725,764,803,842,881,920,959,998` | Section gated off: DB `apple.gallery` row `enabled:false` **and** code fallback/defaults ship `enabled:false` (`mergeGalleryItems` never lets overrides change hrefs) | Admin toggles gallery on → all 18 hrefs render. **Rule §11 satisfied-in-form but fragile: re-enabling re-introduces external Apple destinations with no internal escape hatch.** |
| L2 | Apple Card promo tile: `card.apple.com/apply/…` CTA, `/apple-card/` href + `promo_logo_apple_card__*` / `promo_apple_card__*` art | `src/…/data/tiles.ts:584,625,631` (PROMO_TILES idx 5) | DB `apple.promo_section` row keeps only 5 tiles (Card absent) | **Delete/reset of the row, or admin "save" on the promo editor, falls back to / prefills the 6-tile template** (`getCollectionDefaults` prefill = the reactivation vector) → Card reappears. |
| L3 | URL-rewrite helper: `href.startsWith('http') ? href : \`https://www.apple.com${href}\`` | `src/…/TileCard.tsx:29-30` | Sole live consumer is L2's Card tile; hero tiles now `internal:true` → `<Link>` | Any non-internal tile rendering re-qualifies relative hrefs onto apple.com. |
| L4 | `support.apple.com/` top-level item `href` (renders as `<button>`; data unused as link) | `nav.ts:107` | Button click opens flyout; no anchor emitted | Saving nav in admin writes `apple.nav` row from defaults that **carry this href** (`collections.ts` prefill vector). |
| L5 | LocaleBanner: `https://www.apple.com/in/` ×2 + `https://www.apple.com/choose-country-region/` | `src/…/data/locale-banner.ts:26,30,34` | `AppleHomePage.tsx:57` `useState(false)` with **no true-setter → banner never renders** | Re-wiring banner visibility re-activates 3 Apple URLs. |
| L6 | Apple hrefs inside admin defaults: `APPLE_NAV_DEFAULTS`, `APPLE_FOOTER_DEFAULTS`, `APPLE_LOCALE_BANNER_DEFAULTS`, gallery/seo defaults re-export code data | `src/lib/admin/defaults.ts:596-604` (keys) importing `nav/footer/locale-banner/gallery/tiles` | Editor prefills only | **Admin saves nav/footer/locale/locale-banner → rows written containing the §2/§3 Apple URLs** (resurrect-by-save vector; DB rows then win over any future code fix). |
| L7 | `GALLERY_LOGOS` — SVG wordmarks **containing the Apple glyph path** (Apple Music/Arcade/Fitness) | `src/…/icons.tsx:57-61` → `EndlessEntertainmentGallery.tsx:207` | Gallery section gated off (L1) | Gallery re-enable renders Apple-logo vectors. |
| L8 | Apple-era fineWoven filenames (ids + image paths only; product titles never say FineWoven) | `cases-protection/data/products.ts:290,294,306,310,416,420` + `public/sites/cases-protection/images/iphone17-finewoven-black.jpg` etc. | IDs/internal | Cosmetic rename candidate (see SAFE). |
| L9 | README stale claim: "Outbound links still point at apple.com, so clicking a CTA navigates off-site." | `README.md:66` | — | **False for hero/promo/ribbon/edu now; still TRUE for footer/nav flyout.** Docs misleading. |

## 4. USER-FACING COPY (rendered text; vs §11 legitimate legal/nominative)

**On `/` and every GlobalFooter page (visible now):**
- Footer: "About Apple", "Apple Values", "Apple Store", "Apple Wallet" (column titles); 25 more "Apple *" link labels (A7 list: AppleCard→…: "Apple Card", "Apple Pay", "Apple Cash", "Apple Music", "Apple Arcade", "Apple Books", "Apple News+", "Apple Podcasts", "Apple Fitness+", "Apple TV", "Apple One", "Apple Camp", "Today at Apple", "Apple Trade In", "Apple Upgrade", "Carrier Deals at Apple", "Contact Apple", "Manage Your Apple Account", "Apple Store Account", "Apple Store App", "Apple Leadership", "Apple and Business/Education/Government/Healthcare"); "Find an Apple Store"; "1-800-MY-APPLE (1-800-692-7753)".
- Nav: "Apple Support" (click-gated).
- `<head>`: description "Shop Gadzio accessories for iPhone, iPad, Mac, and Apple Watch…" (defaults.ts:203 copy, page.tsx:11).
- Brand switcher: "Apple Store" + "Shop Mac, iPad, iPhone, Apple Watch, AirPods, and student education pricing."

**On `/in-edu/store` (visible now):** "Apple Education in Action" (×2: eyebrow + aria), "Apple Education Pricing is available to current and newly accepted college students…", "…bring your institution ID to an Apple Store", "Apple M4" (chip line ×6), "Apple A14 Bionic", "Apple Pencil" (subhead + bodies), "AppleCare+", "Apple Watch".

**Shop pages (visible, intentional):** TM-disclaimer sentences (7 surfaces, §11 crossover), "iPhone Models", compatibility lists ("iPhone 15 and later, iPad, AirPods, Apple Watch").

**Hidden (ARIA/metadata):** `aria-label="Apple Education in Action"`; og:title/desc via `apple.seo` default (Gadzio copy, keys internal); favicon/og image files (Apple directory paths only, content = Gadzio logo PNG).

**Comments (non-user, inventory):** 17 "apple.com" mentions in source comments (attribution/TODO), `www.apple.com/ clone` CSS header, etc. — see §6 comment rows.

## 5. INTERNAL IDENTIFIERS (audited per §3 — **not defects by themselves**; classification only)

| Class | Identifier(s) | Location | Note |
|---|---|---|---|
| A — content keys | `apple.hero_tiles`, `apple.hero_video`, `apple.promo_section`, `apple.ribbon`, `apple.locale_banner`, `apple.nav`, `apple.footer`, `apple.gallery`, `apple.seo` | `collections.ts`, `defaults.ts:596-604`, `page.tsx:56-68`, DB rows | **Renaming would orphan the 6 live DB rows** (key = row PK). SAFE to keep; §11 rule: no silent Apple surface inside the values (verified: 0 apple.com in rows). |
| B — theme key | `appleCopyright` | `collections.ts:622`, `ThemeEditor.tsx:12`, `site_settings` (0 rows) | Value = "Copyright © 2026 Gadzio…". Key name internal. |
| C — constants | `APPLE_HERO_TILES_DEFAULTS`, `APPLE_*_DEFAULTS` (~10), `APPLE_GALLERY_DEFAULTS` | `defaults.ts` | Internal symbols. |
| D — CSS/dir names | `apple-clone.css`, `@import "./apple-clone.css"` (`globals.css:2`), `.oppo-brand-switcher-apple` (`oppo.css:1365`), dir `www-apple-com-736d3707/root-8a5edab2`, `sites.original-backup/` | repo-wide | Directory names appear in **public URLs** (`/sites/www-apple-com-…/images/…`) — path-level exposure, classified in §7/§12. |
| E — package/project | `package.json "name": "apple-clone"`, lockfiles, repo dir name | root | Not user-visible; rename optional. |
| F — misc | `STORAGE_KEY='gadzio_apple_cart_v1'` (`CartContext.tsx:39`), `currentBrand?: 'apple'|'oppo'` union, `IMG` path constants ×6 accessories files, `scripts/inspect-apple-keys.mjs`, `fix-apple-destinations.mjs` | — | localStorage key rename = cart loss (leave); union tag internal. |

No identifier in A–F causes an Apple destination by itself.

## 6. APPLE EXTERNAL URLS — complete inventory, every occurrence classified

30 Apple-destination URLs in `src/` — 29 literal apple.com-host + 1 icloud.com — of which 1 is runtime-fabricated (the `TileCard` template); 45 raw `apple.com` occurrences = 29 URL-values + 16 comment mentions (plus 2 script comments outside src). Classification: **ACTIVE** (reachable now) / **LATENT** (dormant) / **DEAD** (unreachable code) / comment.

| URL | file:line | class |
|---|---|---|
| `https://account.apple.com/` | footer.ts:127 | **ACTIVE** |
| `https://apps.apple.com/us/app/apple-store/id375380948` | footer.ts:209 | **ACTIVE** |
| `https://investor.apple.com/` | footer.ts:359 | **ACTIVE** |
| `https://locate.apple.com/` | footer.ts:386 | **ACTIVE** (inside `shopHtml`) |
| `tel:1-800-692-7753` ("1-800-MY-APPLE") | footer.ts:386 | **ACTIVE** (Apple phone route) |
| `https://www.icloud.com` | footer.ts:135 | **ACTIVE** (Apple host, no "apple" in text) |
| `https://support.apple.com/` (flyout link) | nav.ts:329 | **ACTIVE-on-click** |
| `https://support.apple.com/` (top item href, button-rendered) | nav.ts:107 | **LATENT** (data only; written by nav-save L6) |
| `https://tv.apple.com/…` ×9 (ted-lasso, lucky, formula-1, silo, mls, women-in-blue, friday-night-baseball, the-dink, widows-bay) | gallery.ts:35,107,179,251,323,395,467,539,611 | **LATENT** (L1) |
| `https://music.apple.com/…` ×3 | gallery.ts:686,803,920 | **LATENT** |
| `https://apps.apple.com/…` ×3 (hello-kitty, powerwash, balatro) | gallery.ts:725,842,998 | **LATENT** |
| `https://fitness.apple.com/…` ×3 | gallery.ts:764,881,959 | **LATENT** |
| `https://card.apple.com/apply/application?referrer=cid%3Dapy-200-10000036&start=false` | tiles.ts:631 | **LATENT** (L2) |
| `https://www.apple.com${href}` → `https://www.apple.com/apple-card/` | TileCard.tsx:30 | **LATENT** (L3, fabricates only L2) |
| `https://www.apple.com/in/` | locale-banner.ts:26 | **DEAD** (L5) |
| `https://www.apple.com/choose-country-region/` | locale-banner.ts:30 | **DEAD** |
| `https://www.apple.com/in/` (`continueHref`) | locale-banner.ts:34 | **DEAD** |
| comment `Source: https://www.apple.com/in-edu/store` | edu content.ts:2 | comment |
| comment verbatim-source banner ×6 (gallery:2, footer:2, locale-banner:2, nav:2, tiles:2 headers) | data/*.ts:2 each | comment |
| comment css header | apple-clone.css:2 | comment |
| comment `https://www.apple.com/` | page.tsx:63-64 ("tv.apple.com") | comment |
| comment `www.apple.com/ clone` | AppleHomePage.tsx header, icons.tsx:2, Ribbon.tsx:15 | comment |
| comment doc-block (×2: `instead of to apple.com`) | tiles.ts:46,52 | comment |
| comment FLAGGED block (`www.apple.com/apple-card/`, `card.apple.com`) | TileCard.tsx:21-22 | comment |
| comment gallery note | defaults.ts:162 | comment |
| **non-runtime:** `storeimages.cdn-apple.com` ×2 | scripts/generate_all_placeholders.py:… (comments) | dead-tool comment |

Host tallies (literal values): www 11(3 DEAD +1 helper-template +7 comment), tv 9, apps 7 (2 URLs+… ) — see §14 for clean counts. Other Apple-adjacent hosts (`mzstatic`, `idmsa`, `itunes.apple`, `apple-support`, `cdn.apple`) — **0 occurrences repo-wide.** No Apple URL exists anywhere under `public/` text files. The `apple.com`-less Apple URL **icloud.com is the only discovery-class hit** (found via manual read, not by the string "apple").

**Relative Apple-era paths (not external, are 404 findings):** A8 (footer 18), A9 (`/order/lookup` ×5 sites). No `/shop/goto`-style redirect exists in `next.config.ts`/`proxy.ts` (both 0 apple hits; no rewrites at all).

## 7. ASSETS

| Group | Path/Type | Apple-specific? | Used? | Active? | Classification |
|---|---|---|---|---|---|
| Brand logo | `public/gadzio_logo.png`, `gadzio_logo_white.png` | No | Yes (nav) | Yes | KEEP |
| Live media tree | `public/sites/www-apple-com-736d3707/root-8a5edab2/` — **338 files** (260 jpg, 68 png, 5 woff2, 3 webm, 1 ico, 1 png-dir `seo/` incl. `favicon.ico`, `open_graph_logo.png`, 1 helper `GENERATE-ASSETS.JS`) | **Path contains `www-apple-com-736d3707`** (HTTrack mirror name) — appears in every media URL, page HTML, `<link rel=icon>` | 255/338 referenced by code/rows | Yes | Pixels themselves are Gadzio-repainted/neutral product art; **24 basenames contain "apple"** (promo_apple_card/logo_iphone_tradein series). Directory rename = mass URL churn (DEFER). |
| Seo pair | `…/seo/favicon.ico`, `open_graph_logo.png` | Dir path only; content = Gadzio logo | Yes (`page.tsx:24,27`; `in-edu/page.tsx:26`) | Yes | ACTIVE path-exposure (A10). |
| Fonts | 5 × `sf-pro-*.woff2` | Filename "SF Pro" (Apple's font; name-tables contain **no** Apple/© strings — verified binary grep) | Yes (`@font-face` in `apple-clone.css:22+`) | Yes | Licensed-for-use question is §9, not §2; keep or swap = product decision. Attribution comment present. |
| Videos | 3 × `bts-solo-01/02/03-largetall_2x.webm` | Mirror-named; content = Apple BTS film | Referenced by `HERO_INLINE_MEDIA` code; DB `apple.hero_video` row has `clips:[]` (override empties? — merge keeps code stage) | Hero video renders today (design preserved) | Latent content-licensing item. |
| Gallery art | ~18 `fam-*.jpg` | Neutral stills | Referenced by gallery.ts | **No** — section disabled | LATENT with L1. |
| **Dead live files** | **74** unreferenced basenames incl. `hero_back_to_school_startframe__*` ×10, `hero_iphone_family__*` ×10, 6 promo families ×6 (`promo_adapter_*`, `promo_apple_watch_series_11__*`, `promo_logo_apple_watch_series_11__*`, `promo_ipad_air_m4__*`, `promo_iphone_tradein__*`, `promo_logo_iphone_tradein__*`), 7 `.png.png` double-extension artifacts, `2_iph_case__medium_2x.jpg`, `4_iph_case__small.jpg`, `6_cases_iph_small_2x.jpg`, `GENERATE-ASSETS.JS`, 2 oppo hero jpgs | Many apple/iphone-named | No | No (backup-dead) | Delete candidates — audit-only, nothing removed. |
| Backup tree | `public/sites.original-backup/` — **321 files** (24 apple-named basenames) | Path | Referenced only by dev scripts (`shift_hero_artwork.py`, `shift_tile2_artwork.py` constants) | **Never served** (not under a route-served dir? It is under `public/` → *is* technically fetchable by direct URL: `/sites.original-backup/…`) | **Exposure note:** HTTrack originals downloadable by anyone who guesses paths — old Apple mirror art. Verify contents are repainted before deciding. DEAD content-wise, LIVE on URL. |
| **EXIF leak** | `promo_apple_card__d8xz4kd4…` original-Apple asset-ID string embedded in **12 JPEGs** (6 live + 6 backup `chargercover_*.jpg`) | Yes, inside binary metadata | Rendered | Yes | Metadata-only; invisible on page, visible if file downloaded/inspected. |
| Apple-glyph SVGs | `GALLERY_LOGOS` (in-code JSX paths) | **Yes — contain the Apple logo glyph** | Only by disabled gallery | No | L7. No other logo vectors found; nav `APPLE_LOGO` export no longer exists (grep-verified). |
| Placeholders/CDN | no remote CDN image URLs anywhere in src; only script-comment `storeimages.cdn-apple.com` | — | — | — | Clean. |

## 8. DATABASE (READ-ONLY — SELECT only; no INSERT/UPDATE/DELETE/ALTER issued)

`content_blocks` = **6 rows**, `site_settings` = **0 rows**, `users`/`orders` (0008/0009) hold no content.

| key | updated | Apple content in value | Effect |
|---|---|---|---|
| `apple.footer` | Oct 01 | **0 apple.com; 3 "apple" hits — all inside clean copy**: `"copyright":"Copyright © 2026 Gadzio Inc. …"`, footnote text ("Compatibility with MagSafe chargers, Qi2 wireless charging, and Apple devices is certified"; "Apple, iPhone, MagSafe, Mac, and iPad are trademarks of Apple Inc.") + `"localeHref":"/choose-country-region/"`, `"localeLabel":"India"`, footnotesHtml | Overrides **only** copyright/locale/footnotes → **the Apple link columns in §2 render from code fallback, NOT the DB** — deleting this row changes only those 3 fields (resurrect analysis §13). |
| `apple.gallery` | Oct 03 | 0/0 | `enabled:false` (+5 Apple-show captions, empty image slots) → section hidden. hrefs never stored; always code (L1). |
| `apple.hero_tiles` | Oct 03 | 0/0 | 2 tiles, all hrefs `/in-edu/store` & `/shop/iphone/accessories/cases-protection` (internal). Beats code template. |
| `apple.hero_video` | Sep 28 | 0/0 | `clips:[]` + empty image slots — code stage supplies art. |
| `apple.promo_section` | Sep 14 | 0/0 | 5 tiles, all `/in/shop/iphone/accessories/*` internal. **Absence of Card tile here is what keeps L2 hidden.** |
| `apple.ribbon` | Oct 03 | 0/0 | Gadzio copy, internal `shopHref`. |
| `site_settings` | — | — | Empty → theme editor shows default `appleCopyright` value (Gadzio text). |

Merge order everywhere: **DB row > admin-overridden code defaults > code data files > component fallbacks.** Rows existing ⇒ rows win; no row ⇒ `defaults.ts` template (de-branded except the gated L1/L2/L5/L6 families). No Apple destination is stored in any row today.

## 9. ROUTES (from `next build` output, not inferred)

**46 routes** (37 dynamic ƒ, 8 static ○, `/_not-found`). Full tree: `/`, `/_not-found`, `/admin`, `/admin/content/[key]`, `/admin/login`, `/admin/security`, `/admin/theme`, `/android`, 9× `/api/admin/*`, 4× `/api/auth/*`, 6× `/api/payu/*`, `/auth`, `/bag`, `/cart`, `/checkout`, `/in-edu/store`, `/in/shop/iphone/accessories/{airpods-case,cable-plug-case,mobile-cases,power-adapter-cable,wired-earphones}` ○, `/in/shop/iphone/accessories/cases-protection` ƒ, `/order/{cancelled,failed,success}`, `/privacy` ○, `/search`, `/shop/buy/[productId]`, `/shop/iphone/accessories/cases-protection`, `/shop/product/[productId]`, `/terms` ○, + `ƒ Proxy (Middleware)`.

- **Apple-derived path slugs (cosmetic, functional):** `/shop/iphone/*`, `/in/shop/iphone/*` (route group `www-apple-com-736d3707` = directory naming), asset namespace `/sites/www-apple-com-736d3707/root-8a5edab2/*`, `/sites.original-backup/*`.
- **Broken internal routes (referenced, unbuilt):** `/order/lookup` (×5 sources), `/us/shop/goto/*` (×11), `/retail/`, `/retail/geniusbar/`, `/retail/business/`, `/apple-card/`, `/airtag/`, `/choose-country-region/` — all footer/nav → Next 404. No rewrite shim exists.
- **Exposing routes:** `/sites.original-backup/**` is served by `public/` (direct-URL download of 321 backup files incl. pre-repaint mirror art); `/admin/*` behind auth+TOTP; no API route leaks content keys without session (api/admin/* require auth cookie — verified route presence, endpoints return 401 pattern per collections guard).
- Rename/delete: **none recommended in this audit** (per instructions); counts only.

## 10. HOMEPAGE (`/`) — remaining Apple, by layer

- **Visible:** entire footer block (§2 A1–A8): 5 Apple absolute URLs + icloud + tel:1-800-MY-APPLE + 29 Apple labels + ~18 dead relative links. Locale region line "India" (clean) links to `/choose-country-region/` (404). Nav bar itself: Gadzio logo, flyout labels clean **except** Support→"Apple Support" (click-gated). Brand switcher (A12) when opened.
- **Hidden:** meta description names iPhone/iPad/Mac/Apple Watch; `og:image` + `favicon.ico` served from www-apple directory path; `apple.seo` key name; 12 aria/alt strings from gallery (currently not in DOM — section off).
- **Clean layers (verified in live HTML + code):** hero tiles → internal; ribbon → Gadzio copy, internal shopHref; promo grid → 5 internal tiles; video hero → no Apple URL; nav quick-links → internal except `/order/lookup` 404; footer copyright line → "© 2026 Gadzio Inc." (DB).
- **Design preserved:** cleanup passes changed only href/label *values* in rows + `internal` flags and `heroTileHref` routing; layout classes, tile count, art direction, video stage and gallery-wrap untouched — `next build` renders the same 27-page set; visual regression risk nil (no CSS/design tokens edited; `apple-clone.css` name-only).

## 11. LEGITIMATE / NOMINATIVE REFERENCES (do NOT flag as branding defects)

- **`-apple-system, BlinkMacSystemFont`** CSS font stacks — 14 sites (`layout.tsx:10 FONT_FALLBACK`, `admin.css:11,590`, `auth.css:14`, `cases.css:21,294`, `edu-store.css:20`, `oppo.css:22`, `privacy:15`, `terms:15`, `accessory-category.css:22,295`, `ExploreAccessoriesHeader:139,173`, `apple-clone.css`). Exact text: `fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'`. Technical platform token; removing would break system-font fallback. Nominative/compatibility.
- **Trademark notices** (7 user-facing surfaces + DB footnote, terms/page.tsx:78 verbatim legal wording) — these *require* the Apple marks to exist; correct as written.
- **Product-noun compatibility vocabulary** (necessary to sell compatible accessories): iPhone ×300, AirPods ×111, iPad ×108, MagSafe ×88, MacBook ×41, Apple Card ×27 (mostly comments/tile), Apple TV ×9, Apple Store ×9, Apple Watch ×6, FineWoven ×6 (ids/filenames), AirTag ×4, App Store ×3, Apple silicon ×3, Apple Music/Fitness/iCloud ×2 each, AppleCare+ ×1, Genius Bar ×1, Xcode ×2, Apple ID ×1 (comment), Apple Pay ×1 (label). `MFi`/"Made for iPhone/iPad" = **0**.
- **Attribution comments** ("Content verbatim from apple.com", SF Pro © line `apple-clone.css:22`, Ribbon attribution) — honest provenance markers, recommend keeping.
- README:60-62 ("remain © Apple Inc.", not-affiliated statement) — legal-position copy; only README:66 is stale/false.

## 12. BUILD VERIFICATION (allowed per §17; generated artifacts separated)

- `npx tsc --noEmit` → **exit 0**, no errors. Log: job dir `build-tsc.log`.
- `npx next build` → **exit 0**, "Compiled successfully in 48 s", 46 routes, 27 static pages prerendered, no errors/warnings except an environmental notice (package-lock outside git repo). Log: `build-next.log`.
- **Generated, not repo edits:** `.next/` (gitignored), `tsconfig.tsbuildinfo` (24 apple path-hits — regenerable artifact, contains mirror dir names), `next dev`'s self-re-added AGENTS.md block. `git status` post-build shows the same modification set as pre-audit **minus zero new files** (audit wrote only this md).
- Runtime spot-check (prior pass, production HTML): homepage absolutes/relatives listed in §2 confirmed present; gallery & locale banner confirmed absent from SSR; "Apple Support" absent from SSR (flyout client-gated) — all consistent with static trace.

## 13. FINAL REMAINING WORK

**MUST (before "fully de-branded" claim):**
1. Rebuild `data/footer.ts` link columns to Gadzio IA (or empty the columns) — removes 5 Apple absolutes + icloud + tel + 29 labels + 18 dead relatives. Biggest single task; touches `apple.footer` row semantics (row must be edited or extended to override columns, else fallback keeps shipping Apple links).
2. Nav: drop `support.apple.com` item href / rename "Apple Support" link → internal support surface.
3. Implement `/order/lookup` (or repoint the 5 references) — currently a guaranteed 404 from 3 nav panels + search.
4. Page metadata: rewrite homepage/edu `<head>` description wording and either relocate `seo/` assets to a neutral path or accept path-only exposure.
5. Footer region selector `/choose-country-region/` → working page or `#`.

**SHOULD REVIEW:**
6. Decide L1 gallery re-enable risk: hrefs hardcoded apple.com-only (needs renderer escape hatch before ever toggling on).
7. Admin-save resurrect vectors (L6): nav/footer/locale prefills would persist Apple hrefs into rows if saved — consider sanitizing defaults.
8. TOTP issuer string + admin labels + package name (`Apple Clone Admin`, "Apple Homepage", "Apple Clone Studio", `apple-clone`).
9. README staleness (line 66 false; title; © paragraph).
10. Backup tree `public/sites.original-backup/` direct-download exposure (321 files) — move out of `public/` (do not delete without product sign-off).
11. EXIF `promo_apple_card__…` in 12 JPEGs; SF Pro licensing check.

**DEFERRED (known, scoped out):**
12. Apple Card promo tile (L2+L3): no internal destination exists; deleting DB promo row or saving the editor re-activates it. Needs a product decision (drop permanently vs real card page).
13. `www-apple-com-736d3707/root-8a5edab2` directory & `/in/shop/iphone/*` route renames (mass URL churn, zero user-visible text benefit).

**SAFE (explicitly leave alone):**
14. All §5 internal identifiers (`apple.*` DB keys, `appleCopyright`, `APPLE_*` constants, `gadzio_apple_cart_v1`, CSS/dirs) — renaming risks data loss/orphans without removing any Apple surface a user sees.
15. All §11 nominative/technical/legal references.
16. Homepage design/tokens/layout — untouched and must stay so.

## 14. FINAL COUNTS (exact, computed from the sweeps above)

| Metric | Number |
|---|---|
| Total case-insensitive `apple` **text** occurrences, repo (excl. this file) | **1,033** — src 639 · APPLE-BRAND-AUDIT.md 284 · scripts 52 · tsconfig.tsbuildinfo 24 (generated) · .agents 18 · README 9 · package.json 2 · package-lock 2 · skills-lock 2 · migrations 1 · public text files 0 · configs/env/IDEA/CLAUDE/AGENTS 0 |
| Binary embedded occurrences (EXIF `promo_apple_card` files) | **12** (6 live + 6 backup) |
| **Grand total Apple text matches** | **1,045** |
| DB row Apple occurrences | 3 (`apple.footer` value) — **0 destinations** |
| Apple external URL values in src | **30** = 29 apple.com-host (incl. the 1 runtime-fabricated `www.apple.com/apple-card/` template) + 1 icloud.com |
| — ACTIVE | **6** URLs (+1 tel: Apple number) — all §2 footer/nav |
| — ACTIVE-on-interaction included above; LATENT | **19** (18 gallery + 1 support-item href) — plus L2 `card.apple.com` + L3 derived = **21** |
| — DEAD | **3** (locale-banner) |
| `apple.com` string occurrences in src incl. comments | 45 (28 values, 17 comments) |
| Apple-era relative same-origin paths (404 class) | 18 footer + 5 `/order/lookup` sites = **23** |
| User-facing Apple text strings | footer 29 labels/titles + shopHtml 2 + nav 1 + edu content 16 lines + rendered components 19 + TM notices 7 + switcher 3 blocks ≈ **77** |
| Hidden (ARIA/meta) | ~5 |
| Asset files live / backup | **338 / 321** |
| — live unreferenced (dead) | **74** |
| Apple-containing basenames live / backup | **24 / 24** (path-level: all 592+ files sit under `www-apple-com-736d3707`) |
| Apple-glyph vector assets | 3 SVG wordmarks (code-embedded, latent) + 0 in public |
| Internal Apple-named identifiers (keys/constants/paths) | 9 content keys + 1 theme key + ~11 `APPLE_*` constants + 5 name/path items ≈ **26** |
| Legitimate/nominative references | font stacks 14 sites · TM notices 7+1 · product-noun occurrences **748** (iPhone 300, AirPods 111, iPad 108, MagSafe 88, MacBook 41, Card 27, TV 9, Store 9, Watch 6, FineWoven 6, AirTag 4, + 19 minor) |
| Routes total / broken-internal / Apple-slug | **46 / 23-path-family (8 patterns) / 3 families** |
| tsc / build exit codes | **0 / 0** |

*No file was modified, renamed, or deleted during this audit; the database was read with SELECT statements only; `DATABASE_URL` was never printed. This report file is the sole artifact created.*
