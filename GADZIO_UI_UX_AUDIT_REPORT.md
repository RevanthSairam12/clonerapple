# Gadzio Website — Comprehensive UI/UX, Responsiveness, E-Commerce Usability & Accessibility Audit Report

**Audit Date:** October 15, 2026  
**Workspace:** `C:\Users\Abcom\Documents\clon\apple-clone`  
**Framework:** Next.js 16.3.0 / React 19.2.4 / Tailwind CSS v4  
**Scope:** End-to-end UI/UX, responsive layout (`375×812`, `768×1024`, `1024×768`, `1280×800`, `1440×900`), e-commerce user flows, navigation, product discovery, cart/checkout, and WCAG 2.1 AA accessibility audit.

---

## Executive Summary & Severity Matrix

| Severity | Count | Summary of Impact |
| :--- | :---: | :--- |
| **Critical** | **6** | Broken currency conversion (`$49.00` becomes `₹49.00` in cart/checkout), category tab `"Power & Cables"` routing shoppers into `/checkout`, color swatch selection on detail pages failing to update single-image products or mis-swapping gallery angles, `--gz-bar-bottom` CSS variable undefined outside `.gz-root` breaking mega-menu/search dropdown positioning, sticky product action bar hidden behind the 96px `GadzioHeader`, and `/auth` `"By phone"` tab submitting a phone number into an email-only API (`Invalid email`). |
| **High** | **11** | Legacy `44px` top-margin/padding offsets applied below a `sticky` header (creating 44px blank white gaps), filter sidebar breakpoint mismatch (`768px` Tailwind `md:block` vs `833px` CSS `@media`) locking the sidebar open while showing a non-functional mobile toggle button, 100% of mega-menu `?filter=...` URL parameters ignored on category pages, 30 accessory products missing from the global search registry (`src/lib/products/registry.ts`), 6 of 9 products in `cases-protection` falling back to the generic `/shop/product/[id]` iPhone-case template, and multiple no-op interactive controls (`Apply` promo button, `Save for later`, Support search bar, `Start Chat`). |
| **Medium** | **11** | Stale Apple Watch / iPad Pro / MacBook Pro `alt` text on all 5 homepage Gadzio promo tiles, `/in-edu/store` product cards looping back to `/search?q=...` with empty `alt=""`, `/privacy`, `/terms`, `/checkout`, and `/auth` lacking global header/footer navigation, 14 missing `/sites/oppo-india/images/*` assets in Admin CMS defaults, nested `<aside><aside>` landmarks, and missing `aria-expanded` / `role="tablist"` attributes. |
| **Low** | **7** | Hero Slide 3 `"Explore All"` CTA linking to `/mobile-cases` instead of all accessories, decorative SVG QR code on `/auth` claiming `"Download the Business app"`, unlinked Google Play / AppGallery SVG badges, dead CSS/components from the retired `GlobalNav`, and minor touch-target sizing (`14px–32px`) on secondary controls. |

---

## A. Navigation, Header & Footer Audit

### A1. [CRITICAL] `--gz-bar-bottom` CSS Custom Property Undefined Outside `.gz-root`
- **Page / Route:** `/cart`, `/bag`, `/search`, `/shop/product/[productId]`, `/shop/buy/[productId]`, `/in-edu/store`
- **Component / File:** `src/app/gadzio.css` (lines `72–79`) & `src/components/header/GadzioHeader.tsx` (lines `513`, `533`, `564`)
- **Viewport:** Desktop (`1440px`, `1280px`, `1024px`) and Mobile/Tablet (`<834px`)
- **Description:**
  - In `src/app/gadzio.css:78`, `--gz-bar-bottom: 56px;` is scoped **exclusively** inside `.gz-root`.
  - Although lines `72–76` of `gadzio.css` explicitly note that `GadzioHeader` renders outside `.gz-root` on cart, search, product detail, and edu-store pages, `GadzioHeader.tsx` positions `#gz-nav-mega` (`line 513`), `#gz-nav-search` (`line 533`), and `#gz-nav-mobile` (`line 564`) using Tailwind's `top-(--gz-bar-bottom)` (`top: var(--gz-bar-bottom)`).
  - On every page that does not wrap `<GadzioHeader />` in `.gz-root` (`/cart`, `/bag`, `/search`, `/shop/product/[productId]`, `/shop/buy/[productId]`, `/in-edu/store`), `var(--gz-bar-bottom)` is undefined, so `top: var(--gz-bar-bottom)` evaluates to `top: auto`.
  - **Visual & Functional Impact:** On desktop, the mega-menu and search panel drop **40px lower** (`top: 96px` below the 40px secondary category bar instead of `top: 56px` flush below the primary bar), leaving the category bar exposed and misaligned with the backdrop.
