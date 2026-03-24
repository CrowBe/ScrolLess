-- Feed Aggregator Schema
-- Idempotent — safe to run on every startup.

-- Core unified feed, populated by agent POSTs
CREATE TABLE IF NOT EXISTS feed_items (
    id              TEXT PRIMARY KEY,          -- "source:source_id"
    user_id         TEXT NOT NULL DEFAULT 'local',
    source          TEXT NOT NULL,             -- "youtube" | "x" | "news" | custom
    title           TEXT,
    author          TEXT,
    url             TEXT NOT NULL,
    url_hash        TEXT NOT NULL,             -- SHA-256 of normalised URL
    content_preview TEXT,
    thumbnail_url   TEXT,
    tags            TEXT,                      -- JSON array: '["tech","ai"]'
    is_discovery    INTEGER NOT NULL DEFAULT 0,
    published_at    TEXT NOT NULL,             -- ISO 8601
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    is_read         INTEGER NOT NULL DEFAULT 0,
    raw_json        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_url_hash ON feed_items(user_id, url_hash);
CREATE INDEX IF NOT EXISTS idx_feed_published ON feed_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_source ON feed_items(source);
CREATE INDEX IF NOT EXISTS idx_feed_read ON feed_items(is_read);
CREATE INDEX IF NOT EXISTS idx_feed_user ON feed_items(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_discovery ON feed_items(is_discovery);

-- Agent API keys (hashed)
CREATE TABLE IF NOT EXISTS agent_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'local',
    label       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_used   TEXT
);

-- Append-only sync audit trail
CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL DEFAULT 'local',
    source      TEXT NOT NULL,
    synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
    items_added INTEGER NOT NULL DEFAULT 0,
    items_duped INTEGER NOT NULL DEFAULT 0,
    error       TEXT
);

-- Web Push subscription endpoints
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL DEFAULT 'local',
    endpoint    TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Key-value preferences (agent-readable, UI-editable in production)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id     TEXT NOT NULL DEFAULT 'local',
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,                -- JSON-encoded
    PRIMARY KEY (user_id, key)
);
