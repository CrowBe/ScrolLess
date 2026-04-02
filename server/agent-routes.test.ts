import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { insertFeedItems, cleanupOldItems, getSyncContext } from './agent-routes.js';
import type { AgentFeedPayload } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8');
  db.exec(schema);

  // Add is_saved column (migration in db.ts)
  try { db.exec('ALTER TABLE feed_items ADD COLUMN is_saved INTEGER NOT NULL DEFAULT 0'); } catch { /* exists */ }

  // Seed defaults
  db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('blocked_keywords', '[]');
  db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('max_items_per_source', '50');
  db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('retention_days', '7');
  db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`).run('youtube');
  db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`).run('x');
  db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`).run('news');

  return db;
}

describe('insertFeedItems', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('inserts items and returns correct counts', () => {
    const payload: AgentFeedPayload = {
      source: 'youtube',
      items: [
        { source_id: 'v1', title: 'Video 1', url: 'https://youtube.com/watch?v=v1', published_at: '2026-03-30T10:00:00Z' },
        { source_id: 'v2', title: 'Video 2', url: 'https://youtube.com/watch?v=v2', published_at: '2026-03-30T11:00:00Z' },
      ],
    };

    const result = insertFeedItems(db, 'local', payload);
    expect(result.inserted).toBe(2);
    expect(result.duplicates).toBe(0);
  });

  it('deduplicates items by URL hash', () => {
    const payload: AgentFeedPayload = {
      source: 'youtube',
      items: [
        { source_id: 'v1', title: 'Video 1', url: 'https://youtube.com/watch?v=v1', published_at: '2026-03-30T10:00:00Z' },
      ],
    };

    insertFeedItems(db, 'local', payload);
    const result2 = insertFeedItems(db, 'local', payload);
    expect(result2.inserted).toBe(0);
    expect(result2.duplicates).toBe(1);
  });

  it('stores discovery flag correctly', () => {
    const payload: AgentFeedPayload = {
      source: 'youtube',
      items: [
        { source_id: 'd1', title: 'Discovery', url: 'https://youtube.com/watch?v=d1', published_at: '2026-03-30T10:00:00Z', is_discovery: true },
        { source_id: 'f1', title: 'Feed', url: 'https://youtube.com/watch?v=f1', published_at: '2026-03-30T10:00:00Z', is_discovery: false },
      ],
    };

    insertFeedItems(db, 'local', payload);

    const disco = db.prepare('SELECT is_discovery FROM feed_items WHERE id = ?').get('youtube:d1') as { is_discovery: number };
    const feed = db.prepare('SELECT is_discovery FROM feed_items WHERE id = ?').get('youtube:f1') as { is_discovery: number };
    expect(disco.is_discovery).toBe(1);
    expect(feed.is_discovery).toBe(0);
  });

  it('creates sync_log entry', () => {
    const payload: AgentFeedPayload = {
      source: 'news',
      items: [
        { source_id: 'n1', title: 'Article', url: 'https://example.com/article', published_at: '2026-03-30T10:00:00Z' },
      ],
    };

    insertFeedItems(db, 'local', payload);

    const log = db.prepare('SELECT * FROM sync_log WHERE user_id = ? AND source = ?').get('local', 'news') as { items_added: number; items_duped: number };
    expect(log.items_added).toBe(1);
    expect(log.items_duped).toBe(0);
  });

  it('throws on missing required fields', () => {
    const payload: AgentFeedPayload = {
      source: 'youtube',
      items: [
        { source_id: '', title: 'Bad', url: 'https://example.com', published_at: '2026-03-30T10:00:00Z' },
      ],
    };

    expect(() => insertFeedItems(db, 'local', payload)).toThrow('source_id is required');
  });

  it('throws on invalid published_at', () => {
    const payload: AgentFeedPayload = {
      source: 'youtube',
      items: [
        { source_id: 'v1', title: 'Test', url: 'https://example.com', published_at: 'not-a-date' },
      ],
    };

    expect(() => insertFeedItems(db, 'local', payload)).toThrow('valid ISO 8601');
  });
});

describe('cleanupOldItems', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('deletes old items based on retention days', () => {
    // Insert an item with old fetched_at
    db.prepare(`INSERT INTO feed_items (id, user_id, source, title, url, url_hash, published_at, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'old:1', 'local', 'news', 'Old', 'https://old.com', 'oldhash', '2026-01-01T00:00:00Z',
      '2020-01-01T00:00:00Z' // very old
    );

    // Insert a recent item
    db.prepare(`INSERT INTO feed_items (id, user_id, source, title, url, url_hash, published_at, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'new:1', 'local', 'news', 'New', 'https://new.com', 'newhash', '2026-03-30T00:00:00Z',
      new Date().toISOString()
    );

    const result = cleanupOldItems(db, 'local', 7);
    expect(result.deletedItems).toBe(1);

    const remaining = db.prepare('SELECT id FROM feed_items WHERE user_id = ?').all('local') as Array<{ id: string }>;
    expect(remaining.map(r => r.id)).toEqual(['new:1']);
  });

  it('only deletes items for the specified user_id', () => {
    db.prepare(`INSERT INTO feed_items (id, user_id, source, title, url, url_hash, published_at, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'other:1', 'other-user', 'news', 'Other', 'https://other.com', 'otherhash', '2026-01-01T00:00:00Z',
      '2020-01-01T00:00:00Z'
    );

    const result = cleanupOldItems(db, 'local', 7);
    expect(result.deletedItems).toBe(0);

    const otherItems = db.prepare('SELECT id FROM feed_items WHERE user_id = ?').all('other-user') as Array<{ id: string }>;
    expect(otherItems.length).toBe(1);
  });

  it('cleans sync_log scoped to user_id', () => {
    db.prepare(`INSERT INTO sync_log (user_id, source, synced_at, items_added) VALUES (?, ?, ?, ?)`).run(
      'local', 'news', '2020-01-01T00:00:00Z', 5
    );
    db.prepare(`INSERT INTO sync_log (user_id, source, synced_at, items_added) VALUES (?, ?, ?, ?)`).run(
      'other-user', 'news', '2020-01-01T00:00:00Z', 3
    );

    cleanupOldItems(db, 'local', 7);

    const localLogs = db.prepare('SELECT * FROM sync_log WHERE user_id = ?').all('local');
    const otherLogs = db.prepare('SELECT * FROM sync_log WHERE user_id = ?').all('other-user');
    expect(localLogs.length).toBe(0);
    expect(otherLogs.length).toBe(1);
  });
});

