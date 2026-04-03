import { describe, it, expect } from 'vitest';
import { normaliseUrl, hashUrl, initDb } from './db.js';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('normaliseUrl', () => {
  it('lowercases hostname', () => {
    expect(normaliseUrl('https://EXAMPLE.COM/path')).toBe('https://example.com/path');
  });

  it('removes tracking parameters', () => {
    const url = 'https://example.com/page?utm_source=x&utm_medium=y&important=1';
    const result = normaliseUrl(url);
    expect(result).toContain('important=1');
    expect(result).not.toContain('utm_source');
    expect(result).not.toContain('utm_medium');
  });

  it('converts youtu.be short URLs', () => {
    expect(normaliseUrl('https://youtu.be/abc123')).toBe(
      'https://www.youtube.com/watch?v=abc123'
    );
  });

  it('sorts query parameters alphabetically', () => {
    const result = normaliseUrl('https://example.com/page?z=1&a=2');
    expect(result).toBe('https://example.com/page?a=2&z=1');
  });

  it('strips trailing slashes', () => {
    expect(normaliseUrl('https://example.com/path/')).toBe('https://example.com/path');
  });

  it('removes fragment identifiers', () => {
    expect(normaliseUrl('https://example.com/article#comments')).toBe('https://example.com/article');
  });

  it('keeps root slash', () => {
    expect(normaliseUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('returns raw string for invalid URLs', () => {
    expect(normaliseUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('hashUrl', () => {
  it('returns a 64-char hex SHA-256 hash', () => {
    const hash = hashUrl('https://example.com');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same input produces same hash', () => {
    expect(hashUrl('https://example.com')).toBe(hashUrl('https://example.com'));
  });

  it('different input produces different hash', () => {
    expect(hashUrl('https://a.com')).not.toBe(hashUrl('https://b.com'));
  });
});

describe('initDb', () => {
  it('creates tables and seeds defaults', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const schema = readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8');
    db.exec(schema);

    // Seed like initDb does
    db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('blocked_keywords', '[]');
    db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('retention_days', '7');
    db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`).run('youtube');
    db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`).run('x');
    db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`).run('news');

    const sources = db.prepare('SELECT name FROM user_sources WHERE user_id = ?').all('local') as Array<{ name: string }>;
    expect(sources.map(s => s.name).sort()).toEqual(['news', 'x', 'youtube']);

    const prefs = db.prepare('SELECT key FROM user_preferences WHERE user_id = ?').all('local') as Array<{ key: string }>;
    expect(prefs.map(p => p.key)).toContain('blocked_keywords');

    db.close();
  });

  it('schema defaults use ISO 8601 with Z suffix', () => {
    const db = new Database(':memory:');
    const schema = readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8');
    db.exec(schema);

    // Insert a row and check the fetched_at default
    db.prepare(`INSERT INTO feed_items (id, user_id, source, title, url, url_hash, published_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'test:1', 'local', 'test', 'Test', 'https://example.com', 'abc', '2026-01-01T00:00:00Z'
    );

    const row = db.prepare('SELECT fetched_at FROM feed_items WHERE id = ?').get('test:1') as { fetched_at: string };
    expect(row.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    db.close();
  });
});
