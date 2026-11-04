# Phase A — customer order flow

## Step 0: observed design values (2 November 2026, before edits)

The default home uses the modern Gadzio design (the saved UI setting can select the older design). Sources: `src/app/page.tsx`, `GadzioHomePage.tsx`, `GadzioHeroSection.tsx`, `GadzioCrowdFavorites.tsx`, `globals.css`, shared header/footer.

- **Font:** Transducer, weights 400/500/600/700. Body 14–16px; commerce headings 24–36px; modern hero headings 36/48/58px with tight tracking. Do not introduce another font.
- **Colours:** black/white, primary yellow `#ffe100`, hover `#ffea33`, section grey `#e8eaee`, hero surround `#ebebe7`; body `#1d1d1f`, secondary text `#333336`/`#6e6e73`. Avoid light grey small text on white where contrast falls below AA. Existing commerce links/focus use blue `#0066cc`/`#0071e3`.
- **Spacing/container:** modern sections max 1440px, hero max 1560px; 16px mobile/32px larger gutters, commonly 40/56px section padding and 12/14px card gaps. Checkout uses a comfortable narrower content area within this system.
- **Buttons/cards:** yellow primary CTA, black bold text; existing commerce pill buttons, white rounded cards, subtle shadows and borders. Cards typically 16px radius, inputs 12px; retain visible 2px focus rings. No new visual language.
- **Header:** existing GlobalNav → GadzioHeader, sticky white navigation plus desktop strip at 834px; desktop total 96px matches `--cp-nav-height`. Do not change this coupling.
- **Footer:** GlobalFooter → GadzioFooter, black background/white text, responsive max-1440px grids. Payment methods must be neutral, without gateway branding on cart/checkout.

## Step 0: flow/storage findings

- Contact first name/email/mobile and independent shipping recipient/phone are currently duplicated. Orders store customer contact in `orders`; shipping is an immutable checkout snapshot in `order_addresses`; saved recipient/phone/lines/city/state/PIN live in `customer_addresses`. No historical data rewrite is needed.
- Validation diverges between browser, payment initiation and account addresses. Current address validation truncates PIN before checking and accepts leading zero; saved addresses are not revalidated at payment. State is free text; mobile paste handling differs; API name sanitization removes non-ASCII letters.
- Checkout is a single max-2xl card without mobile disclosure. Cart and shared footer contain gateway branding.
- All five order-result pages lack shared navigation/footer. Status defines the progress stepper and pickup placeholder. Keep actual event history.
- Current document policy exposes requested/shipped invoices before delivery. Customer receipt URL is session/ownership guarded; invoice identity must also be removed from pre-delivery document presentation. Keep dispatch-time one-time number allocation and staff/POS behavior.
- Payment prerequisite inspection found new raw-response persistence, app-clock lifecycle decisions, inconsistent integrity checks, unsigned guest summaries, missing failed/cancelled return gates, cancellation precedence and callback error recovery gaps. Repair narrowly before claiming Phase A acceptance.

## Confirmed decisions

1. Keep real-event timeline; remove result-page progress stepper and pickup placeholder.
2. Direct invoice View/Print after Delivered; no reason or approval.
3. Keep paid **Payment receipt** before delivery, never label it invoice or bill of supply.
4. Preserve existing invoice numbers and shipment-time assignment. Tax rules may require issuance at dispatch: confirm with the accountant.
5. Full documents remain account-owner-only; signed return tokens grant safe summaries only.

## Before render descriptions (source inspection, not browser captures)

| Screen | 1440px | 768px | 390px |
|---|---|---|---|
| Cart/bag | Shared navigation/footer, item list and summary, gateway-branded checkout text | Responsive cart with the same branded action | Stacked cart with branded action; guest message requires sign-in regardless of guest setting |
| Checkout | Centered max-2xl summary/form card, no site header/footer | Same single column, summary always expanded | Same single column, duplicate recipient/phone fields, free-text state |
| Success/status/failed/cancelled/processing | Standalone grey background/white centered card without shared navigation/footer | Same standalone card | Same stacked card; status includes progress text and pickup placeholder |
| Customer receipt/order documents | Existing account shell; requested or shipped bills can be shown before delivery | Responsive document/account cards | Document table may scroll internally; customer invoice metadata is not delivery-gated |

