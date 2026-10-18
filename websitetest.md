# GADZIO — COMPLETE UI/UX AUDIT (READ-ONLY, NO CODE CHANGES)

You are acting as a senior UI/UX auditor, frontend architect, visual QA engineer, accessibility specialist, and e-commerce conversion reviewer.

Your task is to perform a thorough, evidence-based UI/UX audit of the existing Gadzio website.

**This is an inspection task, not an implementation task. Do not modify the code.**

Repository:
`C:\Users\Abcom\Documents\clon\apple-clone`

The application is built with Next.js, React, TypeScript, and Tailwind/CSS. It contains multiple storefront sections, product pages, a shopping cart, checkout, support pages, and admin interfaces.

## 1. Primary objective

Find UI and UX issues that need fixing before Gadzio launches.

I do not want a generic design critique. Inspect the actual implementation and, where possible, run the website in a browser and verify what users really see.

Identify issues such as:

- Broken or missing visual elements
- Inconsistent spacing, alignment, sizing, and typography
- Poor visual hierarchy
- Inconsistent buttons, cards, navigation, forms, and page layouts
- Overflow, clipping, overlapping elements, and unexpected whitespace
- Responsive layout problems on mobile, tablet, laptop, and desktop
- Poor readability, contrast, and accessibility
- Broken images, incorrect aspect ratios, stretched images, and placeholder graphics
- Sticky headers, dropdowns, mega-menus, dialogs, banners, and floating elements behaving incorrectly
- Inconsistent styling between pages
- Confusing navigation or unclear user actions
- Product pages that do not communicate product information effectively
- Cart and checkout layouts that may confuse or discourage customers
- Empty, loading, error, and success states that look unfinished
- Admin interfaces with inconsistent controls, labels, spacing, or previews
- Visual defects caused by CSS conflicts, responsive breakpoints, conditional rendering, or inconsistent component usage

Separate genuine defects from subjective design preferences. Do not label something a bug simply because you would have designed it differently.

## 2. Critical preservation rules

Do not edit, create, delete, move, rename, stage, unstage, commit, reset, stash, or revert any files.

Do not change the database, Supabase CMS records, environment variables, Git history, dependencies, package files, configuration, or existing content.

Do not start a redesign or implement suggested fixes.

Preserve all existing staged and unstaged changes.

Do not run destructive cleanup commands or delete `.next` while a development server may be using it.

Do not replace assets, generate images, rewrite copy, or remove routes.

If a test requires modifying application code or database state, do not perform it. Record the limitation in the report.

## 3. Respect the current design decisions

The following work is intentionally deferred. You must audit the current layout around these areas, but do not recommend deleting or replacing the assets as part of this UI-only task.

- Homepage hero images and promotional artwork
- The education-store campaign cards and sticker sprites
- Remaining SVG icons
- Education-store slogans and copy
- The `/android` route and its navigation entries
- The existing backup directory and Git history

For the deferred campaign artwork and icons, evaluate only their UI presentation: sizing, cropping, alignment, text positioning, responsive behavior, contrast, spacing, and consistency.

Do not turn this task into another copyright, trademark, asset-provenance, or repository-cleanup audit.

If you discover an asset that is missing or fails to load, report the broken reference and its visual impact. Do not replace it.

## 4. Establish the baseline before testing

Before interacting with the application:

1. Record the current branch and HEAD commit.
2. Record the existing Git status.
3. Identify which files already have staged or unstaged changes.
4. Identify the current development server and port, if one is already running.
5. Inspect `package.json` to identify the available scripts.
6. Identify the application's routes and shared layout components.
7. Identify the CSS architecture, global styles, theme variables, fonts, and responsive breakpoints.

Do not infer the baseline from previous reports alone. Inspect the current repository state.

Use the existing development server if available. Do not launch duplicate servers unnecessarily.

If the application cannot be opened in a browser, continue with static code inspection and clearly label the findings as code-derived rather than visually verified.

## 5. Audit the entire customer-facing website

Build a route inventory from the actual application. Do not assume the routes listed here are exhaustive.

Inspect every reachable customer-facing route, including relevant pages for:

- Homepage
- Main navigation and mega-menu
- Product/category listings
- Product detail pages
- Product purchase or buy flows
- Cart and bag
- Checkout
- Order success, failure, and cancellation
- Search results and empty search states
- Support and contact sections
- Privacy policy and terms
- Education store
- Accessories and cases storefronts
- `/android` and its intended navigation
- Not-found and error states
- Other routes discovered in the repository

