ROLE
Senior full-stack and backend engineer in the Gadzio repo. Read FEATURES.md and the current
code first. Today there are two admin panels:
  - Store Admin (/store-admin): runs the shop. Tables store_admins, store_admin_sessions,
    cookie store_admin_session, roles store_owner > store_admin > store_viewer.
  - Legacy CMS admin (/admin): edits website design and marketing content (content_blocks,
    theme settings, TOTP security, a legacy media library). Tables admin_users,
    admin_sessions, cookie admin_session, email + password + optional TOTP.
GOAL: remove the separate /admin panel and move everything it does into Store Admin, under
a new "Website" group, using Store Admin's current design, login, roles, audit log and
help-text system. We have also made UI changes since the legacy panel was built; the merged
screens must reflect the CURRENT storefront and the CURRENT Store Admin UI.

This task is self-contained. Do not rely on earlier instructions. Never print secret values
(password hashes, TOTP secrets, tokens, keys): report counts and names only.

HOW TO WORK WITH ME (important)
- First do the read-only inventory (Phase A) and write MERGE_PLAN.md. Change no code until
  the plan is written and I have answered your questions.
- You may ask me questions whenever a decision is mine to make. Use the AskUserQuestion tool:
  up to 4 questions per call, 2 to 4 clear options each, your recommended option first and
  marked "(Recommended)". Do not ask things you can find in the code or database. Batch
  related questions. Questions I expect are listed in Phase A step 7, but ask others as they
  come up.
- If I am not available to answer, do NOT guess on anything destructive or irreversible
  (deleting tables, discarding accounts, rewriting stored content). Take the conservative
  option, record it in MERGE_PLAN.md under "Decisions taken without an answer", and carry on
  with the parts that do not depend on it.
- Commit in small reviewable steps with tests. If an API or quota error interrupts you, stop
  and tell me the exact step you reached.

HARD CONSTRAINTS
1. The storefront must look and behave exactly the same afterwards. No change to routes,
   layout, copy or styling of the customer storefront, except that nothing may break. The
   same content_blocks and theme data must keep driving it, and saved edits must still show
   up on the storefront at once (keep revalidation).
2. Do not touch the Education Store itself (/in-edu/store and its code). Its content keys
   (edu.*) are edited today in the legacy panel; what happens to that editor is my decision
   (Phase A step 7).
3. Keep the commerce boundary: the website editor must continue to reject product, price,
   stock, order, customer and shipping fields (validateLegacyContentWrite and
   check-admin-boundary.mjs must keep working at the new location, with the Education
   exemption unchanged).
4. Do not delete or rewrite stored data. Migrations are additive. content_blocks keeps its
   archive-instead-of-delete behaviour. admin_users and admin_sessions are NOT dropped in
   this task unless I explicitly approve it in a question.
5. Every new store-admin API calls requireStoreRole(...), every mutating one calls
   assertSameOrigin(request), every change writes an audit row (no secrets, no personal
   data). check-store-admin-routes.mjs must report every route guarded.
6. Keep old URLs working for bookmarks and for any stored links (see Phase B step 5).
   Anything that stored a /api/admin/media/<id> URL must keep resolving.
7. Update the maintenance-mode allow-list, the route checkers, the tests, and FEATURES.md
   for every path that moves.
8. New form fields use the shared field-help system (if it exists) so check-field-help
   passes; otherwise add plain hint text under each new field.
9. npm test, typecheck, build, all check scripts, check-admin-boundary and npm audit must
   pass at the end. Show git log --oneline and git status (clean).

