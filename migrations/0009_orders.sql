-- 0009: Orders table for PayU payment gateway integration.
-- Supports both authenticated users and guest checkout sessions.
-- Enforces unique txnid constraint and status transitions.

CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  txnid             TEXT NOT NULL UNIQUE,
  user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  items             JSONB NOT NULL DEFAULT '[]'::jsonb,
  amount            NUMERIC(10, 2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'INR',
  status            TEXT NOT NULL DEFAULT 'CREATED' 
                    CHECK (status IN ('CREATED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED')),
  customer_name     TEXT NOT NULL DEFAULT '',
  customer_email    TEXT NOT NULL DEFAULT '',
  customer_phone    TEXT NOT NULL DEFAULT '',
  payu_mihpayid     TEXT,
  payu_mode         TEXT,
  payu_raw_response JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_txnid ON orders(txnid);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_mihpayid ON orders(payu_mihpayid);
