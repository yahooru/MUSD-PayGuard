-- MUSD PayGuard schema. Idempotent: safe to run repeatedly.
-- Every object lives in the `payguard` schema (the database is shared with other apps).

CREATE SCHEMA IF NOT EXISTS payguard;

-- A user is a wallet that proved ownership with Sign-In With Ethereum.
CREATE TABLE IF NOT EXISTS payguard.users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address        text NOT NULL UNIQUE CHECK (address ~ '^0x[0-9a-f]{40}$'),
  settings       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

-- Single-use SIWE nonces with expiry (replay protection).
CREATE TABLE IF NOT EXISTS payguard.auth_nonces (
  nonce       text PRIMARY KEY CHECK (char_length(nonce) BETWEEN 16 AND 64),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX IF NOT EXISTS auth_nonces_expires_idx ON payguard.auth_nonces (expires_at);

-- Trusted recipient book. "Saved" means the user saved it; it is not an identity verification.
CREATE TABLE IF NOT EXISTS payguard.recipients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES payguard.users(id) ON DELETE CASCADE,
  label              text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  address            text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  chain_id           integer NOT NULL,
  notes              text CHECK (notes IS NULL OR char_length(notes) <= 500),
  verification_note  text CHECK (verification_note IS NULL OR char_length(verification_note) <= 200),
  verified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chain_id, address)
);
CREATE INDEX IF NOT EXISTS recipients_user_idx ON payguard.recipients (user_id, label);

-- Payment requests (shareable via /pay/<id>).
CREATE TABLE IF NOT EXISTS payguard.payment_requests (
  id                 text PRIMARY KEY CHECK (id ~ '^pr_[A-Za-z0-9]{12,32}$'),
  creator_user_id    uuid NOT NULL REFERENCES payguard.users(id) ON DELETE CASCADE,
  creator_address    text NOT NULL CHECK (creator_address ~ '^0x[0-9a-f]{40}$'),
  recipient_address  text NOT NULL CHECK (recipient_address ~ '^0x[0-9a-f]{40}$'),
  payer_address      text CHECK (payer_address IS NULL OR payer_address ~ '^0x[0-9a-f]{40}$'),
  amount             numeric(78,0) NOT NULL CHECK (amount > 0),
  token_address      text NOT NULL,
  chain_id           integer NOT NULL,
  invoice_ref        text CHECK (invoice_ref IS NULL OR char_length(invoice_ref) <= 64),
  invoice_ref_norm   text,
  description        text CHECK (description IS NULL OR char_length(description) <= 500),
  expires_at         timestamptz,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  paid_tx_id         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- A creator cannot have two live requests with the same invoice reference.
CREATE UNIQUE INDEX IF NOT EXISTS payment_requests_ref_uniq
  ON payguard.payment_requests (creator_user_id, invoice_ref_norm)
  WHERE invoice_ref_norm IS NOT NULL AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS payment_requests_creator_idx ON payguard.payment_requests (creator_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_requests_payer_idx ON payguard.payment_requests (payer_address, created_at DESC);

-- Unsigned payment drafts. A draft is never a transaction.
CREATE TABLE IF NOT EXISTS payguard.drafts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES payguard.users(id) ON DELETE CASCADE,
  from_address              text NOT NULL CHECK (from_address ~ '^0x[0-9a-f]{40}$'),
  recipient_input           text NOT NULL CHECK (char_length(recipient_input) <= 128),
  amount                    numeric(78,0) NOT NULL CHECK (amount >= 0),
  token_address             text NOT NULL,
  chain_id                  integer NOT NULL,
  invoice_ref               text CHECK (invoice_ref IS NULL OR char_length(invoice_ref) <= 64),
  invoice_ref_norm          text,
  note                      text CHECK (note IS NULL OR char_length(note) <= 280),
  method                    text NOT NULL DEFAULT 'direct' CHECK (method IN ('direct', 'router')),
  request_id                text REFERENCES payguard.payment_requests(id) ON DELETE SET NULL,
  selected_recipient_id     uuid REFERENCES payguard.recipients(id) ON DELETE SET NULL,
  status                    text NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'reviewed', 'authorized', 'submitted', 'abandoned')),
  payload_hash              text,
  latest_assessment_id      uuid,
  acknowledgements          jsonb NOT NULL DEFAULT '[]'::jsonb,
  authorized_at             timestamptz,
  authorization_expires_at  timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drafts_user_idx ON payguard.drafts (user_id, created_at DESC);