- **Recommendation:** Define `--gz-bar-bottom: 56px;` on `:root` (or directly on `.gz-header` in `src/app/gadzio.css`) so all child panels of `<GadzioHeader />` resolve `56px` regardless of parent wrapper class.


---

### A2. [CRITICAL] Category Sub-Navigation Bar in `CasesProtectionPage` Routes `"Power & Cables"` to `/checkout` and Other Tabs to `/`
- **Page / Route:** `/shop/iphone/accessories/cases-protection` and `/in/shop/iphone/accessories/cases-protection`
- **Component / File:** `src/components/sites/cases-protection/CasesProtectionPage.tsx` (lines `18–26`)
- **Viewport:** All viewports (`375px` – `1440px`)
- **Description:**
  - The horizontal category sub-navigation bar (`CATEGORY_LINKS`) is hardcoded as:
    ```ts
    const CATEGORY_LINKS = [
      { label: 'All Accessories', href: '/shop/iphone/accessories/cases-protection', active: false },
      { label: 'Cases & Protection', href: '/shop/iphone/accessories/cases-protection', active: true },
      { label: 'MagSafe Mounts', href: '/shop/iphone/accessories/cases-protection?filter=magsafe', active: false },
      { label: 'Power & Cables', href: '/checkout', active: false },
      { label: 'Audio & AirPods', href: '/', active: false },
      { label: 'Screen Protectors', href: '/shop/iphone/accessories/cases-protection?filter=screen', active: false },
      { label: 'Stands & Docks', href: '/', active: false },
    ];
    ```
  - Clicking **"Power & Cables"** sends a browsing shopper directly to `/checkout` (which immediately redirects unauthenticated users to `/auth?redirect=/checkout`).
  - Clicking **"Audio & AirPods"** or **"Stands & Docks"** dumps the user back onto the homepage (`/`) instead of `/in/shop/iphone/accessories/wired-earphones` or `/in/shop/iphone/accessories/airpods-case`.
  - By contrast, `AccessoryCategoryPage.tsx` (`lines 12–18`) has the properly wired 6-tab sub-nav (`All Accessories`, `Cases & Protection`, `Power Adapter & Cable`, `Wired Earphones`, `Cable & Plug Case`, `AirPods Case`).
- **Recommendation:** Unify `CATEGORY_LINKS` in `CasesProtectionPage.tsx` (and the default seed in `src/lib/admin/defaults.ts`) with the 6-tab sub-navigation used in `AccessoryCategoryPage.tsx`.

---

### A3. [HIGH] All Mega-Menu & Sub-Nav `?filter=...` Query Parameters Are Ignored by Category Pages
- **Page / Route:** `/shop/iphone/accessories/cases-protection?...` and `/in/shop/iphone/accessories/[slug]?...`
- **Component / File:** `src/components/header/GadzioHeader.tsx` (lines `46–306`), `src/components/sites/cases-protection/CasesProtectionPage.tsx` (lines `62–72`), `src/components/sites/accessories/AccessoryCategoryPage.tsx` (lines `35–42`)
- **Viewport:** All viewports
- **Description:**
  - `GadzioHeader.tsx` defines **40+ mega-menu links** with query strings such as `?filter=magsafe`, `?filter=clear`, `?filter=silicone`, `?filter=leather`, `?filter=usb-c`, `?filter=gan`, `?filter=anc`, etc.
  - Neither `CasesProtectionPage.tsx` nor `AccessoryCategoryPage.tsx` reads `useSearchParams()` or accepts `searchParams` to initialize `selectedFilters`. Every single `?filter=...` link renders the unfiltered catalog with `selectedFilters = {}`.
