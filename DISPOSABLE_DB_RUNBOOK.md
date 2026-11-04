# Disposable PostgreSQL test runbook

This is documentation only. No database was provisioned, contacted or migrated while writing it. Use a new, empty disposable database, with synthetic fixture data only. Never point these commands at the live database, copy its business rows, or use its credentials.

The [84 skipped-test index](docs/phase0-skipped-tests-20261104.md) lists every registration and its reason. All 84 require a PostgreSQL **session** connection. Use a direct endpoint, or a provider's explicitly documented session pooler; transaction pooling (including port 6543) is unsuitable.

## 1. Choose one disposable target

Run commands from the repository root in a new PowerShell terminal. Do not start the application or change `.env.local`. Node/dependencies must already be installed. Install Docker Desktop or PostgreSQL/psql yourself if choosing the corresponding local option.

### A. Local Docker

Choose an unused container name and local port. This example binds only to loopback and keeps its data inside the disposable container; it does not mount any existing database volume. Enter a **new disposable** administrator password without printing it:

~~~powershell
$disposableAdminSecret = Read-Host 'New disposable PostgreSQL admin password' -AsSecureString
$disposablePasswordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($disposableAdminSecret)
try {
    $env:POSTGRES_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($disposablePasswordPtr)
    docker run --name gadzio-disposable-pg --detach --publish 127.0.0.1:55432:5432 --env POSTGRES_PASSWORD postgres:17
    if ($LASTEXITCODE -ne 0) { throw 'Disposable container setup failed; stop here.' }
} finally {
    Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($disposablePasswordPtr)
    $disposableAdminSecret.Dispose()
}
docker exec gadzio-disposable-pg pg_isready -U postgres -d postgres
docker exec -it gadzio-disposable-pg psql -U postgres -d postgres
~~~

If readiness is not yet successful, check it again before opening psql. The last command opens the disposable cluster's administrator session for the SQL in section 2. Pulling the image, creating the container and opening that session are provisioning actions requiring approval if Codex executes them.

### B. Installed PostgreSQL on Windows

Use PostgreSQL 17 (UTF-8). Prefer a dedicated local cluster/service; otherwise create the new database below in your local development cluster. Verify its host and port belong to that local service before connecting. Do not use an existing business database.

Open its maintenance database using psql, with an interactive password prompt:

~~~powershell
psql -h 127.0.0.1 -p 5432 -U postgres -d postgres -W
~~~

If psql is not on PATH, invoke its installed executable with PowerShell's `&` operator. Run section 2 in this administrator session. For this option the local test port is 5432 instead of Docker's 55432.

### C. Separate hosted PostgreSQL

Create a completely separate disposable PostgreSQL project/instance, for example a new Neon project. Do not create a schema in the live project or branch/copy its data. Choose a provider that allows an administrator to create a database and a restricted LOGIN role; use its direct endpoint, TLS and PostgreSQL 17/UTF-8.

From psql, connect using the **new project's administrator** and interactive password prompt. Host/port/login names are arguments; never put a password or a connection URL in a command:

~~~powershell
$disposableHostedHost = Read-Host 'New disposable project direct hostname'
$disposableHostedAdmin = Read-Host 'New disposable project administrator login'
$disposableHostedPort = [int](Read-Host 'Direct PostgreSQL port')
$disposableHostedBootstrapDb = Read-Host 'New project empty bootstrap database name'
$env:PGSSLMODE = 'require'
psql -h $disposableHostedHost -p $disposableHostedPort -U $disposableHostedAdmin -d $disposableHostedBootstrapDb -W
~~~

Run section 2. If the service prohibits the required role/database setup, stop and choose a provider that supports it; do not substitute a superuser/BYPASSRLS login for the tests. These instructions use ordinary hosted PostgreSQL. Supabase has real platform-owned Storage objects; do not replace them with the compatibility table below.

## 2. Create the restricted role and empty database

**Approval boundary:** identify the disposable hostname, port and database name, confirm there are no application tables/rows there, and approve creation of the following role/database. This provisioning approval is separate from migration and fixture approval.

Run this SQL in the disposable cluster's administrator psql session. Names are intentionally distinct and fixed; an already-existing role/database is a reason to stop and inspect, not overwrite it.

~~~sql
CREATE ROLE gadzio_disposable
    LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOINHERIT NOREPLICATION NOBYPASSRLS;
\password gadzio_disposable

CREATE DATABASE gadzio_phase1_disposable
    TEMPLATE template0 ENCODING 'UTF8';