## Verification and after renders

### Implemented after renders — 2 November 2026

| Screen | 1440px | 768px | 390px |
|---|---|---|---|
| Cart/bag | Existing shared shell/list/summary; available primary action says Checkout, neutral payment methods in footer | Existing responsive layout, same neutral action | Stacked cart, guest-setting-aware help; unavailable items still block checkout |
| Checkout | Shared header/footer, max-1152px two-column grid, sticky summary left and labelled form right | Single column; total visible in collapsed summary above form | Same disclosure, one-column address fields, fixed +91 prefix; wrapping account bar |
| All five result routes | Shared max-1440px shell, max-672px white rounded card; authoritative title/reference/amount and one action group | Same card, two-column actions | 16px outer gutters, stacked full-width actions; real timeline on status only |
| Customer order/receipt | Existing account shell; Payment receipt before delivery; direct View/Print invoice only after eligible Delivered state | Same capabilities and responsive document | Same owner-only gate; item table has internal overflow wrapper; no pre-delivery invoice metadata or request form |

Checkout and populated/document result descriptions are source/static-render evidence, **not live populated browser acceptance**. Existing account order progress/delivery UI was intentionally not redesigned; removal of the stepper/placeholder is scoped to `/order/*` result pages.

### Actual verification

- Full offline `npm test`: **1,249 tests, 1,167 passed, 0 failed, 82 skipped**, 0 cancelled. All seven DB opt-ins explicitly disabled. `.tmp-phaseA-final-verified-tests.txt`. Baseline was 1,103 / 1,021 passed / 82 skipped; skips remain unverified, not passes.
- Real initiation route tests (mocked infrastructure): malformed contact/address, leading-zero/overlong PIN, unavailable/foreign saved address and legacy saved-address revalidation reject before order creation. Shared validation covers all 36 Indian regions and supported phone prefixes. Render/source tests cover disclosure, selected option/image and save retry handling; full saved-address interaction acceptance remains pending.
- Document coverage includes 1,440 customer combinations and retained 720 staff combinations inside table-driven registrations, real renderers and mocked route/service exports. These combinations are not additional top-level test counts.
- Typecheck and production builds passed; final build evidence recorded separately in FEATURES. Existing external-lockfile warning remains.
- All 110 store-admin routes, 21 account API routes / 11 dynamic account pages, and admin boundary checker passed. Settings read-only check passed: 15 settings/list tables plus staff columns; 114 notification cells.
- Legacy compatibility against the already-running configured local app passed **2/2 stored-media routes**, zero old-admin references. The separate no-DB app correctly could not resolve stored media (**0/2**); this diagnostic failure is not concealed.
- Notification checker offline: **102 template variants passed**, readiness summary **1 pass / 4 fail** (database omitted, mail driver not SMTP, SMS off, SMTP deliberately skipped). No SMTP/provider/send attempted. Added `--preview-dir` to write only into a fresh directory under `tmp`; existing previews preserved. This is not evidence of configured delivery readiness.
- Audit: **0 vulnerabilities**, `.tmp-phaseA-audit.json`.
- Browser: actual production app on 127.0.0.1:3100, `DATABASE_URL` blank; Chromium at 1440/768/390 visited cart, bag and unavailable-order result (**9 HTTP-200 cases**, header/footer, no horizontal overflow). Checkout returned 307 and redirected to auth, preserving guest-off behavior. Screenshots under `tmp/phaseA-browser-20261102/`; desktop result and mobile cart images inspected. Follow-up smoke also clicked Continue shopping at each width and reached a nonblank home page (`.tmp-phaseA-browser-actions.txt`, `tmp/phaseA-browser-actions-20261102/`). A first browser probe hit Windows console Unicode encoding after loading the page; the UTF-8 smoke rerun passed.
- No configured-database writes, migration, gateway calls, notifications, commits or staging. Historical raw payment records and invoice numbering untouched. Existing dirty tree preserved.