- **Recommendation:** Read `searchParams.get('filter')` in `CasesProtectionPage.tsx` and `AccessoryCategoryPage.tsx` and map the query token to the corresponding initial filter state, or link directly to dedicated category/product routes.

---

### A4. [HIGH] Legacy `44px` Fixed-Header Top Offset Applied Below Sticky `GadzioHeader`
- **Page / Route:**
  - `/shop/iphone/accessories/cases-protection` & `/in/shop/iphone/accessories/cases-protection`
  - `/in/shop/iphone/accessories/[category-slug]` (all 5 category pages)
  - `/shop/product/[productId]`, `/shop/buy/[productId]`, `/product/[slug]`
  - `/in/shop/iphone/accessories/[category-slug]/[product-slug]`
  - `/cart`, `/bag`, `/search`, `/support`
- **Component / File:**
  - `src/components/sites/cases-protection/CasesProtectionPage.tsx:116` (`style={{ marginTop: 44 }}`)
  - `src/components/sites/accessories/AccessoryCategoryPage.tsx:70` (`style={{ marginTop: 44 }}`)
  - `src/components/shop/ProductDetailPage.tsx:183` (`className="... mt-[44px]"`)
  - `src/components/sites/accessories/AccessoryDetailPage.tsx:105` (`className="... mt-[44px]"`)
  - `src/components/cart/CartPageView.tsx:90` (`pt-[54px]`)
  - `src/components/search/SearchPageView.tsx:75` (`pt-[60px]`)
  - `src/app/support/page.tsx:53` (`pt-[52px]`)
- **Viewport:** All viewports (`375px` – `1440px`)
- **Description:**
  - The retired `GlobalNav` used `position: fixed; top: 0; height: 44px`, which required downstream content to add `margin-top: 44px` so it wouldn't be obscured.
  - The active `GadzioHeader` (`src/components/header/GadzioHeader.tsx:342`) uses `sticky top-0` (in normal document flow, occupying `96px` height on desktop and `56px` on mobile).
  - Because `marginTop: 44` / `mt-[44px]` was left in place on category sub-nav bars and product detail breadcrumb bars, there is an **unintended 44px blank white/grey gap** directly below `GadzioHeader` on every category and product detail page.
- **Recommendation:** Remove `style={{ marginTop: 44 }}` from `CasesProtectionPage.tsx:116` and `AccessoryCategoryPage.tsx:70`, remove `mt-[44px]` from `ProductDetailPage.tsx:183` and `AccessoryDetailPage.tsx:105`, and reduce the excessive top padding on `CartPageView.tsx:90`, `SearchPageView.tsx:75`, and `support/page.tsx:53`.


---

### A5. [MEDIUM] Standalone Pages Missing Global Header & Footer Navigation
- **Page / Route:** `/privacy`, `/terms`, `/auth`, `/checkout`, `/order/success`, `/order/failed`, `/order/cancelled`
- **Component / File:** `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/app/auth/page.tsx`, `src/app/checkout/page.tsx`
- **Viewport:** All viewports
- **Description:**
  - `/privacy` (`src/app/privacy/page.tsx:27–40`) and `/terms` (`src/app/terms/page.tsx:27–40`) render neither `<GadzioHeader />` nor `<GlobalFooter />`. Their only escape link at the top is `← Back to Sign In` (`href="/auth"`), even when a user clicks **Privacy Policy** or **Terms of Use** from the homepage `GlobalFooter`!
  - `/auth` (`src/app/auth/page.tsx`) has no link or logo to return to the Gadzio homepage (`/`). If a user clicks "Sign In" from the header and changes their mind, they must use the browser Back button.
- **Recommendation:** Include `<GadzioHeader />` and `<GlobalFooter />` on `/privacy` and `/terms`, and add a clickable Gadzio brand logo/home link at the top of `/auth`.

---

## B. Homepage & Hero Section Audit (`/`)