GRANT CONNECT, CREATE ON DATABASE gadzio_phase1_disposable TO gadzio_disposable;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

\connect gadzio_phase1_disposable
GRANT USAGE, CREATE ON SCHEMA public TO gadzio_disposable;
~~~

`\password` prompts twice and avoids a password literal in SQL/history. The test role is not granted membership in any other role. **CREATE ON DATABASE** permits creating schemas; **CREATEDB** is a different role attribute and remains disabled. The administrator account is for provisioning, not the fixture connection.

### Plain PostgreSQL migration prerequisites

The complete migration chain references `anon`/`authenticated` in 0002 and later files, and 0007 inserts a row into Supabase's `storage.buckets`. Plain PostgreSQL lacks those objects. The role setup above supplies the policy role names.

Now connect to the **new database as gadzio_disposable**, using psql's host/port/user/database arguments and `-W` (Docker: 127.0.0.1:55432; installed Windows: your verified local port; hosted: the new direct endpoint with TLS). In this fresh ordinary PostgreSQL database only, run:

~~~sql
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
    id text PRIMARY KEY,
    name text NOT NULL,
    public boolean NOT NULL DEFAULT false
);
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
~~~

This is a minimal migration-compatibility table, owned by the restricted role. It supports 0007's bucket insert/upsert, not Supabase Storage uploads or authenticated media acceptance. It creates no devices, colours or business rows. Do not run it against platform-owned Supabase Storage or any existing storage schema. No extensions are required by the current 0001–0059 migration files.

## 3. Supply the disposable session connection safely

All later commands require explicit nonempty environment values. The migration runner and some legacy fixtures can fall back to the live `.env.local` when `DATABASE_URL` is missing; therefore **do not enable any RUN flag or run migrations before the target guard succeeds**.

Start with every database opt-in disabled:

~~~powershell
$disposableRunFlags = @(
    'RUN_LEGACY_DB_TESTS', 'RUN_PAYU_CALLBACK_INTEGRATION', 'RUN_SHIPPING_ORDER_INTEGRATION',
    'RUN_PHASE2_CATALOG_DB_TESTS', 'RUN_PHASE2_DB_TESTS', 'RUN_PHASE3_DB_TESTS',
    'RUN_PHASE4_DB_TESTS', 'RUN_PHASE5_DB_TESTS', 'RUN_SHARED_LIST_DB_TESTS', 'SHARED_LIST_RACE'
)
foreach ($disposableFlag in $disposableRunFlags) {
    Set-Item -Path ('Env:' + $disposableFlag) -Value '0'
}
~~~

Paste the **restricted role's session connection** at the hidden prompt below, not the administrator URL. It must name gadzio_phase1_disposable and gadzio_disposable. Remove provider URL query options (including sslmode); set TLS with the variables below. The shared-list fixture deliberately rejects URL query overrides.

~~~powershell
$approvedDisposableHost = Read-Host 'Exact disposable hostname to approve'
$approvedDisposablePort = [int](Read-Host 'Exact disposable session port to approve')

function Assert-DisposableConnection {
    if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) { throw 'Explicit disposable connection required.' }
    try { $disposableUri = [Uri]$env:DATABASE_URL }
    catch { throw 'Invalid disposable connection; details withheld.' }
    $disposablePort = if ($disposableUri.Port -lt 0) { 5432 } else { $disposableUri.Port }
    $disposableDatabase = [Uri]::UnescapeDataString($disposableUri.AbsolutePath.TrimStart('/'))
    $disposableRole = [Uri]::UnescapeDataString($disposableUri.UserInfo.Split(':')[0])
    if ($disposableUri.Scheme -notin @('postgres', 'postgresql') -or
        $disposableUri.Host -ne $approvedDisposableHost -or
        $disposablePort -ne $approvedDisposablePort -or $disposablePort -eq 6543 -or
        $disposableDatabase -ne 'gadzio_phase1_disposable' -or $disposableRole -ne 'gadzio_disposable' -or
        $disposableUri.Query -or $disposableUri.Fragment) {
        throw 'Disposable target mismatch; no database operation authorized.'
    }
}