======================================================================
PHASE A: INVENTORY AND PLAN (read-only)
======================================================================
1. LEGACY PANEL INVENTORY. List every page under src/app/(admin)/admin/**, every API under
   src/app/api/admin/**, every file in src/lib/admin/*, every component the panel uses, every
   script and test that references it (check-admin-boundary, validators, content tests), and
   every place the storefront or Store Admin imports from it. For each, one line: what it
   does and who depends on it.
2. DATA INVENTORY. Tables and cookies the legacy panel owns or reads/writes: admin_users,
   admin_sessions, content_blocks (including archived_at), theme settings, legacy media rows
   and store_media. Counts only: how many legacy admin users exist, how many are active, how
   many have TOTP enabled, how many share an email with a Store Admin account, how many
   content_blocks rows exist per key group, how many archived. Never print hashes or secrets.
3. CONTENT MAP. List all collections the editor offers (previously 34: apple.*, oppo.*,
   cases.*, edu.*, plus theme) with their fields and field types, which storefront component
   reads each key, and whether it is design/marketing or commerce-shaped.
4. UI CHANGES AND DRIFT. Find what changed in the UI since the legacy editor was built:
   a. git log for the legacy panel files and for the storefront components that read
      content_blocks and theme; list recent commits that changed storefront layout, copy or
      components (for example sale price display, countdown, coupon box, account dashboard,
      maintenance page, new pages).
   b. Compare editor schemas with what the storefront reads TODAY: keys and fields the
      storefront no longer reads (dead), fields the storefront reads that the editor cannot
      edit, text that is hard-coded in components but clearly marketing copy that belongs in
      the editor, and fields whose type or limits changed.
   c. Compare the legacy editor's look and components with Store Admin's current design
      system (layout shell, form fields, buttons, tables, toasts, confirm dialogs, help
      text). List what must be rebuilt in Store Admin style.
   d. If you cannot tell which "UI changes" I mean, ask me (step 7).
5. STORE ADMIN INVENTORY. Current sidebar groups and order, shell and shared components,
   role model, session and auth code, forced-password-change flow, My profile, audit log,
   the Media screen, the field-help registry, and Settings -> Content and Settings ->
   Storefront (which hold store_pages, seo_pages, login copy, maintenance).
6. OVERLAPS AND CONFLICTS. Anything that exists in both panels or twice in Store Admin:
   two media libraries (already sharing a bucket), two places for SEO (cases.seo and
   apple.* SEO in the legacy editor vs seo_pages in Settings -> Content), footer and
   business details (legacy theme copyright and logo text vs Settings -> Business), login
   copy, and site-wide text.
7. WRITE MERGE_PLAN.md in the repo root with these tables, then show me a short summary:
   - "Moves as is" / "Rebuild in Store Admin style" / "Replace with an existing Store Admin
     feature" / "Remove as dead" / "Keep for compatibility" / "Needs my decision", one row
     per item with source, target, risk and tests.
   - The proposed new Store Admin navigation (a "Website" group) and URL map.
   - The proposed account migration (legacy admin to Store Admin) with counts.
   - Risks, rollback plan (the removal of old code is a separate final commit that can be
     reverted), and the order of work.
   Then ask me the decisions. Likely questions (ask only those still open):
   a. WHO CAN EDIT THE WEBSITE: which Store Admin roles may edit website content and theme
      (recommended: store_admin and store_owner can edit; store_viewer read only; theme and
      sensitive site-wide settings owner only).
   b. LEGACY ADMIN ACCOUNTS: for each legacy admin_users row, create or link a Store Admin
      account (by matching email), with which role, and whether existing passwords carry over
      (copying the bcrypt hash lets people keep their password) or everyone gets a temporary
      password and a forced change.
   c. TOTP (two-factor): the legacy panel has optional TOTP and Store Admin has none. Add
      optional TOTP to Store Admin and migrate existing secrets, add it without migrating
      (people re-enrol), or drop it.
   d. EDUCATION CONTENT (edu.* shelves): move the editor into Website as an "Education
      Store" tab unchanged (recommended, the Education Store code itself stays untouched),
      keep a minimal legacy editor only for it, or hide it for now.
   e. OVERLAPS: for SEO, footer/business details and logo, which editor is the single source
      of truth afterwards, and whether to hide or remove the duplicate.
   f. OLD TABLES: keep admin_users and admin_sessions (recommended for now), or drop them in
      a later, separately approved migration after a backup.
   g. OLD URLS: permanent redirects from /admin/* to the new Website screens (recommended),
      or return "gone".
   h. UI CHANGES: if the "UI changes" cannot be identified from the code, which screens or
      commits do you mean, or should the merged editor simply follow the current storefront
      and current Store Admin design.
   Wait for my answers before building. Record every answer in MERGE_PLAN.md.

======================================================================
PHASE B: BUILD (after my answers)
======================================================================
1. ACCOUNTS AND ACCESS. Implement decision b and c. Add the role rule from decision a (a
   small permission helper such as canEditWebsite(role) so it is one place). Migrate legacy
   admin accounts into Store Admin in an additive, idempotent, dry-run-first script
   (scripts/migrate-legacy-admins.mjs): matches by normalized email, never overwrites an
   existing Store Admin account's password or role, reports created / linked / skipped
   counts, never prints secrets. Migrated accounts that did not keep a password get
   must_change_password. If TOTP is kept, add the columns by migration and a setup screen on
   My profile -> Security; if migrated, move secrets without exposing them.
2. WEBSITE SECTION IN STORE ADMIN. Add a "Website" sidebar group (placement after Catalog or
   Customers as makes sense, matching the existing style):
   - Website overview: which collections have saved overrides, last edited by and when,
     shortcuts. Replaces the legacy dashboard.
   - Content: list grouped by site (Home/Apple, OPPO, Cases and Protection, Education if kept)
     and an editor per collection at /store-admin/website/content/[key]. Rebuild the editor
     UI with Store Admin components: field types from the legacy schemas (text, rich text,
     link, image picker backed by the shared Media screen, lists with add/remove/reorder,
     switches), inline validation in plain words, an unsaved-changes guard, Save with a
     success toast, "Reset to defaults" (archives the override, same as today), version info
     (last edited by and when), and a "View on site" link. Keep validateLegacyContentWrite at
     the API boundary (rename if you like), archive-on-delete, and readers that ignore
     archived rows.
   - Theme at /store-admin/website/theme: same six settings (font, logo text, colours,
     copyright and the rest), live preview if cheap, saved through the same storage the root
     layout reads, with revalidation so the storefront changes at once. Owner only if so
     decided.
   - Media: reuse the existing Store Admin Media screen; the legacy upload endpoints become
     thin wrappers or are retired once nothing calls them.
   - Security: TOTP lives under My profile -> Security (per decisions c).
3. UI CHANGES APPLIED. Using the Phase A findings, update the merged editor so it matches
   the current storefront: add editor fields for copy the storefront now reads (or that we
   agreed belongs in the editor), remove fields for keys the storefront no longer reads
   (archive their stored values, never delete), and update the schemas, defaults and
   validation. List every addition and removal in MERGE_PLAN.md.
4. OVERLAPS. Apply decision e: one editor per setting, the other either removed, hidden, or
   marked "managed in <screen>" with a link. Make sure the storefront reads the single
   source.
5. COMPATIBILITY AND REDIRECTS. Implement decision g: /admin, /admin/login,
   /admin/content/[key], /admin/theme, /admin/security redirect permanently (308) to the new
   screens; if the visitor is not signed in, Store Admin's login screen handles it and sends
   them on afterwards. Old mutating API routes under /api/admin/* stop working (410 Gone with
   a plain message) EXCEPT the public read route /api/admin/media/[id] and any other route the
   storefront or stored content still calls: keep those working, source-guarded and tested.
   Search the stored content and the code for /api/admin/ URLs and report them. Stop issuing
   the admin_session cookie; sessions of the old panel simply end.
6. INFRASTRUCTURE. Update the maintenance-mode allow-list and proxy/middleware matchers,
   check-store-admin-routes, check-admin-boundary (point it at the new editor and API),
   check-field-help, the route table, and every test that referenced /admin.
7. VERIFY BEFORE REMOVING. With the new screens in place and redirects working, run the
   full test suite and a behaviour comparison: for each collection in the content map, load
   the storefront page(s) before and after a no-op save in the new editor and confirm
   identical output; save a small change, confirm it appears at once, then reset it. Confirm
   the theme round-trips. Confirm a migrated legacy admin can sign in to Store Admin.
8. REMOVE THE OLD PANEL (separate final commit, easy to revert). Delete src/app/(admin),
   the mutating src/app/api/admin routes, the legacy login/session code and any component or
   library nothing imports any more (prove it with a typecheck and a search for dangling
   imports). Keep the compatibility pieces from step 5. Do NOT drop admin_users or
   admin_sessions unless decision f says so; if it does, add a separate migration that I
   approve at that moment.
9. DOCS. Update FEATURES.md (architecture diagram now shows ONE admin identity plus the
   customer identity, the Website section, the role rules, the migration notes, the redirect
   table, the evidence block with the real final test count, route count and checks) and
   write the final "Decisions" section into MERGE_PLAN.md.

TESTS (all must be written and passing)
  - Editor: every collection saves, validates, archives on reset, rejects commerce fields at
    any depth (Education exemption unchanged), requires the right role, writes an audit row,
    and triggers storefront revalidation.
  - Storefront output is byte-for-byte or visually identical before and after a no-op save
    for every collection; theme round-trips.
  - Account migration: idempotent, no overwrite of an existing Store Admin account, counts
    correct, no secrets in output, forced password change where required, TOTP behaviour per
    decision.
  - Roles: viewer cannot save, admin can edit content, theme per decision, owner everything.
  - Redirects: every old /admin URL goes to the right new URL with a 308; old mutating APIs
    return 410; the media read route and any stored /api/admin/ URL still resolve.
  - Maintenance allow-list and the route checkers cover the new paths; no reference to the
    admin_session cookie remains.
  - Dead-code guard: no import of removed modules; typecheck clean.

DELIVERABLES
  1. MERGE_PLAN.md (Phase A) and my answers.
  2. Code in small reviewable commits: accounts and roles, Website screens, UI drift fixes,
     overlaps, redirects and compatibility, infrastructure, verification, then the separate
     removal commit, then docs.
  3. A before/after list: every old /admin URL and its new location; every removed or added
     editor field.
  4. npm test (passed, failed, skipped), typecheck, build, all check scripts, npm audit,
     git log --oneline, git status (clean).

DEFINITION OF DONE
  - There is one admin panel. Signing in at /admin sends people to Store Admin; no separate
    admin login, cookie or sessions remain.
  - Everything the legacy panel could do (content, theme, media, two-factor if kept) is in
    Store Admin under Website, in Store Admin's current design, with roles, audit, help text.
  - The storefront is unchanged and still updates the moment content or theme is saved.
  - The commerce boundary still holds, the Education Store is untouched, and old links and
    stored media URLs still work.