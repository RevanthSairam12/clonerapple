<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Standing reminders (read every session)
- RLS IS NOT ENABLED YET on the users, user_sessions and orders tables
  (migrations 0008/0009). These tables hold customer names, emails, phones
  and PayU responses, and the publishable key ships to the browser.
  At the END OF EVERY COMPLETED TASK, the final report must end with the
  line: "REMINDER: RLS is still not enabled on users/user_sessions/orders.
  Needs its own task: test the anon role per table first, then enable."
  Keep including it until the owner says RLS is done.
- Do not enable RLS as a side effect of another task.
- Education Store is deferred to the end; do not touch it unless asked.
- Never print keys, tokens or connection strings.

## Store admin rules
- Store admins are a separate identity store: `store_admins`,
  `store_admin_sessions` and the `store_admin_session` cookie. Never reuse
  `admin_users`, `admin_sessions` or `admin_session` for store staff, and never
  let one panel's session authenticate the other.
- Roles are `store_owner` ⊇ `store_admin` ⊇ `store_viewer`. Every API route
  under `src/app/api/store-admin` must call `requireStoreRole(...)` except
  `auth/login`, which is public. Run
  `node scripts/check-store-admin-routes.mjs` after adding a route.
- Mutating store-admin requests must also call `assertSameOrigin(request)`.
- Price editing is disabled until the PayU flow reads prices from the database.
  Do not enable a price write path before that gate (design v1 §5.4 / v2 §5).
- New tables ship with `enable row level security` in the same migration file
  that creates them, with no policies unless the design explicitly adds them.
  This does not authorize enabling RLS on users/user_sessions/orders.
- Every privileged action writes a `store_admin_audit` row through
  `writeAudit()`. Never put a full email, phone, address or raw PayU response in
  `before`/`after`; never store a raw IP or user agent (hash them).
- `store_admin_audit` is append-only at the database level. Do not add UPDATE or
  DELETE paths, and do not remove the immutability trigger.
