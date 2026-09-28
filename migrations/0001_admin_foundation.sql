-- 0001: Admin panel foundation — additive only.
-- Creates the content/schema storage used by the /admin panel. Does not touch
-- any pre-existing objects (the repo previously had no database at all).

-- Editor accounts. The site has no user table, so this is the auth store.
CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side sessions. Cookie holds only the opaque token.
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generic content store: one row per editable collection.
-- key example: 'apple.hero_tiles'. value is JSON; when a row is absent or
-- value is NULL the site renders its hardcoded defaults.
CREATE TABLE IF NOT EXISTS content_blocks (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- Site-wide settings: fonts, colors, logo (one row per key, scalar values).
CREATE TABLE IF NOT EXISTS site_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- Metadata for uploaded media (files live under public/uploads/admin-media).
CREATE TABLE IF NOT EXISTS media (
  id         TEXT PRIMARY KEY,
  filename   TEXT NOT NULL,
  url        TEXT NOT NULL,
  mime_type  TEXT NOT NULL,
  size       INTEGER NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_media_uploaded_at ON media(uploaded_at DESC);