For each route, inspect the full page, including sections below the fold. Do not audit only the first viewport.

If a route requires authentication, administrator permissions, live data, or a payment transaction, inspect what is safely accessible and document anything that could not be verified.

## 6. Inspect the actual rendered UI

When browser automation or a browser tool is available, use it to inspect the running application.

Test representative viewport sizes:

- Mobile: 360 × 800
- Mobile: 390 × 844
- Tablet: 768 × 1024
- Laptop: 1366 × 768
- Desktop: 1440 × 900
- Wide desktop: 1920 × 1080

Use the exact viewport dimensions where possible.

For each viewport, check:

- Horizontal overflow and unexpected horizontal scrolling
- Header height and navigation fit
- Logo size and placement
- Menu and dropdown positioning
- Hero height, image cropping, and text placement
- Grid column counts and card widths
- Typography wrapping and clipping
- Button dimensions and touch targets
- Content margins and maximum widths
- Footer layout
- Sticky or fixed elements covering content
- Floating controls overlapping buttons or product information
- Forms fitting within the viewport
- Modal/dialog sizing and scrolling
- Safe spacing around mobile screen edges

Do not claim to have visually tested a page or viewport unless you actually did so.

## 7. Audit design consistency

Compare repeated components across the website.

### Typography
- Heading sizes and hierarchy
- Font families and weights
- Line heights and letter spacing
- Text wrapping and truncation
- Body-text readability
- Inconsistent text styles between similar pages

### Spacing and layout
- Inconsistent section padding
- Uneven vertical rhythm
- Inconsistent content widths
- Misaligned grids and cards
- Unnecessary empty space
- Sections that are too compressed or excessively tall
- Different margins for visually equivalent components

### Components
- Primary, secondary, and destructive buttons
- Product cards and promotional tiles
- Navigation, dropdowns, and mega-menus
- Inputs, selects, checkboxes, and validation messages
- Badges, labels, prices, discounts, and availability indicators
- Accordions, tabs, carousels, and modals
- Footer links and legal information
- Loading skeletons and empty states

### Visual system
- Inconsistent colors and borders
- Inconsistent corner radii and shadows
- Inconsistent icon sizes and stroke weights
- Different styling for equivalent interactions
- Hardcoded values that cause visible inconsistency
- CSS specificity conflicts or duplicated styles that demonstrably cause UI defects

Do not recommend centralizing every style merely for code cleanliness. Focus on visible inconsistencies and meaningful maintainability problems that cause or are likely to cause UI defects.

## 8. Audit e-commerce usability

Inspect the complete customer journey without placing a real order or charging a payment method.

### Product discovery
- Is the product category clear?
- Are cards aligned and readable?
- Are product images appropriately sized?
- Are names, prices, discounts, and key features easy to scan?
- Are interactive cards and buttons distinguishable?
- Are filtering, search, and navigation understandable?

### Product details
- Is the product name clear?
- Are price and important specifications easy to find?
- Is the primary purchase action prominent?
- Are images and galleries presented consistently?
- Are compatibility details readable?
- Are shipping, returns, warranty, and other relevant details easy to locate?
- Are long descriptions structured clearly?

### Cart and checkout
- Are quantities, totals, discounts, and shipping costs understandable?
- Is it easy to edit or remove an item?
- Are empty-cart and unavailable-item states clear?
- Are form labels and required fields obvious?
- Are validation errors shown near the relevant fields?
- Are disabled, loading, and submitting states visually clear?
- Can users distinguish payment success, failure, cancellation, and pending states?
- Are important actions obscured on mobile?
- Are order summaries easy to review before payment?

Do not initiate live payments, submit real orders, alter customer records, or change server-side commerce data.

## 9. Audit accessibility and interaction

Inspect:

- Text and control contrast
- Readability at different screen sizes
- Visible keyboard focus
- Keyboard navigation and escape behavior
- Appropriate accessible names for icon-only buttons
- Labels associated with inputs
- Heading hierarchy
- Alt text where images convey meaningful information
- Touch target size
- Focus visibility in dropdowns and dialogs
- Reduced-motion behavior where animation is present
- Validation feedback that is understandable without relying only on color

