-- 011_api_core_compat.sql
-- Add columns expected by @puda/api-core that are missing from IntelliRAG's base schema.

-- user_account columns expected by local-auth.ts and auth-routes.ts
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS unit_id UUID;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE user_account ADD COLUMN IF NOT EXISTS last_failed_login TIMESTAMPTZ;

-- audit_event table expected by api-core audit-logger.ts (default table name)
CREATE TABLE IF NOT EXISTS audit_event (
    audit_event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type    TEXT NOT NULL DEFAULT 'unknown',
    entity_id      TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    event_type     TEXT NOT NULL,
    actor_type     TEXT NOT NULL DEFAULT 'SYSTEM_AUDIT',
    actor_id       TEXT NOT NULL,
    payload_jsonb  TEXT,
    ip_address     TEXT,
    request_id     TEXT,
    actor_role     TEXT,
    response_status INTEGER,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_event_actor ON audit_event(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_entity ON audit_event(entity_type, entity_id);

-- audit_log column expected by audit-logger.ts (kept for backward compatibility)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_type TEXT;

-- role table columns expected by api-core auth
ALTER TABLE role ADD COLUMN IF NOT EXISTS role_key TEXT;
UPDATE role SET role_key = name WHERE role_key IS NULL;

-- user_role join table expected by local-auth getUserRoles()
CREATE TABLE IF NOT EXISTS user_role (
    user_id UUID NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES role(role_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- nl_query_log table expected by nl-query-routes
CREATE TABLE IF NOT EXISTS nl_query_log (
    query_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES user_account(user_id),
    question TEXT NOT NULL,
    generated_sql TEXT,
    summary TEXT,
    citations JSONB DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'NONE',
    execution_time_ms INTEGER,
    app_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nl_query_log_user ON nl_query_log(user_id, created_at DESC);
