-- 0005: Complete the hashed-session-token migration.
--
-- 0004 added the token_hash column but left the original `token` column as a
-- NOT NULL PRIMARY KEY, so inserts that store only the hash fail with 23502.
-- The token column is no longer used (sessions are looked up by token_hash).
--
-- This swaps the primary key onto token_hash. Like 0002's policy handling
-- (drop-and-recreate, data preserved), this is additive in effect: no rows
-- or columns are lost, no application queries reference the old constraint.

-- PKs require NOT NULL, so hash first: set NOT NULL where 0004 left it nullable.
ALTER TABLE admin_sessions
  ALTER COLUMN token_hash SET NOT NULL;

-- Replace the primary key (drops old constraint `admin_sessions_pkey`).
ALTER TABLE admin_sessions
  DROP CONSTRAINT admin_sessions_pkey,
  ADD PRIMARY KEY (token_hash);

-- token is now an ordinary, unused column.
ALTER TABLE admin_sessions
  ALTER COLUMN token DROP NOT NULL;
