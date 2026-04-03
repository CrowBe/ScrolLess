import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath = (dbPath ?? '~/.feed-aggregator/feed.db').replace(
    /^~/,
    homedir()
  );

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

  // Idempotent migrations for columns added after initial schema
  try {
    db.exec(`ALTER TABLE user_sources ADD COLUMN scraping_notes TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    db.exec(`ALTER TABLE feed_items ADD COLUMN is_saved INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }
  const feedColumns = [
    'source_type TEXT',
    'content_type TEXT',
    'card_type TEXT',
    'action_label TEXT',
    'action_icon TEXT',
    'metadata_json TEXT',
  ];
  for (const column of feedColumns) {
    try {
      db.exec(`ALTER TABLE feed_items ADD COLUMN ${column}`);
    } catch {
      // Column already exists — safe to ignore
    }
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
