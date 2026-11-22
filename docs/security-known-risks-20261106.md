# Known security risks (Gadzio audit, 2026-11-06)

Accepted or deferred items from the audit. Each entry says what the risk is, why
it was not fixed now, and what would close it.

## L-9 — Expense receipts live in the public `media` bucket (remediated in SEC-005)

**Risk.** Expense receipts previously shared the `store_media` pipeline and public
Supabase Storage `media` bucket, so anyone holding the CDN object URL could read
a receipt without a Store Admin session.

**Remediation (SEC-005).**
- Added private bucket support (`expense-receipts`) and `bucket` column on
  `store_media` in `migrations/0075_private_expense_receipts.sql`, preserving
  public `media` bucket access for product images.
- Added dedicated upload route `POST /api/store-admin/expenses/receipts`
  storing receipts strictly in `expense-receipts` with `url = ''` and
  `Cache-Control: private, no-store` (supporting raster images, videos, and
  sniffed `%PDF-` documents).
- Added authenticated download route `GET /api/store-admin/expenses/[id]/receipt`
  requiring `requireStoreRole('store_admin')`, distributed rate limiting,
  short-lived (60s) signed URLs, `Cache-Control: private, no-store`, and
  `store_admin_audit` logging without leaking signed URLs.
- Hardened `GET /api/media/[id]` and `listMedia()` so private-bucket objects and
  expense attachments return `404` and stay hidden from the public media library.
- Existing legacy receipts in `media` must be migrated with
  `node scripts/migrate-receipts-to-private.mjs --apply` after creating the
  private `expense-receipts` bucket in Supabase Storage.

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