$disposableConnectionSecret = Read-Host 'Paste NEW restricted-role session connection (hidden)' -AsSecureString
$disposableConnectionPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($disposableConnectionSecret)
try {
    $env:DATABASE_URL = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($disposableConnectionPtr)
    Assert-DisposableConnection
    $env:SHARED_LIST_DATABASE_URL = $env:DATABASE_URL
} catch {
    Remove-Item Env:DATABASE_URL, Env:SHARED_LIST_DATABASE_URL -ErrorAction SilentlyContinue
    throw 'Disposable connection setup failed; details withheld. Stop here.'
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($disposableConnectionPtr)
    $disposableConnectionSecret.Dispose()
}
~~~

For local Docker/Windows without TLS:

~~~powershell
$env:DATABASE_SSL = 'false'
$env:SHARED_LIST_SSL = 'disable'
~~~

For the separate hosted target:

~~~powershell
$env:DATABASE_SSL = 'true'
$env:SHARED_LIST_SSL = 'require'
~~~

`SHARED_LIST_DATABASE_URL` is dedicated: shared-list tests never fall back to `DATABASE_URL` or env files. Keep both explicitly pointed at this same disposable database. Never display these variables, run `Get-ChildItem Env:`, or commit an environment file containing them.

In your restricted-role psql session, verify:

~~~sql
SELECT current_database(), current_user, inet_server_addr(), inet_server_port(),
       current_setting('server_encoding');
SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
FROM pg_roles WHERE rolname = current_user;
SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schemas;
SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public';
~~~

Expected: the approved disposable database/role, UTF8, all five privilege flags false, can_create_schemas true, and no public application tables before migrations. Docker's server-side port is 5432 although its local client endpoint is 55432. Report names/flags/counts only.

## 4. Apply every repository migration

**Approval boundary:** approve the exact disposable hostname/database/role, the empty-public-table preflight above, the complete ordered migration file list, and writes of migration defaults/metadata plus the storage media bucket. This is not permission to seed devices or copy business data. The general migration runner has no target-approval gate of its own.

Review the complete list locally:

~~~powershell
Get-ChildItem -LiteralPath migrations -Filter '*.sql' | Sort-Object Name | Select-Object Name
~~~

Only after that migration approval, in the same guarded PowerShell terminal:

~~~powershell
Assert-DisposableConnection
node scripts/migrate.mjs
if ($LASTEXITCODE -ne 0) { throw 'Migration failed; stop and review before retrying.' }
~~~

This applies **all** SQL files in filename order (currently 57 files numbered from 0001 through 0059) and records them in schema_migrations. Do not select only 0055–0059 or skip 0007. It does not run seed scripts. Keep the database explicitly set throughout; changing a setting to an empty string re-enables loader fallback. A failed file can have partially applied DDL because this runner does not wrap a whole file plus its tracking insert in one transaction; inspect that disposable target before any retry.

In the restricted-role psql session, inspect the result without printing row contents:

