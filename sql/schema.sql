-- ScrolLess Schema
-- Idempotent — safe to run on every startup.
-- Feed content lives on the host in content_items; readers fetch it via /api/items.

-- Device proof-of-possession challenges
CREATE TABLE IF NOT EXISTS device_challenges (
    challenge_id TEXT PRIMARY KEY,
    device_id    TEXT NOT NULL,
    public_key   TEXT NOT NULL,
    nonce        TEXT NOT NULL,
    issued_at    TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    consumed_at  TEXT
);

-- Device session tokens (short-lived, issued after challenge/verify)
CREATE TABLE IF NOT EXISTS device_sessions (
    token_hash  TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_device_sessions_device ON device_sessions(device_id, expires_at);

-- Agent API keys (hashed)
CREATE TABLE IF NOT EXISTS agent_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'local',
    label       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used   TEXT
);

-- Web Push subscription endpoints
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL DEFAULT 'local',
    endpoint    TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Key-value preferences (agent-readable, UI-editable in production)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id     TEXT NOT NULL DEFAULT 'local',
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,                -- JSON-encoded
    PRIMARY KEY (user_id, key)
);

-- User-managed content sources
CREATE TABLE IF NOT EXISTS user_sources (
    user_id         TEXT NOT NULL DEFAULT 'local',
    name            TEXT NOT NULL,                -- "youtube" | "x" | custom
    enabled         INTEGER NOT NULL DEFAULT 1,
    urls            TEXT,                         -- JSON array of URLs
    max_items       INTEGER,                      -- per-source override
    last_sync_at    TEXT,
    scraping_notes  TEXT,                         -- freeform notes appended to platform resource
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, name)
);

-- OAuth 2.0 clients (seeded from environment config)
CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id       TEXT PRIMARY KEY,
    client_secret   TEXT,                     -- NULL for public clients (PKCE only)
    redirect_uris   TEXT NOT NULL,            -- JSON array
    label           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- OAuth 2.0 authorization codes (short-lived, 10-min expiry)
CREATE TABLE IF NOT EXISTS oauth_auth_codes (
    code            TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    redirect_uri    TEXT NOT NULL,
    code_challenge  TEXT NOT NULL,            -- PKCE S256 challenge
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- OAuth 2.0 access + refresh tokens (tokens stored as SHA-256 hashes only)
CREATE TABLE IF NOT EXISTS oauth_tokens (
    access_token_hash   TEXT PRIMARY KEY,
    refresh_token_hash  TEXT UNIQUE,
    client_id           TEXT NOT NULL,
    user_id             TEXT NOT NULL,
    access_expires      TEXT NOT NULL,
    refresh_expires     TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Readable content pushed by a trusted agent over MCP (agent-push v1).
-- Identity is (user_id, source, source_id).
CREATE TABLE IF NOT EXISTS content_items (
    id                  TEXT PRIMARY KEY,             -- "ci_" + random hex
    user_id             TEXT NOT NULL DEFAULT 'local',
    source              TEXT NOT NULL,
    source_id           TEXT NOT NULL,
    url                 TEXT NOT NULL,
    url_hash            TEXT NOT NULL,                -- SHA-256 of normalised url (index only)
    title               TEXT NOT NULL,
    author              TEXT,
    content_preview     TEXT,
    body                TEXT,
    thumbnail_url       TEXT,
    content_type        TEXT,
    tags                TEXT NOT NULL DEFAULT '[]',   -- JSON array
    metadata            TEXT,                         -- JSON object of primitives
    is_discovery        INTEGER NOT NULL DEFAULT 0,
    published_at        TEXT,                         -- ISO 8601 when parseable, else NULL
    published_at_raw    TEXT,                         -- value as supplied by the agent
    sort_at             TEXT NOT NULL,                -- COALESCE(published_at, first_seen_at)
    fingerprint         TEXT NOT NULL,
    revision            INTEGER NOT NULL DEFAULT 1,
    eligibility         TEXT NOT NULL DEFAULT 'accepted', -- accepted | blocked
    eligibility_reason  TEXT,
    is_read             INTEGER NOT NULL DEFAULT 0,
    is_saved            INTEGER NOT NULL DEFAULT 0,
    state_version       INTEGER NOT NULL DEFAULT 0,
    first_seen_at       TEXT NOT NULL,
    last_seen_at        TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE (user_id, source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_content_feed ON content_items(user_id, eligibility, sort_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_content_source ON content_items(user_id, source, sort_at DESC);

-- One swipe verdict per item. Feature snapshot (source, author, type, tags)
-- feeds preference learning even if the item is later edited or removed.
-- prev_* hold the item's read/save state before the swipe so undo can restore it.
CREATE TABLE IF NOT EXISTS item_feedback (
    user_id         TEXT NOT NULL DEFAULT 'local',
    item_id         TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    verdict         TEXT NOT NULL,                -- like | dislike | save
    source          TEXT NOT NULL,
    author          TEXT,
    content_type    TEXT,
    tags            TEXT NOT NULL DEFAULT '[]',
    prev_is_read    INTEGER NOT NULL,
    prev_is_saved   INTEGER NOT NULL,
    created_at      TEXT NOT NULL,
    PRIMARY KEY (user_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON item_feedback(user_id, created_at DESC);
