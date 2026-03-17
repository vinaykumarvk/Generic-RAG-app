-- 010_auth_session.sql
-- Auth session tables referenced by api-core auth middleware.
-- Creates: auth_token_denylist, auth_session_activity, idempotency_cache
-- Adds: tokens_revoked_before column to user_account

-- Token denylist for JWT revocation
CREATE TABLE IF NOT EXISTS auth_token_denylist (
    jti             TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_denylist_expires ON auth_token_denylist(expires_at);
CREATE INDEX IF NOT EXISTS idx_token_denylist_user ON auth_token_denylist(user_id);

-- Session activity tracking for inactivity timeout
CREATE TABLE IF NOT EXISTS auth_session_activity (
    jti             TEXT PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_activity_user ON auth_session_activity(user_id);

-- Idempotency cache for mutation deduplication
CREATE TABLE IF NOT EXISTS idempotency_cache (
    idempotency_key TEXT PRIMARY KEY,
    user_id         UUID NOT NULL,
    method          TEXT NOT NULL,
    path            TEXT NOT NULL,
    status_code     INTEGER,
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_cache(expires_at);

-- Add tokens_revoked_before to user_account if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'user_account' AND column_name = 'tokens_revoked_before'
    ) THEN
        ALTER TABLE user_account ADD COLUMN tokens_revoked_before TIMESTAMPTZ;
    END IF;
END $$;