-- Every preflight run is stored in full, so a payment can always show the checks performed before it.
CREATE TABLE IF NOT EXISTS payguard.assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id        uuid NOT NULL REFERENCES payguard.drafts(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES payguard.users(id) ON DELETE CASCADE,
  purpose         text NOT NULL DEFAULT 'review' CHECK (purpose IN ('review', 'authorize')),
  payload_hash    text NOT NULL,
  category        text NOT NULL CHECK (category IN ('low', 'caution', 'high')),
  decision        text NOT NULL CHECK (decision IN ('proceed', 'acknowledge', 'blocked')),
  engine_version  text NOT NULL,
  summary         text NOT NULL,
  result          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assessments_draft_idx ON payguard.assessments (draft_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assessments_user_idx ON payguard.assessments (user_id, created_at DESC);

-- Flattened check results for querying warnings and failures (Security Centre).
CREATE TABLE IF NOT EXISTS payguard.check_results (
  assessment_id  uuid NOT NULL REFERENCES payguard.assessments(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES payguard.users(id) ON DELETE CASCADE,
  check_id       text NOT NULL,
  status         text NOT NULL CHECK (status IN ('pass', 'warn', 'fail', 'unavailable')),
  severity       text NOT NULL,
  title          text NOT NULL,
  explanation    text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assessment_id, check_id)
);
CREATE INDEX IF NOT EXISTS check_results_user_idx ON payguard.check_results (user_id, created_at DESC) WHERE status <> 'pass';

-- Submitted on-chain transactions. tx_hash is UNIQUE: a hash can never be counted twice.
CREATE TABLE IF NOT EXISTS payguard.transactions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES payguard.users(id) ON DELETE CASCADE,
  draft_id             uuid NOT NULL UNIQUE REFERENCES payguard.drafts(id),
  tx_hash              text NOT NULL UNIQUE CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  chain_id             integer NOT NULL,
  from_address         text NOT NULL,
  recipient_address    text NOT NULL,
  token_address        text NOT NULL,
  amount               numeric(78,0) NOT NULL,
  invoice_ref          text,
  invoice_ref_norm     text,
  method               text NOT NULL CHECK (method IN ('direct', 'router')),
  request_id           text REFERENCES payguard.payment_requests(id) ON DELETE SET NULL,
  assessment_id        uuid REFERENCES payguard.assessments(id) ON DELETE SET NULL,
  risk_category        text,
  acknowledgements     jsonb NOT NULL DEFAULT '[]'::jsonb,
  gas_limit            numeric(78,0),
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'confirmed', 'failed', 'verification_delayed', 'unknown')),
  status_reason        text,
  block_number         bigint,
  block_hash           text,
  confirmations        integer,
  gas_used             numeric(78,0),
  effective_gas_price  numeric(78,0),
  verification         jsonb,
  submitted_at         timestamptz NOT NULL DEFAULT now(),
  verified_at          timestamptz,
  last_checked_at      timestamptz,
  check_attempts       integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS transactions_user_idx ON payguard.transactions (user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS transactions_ref_idx ON payguard.transactions (user_id, invoice_ref_norm);
CREATE INDEX IF NOT EXISTS transactions_open_idx ON payguard.transactions (status, last_checked_at)
  WHERE status IN ('pending', 'verification_delayed', 'unknown');

CREATE TABLE IF NOT EXISTS payguard.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES payguard.users(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON payguard.notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payguard.audit_events (
  id           bigserial PRIMARY KEY,
  user_id      uuid REFERENCES payguard.users(id) ON DELETE SET NULL,
  event        text NOT NULL,
  entity_type  text,
  entity_id    text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_user_idx ON payguard.audit_events (user_id, created_at DESC);

-- Fixed-window rate limiting for the public API.
CREATE TABLE IF NOT EXISTS payguard.rate_limits (
  bucket        text NOT NULL,
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS payguard.schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO payguard.schema_migrations (version) VALUES ('001_init') ON CONFLICT DO NOTHING;
