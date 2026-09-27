CREATE TABLE owner_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_handle BLOB NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
);
CREATE TABLE owner_credentials (
    id TEXT PRIMARY KEY,
    credential_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE owner_sessions (
    token_hash TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('owner', 'recovery')),
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE owner_challenges (
    token_hash TEXT PRIMARY KEY,
    purpose TEXT NOT NULL,
    session_json TEXT NOT NULL,
    grant_hash TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL
);
CREATE TABLE owner_recovery_codes (
    code_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
);
CREATE TABLE owner_auth_limits (
    bucket TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL
);
