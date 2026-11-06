# Known security risks (Gadzio audit, 2026-11-06)

Accepted or deferred items from the audit. Each entry says what the risk is, why
it was not fixed now, and what would close it.

## L-9 — Expense receipts live in the public `media` bucket (accepted for now)

**Risk.** Expense receipts are uploaded through the media library and stored as
`store_media` rows in the public Supabase Storage `media` bucket. The object URL
is public and unguessable-ish (uuid path) but not authenticated: anyone who
obtains the URL can fetch the receipt without a store-admin session. Receipts
can contain supplier names, amounts and bank or card fragments — financial data
that belongs to the store, not to the internet.

**Why it is not fixed now.** Receipts share the `media` bucket with product
photographs, which must stay public for the storefront. Splitting them means a
private bucket, a signed-URL read path in the expense detail page, and a
one-time move of existing objects — a storage migration, deliberately out of
scope for a code-only remediation pass.

**Interim controls.**
- The URL is only rendered in the store-admin expense pages (staff session +
  `requireStoreRole`), never sent to the storefront API.
- The media library is staff-only; the bucket cannot be listed with the public
  key (only known paths resolve).
- Archiving the media row now deletes the object (L-8), so removing a receipt
  from the library does end its public availability.

**What would close it.** A private `expense-receipts` bucket, uploads routed
there for `attachment_media_id`, and signed-URL downloads issued per request
after the role check. Track as its own migration + storage move.

## Informational findings (no code change)

- **I-1** The application connects with the table-owner role over
  `DATABASE_URL`, which bypasses RLS. RLS is therefore a boundary against the
  Supabase API roles only; every app query must scope by user or role itself.
  Accepted while the app is the only tenant of that connection.
- **I-3** Some CMS tables (`content_blocks` and neighbours) use `using (true)`
  policies: their content is public by design. Kept, but noted so nobody copies
  the policy onto a table holding personal data.
- **I-4** A few older migrations enable RLS in a later file than the one that
  creates the table. New tables follow the rule (RLS in the creating file);
  old files were not edited because applied migrations stay immutable.
- **I-6** Viewer-role staff can see staff and customer names in list pages.
  Names are needed to work the order queue; email and phone are masked
  (M-1/H-2). Revisit if the viewer role is ever given to a party outside the
  store.
- **I-7** `scripts/check-store-admin-routes.mjs` proves a route calls
  `requireStoreRole`, not which role. The role itself is asserted in each
  route's tests (H-3 owner-only mail settings and lists, M-1 customer reveal,
  the role-matrix test).