Use automated accessibility checks if already available and safe to run. Supplement them with manual inspection. Do not claim WCAG compliance based solely on a quick automated scan.

## 10. Audit interaction states

Inspect each major interactive component in its relevant states:

- Default
- Hover
- Keyboard focus
- Active/pressed
- Disabled
- Loading
- Open/expanded
- Empty
- Error
- Success

Pay particular attention to:

- Navigation dropdowns
- Mega-menus
- Mobile menus
- Carousels
- Search
- Product selectors
- Add-to-cart controls
- Quantity controls
- Form validation
- Checkout buttons
- Cookie or location banners, if present
- Floating brand switcher
- Admin navigation and theme editor

If a state requires backend data that is unavailable, report it as unverified instead of fabricating a result.

## 11. Inspect admin UI separately

Inspect accessible admin screens without saving any changes.

Look for:

- Inconsistent page layouts
- Poorly aligned form fields
- Confusing labels or helper text
- Inputs that are too narrow or too wide
- Poorly organized settings
- Broken previews or image thumbnails
- Unclear save, cancel, loading, and error states
- Overflow in tables, sidebars, and editors
- Responsive issues
- Controls that appear clickable but have no visible response

Do not save changes, upload assets, modify CMS records, or alter theme settings.

If an admin screen cannot be safely accessed, record the limitation.

## 12. Investigate the cause of each confirmed issue

For every issue, record:

1. Issue ID.
2. Page or route.
3. Viewport size.
4. Component or section.
5. Actual observed behavior.
6. Expected behavior.
7. Severity.
8. Reproduction steps.
9. Evidence, such as a screenshot, browser-console error, DOM observation, or relevant source location.
10. Likely root cause, if supported by evidence.
11. Recommended fix.
12. Files likely to require modification in a later implementation phase.
13. Confidence level: confirmed, likely, or unverified.

Use exact file paths and line numbers when available. Recheck line numbers against the current repository.

If multiple symptoms have the same root cause, group them into one issue with all affected routes listed.

Do not invent screenshots, observations, source locations, or browser errors.

## 13. Prioritize findings

Use these severity definitions:

### P0 — Launch blocker
A visible defect or broken interaction that prevents customers from using a critical part of the storefront, or a severe usability/accessibility issue.

### P1 — High priority
A significant defect that damages usability, trust, navigation, or conversion, but does not completely block the primary journey.

### P2 — Medium priority
A noticeable inconsistency, responsive issue, or usability improvement that should be addressed soon.

### P3 — Polish
Minor visual refinements with limited user impact.

Do not classify subjective preferences as P0. Explain the impact behind every severity rating.

## 14. Deliverables

Create a detailed Markdown audit report outside the repository if an appropriate external output location is available. Otherwise, return the complete report in your response without creating files.

Do not create a report file inside the repository.

The report must contain:

### A. Executive summary
- Overall UI quality
- Number of confirmed issues by severity
- Most important customer-facing risks
- What prevents launch, if anything

### B. Route coverage matrix
For every discovered route, include:
- Route
- Tested or not tested
- Viewports checked
- Interaction states checked
- Result
- Reason for any testing limitation

### C. Prioritized issue register
A detailed list of every confirmed issue, with evidence and a practical fix recommendation.

### D. Responsive audit
Group findings by mobile, tablet, laptop, desktop, and wide desktop.

### E. Design consistency audit
Summarize typography, spacing, components, visual hierarchy, and style inconsistencies.

### F. E-commerce and accessibility audit
Include product discovery, product details, cart, checkout, forms, interaction states, and accessibility.

### G. Admin UI audit
Document observed problems and unverified areas.

### H. Quick wins
List safe, high-impact fixes that can be implemented independently, without redesigning the entire website.

### I. Deferred decisions
Explicitly list the hero artwork, education-store assets, SVG icons, slogans, `/android` route, and backup/history work as excluded from implementation during this audit.

### J. Final recommendation
State which issues should be fixed first and what should be retested afterward.

## 15. Final rules

- This is an audit, not a code modification task.
- No file changes.
- No Git index changes.
- No database writes.
- No real payment or order submission.
- No broad redesign recommendations without evidence.
- Preserve the existing design intent where it works.
- Prioritize actual customer-visible problems over stylistic preferences.
- Clearly distinguish observed facts, source-code findings, assumptions, and unverified issues.
- Stop after delivering the report and wait for my approval before implementing any fixes.