~~~sql
SELECT filename FROM schema_migrations ORDER BY filename;
SELECT count(*) AS seeded_brands FROM device_brands;
SELECT count(*) AS seeded_models FROM device_models;
SELECT format('SELECT %L AS table_name, count(*) AS row_count FROM %I.%I;',
              schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
~~~

Compare migration filenames with the local list; device brand/model counts must both be zero. The count report includes intentional settings/reference defaults created by historical migrations. Review any unexpected rows before fixtures. This migrated disposable public schema is needed by the legacy tests, which clone table contracts into isolated schemas; newer manifest fixtures build their own minimal contracts.

## 5. Approve the test targets and operation manifests

| Skipped group | Registrations | Required opt-in / approval |
| --- | ---: | --- |
| Legacy DB integration | 68 | RUN_LEGACY_DB_TESTS=1; approve the 19 legacy files' disposable schema writes/cleanup |
| PayU callbacks | 4 | RUN_PAYU_CALLBACK_INTEGRATION=1; approve callback fixture schema writes |
| Shipping | 6 | RUN_SHIPPING_ORDER_INTEGRATION=1; approve shipping fixture schema writes |
| Phase 2 catalogue | 1 parent | RUN_PHASE2_CATALOG_DB_TESTS=1; PHASE2_CATALOG_APPROVED_MANIFEST |
| Phase 2 documents | 1 parent | RUN_PHASE2_DB_TESTS=1; PHASE2_APPROVED_MANIFEST |
| Phase 3 metadata | 1 parent | RUN_PHASE3_DB_TESTS=1; PHASE3_APPROVED_MANIFEST |
| Phase 4 stock | 1 parent | RUN_PHASE4_DB_TESTS=1; PHASE4_APPROVED_MANIFEST |
| Phase 5 coupons | 1 parent | RUN_PHASE5_DB_TESTS=1; PHASE5_APPROVED_MANIFEST |
| Shared lists | 1 parent | RUN_SHARED_LIST_DB_TESTS=1; SHARED_LIST_APPROVED_MANIFEST; dedicated URL and TLS policy |

The six parent tests register additional nested PostgreSQL assertions when enabled, so the resulting total will exceed the 84 formerly skipped registrations. These phase numbers refer to existing test suites, not authorization to build later product-options phases.

Generate all six **local, nonconnecting** manifests from the final checkout. Do not use --configured-hostname (which can read `.env.local`):

~~~powershell
Assert-DisposableConnection
New-Item -ItemType Directory -Path tmp/disposable-db-approval -Force | Out-Null
node tests/helpers/phase2-catalog-fixture.mjs --manifest | Out-File tmp/disposable-db-approval/phase2-catalog.json -Encoding utf8
node scripts/phase2-test-manifest.mjs | Out-File tmp/disposable-db-approval/phase2-documents.json -Encoding utf8
node scripts/phase3-test-manifest.mjs | Out-File tmp/disposable-db-approval/phase3-metadata.json -Encoding utf8
node scripts/phase4-test-manifest.mjs | Out-File tmp/disposable-db-approval/phase4-stock.json -Encoding utf8
node scripts/phase5-test-manifest.mjs | Out-File tmp/disposable-db-approval/phase5-coupons.json -Encoding utf8
node scripts/shared-list-test-manifest.mjs | Out-File tmp/disposable-db-approval/shared-lists.json -Encoding utf8
~~~

Check each command's exit code and inspect every complete JSON file. For each approval, show the hostname/port, database identity, role attributes, absent initial fixture schema, source/migration hashes, insert/update/rejection/rollback counts or bounds, sequence effects, connections and cleanup scope. The manifests already provide row operation counts/bounds. Names of manifest schemas are:

- itest_phase2_catalog_approved
- itest_phase2_documents_approved
- itest_phase3_metadata_approved
- itest_phase4_variant_stock_approved
- itest_phase5_coupon_visibility_approved
- itest_shared_lists_v1

Verify these schemas do not exist before running, and approve only their creation/fixture writes/cleanup plus the legacy suites' newly owned schemas. Existing namespaces are refused, never adopted. No live/public business writes, provider probe/send, application login or rollout is included.

**Generating a hash is not approval.** Obtain an explicit user approval naming the disposable target and each manifest's approvalSha256. Some older manifests bind hostname but not the complete database/role/TLS identity; the target guard, restricted-role preflight and explicit approval must cover those details too. Any covered source, migration, target, credential, runtime or optional-race change requires a fresh manifest and approval. Do not reuse hashes from the earlier live-target runs.

After that explicit approval, paste the six approved hashes (not credentials):

~~~powershell
$env:PHASE2_CATALOG_APPROVED_MANIFEST = Read-Host 'Approved Phase 2 catalogue SHA256'
$env:PHASE2_APPROVED_MANIFEST = Read-Host 'Approved Phase 2 documents SHA256'
$env:PHASE3_APPROVED_MANIFEST = Read-Host 'Approved Phase 3 metadata SHA256'
$env:PHASE4_APPROVED_MANIFEST = Read-Host 'Approved Phase 4 stock SHA256'
$env:PHASE5_APPROVED_MANIFEST = Read-Host 'Approved Phase 5 coupons SHA256'
$env:SHARED_LIST_APPROVED_MANIFEST = Read-Host 'Approved shared-list SHA256'
Assert-DisposableConnection
foreach ($disposableFlag in $disposableRunFlags | Where-Object { $_ -ne 'SHARED_LIST_RACE' }) {
    Set-Item -Path ('Env:' + $disposableFlag) -Value '1'
}
~~~

The three legacy opt-ins represent a separately approved write scope, not an automatic consequence of approving a shared-list manifest. Some fixtures set the application SQL seam to their isolated client; all connections must still use this disposable database.

If Codex executes these commands, normal sandbox/network execution permission is an additional gate. After a sandbox/network failure, request the exact command with require_escalated and explain the failure. A permission denial stops that action and must be reported exactly; neither a hash nor this runbook bypasses a denial.

## 6. Exact test commands

Do **not** use scripts/run-approved-legacy-tests.mjs, scripts/run-phase3-approved.mjs or scripts/run-phase5-approved.mjs for this run. They encode earlier target assumptions and/or load configured credentials. Invoke Node directly with the guarded disposable environment.

Run the 19 legacy files plus callback/shipping files serially (the individual suites still exercise their own deliberate races):

~~~powershell
Assert-DisposableConnection
$disposableLegacyFiles = @(
    'tests/coupon-db-integration.test.mjs',
    'tests/coupon-order-integration.test.mjs',
    'tests/flash-sale-reconcile-integration.test.mjs',
    'tests/flash-sale-reservation-integration.test.mjs',
    'tests/inventory-controls.test.mjs',
    'tests/late-payment-stock-integration.test.mjs',
    'tests/maintenance-integration.test.mjs',
    'tests/notifications-enqueue-integration.test.mjs',
    'tests/notifications-outbox-integration.test.mjs',
    'tests/order-cancel-stock-integration.test.mjs',
    'tests/order-stock-integration.test.mjs',
    'tests/pos-entered-prices.test.mjs',
    'tests/reports-correctness-integration.test.mjs',
    'tests/sale-admin.test.mjs',
    'tests/sale-boundary-display.test.mjs',
    'tests/sale-price-entry.test.mjs',
    'tests/sale-pricing.test.mjs',
    'tests/staff-accounts-integration.test.mjs',
    'tests/stock-behaviour.test.mjs',
    'tests/payu-callback-integration.test.mjs',
    'tests/shipping-order-integration.test.mjs'
)
node --test --test-concurrency=1 --test-reporter=spec @disposableLegacyFiles
if ($LASTEXITCODE -ne 0) { throw 'Disposable legacy/callback/shipping tests failed; stop and review.' }
~~~

Then run the six manifest-approved parent suites:

~~~powershell
Assert-DisposableConnection
node --test --test-reporter=spec tests/phase2-catalog-integration.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Phase 2 catalogue fixture failed; stop.' }
node --test --test-reporter=spec tests/phase2-documents-integration.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Phase 2 documents fixture failed; stop.' }
node --test --test-reporter=spec tests/phase3-metadata-integration.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Phase 3 metadata fixture failed; stop.' }
node --test --test-reporter=spec tests/phase4-stock-integration.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Phase 4 stock fixture failed; stop.' }
node --test --test-reporter=spec tests/phase5-coupon-integration.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Phase 5 coupon fixture failed; stop.' }
node --test --test-reporter=spec tests/shared-list-integration.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Shared-list PostgreSQL fixture failed; stop.' }
~~~

Require passed/failed/skipped/cancelled totals and actual fixture cleanup evidence. An opt-in suite that skips has not passed. On a crash, inspect the exact disposable target for leftovers; do not blindly adopt/drop an existing schema or kill a session by an unverified PID.

An optional shared-list race needs a **new separate** manifest/approval before setting SHARED_LIST_RACE=1:

~~~powershell
Assert-DisposableConnection
node scripts/shared-list-test-manifest.mjs --race
~~~

After explicitly approving that new hash and its extra writes/two connections, set SHARED_LIST_APPROVED_MANIFEST to that approved hash, SHARED_LIST_RACE=1, and run the shared-list test command above. Leave the race disabled for the default six-suite run.

For the final full-suite rerun after all these approvals:

~~~powershell
Assert-DisposableConnection
npm test
~~~

Keep the disposable environment set for that command; do not replace it with `.env.local`. Record the actual expanded totals and any remaining skips.

## 7. What this proves and cleanup

The restricted role cannot bypass RLS via a role attribute and is not a superuser. However, a table owner implicitly bypasses ordinary RLS unless FORCE ROW LEVEL SECURITY is set. The fixtures own their tables; only explicit FORCE-RLS/non-owner assertions prove enforcement in those cases. No successful fixture run alone proves authenticated application session isolation, real production privilege equivalence or provider readiness.

The shared-list fixture also compares the installed PostgreSQL NFKC/Unicode behavior against the pinned Node normalization data. Engine versions can differ. A parity failure is evidence to review before rollout, not a reason to weaken that assertion or change the target to the live database.

The tests remove only schemas they successfully created. Keep the disposable database for inspection until results and cleanup are reviewed. Close the PowerShell terminal afterward, or clear every RUN flag, approved-manifest variable and connection variable before any other work. Never leave opt-ins enabled with a missing DATABASE_URL.

Destroy the disposable container/project/database only after explicitly selecting that exact disposable resource and reviewing any evidence you want to retain. Do not issue a generic cleanup against the live cluster, an existing Docker volume, unrelated schemas or shared local services.