### Incomplete acceptance — do not mark Phase A fully complete

Real SQL document/shipping/callback suites were **not rerun for the current Phase A changes**: fresh configured-database write authorization was not provided, and continuation requested no further questions. Historical SQL work is complete for all original 80 registrations, including callback 4/4, shipping 6/6 and expanded Phase 2 15/15; separate Phase 5 evidence is 9/9. A read-only reconciliation found 79 of the current 82 offline skips match historical passing names; the nonmatches are the changed Phase 2 registration and separate Phase 4/5 registrations. See `remaing tests.md`. Earlier Phase 2 tests exercised active bill requests, not Phase A’s retired mutation; do not present historical evidence as current-source acceptance. Read-only manifest: `scripts/phase-a-test-manifest.mjs --configured-hostname`, evidence `.tmp-phaseA-sql-preapproval.json`, target host `aws-0-ap-northeast-1.pooler.supabase.com`. Proposed isolated schemas only, zero public writes/sequences, max two connections; all source-bound counts are expectations, not observed results. Regenerate and obtain fresh approval before execution; do not reuse historical approvals.

Populated checkout/mobile keyboard and saved-address retry interactions, confirmed payment result, customer/staff invoice access against real data, and real PayU test payment remain pending. No production bypass or live business order was introduced to obtain screenshots. Accountant confirmation of dispatch-time issuance remains external. Phase B evidence is recorded below; it is not fully accepted.

## Decisions taken without an answer

The three Phase A customer-document/timeline decisions were answered explicitly. For Phase B, retain the independent option-price write gate until current-source database-authoritative checkout acceptance is approved and executed. No configured-database writes, live migration/backfill or real payment is implied by broad testing permission. Saved commerce identities are archived/replaced rather than rewritten; replacement stock starts at zero and holds/history remain on the original.

# Phase B — catalogue and product admin — 3 November 2026

## Inspection and approved layout

The original Add form mixed identity, prices, metadata, publication and stock. Edit used independent save paths for copy/gallery/price/options/stock/metadata. Existing option IDs, SKU/model mappings, variant stock, holds and ledgers were present. The user confirmed Basics → Photos → Price and options → Stock → Description → Review and publish. Add now uses these six steps; Edit shows all six, jump links and a sticky coordinated Save. Advanced details remain collapsed. Browser unload and clicked outgoing links warn about drafts; browser Back/popstate is not comprehensively guarded.

## Sub-items and compatibility follow-up

- Existing sub-items load in Edit. Unsaved labels/type/model/SKU, color hex, active status, counts and per-item stock limits can be changed. The helper generates model × color/value combinations only from explicitly selected active compatible devices. Duplicate labels, including archived identities, reject before SQL.
- Saved purchasable identity changes use Archive and replace. Original ID/order/stock history is retained, replacement receives new SKU/combination identity, zero initial count and inherited product price (no copied override). No automatic transfer of reserved or parent stock.
- Compatible devices active switch reveals a searchable, brand-grouped device dropdown. It starts on for saved selections. Turning off asks before clearing selections; removing a model still used by an active sub-item rejects. Off does not claim universal compatibility. This is a draft editor switch over existing compatibility mappings, not a new persisted product-wide boolean.
- Products list links directly to colors/models and stock sections, shows sub-item count and aggregate N left/Out of stock/Not limited/Mixed stock limits/Stock setup needed. Variant counts use exact stock rows; missing rows are never unlimited. Stock writes keep strict audit/movement records and checkout holds.

## Customer rendering and pricing

Reuse the home design values above. Existing generic and accessory detail components render safe sections in saved order, omit hidden/empty sections, and use legacy fallback only for null. Short description supplies summary metadata. Existing option selectors show exact selected prices; catalog cards use From only when eligible option prices differ and link to Choose options instead of ambiguous quick-add. Server-only parent price provenance survives sale-state refresh. POS reference prices resolve options; staff-entered charges remain unchanged.