### B1. [MEDIUM] Mismatched Apple Product `alt` Text on All 5 Homepage Promo Tiles
- **Page / Route:** `/` (Homepage)
- **Component / File:** `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles.ts` (lines `257`, `319`, `381`, `443`, `505`)
- **Viewport:** All viewports (Screen Readers / SEO / Image Fallback)
- **Description:**
  - While the headlines, subheads, CTAs, and images of the 5 homepage promo tiles (`PROMO_TILES`) were updated for Gadzio accessories, their `image.img.alt` strings still describe unrelated Apple hardware from the original scrape:
    1. **Tile 0 (`Power Adapter & Cable`, line 257):** `alt: "iPad Air models floating, back exterior, single-lens camera, front exterior, rounded corners, black display bezel"`
    2. **Tile 1 (`Wired Earphones`, line 319):** `alt: "MacBook Pro positioned into the shape of a V, referencing the M5 chip family"`
    3. **Tile 2 (`Cable & Plug Case`, line 381):** `alt: "Apple Watch Series 11, rose gold color, aluminum case, sleep score, right side exterior, Digital Crown, microphone, side button, starlight Sport Band"`
    4. **Tile 3 (`Case for AirPods`, line 443):** `alt: "Two iPad Pro devices, front exterior, portrait orientation, black display bezel, display showing multicolored, curved line art..."`
    5. **Tile 4 (`Mobile Cases`, line 505):** `alt: "Side-by-side, hand holding iPhone 13 in silicon case with stickers on back exterior, trade-in with hand holding new iPhone box for iPhone 17 Pro"`
- **Recommendation:** Replace `image.img.alt` on all 5 `PROMO_TILES` in `src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles.ts` (and `src/lib/admin/defaults.ts`) with accurate descriptions of the Gadzio accessory images shown.

---

### B2. [LOW] Hero Carousel Slide 3 `"Explore All"` CTA Links to Mobile Cases Instead of All Accessories
- **Page / Route:** `/` and `/in-edu/store`
- **Component / File:** `src/components/hero/GadzioHeroSection.tsx` (lines `35–42`)
- **Viewport:** All viewports
- **Description:**
  - Slide 3 (`"Protection that speaks your style."`) renders two CTA buttons (`"Shop Cases"` and `"Explore All"`), both pointing to `/in/shop/iphone/accessories/mobile-cases`. Users clicking `"Explore All"` expect the full accessories catalog (`/shop/iphone/accessories/cases-protection`).
- **Recommendation:** Point the secondary CTA `"Explore All"` on Slide 3 to `/shop/iphone/accessories/cases-protection`.

---

## C. Category & Product Listing Pages Audit

### C1. [HIGH] Responsive Breakpoint Mismatch (`768px` Tailwind `md:block` vs `833px` CSS `@media`) on Filter Sidebar
- **Page / Route:**
  - `/shop/iphone/accessories/cases-protection` & `/in/shop/iphone/accessories/cases-protection`
  - `/in/shop/iphone/accessories/mobile-cases`, `/power-adapter-cable`, `/wired-earphones`, `/cable-plug-case`, `/airpods-case`
- **Component / File:**
  - `src/components/sites/cases-protection/CasesProtectionPage.tsx` (line `154`) & `src/app/in/shop/iphone/accessories/cases-protection/cases.css` (lines `70`, `146`, `522`)
  - `src/components/sites/accessories/AccessoryCategoryPage.tsx` (line `110`) & `src/components/sites/accessories/accessory-category.css` (lines `70`, `145`, `530`)
- **Viewport:** Tablet (`768px` – `833px`, including iPad Mini / standard `768px` tablet breakpoint)
- **Description:**
  - In `CasesProtectionPage.tsx:154` and `AccessoryCategoryPage.tsx:110`, the filter sidebar wrapper uses Tailwind's `md:` (`min-width: 768px`) utility (`<aside className={`${showMobileFilters ? 'block' : 'hidden'} md:block`}>`).
  - However, `cases.css` and `accessory-category.css` switch `.cp-main` to `flex-direction: column`, `.cp-sidebar` to `width: 100%`, and `.cp-mobile-filter-btn` to `display: inline-flex` at `@media (max-width: 833px)`.
  - **Result at `768px–833px`:** `md:block` forces the `<aside>` visible at **100% full width** stacked **above** the product grid, while the mobile **"Filters (0)"** toggle button is simultaneously rendered in the toolbar and non-functional (`md:block` overrides `hidden`).
