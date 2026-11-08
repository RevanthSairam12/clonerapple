# Production Cutover Plan — Mumbai (ap-south-1) & Vercel (bom1)

**Status:** Plan only — DO NOT EXECUTE until all prior verification stages pass.  
**Target Topology:**
- Supabase Project Region: **Mumbai, India (`ap-south-1`)**
- Vercel Function Region: **Mumbai, India (`bom1`)** (`vercel.json`)
- Source Database: Tokyo (`ap-northeast-1`, `ttzfovaadeyynggnypru`) — preserved as read-only staging/test database for at least 30 days.

---

## 1. Sequence of Cutover Steps

### Step 1: Freeze Edits to Website & Settings Pages
- Instruct staff / editors to freeze all edits to Website Overview, Content Blocks, Theme, and Store Settings on the test/staging instance.
- Inform all administrative users that migration is underway; no new categories, products, or settings should be modified until cutover completes.

### Step 2: Final Data Copy & Storage Sync
- Run `node scripts/migrate-data-to-new-project.mjs --apply` with target credentials.
- The script:
  1. Validates that the target is a distinct database from the source Tokyo project.
  2. Ensures target tables are clean prior to insert.
  3. Copies kept tables inside transactional blocks with stable IDs and timestamps.
  4. Downloads and uploads storage objects in bucket `media`, validating sizes and SHA-256 checksums.
  5. Initializes counters (`order_number_counters` from `order_prefix` and `order_start_number`, `receipt_counters`, `invoice_number_counters`).
  6. Copies selected owner staff account(s) without altering password hashes.

### Step 3: Verification (Read-Only on Both Sides)
- Run `node scripts/verify-migrated-data.mjs`.
- Confirms:
  - Exact row count parity on all kept tables.
  - Deep canonical JSON match of every `content_blocks`, `site_settings`, and `store_settings` row.
  - SHA-256 canonical hash match across all rows per table.
  - Product, option, image, and price parity.
  - Storage objects presence, file size, and checksum equality.
- Perform rendered HTML diffs and side-by-side admin UI verification.

### Step 4: Switch Vercel Environment Variables to New Project
In the Vercel Dashboard (Project Settings → Environment Variables):
- `DATABASE_URL`: Set to target Supabase Transaction Pooler URL (`aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require&supavisor_session_mode=transaction`).
- `DATABASE_MIGRATION_URL`: Set to target Supabase Session Pooler or direct connection URL (`aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require`).
- `NEXT_PUBLIC_SUPABASE_URL`: Set to target project URL (`https://<new-project-ref>.supabase.co`).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Set to target project anon/publishable key.
- `SUPABASE_SERVICE_ROLE_KEY`: Set to target project service role key.
- `APP_BASE_URL`: Ensure set to production HTTPS custom domain.
- `PAYU_ENV`, `PAYU_KEY`, `PAYU_SALT`: Configure production PayU credentials.
- `CRON_SECRET`: Generate a secure random token and configure for background reconcile cron.

### Step 5: Redeploy to Vercel (bom1)
- Verify `vercel.json` pins `"regions": ["bom1"]`.
- Trigger a production deployment on Vercel.
- Verify build succeeds: Next.js SSR functions deploy into Mumbai (`bom1`), co-located with the `ap-south-1` Supabase database. Single-statement RTT drops from ~65 ms to ~1–3 ms.

### Step 6: Production Smoke Checks
- Verify public storefront: Home, Category, Product Detail, /privacy, /terms, /support.
- Verify Store Admin login with migrated owner account.
- Verify Website Overview, Content, Theme, and Settings load identically to staging.
- Place a test purchase in PayU test or real 1-rupee production verification mode.
- Verify receipt generation, stock deduction, and order timeline.

### Step 7: Decommissioning & Retention Policy
- The old Tokyo project (`ttzfovaadeyynggnypru`) remains untouched and read-only for **at least 30 days** as a reference backup and staging database.
- **Important:** Nothing copies back or syncs again after cutover. All subsequent operational data (orders, customers, stock movements, audit logs) lives exclusively in the new Mumbai project.
