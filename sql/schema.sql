-- ScrolLess Schema
-- Idempotent — safe to run on every startup.
-- Feed content lives in IndexedDB on the device, NOT on the server.

-- Device registrations (edge device identity + public key)
CREATE TABLE IF NOT EXISTS device_registrations (
    user_id     TEXT PRIMARY KEY,
    public_key  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_seen   TEXT
);

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

-- Free-tier single-active-device rotation state (one row per user)
CREATE TABLE IF NOT EXISTS free_device_rotation (
    user_id                  TEXT PRIMARY KEY,
    active_device_id         TEXT NOT NULL,
    previous_active_device_id TEXT,
    grace_expires_at         TEXT
);

-- Agent API keys (hashed)
CREATE TABLE IF NOT EXISTS agent_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'local',
    label       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used   TEXT
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

-- Paid-tier encrypted queue, tracked per recipient device
CREATE TABLE IF NOT EXISTS paid_queue_deliveries (
    delivery_id      TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    device_id        TEXT NOT NULL,
    payload_envelope TEXT NOT NULL,
    submitted_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    acked_at         TEXT,
    expires_at       TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'queued', -- queued | delivered_unacked | acked | expired
    PRIMARY KEY (delivery_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_paid_queue_user ON paid_queue_deliveries(user_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_paid_queue_device ON paid_queue_deliveries(device_id, status);

CREATE TABLE IF NOT EXISTS paid_queue_cursor (
    user_id                TEXT PRIMARY KEY,
    last_acked_delivery_id TEXT,
    last_acked_at          TEXT
);

-- Free-tier short-lived relay queue for PWA background push constraints
CREATE TABLE IF NOT EXISTS free_queue_deliveries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          TEXT NOT NULL,
    payload_envelope TEXT NOT NULL, -- JSON encrypted relay payload
    queued_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at       TEXT NOT NULL,
    delivered_at     TEXT,
    status           TEXT NOT NULL DEFAULT 'queued' -- queued | delivered | expired
);

CREATE INDEX IF NOT EXISTS idx_free_queue_user_status ON free_queue_deliveries(user_id, status, queued_at);
