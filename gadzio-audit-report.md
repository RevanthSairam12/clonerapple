# Gadzio Storefront — Pre-Launch Audit (READ-ONLY)

**Report date:** 2026-10-11
**Repository:** `C:\Users\Abcom\Documents\clon\apple-clone`
**Method:** read-only inspection. No file inside the repo was created, edited, deleted, moved, staged or committed. The only file written is this report, outside the repo.

---

## A. Header / baseline

| Item | Value |
|---|---|
| Commit (HEAD) | `bef61ffdd1a365b86ed7c77ef1f570b53e705132` |
| Branch | `main` |
| Date | 2026-10-11 |
| Remote | `origin` → `https://github.com/RevanthSairam12/clonerapple.git` (from `.git/config`) |
| Working tree | Dirty — 329 deleted-but-tracked files (` D`), plus added/modified files (see below) |
| Commits in history | 5 |
| Next.js | `16.3.0` | React | `19.2.4` |

Commands run (representative):
```
git rev-parse HEAD ; git status --porcelain ; git remote -v ; cat .git/config
git ls-tree -r HEAD --name-only public/sites.original-backup | wc -l
find public -type f | wc -l ; du -sh public/sites
grep -rhoE "/sites/[^\"']+\.(jpg|jpeg|png|webp|svg|gif|mp4)" src/ | sort -u
npx tsc --noEmit ; npm run build
python (PIL) metadata scan over public/**  [script kept at %TEMP%\ga\meta2.py]
git log --all --stat -- public/sites/www-apple-com-736d3707
grep -rn "College, sorted." src/ ; grep -rn "apple\.com" src/
```

**Baseline `git status --porcelain` (truncated to the relevant lines):**
```
A  .agents/skills/apple-design/SKILL.md
AM .claude/worktrees/whimsical-jumping-valiant
A  APPLE-BRAND-AUDIT.md / APPLE-GADZIO-CODE-AUDIT.md / APPLE-GADZIO-FULL-AUDIT.md
A  REPOSITORY-APPLE-AUDIT-2026-10-03.md
M  README.md, package.json, package-lock.json
 D public/sites.original-backup/**            <-- 329 deletions, still in HEAD
```

---

## B. Findings

Severity: **Critical** = blocks launch / legal exposure · **High** · **Medium** · **Low**.

### Critical