- **Recommendation:** Replace `md:block` with `min-[834px]:block` on the sidebar container in both `CasesProtectionPage.tsx:154` and `AccessoryCategoryPage.tsx:110`.


---

### C2. [HIGH] 30 of 39 Accessory Catalog Products Missing from Global Search Registry (`src/lib/products/registry.ts`)
- **Page / Route:** `/search`, Header Search Bar (`GadzioHeader.tsx`), and `/shop/product/[productId]`
- **Component / File:** `src/lib/products/registry.ts` (lines `146–564`), `src/components/sites/accessories/data/*.ts` (5 files × 6 products = 30 products)
- **Viewport:** All viewports
- **Description:**
  - `src/lib/products/registry.ts` only registers **9 products** (`iphone-17-pro-silicone-terracotta`, `iphone-17-pro-clear-magsafe`, `iphone-17-pro-finewoven-wallet-black`, `iphone-17-silicone-denim`, `iphone-17-pro-max-techwoven-sienna`, `iphone-17-beats-rugged-orange`, `magsafe-charger-1m`, `20w-usbc-power-adapter`, `airtag-finewoven-keyring-coral`).
  - None of the **30 products** defined across `src/components/sites/accessories/data/` (`mobile-cases.ts`, `power-adapter-cable.ts`, `wired-earphones.ts`, `cable-plug-case.ts`, `airpods-case.ts`) are imported or indexed in `src/lib/products/registry.ts`.
  - **Impact:** Searching in the header search bar or `/search` for `"EarPods"`, `"Braided Cable"`, `"35W Dual USB-C"`, `"AirPods Pro"`, `"Silicone Cable Sleeve"`, `"Organizer Pouch"`, or `"Privacy Screen Protector"` returns **zero results** for those 30 products.
- **Recommendation:** Import all 5 accessory category product arrays into `src/lib/products/registry.ts` (or build a unified catalog source) so search indexes all 39 products.

---

## D. Product Detail Pages Audit

### D1. [CRITICAL] Color Swatch Selection Either Swaps Angle Photos Instead of Colors or Does Nothing
- **Page / Route:**
  - `/in/shop/iphone/accessories/[category]/[product-slug]` (`AccessoryDetailPage.tsx`)
  - `/shop/product/[productId]`, `/shop/buy/[productId]`, `/product/[slug]` (`ProductDetailPage.tsx`)
- **Component / File:**
  - `src/components/sites/accessories/AccessoryDetailPage.tsx` (lines `41–44`, `176–190`)
  - `src/components/shop/ProductDetailPage.tsx` (lines `103–109`, `144–153`, `232–245`)
- **Viewport:** All viewports
- **Description:**
  1. **Single-image products (36 of 39 products):** Every product in `src/components/sites/accessories/data/*.ts` has only 1 image in `galleryImages`. Clicking any color swatch in `AccessoryDetailPage.tsx:180` runs:
     ```ts
     onClick={() => {
       setSelectedColorIndex(idx);
       if (idx < images.length) setSelectedImage(idx);
     }}
     ```
     Because `images.length === 1`, clicking color index `1`, `2`, `3`, `4`, or `5` updates the text label (`Color - Ultramarine`), **leaves the main product image completely unchanged**, and when the user clicks **"Add to Bag"**, `addItem(product.id, 1)` (`line 67`) does **not** pass the selected color at all!
  2. **Multi-angle gallery products (e.g., `iphone-17-pro-silicone-terracotta`):** `galleryImages` contains 6 different **camera angles** of the Terracotta case (`front`, `back`, `side`, `interior`, `lifestyle`, `packaging`). Clicking the 2nd color swatch (`"Black"`) sets `selectedImage(1)`, which displays the **back angle of the Terracotta case** rather than a Black case.
  3. **`ProductDetailPage.tsx:106`:** Clicking a color swatch only calls `setSelectedColorIndex(idx)` and does not update `selectedImage` or pass the selected color into `addItem(product.id, 1)`.