Before: legacy Overview/highlights/What's in the box blocks; parent-sale inheritance could leak into independently priced options. After: safe text/bullets/specification/FAQ blocks in existing detail styling, exact option resolver with explicit parent-default provenance. At 1440px the generic PDP is two-column gallery/details with stacked information below; 768px follows existing responsive layout; 390px stacks gallery/features/details/information/footer. Actual screenshots at tmp/phaseB-browser-20261103-final/product-{1440,768,390}.png show the existing adapter PDP, shared header/footer, yellow actions and no horizontal overflow. Desktop/mobile images inspected. This is legacy-fallback content, not persisted new structured-content or option-payment acceptance. All changed card/category/search surfaces have source/tests, not individual browser screenshots. Keyboard/focus/AA contrast acceptance remains incomplete.

## Safe content deployment and CSV

Apply existing metadata/inventory migrations 0051/0052, retain 0053, then additive 0054_product_descriptions.sql before description writes. No migration was applied in this work. Reads tolerate absent optional description columns via to_jsonb. Backfill-product-descriptions defaults to read-only dry run; apply requires source/digest/host/actor checks. No live backfill or SQL idempotence run occurred.

CSV short_description is plain text; description_sections is JSON in display order with stable IDs and text/bullets/specs/faq types. Omitted/blank preserves; literal null clears summary/restores legacy fallback; [] intentionally suppresses sections. Export uses null explicitly for round trips. Safe formatting is typed spans, never interpreted HTML; unsafe link attributes/protocols are discarded/rejected. Description validation and atomic saves audit in the caller transaction.

## Verification and remaining acceptance

- Full offline suite: 1,342 total, 1,260 passed, 0 failed, 82 skipped, 0 cancelled (.tmp-phaseB-tests-complete-20261103.txt), including seven selected-variant deduction tests and the saved-compatibility cancellation test. Database opt-ins disabled; skips are not passes. Subsequent fixture-only same-product iPhone15 sibling addition passed the 48-test focused rerun.
- Nonincremental typecheck passed (.tmp-phaseB-typecheck-complete-20261103.txt); final production build passed (.tmp-phaseB-build-complete-20261103.txt). Build retains existing workspace lockfile warning.
- 111 guarded store-admin routes; 21 account APIs/11 pages; admin boundary passed. Read-only settings: 15 settings/list tables plus staff columns, 114 notification cells. Legacy stored media 2/2 passed, zero old-admin references.
- Notification offline previews: 102 templates render, readiness 1 pass/4 fail (database omitted, mail not configured, SMS off, SMTP deliberately skipped). No sends/provider connections. npm audit: zero vulnerabilities.
- Existing PDP at 1440/768/390: HTTP 200, header/footer, no horizontal overflow/pageErrors. Protected Add redirects to login; authenticated workflow was not browser-exercised.
- Exact selected-variant follow-up: tests/selected-variant-stock.test.mjs adds seven tests invoking actual createOrderUsing, stock exports and signed callback processor with injected SQL/verifier. Focused matrix 48 passed/0 failed/0 skipped (.tmp-phaseB-selected-variant-20261103.txt). Black 10→9 at reservation; verified payment consumes without decrementing again; Blue, iPhone15 under the same product, another product and retained parent balances stay unchanged. Replay cannot duplicate deduction; cancellation release restores only the selected row once; grace holds persist; missing/empty selection rejects despite available siblings/parent. This verifies real service behavior/SQL bindings, not PostgreSQL execution, row-lock/concurrency/schema or live gateway evidence.
- Earlier full runs failed a stale workflow assertion, a normalized snapshot identity regression and a relocated stock-label assertion; fixed and covered by the passing rerun. API balance errors interrupted delegated work; user authorized retry and resumed work completed.

## Product admin clarity — UI-only follow-up, 3 November 2026

The product list now separates the main task, review filters and category totals. Product names, Edit/View product, colors/models and Set stock have a clearer hierarchy; all seven columns and existing destinations remain. Category figures are explicitly counts, not filters. Filter wording is simpler while query values and filtering remain unchanged.

Add retains the confirmed six steps; Edit retains all six sections and deep links. Larger readable labels, grouped fields, stronger help contrast and quieter technical information reduce visual density. Existing advanced settings remain accessible. Description formatting and links are secondary disclosures; plain text, unsafe-link notices and all reorder methods remain available. Existing stock warnings, publication blockers, option-identity locks and the option-price gate remain visible and unchanged.