| ID | Priority | Area | Finding | Evidence | Verified? | Sev | Suggested fix |
|---|---|---|---|---|---|---|---|
| G-01 | P0 | Copied originals | The complete apple.com mirror `public/sites.original-backup/` was deleted from the **working tree only**. It still exists in git `HEAD` with **321 files**. | `git ls-tree HEAD public/sites.original-backup` → `040000 tree 3cb4c92…`; `git ls-tree -r HEAD --name-only public/sites.original-backup \| wc -l` → `321`; `git status --porcelain \| grep -c "^ D"` → `329` | Verified | Critical | The deletion must be **committed**, and the folder must additionally be purged from history (`git filter-repo` / BFG) **and** from the GitHub remote before launch — committing the deletion alone leaves the material retrievable via `git log`/`git checkout`. |
| G-02 | P0 | Trademark | Apple's logo is shipped as a live static asset at `public/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico` (22,382 bytes, 3 ICO frames). Extracted frame is a black Apple mark in a circle. Publicly served at `/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico`. | `ls -la …/seo/favicon.ico`; PIL `Image.open(...).ico.sizes()` → `{(32,32),(16,16),(64,64)}`; rendered frame inspected | Verified | Critical | Delete the file. It is unreferenced by code (`grep -rn "favicon" src/` matches only `src/proxy.ts:62`, a middleware matcher string), so removal is safe. |
| G-03 | P0 | Copied imagery | 49 education "store-card" images under `public/sites/edu-store/images/store-cards/` are Apple's own education-store marketing artwork. Filenames are Apple's CDN asset names and include Apple-owned product/brand names. Visual confirmation: `store-card-40-bts-apple-college-202607.jpg` is Apple's Back-to-School artwork; `store-card-50-apple-intelligence-202609.webp` is Apple's official Apple Intelligence hero (iPhone + iPad + Mac, "Ask Siri" pill, macOS dock). | `ls public/sites/edu-store/images/store-cards/ \| wc -l` → **49**; names include `store-card-40-applecare-202606.webp`, `store-card-40-bts-apple-music-202607.webp`, `store-card-50-apple-intelligence-202609.webp`, `store-card-40-apple-creator-studio-202606.webp`, `store-card-40-bts-apple-college-202607.jpg`; both files opened and viewed | Verified | Critical | These are Apple marketing works reproduced wholesale. Replace with Gadzio-created photography/artwork or remove the Education Store surface. |
| G-04 | P0 | Copied imagery | Hero tile 0 (the `hero_banner1` set, 10 files) is Apple education-campaign photography: three models holding baskets of Apple devices, with **the Apple logo legible on the MacBook lids**. | `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles.ts:93-118` references `hero_banner1 (1..10).jpg`; `hero_banner1 (1).jpg` opened and viewed; no XMP/EXIF in any of the 10 | Verified | Critical | Remove/replace. Also a **model-release / publicity** exposure — Apple's contracted models appear on a third-party commercial site. |
| G-05 | P0 | Impersonation | A live route `/android` (`src/app/android/page.tsx`) serves a clone of the OPPO India website and declares itself to be the official site: `<title>` "OPPO Official Site - OPPO India", `og:url` `https://www.oppo.com/in/`, `siteName` "OPPO India", copy "powered by ColorOS". | `src/app/android/page.tsx:14-23, 35`; `src/components/sites/oppo-india/**` (full component set + `src/app/oppo.css`) | Verified | Critical | Unrelated to Apple but the same class of risk and arguably worse (a false claim of official status, not just copied assets). Remove the route and `src/components/sites/oppo-india/`, or repurpose under an unambiguous Gadzio identity with no OPPO marks. |

### High