- **Recommendation:** Store color-specific image sets per swatch (or map each color swatch to its variant product ID/image) and pass the selected color variant to `addItem()`.

---

### D2. [CRITICAL] Sticky Secondary Product Action Bar Hidden Behind `GadzioHeader` on Scroll
- **Page / Route:**
  - `/in/shop/iphone/accessories/[category]/[product-slug]`
  - `/shop/product/[productId]`, `/shop/buy/[productId]`, `/product/[slug]`
- **Component / File:**
  - `src/components/sites/accessories/AccessoryDetailPage.tsx` (lines `75–102`)
  - `src/components/shop/ProductDetailPage.tsx` (lines `156–180`)
- **Viewport:** Desktop (`1440px`, `1280px`, `1024px` where `GadzioHeader` height is `96px`) and Mobile (`375px`, `768px` where `GadzioHeader` height is `56px`)
- **Description:**
  - Both detail pages render a fixed secondary buy bar when scrolling past `400px` with `translate-y-[44px] z-40`.
  - Because `GadzioHeader` is `sticky top-0 z-[900]` with a height of **`96px` on desktop** (`56px` primary bar + `40px` category bar) and **`56px` on mobile**, a fixed bar at `translate-y-[44px]` (`top: 44px`, height `52px`, bottom `96px`) with `z-40` sits **100% underneath `GadzioHeader` (`z-[900]`)** on desktop and mostly underneath it on mobile!
  - Users never see the sticky product title, price, or quick "Add to Bag" button on desktop.
- **Recommendation:** Change `translate-y-[44px]` to `translate-y-[56px] min-[834px]:translate-y-[96px]` (or reference a CSS custom property for full header height).


---

### D3. [HIGH] 6 of 9 Products on `CasesProtectionPage` Link to `/shop/product/[id]` Which Renders Generic iPhone Case Copy for Non-Cases
- **Page / Route:** `/shop/product/magsafe-charger-1m`, `/shop/product/20w-usbc-power-adapter`, `/shop/product/airtag-finewoven-keyring-coral`, `/shop/product/iphone-17-pro-finewoven-wallet-black`
- **Component / File:** `src/components/shop/ProductDetailPage.tsx` (lines `115–121`, `194–227`, `325–399`, `421–426`)
- **Viewport:** All viewports
- **Description:**
  - In `src/components/sites/cases-protection/data/products.ts`, 6 of the 9 products (`magsafe-charger-1m`, `20w-usbc-power-adapter`, `airtag-finewoven-keyring-coral`, etc.) are not in `registry.ts`'s `FULL_PRODUCTS` array (`registry.ts:146–253`), so `getProductById()` synthesizes them via `fromCatalogProduct()` (`registry.ts:276–329`) and renders `ProductDetailPage.tsx`.
  - `ProductDetailPage.tsx` hardcodes iPhone Case UI onto **every** product:
    - Renders a **"Size"** dropdown (`lines 213–227`) forcing the user to pick `iPhone 17 Pro` / `iPhone 17 Pro Max` / `iPhone 17` / `iPhone 17 Air` when buying a **20W USB-C Power Adapter** or **MagSafe Charger**!
    - Renders hardcoded `"Compatibility — iPhone Models"` (`lines 115–121`), `"Built-in magnets align perfectly"` (`line 369`), and `"Drop Test: Tested across thousands of hours of engineering"` (`line 395`) on power adapters and keyrings.
- **Recommendation:** Route all products through `AccessoryDetailPage.tsx` (which respects product-specific `overview`, `highlights`, `boxItems`, and `compatibility` without forcing a phone-case size selector) or make the size selector conditional on product category.

---

## E. Cart, Checkout, Authentication & Support Audit