describe('getSyncContext', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns disabled sources with minimal info', () => {
    const ctx = getSyncContext(db, 'local');
    const yt = ctx.sources.find(s => s.name === 'youtube');
    expect(yt).toBeDefined();
    expect(yt!.enabled).toBe(false);
    expect(yt!.urls).toBeUndefined();
  });

  it('returns enabled sources with full sync context', () => {
    db.prepare(`UPDATE user_sources SET enabled = 1, urls = ? WHERE user_id = 'local' AND name = 'youtube'`).run(
      JSON.stringify(['https://youtube.com/feed/subscriptions'])
    );

    const ctx = getSyncContext(db, 'local');
    const yt = ctx.sources.find(s => s.name === 'youtube');
    expect(yt!.enabled).toBe(true);
    expect(yt!.urls).toEqual(['https://youtube.com/feed/subscriptions']);
    expect(yt!.scraping_resource).toBe('scrolless://platforms/youtube');
  });

  it('includes blocked_keywords in filters', () => {
    db.prepare(`UPDATE user_preferences SET value = ? WHERE user_id = 'local' AND key = 'blocked_keywords'`).run(
      JSON.stringify(['sponsored', 'giveaway'])
    );

    const ctx = getSyncContext(db, 'local');
    expect(ctx.filters.blocked_keywords).toEqual(['sponsored', 'giveaway']);
  });
});