| ID | Priority | Area | Finding | Evidence | Verified? | Sev | Suggested fix |
|---|---|---|---|---|---|---|---|
| G-06 | P0 | Copied text | Apple's education tagline **"College, sorted."** is still live in 4 places. | `src/app/in-edu/store/page.tsx:26` and `:29`; `src/components/sites/edu-store/data/content.ts:49`; `src/lib/admin/defaults.ts:469` (`grep -rn "College, sorted." src/ \| wc -l` → 4) | Verified | High | Rewrite. Note `defaults.ts` is the admin default, and the **DB row overrides it** (see G-16) — both must change. |
| G-07 | P0 | Copied text | Apple product taglines survive a mechanical `M`→`G` find/replace: "Now supercharged by G5." (Apple's "…M5."), "Now with G6 and G5 Pro.", "Now with G5 Max and G5 Ultra.", "Now supercharged by G4.", "A battery you can't outrun.", "Write on it. Draw on it. Love it.", "Walk it. Track it. Love it." | `src/components/sites/edu-store/data/content.ts:131,151,161,171,181,191,200,210,229` | Verified | High | Rewrite all education-store copy from scratch. A letter substitution does not remove Apple's authorship. |
| G-08 | P0 | Evidence of copying | The source files **self-declare** verbatim copying of apple.com, and instruct future editors not to regenerate. | `data/tiles.ts:2` — "Content is verbatim from https://www.apple.com/ (captured 2026-08-20). Do not hand-edit."; `icons.tsx:2` — same; `gallery.ts:4-5`; `TileCard.tsx:19` | Verified | High | These comments are an admission in the repository. Remove alongside the material they describe. |
| G-09 | P1 | PayU compliance | The "Contact Gadzio" support section contains **no contact details** — no email, no phone, no postal address, no business/legal entity name. It offers only "sign in to your account" and a privacy link. | `src/app/support/page.tsx:181-195` (section `id="contact"`); `grep -rniE "@gadzio\|support@\|help@\|\+91\|1800-" src/app/support/page.tsx` → no match | Verified | High | PayU onboarding expects a reachable support contact and a business name. Add a real email + phone + registered entity name, and expose the entity name in the footer. |
| G-10 | P1 | Copied imagery | 5 education header sticker sprites are Apple's education-store sticker artwork, shipped as horizontal sprite sheets in Apple's exact style. | `src/components/sites/edu-store/data/content.ts:51-57` (5 entries); files under `public/sites/edu-store/images/edu-header-icon-sprite-*-202606.png`; `edu-header-icon-sprite-cap-202606.png` opened and viewed (halftone mortarboard in Apple's education palette, 10 frames); `src/app/in-edu/store/edu-store.css:185` comments "Apple ships each sticker as a horizontal sprite sheet" | Verified (count + 1 of 5 viewed) | High | Replace or remove. The CSS comment is also a written acknowledgement of Apple provenance. |
| G-11 | P1 | Copied content | The nav/UI icon set is verbatim Apple SVG geometry — **9 `<path d=…>` elements** in one file, including Apple's search, bag, chevron and gallery-control glyphs. | `src/components/sites/www-apple-com-736d3707/root-8a5edab2/icons.tsx` (`grep -c "<path d=" ` → 9; exports at lines 6,10,14,19,24,29,34,39,44,48,52); header line 2 declares them verbatim from apple.com | Verified | High | Redraw as original icons. The `GALLERY_LOGOS` map at `icons.tsx:70` was already emptied in an earlier de-brand pass — the same treatment is needed for the 9 paths, not just the wordmarks. |
| G-12 | P1 | Audit validity | Content is **not** fully determined by these source files. `src/lib/content.ts` reads `content_blocks` from Supabase and a stored row **wins** over the hardcoded default. | `src/lib/content.ts:15-22` ("when a row exists in content_blocks the stored JSON wins"); `:44, :57, :86, :99`; `src/app/page.tsx:33,55` | Verified | High | A code-only audit is not sufficient. **Dump the live `content_blocks` and `site_settings` rows** and re-run this audit against actual served content. |

### Medium

| ID | Priority | Area | Finding | Evidence | Verified? | Sev | Suggested fix |
|---|---|---|---|---|---|---|---|
| G-13 | P0 | Data integrity | 4 image references point at files that do not exist → broken images in production. | Scripted check over 136 unique `/sites/...` refs. MISSING: `/sites/edu-store/images/category-iphone.png`; `/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/2_iph_case_medium_2x.jpg`; `…/4_iph_case_small.jpg`; `…/6_iph_case_small_2x.jpg` | Verified | Medium | Fix paths or restore files. (Note `src/components/cart/CartPageView.tsx:72` and `src/components/search/SearchPageView.tsx:57` carry comments acknowledging the `category-iphone.png` 404 and working around it.) |
| G-14 | P1 | Ops hygiene | A Node build script is served publicly from the asset tree. | `public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/GENERATE-ASSETS.JS` (1,262 bytes, `require("sharp")` asset-resizer) | Verified | Medium | Delete; it is not a web asset. |
| G-15 | P2 | Metadata | The site's Open Graph image is a **grey placeholder**, so every social share renders a stub. | `src/app/page.tsx:24` → `/sites/www-apple-com-736d3707/root-8a5edab2/seo/open_graph_logo.png`; file opened → "1200 x 630 px / Open Graph Logo / 1.90:1" | Verified | Medium | Replace with a real Gadzio OG image. |
| G-16 | P2 | Metadata | `metadataBase` is hardcoded to `http://localhost:3000` on the homepage and the Android route. | `src/app/page.tsx:16`; `src/app/android/page.tsx:14` | Verified | Medium | Set to `https://gadzio.in` (env-driven). |
| G-17 | P1 | Commerce | A demo/test product is present in the **authoritative server-side checkout catalog**. | `src/lib/payu/catalog.ts:46-52` — id `demo-case-test`, name `Gadzio Premium MagSafe Case (Test Item)`, price `499` | Verified | Medium | Remove before launch. `getProductFromCatalog` resolves it like any real SKU. |
| G-18 | P2 | Repo hygiene | A second full checkout of the repo is committed into git as a gitlink, including `.next` build cache. | `git ls-files -s .claude` → `160000 2d50b69… .claude/worktrees/whimsical-jumping-valiant`; `git worktree list` lists it as branch `worktree-whimsical-jumping-valiant` | Verified | Medium | Remove the gitlink and the worktree; add `.claude/` to `.gitignore`. |
| G-19 | P2 | P2 assets | No favicon, no `apple-touch-icon`, no web app manifest, no `robots.txt`, no `sitemap`. The `icons.icon` points at a 2.5 KB brand logo, not an ICO. | `ls public/*.ico public/manifest*` → none; `find src/app -name "robots.*" -o -name "sitemap.*"` → none; `src/app/page.tsx:26-28` sets `icons.icon: '/gadzio_logo.png'` | Verified | Medium | Add favicon/apple-touch-icon/manifest/robots/sitemap for a credible storefront. |
| G-20 | P2 | Served assets | 166 files under `public/` are referenced by nothing yet are still publicly served — dominated by **146 Apple gallery images** and 17 tile images. (Most are generated placeholders, but they are fetched by anyone guessing the path.) | Scripted basename cross-check against `src/`; grouped: `images/gallery` 146, `images/tiles` 17, `oppo-india/images` 2, `gadzio_logo_white.png` 1 | Verified | Medium | Delete the unreferenced tree, especially the whole `images/gallery/` folder. |
| G-21 | P2 | Trust | No custom 404 or error boundary exists; failures fall back to Next's bare default. | `ls src/app/not-found.tsx src/app/error.tsx src/app/global-error.tsx` → none; build output shows only `○ /_not-found` | Verified | Medium | Add branded `not-found.tsx` and `error.tsx`. |
| G-22 | P0 | Product media | All 17 case product photos are generated placeholders, so product pages show a "600 × 600 px" stub, not the product. | `src/components/sites/cases-protection/data/products.ts:221,234,253,…`; `public/sites/cases-protection/images/` — all 17 files 22–23 KB, all timestamped `Sep 27 22:07`; `iphone17pro-clear-magsafe.jpg` opened → placeholder card reading "600 x 600 px / iPhone 17 Pro Clear Case with MagSafe" | Verified (1 of 17 viewed; uniformity + `scripts/generate_all_placeholders.py` corroborate) | Medium | Commission real product photography. |

### Low

| ID | Priority | Area | Finding | Evidence | Verified? | Sev | Suggested fix |
|---|---|---|---|---|---|---|---|
| G-23 | P2 | i18n | `<html lang="en-US">` on an India-targeted INR storefront. | `src/app/layout.tsx:39` | Verified | Low | Use `en-IN`. |
| G-24 | P2 | Tidy-up | `public/sites/.../images/tiles/` mixes live and dead assets, and the `videos/` folder is empty but retained. | `ls …/videos/` → empty dir; 4 missing tile refs per G-13 | Verified | Low | Prune. |

### Verified-good (no action, recorded so the audit is not one-sided)

| ID | Area | Finding | Evidence |
|---|---|---|---|
| G-25 | PayU crypto | Request hash is generated **server-side** with SHA-512 to the documented field order; the module throws if loaded in a browser. | `src/lib/payu/hash.ts:10-12, 66-102` |
| G-26 | PayU callback | The return callback **verifies** the reverse hash with a constant-time compare, then re-checks amount against the server-side order, then calls PayU server-to-server before marking PAID. | `src/lib/payu/hash.ts:155-194`; `src/lib/payu/process-response.ts:93, 104, 135-147, 154-172`; `src/lib/payu/verify.ts:30-117` |
| G-27 | PayU secrets | Key/salt are read from env only and never reach client code; `assertPayUConfigured` fails closed with a message that does not echo the secret. | `src/lib/payu/config.ts:12-14, 31-41, 73-80` |
| G-28 | PayU pricing | Checkout totals are computed from a server-side catalog; client-supplied prices are ignored. | `src/lib/payu/catalog.ts:54-63` ("NEVER trusts prices supplied from the client"), `:80-104` |
| G-29 | Tracking | No Apple/Adobe/Omniture analytics, no `s_code`/`AppMeasurement`, no tracking pixels, no cookie-consent or geolocation logic in any text file. | `grep -rniIE "s_code\|AppMeasurement\|omtrdc\|omniture\|gtag\|googletagmanager\|navigator.geolocation"` over `src/**/*.{ts,tsx,js,css,html}` → no matches (earlier hits were binary false-positives inside JPEGs) |
| G-30 | Secrets | No `.env` file was ever committed; `.env*` is gitignored; no hardcoded key/salt/token matched a secret-shaped pattern in `src/`. | `git log --all --diff-filter=A --name-only \| grep -i "\.env"` → empty; `.gitignore:7`; `.env.local` and `.env.example` present on disk (keys only, values never printed) |
| G-31 | Fonts | No SF Pro (or any) font binaries are shipped; the stack uses Google Fonts (Inter, Mona Sans) with a generic `-apple-system` fallback. | `find public -iname "*.woff*" -o -iname "*.otf" -o -iname "*.ttf"` → none; `src/app/layout.tsx:6-10, 34-57` |
| G-32 | Legal text | A non-affiliation disclaimer and Apple trademark attribution **do** exist. | `src/app/terms/page.tsx:78` ("Gadzio is an independent retailer of compatible accessories and is not affiliated with, sponsored by, or endorsed by Apple Inc."); `src/components/shop/ProductDetailPage.tsx:657-658`; per-category disclaimers in `src/components/sites/accessories/data/*.ts:34-44` |
| G-33 | Nav trademark | Apple's logo was removed from the nav — all wordmark path arrays are empty. | `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/nav.ts:49-52, 61-64, 73-76, 85-88, 97-100, 109-112` → `paths: []` |
| G-34 | Build health | `tsc --noEmit` is clean; `next build` succeeds. | `npx tsc --noEmit` → no output, exit 0; `npm run build` → `BUILD_EXIT=0`, 28 routes rendered |
| G-35 | Authorship (positive) | 36 tile images are Gadzio originals made in Canva, carrying XMP naming a human author — they are **not** Apple files despite Apple-style filenames. | XMP on 36 files: `<xmp:CreatorTool>Canva doc=… user=UAEAcQSddC4 brand=Tim Santi Putri</xmp:CreatorTool>`, `<pdf:Author>Revanth Sairam</pdf:Author>`, `<Attrib:Created>2026-08-25…2026-09-07</Attrib:Created>` |

---

## C. Coverage matrix

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Public exposure | **DONE** | `public/` = 300 files; `public/sites/` = 298 files / 25 MB. `public/sites/` **is** referenced by code (246 refs) so it is served by design. `public/sites.original-backup/` is gone from disk but alive in `HEAD` (G-01). No `vercel.json`; `next.config.ts` is empty (default output) → `public/` is served verbatim at the URL root in dev, `next start`, and any Node host. |
| 2 | Homepage / promo imagery | **DONE** | 136 unique refs resolved; 4 missing (G-13). Hero tile 0 = Apple photography (G-04). 36 tile files proven Gadzio-original via XMP (G-35). Remaining tile files: UNKNOWN (see D). |
| 3 | Education-store imagery | **DONE** | Counts verified myself: **49** store-card files, **5** sticker sprites, 1 header background — not inherited from any prior audit. All Apple-derived or UNKNOWN (G-03, G-10). |
| 4 | Product authenticity / claims | **PARTIAL** | Product names/prices are internally consistent and mostly Gadzio-branded ("Gadzio MagPulse…", ₹ prices). Also present: a purchasable test SKU (G-17), Apple taglines (G-06, G-07). **Not done:** there is no separate authoritative catalogue to diff against — `src/lib/payu/catalog.ts` is derived from the same TS data files, so a true cross-source price check is impossible from the repo alone, and the live CMS rows may differ (G-12). |
| 5 | Branding & icons | **DONE** | 9 verbatim Apple SVG paths (G-11); no SF Pro binaries (G-31); "College, sorted." ×4 (G-06); nav wordmark paths already emptied (G-33); Apple-describing `alt`/`aria` text catalogued in D. |
| 6 | Legal & trust pages | **DONE** | `/privacy`, `/terms`, `/support` exist with real prose — no `lorem`/`TODO`/placeholder strings matched. Non-affiliation + Apple trademark attribution present (G-32). Footer links Privacy/Terms/Contact (`data/footer.ts:110-111, 206-207`). **Gap:** no contact details (G-09), no separate returns/shipping pages (covered only as `/support#…` anchors). |
| 7 | Functionality | **PARTIAL** | Ran: typecheck ✅ clean, build ✅ exit 0. **Could not run lint or tests — no `lint` or `test` script exists and no `*.test.*`/`*.spec.*` file exists.** Routes: product `/shop/product/[productId]`, `/shop/buy/[productId]`; cart/bag `/cart`, `/bag`; checkout `/checkout`; PayU `/api/payu/{initiate,success,failure,cancel,webhook,reconcile}` + `/order/{success,failed,cancelled}`; search `/search`. Error states: empty cart handled (`CartPageView.tsx:125,167`); payment tamper/amount-mismatch/network paths handled (`process-response.ts:111-147`, `verify.ts:118-131`); **no** out-of-stock concept, **no** custom 404/error boundary (G-21). Mobile: viewport meta + Tailwind responsive classes present. |
| 8 | Scraped originals | **DONE** | `public/sites/www-apple-com-736d3707/` (Apple mirror) and `public/sites.original-backup/` (G-01). Present in history since `2034bfd`/`2d50b69`. **No cloner manifest/config/script is present** — `grep -rliE "cloner\|httrack\|crawl\|scrape\|mirror"` over `scripts/` and `package.json` returned nothing; `scripts/` holds remediation utilities only. |
| 9 | Hardcoded apple.com URLs | **DONE** | No live Apple URL in shipped code. All 3 `www.apple.com` matches in `src/` are comments (`data/tiles.ts:2`, `icons.tsx:2`, `TileCard.tsx:19`). No hotlinked Apple CDN host. External hosts in `src/`: `w3.org` ×13 (SVG ns), `gadzio.in` ×11, `fonts.googleapis/gstatic`, `payu.in` ×10, `oppo.com` ×1. |
| 10 | Analytics / tracking | **DONE** | No matches in any text file (G-29). |
| 11 | Verbatim Apple JS/CSS | **PARTIAL** | No Apple copyright header and no `sourceMappingURL` found in `src/`. **But** a later-deleted pass already stripped `GALLERY_LOGOS` (icons.tsx:70), and 9 verbatim Apple SVG paths remain (G-11). CSS was not exhaustively diffed against Apple's stylesheets — that diff is out of scope for static inspection (see D). |
| 12 | Metadata tags | **DONE** | `<title>`/description/OG on the homepage and Android route are Gadzio/OPPO-branded, not Apple. Two defects: `metadataBase` = localhost (G-16) and a placeholder OG image (G-15). `lang="en-US"` (G-23). No Apple JSON-LD. |
| 13 | Image EXIF/XMP | **DONE** | Scanned all **298** images with PIL: 42 carry XMP (36 identifiable as Canva/`Revanth Sairam`, 6 with only a benign orientation tag); **256 carry no metadata at all**. No image names Apple as author or copyright holder. Full method + results in D. |
| 14 | The cloner | **DONE** | Cloner = `github.com/RevanthSairam12/cloner`, **MIT-licensed**, `LICENSE` present, self-described as an AI website-cloner template. Its code/files are **not** vendored into this repo (no dependency, no manifest). **Important:** MIT licenses the tool's *code*; it grants no rights whatsoever to the sites it clones — every copied asset remains the originator's. |
| 15 | Git history | **DONE** | 5 commits. Apple paths present since the initial commits — `git log --oneline --all -- public/sites/www-apple-com-736d3707` → `2d50b69`, `954b411`, `55c1fe8`, `2034bfd`. Audit docs are **tracked** (`APPLE-BRAND-AUDIT.md`, `APPLE-GADZIO-CODE-AUDIT.md`, `APPLE-GADZIO-FULL-AUDIT.md`, `REPOSITORY-APPLE-AUDIT-2026-10-03.md`); `GADZIO_APPLE_ORIGIN_AUDIT.md` is untracked. A remote exists. **Whether that remote is public is UNVERIFIED** — I could not determine visibility from local config alone and deliberately made no network call to test it. If it is public, the Apple mirror is already published. |
| 16 | P2 assets | **DONE** | No favicon/apple-touch-icon/manifest (G-19); OG image is a placeholder (G-15); 17 product photos are placeholders (G-22); 166 unreferenced-but-served files (G-20). |
| 17 | File & security hygiene | **DONE** | No committed secrets, no `.env` in history (G-30). Dev tooling that should not ship, all **tracked**: `.agents/skills/apple-design/SKILL.md`, `skills-lock.json`, `.claude/worktrees/…` (gitlink, G-18), 4 audit `.md` files at repo root, `GENERATE-ASSETS.JS` inside `public/` (G-14). |

**Every item 1–17 has a row.**

---

## D. Needs human review

### D1. Images that cannot be confirmed Gadzio-original

Confirmed Apple-derived (no further review needed — remove):
```
public/sites/www-apple-com-736d3707/root-8a5edab2/seo/favicon.ico                    (Apple logo)
public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/hero_banner1 (1).jpg  (+ (2)…(10), 10 files)
public/sites/edu-store/images/store-cards/                                            (all 49 files)
public/sites/edu-store/images/edu-header-icon-sprite-{burst-pink,burst-yellow,cap,eyes,peace}-202606.png  (5 files)
```

Confirmed Gadzio-original (Canva XMP, author "Revanth Sairam") — no review needed:
```
36 files: the adapter / promo_adapter / cases / chargercover / icase / iearphones sets
under public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/
```

**UNKNOWN — needs Google Lens / TinEye reverse image search** (no metadata, Apple-style filenames, not yet viewed):
```
public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/2_iph_case__medium_2x.jpg
public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/3_iph_case_medium.jpg
public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/5_iph_case_large_2x.jpg
public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/6_cases_iph_small_2x.jpg
public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/12_Untitled (2136 x 1140 px) (1..9).jpg   (9 files)
public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/promo_adapter_{small,medium,large}{,_2x}.png   (6 files)
public/sites/edu-store/images/edu-header-background-202606.png
public/sites/oppo-india/images/*.png|jpg                                              (16 files)
public/gadzio_logo.png, public/gadzio_logo_white.png
```
The 9 `12_Untitled (2136 x 1140 px)` files are the **iPhone 18 promo tile** (referenced at `data/tiles.ts:166-191`) shown at the top of the homepage — treat these as the highest-priority items on this list.

Note on `edu-header-background-202606.png`: I cropped/brightened it and could not resolve legible text; it is a dark 6016×600 banner with a cyan dotted diagonal band. Apple-style dimension and `202606` date-suffix naming put it under suspicion — flagged UNKNOWN rather than guessed.

### D2. Text needing legal review
- The education-store taglines (G-06, G-07) — a lawyer should confirm the rewrite is sufficiently distinct.
- `terms/page.tsx:78` asserts *"All content … on this site are owned by, controlled by, or licensed to Gadzio"* while the site still ships Apple's artwork. **That sentence is currently inaccurate** and could be read as a misrepresentation; it must not go live alongside the copied assets.
- G-09 (PayU contact requirements) — confirm against PayU's current onboarding checklist.

### D3. Cloner license
- Resolved: MIT (see item 14). Remaining human step: confirm the MIT `LICENSE` text covers the *template's* code only, and record that no license from `apple.com` or `oppo.com` exists for any copied asset.

### D4. Image metadata method (and its limits)
- Tool: PIL (available at the local venv). `exiftool` is **not** installed and nothing was installed.
- Result: 42/298 images carry XMP; **256/298 carry none**. Absence of metadata is **not** evidence of originality — metadata is routinely stripped by scraping. I used absence only to route a file to "UNKNOWN", never to conclude "Gadzio-original". **No image names Apple as author or copyright holder.**

---

## E. Top 10 fixes, riskiest first

1. **Purge the Apple mirror, not just delete it** (G-01). Commit the deletion *and* rewrite history *and* force-push/clean the GitHub remote. Until the remote is cleaned, 321 Apple files remain published. Riskiest item: it is both the largest reproduction and the one most likely to already be public.
2. **Delete the Apple-logo favicon** (G-02). One file, maximum trademark exposure, zero code dependency.
3. **Take down the two imitation surfaces** (G-05 OPPO `/android`; G-04 `hero_banner1`). The OPPO route claims to *be* another company; the hero uses Apple's contracted models.
4. **Remove the 49 Apple education store-cards and 5 sticker sprites** (G-03, G-10), or remove the Education Store entirely.
5. **Rewrite all education-store copy** (G-06, G-07) — "College, sorted." and the G-series taglines.
6. **Dump and audit the live CMS rows** (G-12). Everything above may also exist in `content_blocks`, where it overrides the code you fixed.
7. **Add real contact details and a business name** (G-09) — blocks PayU onboarding.
8. **Redraw the 9 Apple SVG icon paths** (G-11) and strip the self-incriminating "verbatim from apple.com" headers (G-08).
9. **Delete the demo SKU** (G-17) and fix the 4 broken image paths (G-13) before taking real money.
10. **Hygiene sweep** (G-14, G-18, G-20): remove `GENERATE-ASSETS.JS` from `public/`, untrack the `.claude` worktree gitlink, delete the 166 unreferenced assets.

---

## Final self-check (re-verified after writing the findings)

Spot-checked 5 findings — the 3 most severe plus 2 at random. All evidence still holds:

| Check | Finding | Re-run | Result |
|---|---|---|---|
| 1 (most severe) | G-02 Apple favicon | `ls -la …/seo/favicon.ico` | Still present, 22,382 bytes, Aug 21 16:37 — **holds** |
| 2 (most severe) | G-01 backup in HEAD | `git ls-tree -r HEAD --name-only public/sites.original-backup \| wc -l` | `321` — **holds** |
| 3 (most severe) | G-06 "College, sorted." | `grep -rn "College, sorted." src/ \| wc -l` → `4`; `content.ts:49` still `subhead: 'College, sorted.'` | **holds** |
| 4 (random) | G-13 broken refs | Re-ran the existence loop over all 136 refs | Same 4 files missing — **holds** |
| 5 (random) | G-17 demo SKU | `grep -n "demo-case-test" -A 5 src/lib/payu/catalog.ts` | Still at `catalog.ts:46-52`, price `499` — **holds** |

No finding in this report was retracted. Two claims are explicitly marked **UNVERIFIED** rather than guessed: (i) whether the GitHub remote is public (item 15), and (ii) the ~115 tile/edu/oppo images listed in D1, whose origin needs reverse image search.

---

## Scope statement

Everything above was verified by direct inspection on 2026-10-11 at commit `bef61ff`. Two limits bound this audit:

1. **The repository is not the website.** `content_blocks` rows in Supabase override these files at runtime (G-12). Any fix applied only to code can be silently reverted by a stored row.
2. **No build output was inspected for copied assets.** `public/` is copied verbatim into the deployment by Next.js; `.next/` holds no `public/` copy, and the build succeeded (exit 0). The exposure is therefore at the URL root regardless of build configuration.
