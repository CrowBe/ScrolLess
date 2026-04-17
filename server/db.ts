import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? join(__dirname, '../data/scrolless.db');

  const dir = dirname(resolvedPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(resolvedPath);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Execute schema
  const schema = readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8');
  db.exec(schema);

  // One-time destructive migrations — idempotent (IF EXISTS is a no-op when table is gone)
  // feed_items must not exist on the server (content lives in device IndexedDB only)
  db.exec(`DROP TABLE IF EXISTS feed_items`);
  db.exec(`DROP INDEX IF EXISTS idx_feed_url_hash`);
  db.exec(`DROP INDEX IF EXISTS idx_feed_published`);
  db.exec(`DROP INDEX IF EXISTS idx_feed_source`);
  db.exec(`DROP INDEX IF EXISTS idx_feed_read`);
  db.exec(`DROP INDEX IF EXISTS idx_feed_saved`);
  db.exec(`DROP INDEX IF EXISTS idx_feed_user`);
  db.exec(`DROP INDEX IF EXISTS idx_feed_discovery`);
  // sync_log superseded by sync_attempts
  db.exec(`DROP TABLE IF EXISTS sync_log`);

  // Migrate free_device_rotation: scope_id singleton → user_id-keyed per-user table
  const fdrCols = (db.prepare(
    `SELECT name FROM pragma_table_info('free_device_rotation')`
  ).all() as { name: string }[]).map(c => c.name);
  if (fdrCols.includes('scope_id')) {
    const oldRow = db.prepare(
      `SELECT active_device_id, previous_active_device_id, grace_expires_at FROM free_device_rotation WHERE scope_id = 1`
    ).get() as { active_device_id: string; previous_active_device_id: string | null; grace_expires_at: string | null } | undefined;
    db.exec(`DROP TABLE free_device_rotation`);
    db.exec(`
      CREATE TABLE free_device_rotation (
        user_id                   TEXT PRIMARY KEY,
        active_device_id          TEXT NOT NULL,
        previous_active_device_id TEXT,
        grace_expires_at          TEXT
      )
    `);
    if (oldRow) {
      db.prepare(
        `INSERT INTO free_device_rotation (user_id, active_device_id, previous_active_device_id, grace_expires_at) VALUES ('local', ?, ?, ?)`
      ).run(oldRow.active_device_id, oldRow.previous_active_device_id ?? null, oldRow.grace_expires_at ?? null);
    }
  }

  // Migrate oauth_tokens: plaintext access_token/refresh_token → hashed columns
  const oauthCols = (db.prepare(
    `SELECT name FROM pragma_table_info('oauth_tokens')`
  ).all() as { name: string }[]).map(c => c.name);
  if (oauthCols.includes('access_token')) {
    const oldRows = db.prepare(
      `SELECT access_token, refresh_token, client_id, user_id, access_expires, refresh_expires, created_at FROM oauth_tokens`
    ).all() as Array<{
      access_token: string; refresh_token: string | null;
      client_id: string; user_id: string;
      access_expires: string; refresh_expires: string | null; created_at: string;
    }>;
    db.exec(`DROP TABLE oauth_tokens`);
    db.exec(`
      CREATE TABLE oauth_tokens (
        access_token_hash   TEXT PRIMARY KEY,
        refresh_token_hash  TEXT UNIQUE,
        client_id           TEXT NOT NULL,
        user_id             TEXT NOT NULL,
        access_expires      TEXT NOT NULL,
        refresh_expires     TEXT,
        created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )
    `);
    const ins = db.prepare(
      `INSERT OR IGNORE INTO oauth_tokens (access_token_hash, refresh_token_hash, client_id, user_id, access_expires, refresh_expires, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const migrate = db.transaction(() => {
      for (const row of oldRows) {
        const aHash = createHash('sha256').update(row.access_token).digest('hex');
        const rHash = row.refresh_token
          ? createHash('sha256').update(row.refresh_token).digest('hex')
          : null;
        ins.run(aHash, rHash, row.client_id, row.user_id, row.access_expires, row.refresh_expires ?? null, row.created_at);
      }
    });
    migrate();
  }

  // Idempotent migrations for columns added after initial schema
  try {
    db.exec(`ALTER TABLE user_sources ADD COLUMN scraping_notes TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec(`ALTER TABLE user_sources ADD COLUMN last_sync_at TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }

  // Seed default user_preferences if not present
  const seedPref = db.prepare(
    `INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`
  );
  const seedSource = db.prepare(
    `INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`
  );
  const seedAll = db.transaction(() => {
    seedPref.run('blocked_keywords', JSON.stringify([]));
    seedPref.run('max_items_per_source', JSON.stringify(50));
    seedPref.run('retention_days', JSON.stringify(7));
    seedSource.run('youtube');
    seedSource.run('x');
    seedSource.run('news');
  });
  seedAll();

  return db;
}

export function normaliseUrl(raw: string): string {
  try {
    const url = new URL(raw);

    // Lowercase hostname
    url.hostname = url.hostname.toLowerCase();

    // Convert youtu.be short links
    if (url.hostname === 'youtu.be') {
      const videoId = url.pathname.slice(1);
      url.hostname = 'www.youtube.com';
      url.pathname = '/watch';
      url.search = '';
      url.searchParams.set('v', videoId);
    }

    // Remove tracking parameters
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      's', 'ref', 'feature',
    ];
    for (const param of trackingParams) {
      url.searchParams.delete(param);
    }

    // Sort remaining query params alphabetically
    url.searchParams.sort();

    // Strip fragment identifiers (same resource, different in-page anchor)
    url.hash = '';

    // Strip trailing slash from pathname (but keep root /)
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }

    return url.toString();
  } catch {
    return raw;
  }
}

export function hashUrl(url: string): string {
  return createHash('sha256').update(url).digest('hex');
}
