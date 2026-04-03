-- Feed Aggregator Schema
-- Idempotent — safe to run on every startup.

-- Core unified feed, populated by agent POSTs
CREATE TABLE IF NOT EXISTS feed_items (
    id              TEXT PRIMARY KEY,          -- "source:source_id"
    user_id         TEXT NOT NULL DEFAULT 'local',
    source          TEXT NOT NULL,             -- "youtube" | "x" | "news" | custom
    source_type     TEXT,                      -- broad taxonomy: "video" | "social" | "news" | custom
    content_type    TEXT,                      -- specific content: "video" | "article" | "post" | custom
    card_type       TEXT,                      -- optional UI rendering hint
    title           TEXT,
    author          TEXT,
    url             TEXT NOT NULL,
    url_hash        TEXT NOT NULL,             -- SHA-256 of normalised URL
    content_preview TEXT,
    thumbnail_url   TEXT,
    tags            TEXT,                      -- JSON array: '["tech","ai"]'
    is_discovery    INTEGER NOT NULL DEFAULT 0,
    published_at    TEXT NOT NULL,             -- ISO 8601
    fetched_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    is_read         INTEGER NOT NULL DEFAULT 0,
    is_saved        INTEGER NOT NULL DEFAULT 0,
    action_label    TEXT,
    action_icon     TEXT,
    metadata_json   TEXT,
    raw_json        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_url_hash ON feed_items(user_id, url_hash);
CREATE INDEX IF NOT EXISTS idx_feed_published ON feed_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_source ON feed_items(source);
CREATE INDEX IF NOT EXISTS idx_feed_read ON feed_items(is_read);
CREATE INDEX IF NOT EXISTS idx_feed_saved ON feed_items(is_saved);
CREATE INDEX IF NOT EXISTS idx_feed_user ON feed_items(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_discovery ON feed_items(is_discovery);

-- Device registrations (edge device identity + public key)
CREATE TABLE IF NOT EXISTS device_registrations (
    user_id     TEXT PRIMARY KEY,
    public_key  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_seen   TEXT
);

-- Agent API keys (hashed)
CREATE TABLE IF NOT EXISTS agent_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'local',
    label       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used   TEXT
);

-- Append-only sync audit trail
CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL DEFAULT 'local',
    source      TEXT NOT NULL,
    synced_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    items_added INTEGER NOT NULL DEFAULT 0,
    items_duped INTEGER NOT NULL DEFAULT 0,
    error       TEXT
);

-- Edge relay sync attempts (no feed content)
CREATE TABLE IF NOT EXISTS sync_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    source       TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    item_count   INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL,  -- 'relayed' | 'device_offline' | 'error'
    error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_attempts_user ON sync_attempts(user_id, attempted_at DESC);

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

-- OAuth 2.0 clients (seeded from config.json)
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

-- OAuth 2.0 access + refresh tokens
CREATE TABLE IF NOT EXISTS oauth_tokens (
    access_token    TEXT PRIMARY KEY,
    refresh_token   TEXT UNIQUE,
    client_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    access_expires  TEXT NOT NULL,
    refresh_expires TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