### E1. [CRITICAL] Currency Mismatch Between Product Pages (`$49.00` USD) and Cart / Checkout (`₹49.00` INR)
- **Page / Route:** All category & product detail pages vs `/cart`, `/bag`, and `/checkout`
- **Component / File:**
  - `src/components/sites/cases-protection/data/products.ts` (`price: '$49.00'`, `monthlyPrice: '$4.08/mo.'`)
  - `src/components/sites/accessories/data/*.ts` (`price: '$49.00'`)
  - `src/lib/cart/pricing.ts` (`lines 5–9`: `new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })`)
  - `src/lib/payu/catalog.ts` (`lines 15–19`: `parsePrice("₹4,900.00")` or `"$49.00"` → `49.00`)
- **Viewport:** All viewports
- **Description:**
  - All 39 products in `cases-protection/data/products.ts` and `accessories/data/*.ts` display prices in **US Dollars** (`$49.00`, `$19.00`, `$39.00`, `$59.00`) on category cards and product detail pages.
  - When a user adds a `$49.00` item to their bag and opens `/cart`, `/bag`, or `/checkout`, `parsePrice("$49.00")` strips the `$` sign, keeps the raw number `49`, and `formatINR(49)` formats it as **`₹49.00` (49 Indian Rupees — ~$0.58 USD)** and bills `₹49.00` through PayU!
  - Meanwhile, on `/cart` (`src/components/cart/CartPageView.tsx:287`), the "You Might Also Like" upsell grid renders `product.price` directly (`$49.00`), so the user sees `₹49.00` in the Bag summary right above `$49.00` in the recommendations on the very same page.
- **Recommendation:** Standardize all catalog `price` and `monthlyPrice` strings across `products.ts` and `accessories/data/*.ts` to INR (`₹4,900.00`, etc.) or convert currencies consistently.

---

### E2. [CRITICAL] `/auth` `"By phone"` Tab Submits Phone Number as `email` to `/api/auth/signin`, Which Always Fails
- **Page / Route:** `/auth`
- **Component / File:** `src/components/auth/AuthForm.tsx` (lines `51`, `61–62`, `141–204`) & `src/app/api/auth/signin/route.ts` (lines `14–35`)
- **Viewport:** All viewports
- **Description:**
  - `AuthForm.tsx` offers two tabs on the Sign In view (`"By email"` and `"By phone"`).
  - When the user selects `"By phone"`, enters their phone number, and submits, `handleSignInSubmit` (`lines 55–66`) sends:
    ```ts
    const identifier = signInMethod === "email" ? signInEmail : signInPhone;
    const res = await fetch("/api/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: identifier, password: signInPassword }),
    });
    ```
  - `/api/auth/signin/route.ts` (`lines 25–30`) normalizes `body.email` and queries `SELECT ... FROM users WHERE email = $1`. Because a phone number never matches an email address (and the `users` table doesn't even store phone numbers during `/api/auth/signup`), signing in via the `"By phone"` tab **always fails** with `"Invalid email or password."`
- **Recommendation:** Either remove the `"By phone"` tab from `AuthForm.tsx` until phone authentication is supported in the database/API, or add a `phone` column to `users` and support phone lookup in `/api/auth/signin`.

---

### E3. [HIGH] Non-Functional Interactive Controls Across `/cart`, `/support`, and `/auth`
- **Page / Route:** `/cart`, `/bag`, `/support`, `/auth`
- **Component / File:**
  1. `src/components/cart/CartPageView.tsx:161–169` — **"Save for later"** button has no `onClick` handler (pure no-op).
  2. `src/components/cart/CartPageView.tsx:222–237` — **Promo Code input + `"Apply"` button** has no `onClick` handler, state, or feedback message (clicking `"Apply"` does nothing).
  3. `src/app/support/page.tsx:66–81` — **"Search for topics, products, or questions..."** `<input type="search">` has no `value`, `onChange`, or `<form>` handler (typing and pressing Enter does nothing).
  4. `src/app/support/page.tsx:180–186` — **"Start Chat"** button in the Live Chat card has no `onClick` handler (clicking does nothing).
  5. `src/components/auth/AuthForm.tsx:274–308` — **"Scan with Business app"** renders a fake decorative SVG QR code on `/auth` instructing users to scan with a non-existent `"Business app"`.
- **Recommendation:** Wire up functional handlers (or remove/hide unimplemented UI elements such as the fake QR code, no-op promo code box, and dead buttons).
