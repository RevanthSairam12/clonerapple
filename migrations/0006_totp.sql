-- 0006: TOTP two-factor authentication for the admin panel.

-- Per-editor TOTP secrets. totp_secret holds the base32 secret (only set
-- once the editor completes enrollment); totp_enabled flips to true only
-- after the editor proves the authenticator works by submitting a valid
-- code. A one-time recovery code (bcrypt-hashed like a password) lets the
-- editor back in if they lose their device.
--
-- Additive only: two nullable columns, no drops, no data changes.

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS totp_secret TEXT,
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recovery_hash TEXT;
