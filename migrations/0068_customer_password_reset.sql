-- 0068: Customer password reset tokens, PostgreSQL auth rate limits, and
-- non-PII mail failure tracking for the Store Admin Needs-attention panel.
-- All tables ship with RLS enabled and no policies (accessed via DATABASE_URL).

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id              BIGSERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  invalidated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  request_ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
  ON password_reset_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_created
  ON password_reset_tokens (user_id, created_at DESC);

ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id          BIGSERIAL PRIMARY KEY,
  scope       TEXT NOT NULL,
  bucket_key  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_lookup
  ON auth_rate_limits (scope, bucket_key, created_at DESC);

ALTER TABLE auth_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS password_reset_mail_failures (
  id          BIGSERIAL PRIMARY KEY,
  reason      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_mail_failures_created
  ON password_reset_mail_failures (created_at DESC);

ALTER TABLE password_reset_mail_failures ENABLE ROW LEVEL SECURITY;

