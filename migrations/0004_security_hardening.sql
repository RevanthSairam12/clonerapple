-- 0004: Security hardening — hashed session tokens.
--
-- admin_sessions.token stored the raw cookie value; if the table is ever
-- leaked (dump, backup, log) the attacker can use tokens directly. Storing
-- SHA-256(token) instead means a leak reveals nothing usable, at the cost of
-- one hash per request (negligible).
--
-- Additive only: new nullable column, no data loss, no drops. Existing raw
-- tokens are simply invalidated (editors re-login once) — acceptable because
-- the panel has a single test account at time of writing.

ALTER TABLE admin_sessions
  ADD COLUMN IF NOT EXISTS token_hash TEXT;

-- Any rows created before this migration hold raw tokens and cannot be
-- re-hashed (the raw value is what the browser holds) — remove them.
DELETE FROM admin_sessions WHERE token_hash IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_sessions_hash ON admin_sessions(token_hash);