`ProductHelp`, `ProductField` and the product-scoped `ProductGuide` use native question-mark disclosures. Help opens inline using keyboard, mouse or touch, including inside disabled viewer fieldsets. Field labels/descriptions use associated IDs; repeated rows get unique targets. Dynamic attribute help derives from configured data types and choices, without invented units. Help is presentation-only: no draft state, save request or adjacent switch change.

- Focused checks: **71 passed, 0 failed, 0 skipped**, including help, workflow payload preservation, descriptions, metadata, list stock, draft/route and selected-variant stock (`.tmp-product-ui-focused-20261103.txt`).
- Full offline suite: **1,349 total, 1,267 passed, 0 failed, 82 skipped**, 0 cancelled (`.tmp-product-ui-tests-20261103.txt`). Integration opt-ins disabled; skipped SQL tests are not passes.
- Early runs caught wording-based assertions and mixed classic/automatic JSX test-loader imports; corrected expectations and interop, without changing product state/save logic. The new ordinary-edit payload baseline initially expected omitted type rather than the existing explicit null; corrected the test to reflect existing behavior.
- Route checker: 111 store-admin routes guarded; admin boundary passed; `git diff --check` passed (`.tmp-product-ui-guards-20261103.txt`, `.tmp-product-ui-diff-20261103.txt`). No route or backend implementation changed.
- Browser verification uses a separate loopback-only server (`scripts/product-admin-ui-fixture.mjs`) and Playwright driver (`scripts/product-admin-ui-browser.py`), with actual SSR/hydrated product components and the actual list page composed with synthetic auth/data imports. It is not a public app route or auth bypass. Save requests are recorded only in browser memory; network connections and database modules are blocked. The outer admin shell uses fixture layout utilities rather than the running Next app, so this is component interaction/responsiveness evidence, not authenticated application-shell acceptance.
- Mobile list, options and description and desktop viewer-help screenshots were inspected under `tmp/product-admin-ui-20261103/`. The list retains horizontal table scrolling rather than hiding columns; canonical screenshots reset scrolling to show Product first. Existing authenticated-save/real-database/payment acceptance remains pending. Final browser matrix passed at 1440/768/390: all six Add steps, option generation, four description types, in-memory draft/edit saves, metadata/stock edits, keyboard reorder, viewer disabling/help, filters/deep links, valid unique help IDs and resolved descriptions, no nested interactive help, no help-induced dirty/save changes, table-only overflow, and reachable final publication controls/expanded Save help above the sticky footer. Zero hydration/console/page errors or external requests. Results: `tmp/product-admin-ui-20261103/results.json`. Nonincremental typecheck and production build passed (`.tmp-product-ui-typecheck-20261103.txt`, `.tmp-product-ui-build-20261103.txt`); existing external-lockfile warning remains. New help/label text colours were checked numerically: #4b5563 on white 7.56:1, #263449 on #f0f5fc 11.48:1, #334155 on white 10.35:1 and #64748b on white 4.76:1. This is not a full application AA audit. The browser bundle preceded only unreachable duplicate help-regex removal, with no markup/state difference; current-source unit/type/build checks cover that cleanup. The test-only fixture process was stopped after verification. Reproduce from the repository root with `node scripts/product-admin-ui-fixture.mjs --port 43127`, then in another terminal `python -I scripts/product-admin-ui-browser.py --port 43127`; stop only that fixture when finished.

**Not complete:** independent option-price writes/UI, editable option-price CSV and option Sale inline/bulk/clear remain gated/unbuilt. Parent-only Sale bulk scope is labelled explicitly. Real SQL atomic rollback/stock/concurrency/migration/backfill acceptance, fresh Phase B source-bound fixture manifest, authenticated Add/Edit publish and saved-content storefront roundtrip, all changed-screen visual/accessibility coverage, and real PayU test payment remain pending. Do not mark Phase B done. No configured business data writes, Education changes, Phase C work, commits or staging.
