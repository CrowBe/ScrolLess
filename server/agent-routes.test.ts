import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cleanupGlobal, getSyncContext } from './agent-routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8');
  db.exec(schema);

  db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('blocked_keywords', '[]');
  db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('max_items_per_source', '50');
  db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('retention_days', '7');
  db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`).run('youtube');
  db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`).run('x');
  db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', ?, 0)`).run('news');

  return db;
}

describe('cleanupGlobal', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('deletes old sync attempts (global, 30-day retention)', () => {
    // Old row: will be deleted
    db.prepare(`INSERT INTO sync_attempts (user_id, source, attempted_at, item_count, status)
      VALUES (?, ?, ?, ?, ?)`).run(
      'local', 'news', '2020-01-01T00:00:00Z', 1, 'device_offline'
    );
    // Recent row: kept
    db.prepare(`INSERT INTO sync_attempts (user_id, source, attempted_at, item_count, status)
      VALUES (?, ?, datetime('now'), ?, ?)`).run(
      'local', 'news', 1, 'relayed'
    );

    cleanupGlobal(db);

    const remaining = db.prepare('SELECT id FROM sync_attempts').all();
    expect(remaining).toHaveLength(1);
  });

  it('deletes old sync_attempts across all users (global cleanup)', () => {
    // Old row for a different user — global cleanup should delete it too
    db.prepare(`INSERT INTO sync_attempts (user_id, source, attempted_at, item_count, status)
      VALUES (?, ?, ?, ?, ?)`).run(
      'dev_other', 'news', '2020-01-01T00:00:00Z', 1, 'device_offline'
    );

    cleanupGlobal(db);

    const remaining = db.prepare('SELECT id FROM sync_attempts WHERE user_id = ?').all('dev_other');
    expect(remaining).toHaveLength(0);
  });

  it('purges expired device sessions and consumed/expired device challenges stored as ISO-8601', () => {
    // Expired session written with toISOString() — must be deleted even on the same day
    const pastIso = new Date(Date.now() - 60 * 1000).toISOString();
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    db.prepare(`INSERT INTO device_sessions (token_hash, device_id, expires_at) VALUES (?, ?, ?)`)
      .run('hash_expired', 'dev_a', pastIso);
    db.prepare(`INSERT INTO device_sessions (token_hash, device_id, expires_at) VALUES (?, ?, ?)`)
      .run('hash_active', 'dev_a', futureIso);

    // Challenges: consumed, expired, and still-valid
    db.prepare(`INSERT INTO device_challenges (challenge_id, device_id, public_key, nonce, issued_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run('chal_consumed', 'dev_a', 'k', 'n', pastIso, futureIso, pastIso);
    db.prepare(`INSERT INTO device_challenges (challenge_id, device_id, public_key, nonce, issued_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run('chal_expired', 'dev_a', 'k', 'n', pastIso, pastIso);
    db.prepare(`INSERT INTO device_challenges (challenge_id, device_id, public_key, nonce, issued_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run('chal_active', 'dev_a', 'k', 'n', pastIso, futureIso);

    cleanupGlobal(db);

    const sessions = db.prepare('SELECT token_hash FROM device_sessions').all() as { token_hash: string }[];
    expect(sessions.map(s => s.token_hash)).toEqual(['hash_active']);

    const challenges = db.prepare('SELECT challenge_id FROM device_challenges').all() as { challenge_id: string }[];
    expect(challenges.map(c => c.challenge_id)).toEqual(['chal_active']);
  });

  it('expires queued free-tier deliveries and purges old delivered/expired queue rows', () => {
    // Expired queued row (past TTL)
    db.prepare(`
      INSERT INTO free_queue_deliveries (user_id, payload_envelope, expires_at, status)
      VALUES (?, ?, datetime('now', '-1 hour'), 'queued')
    `).run('local', '{"source":"news"}');

    // Old delivered row (eligible for purge)
    db.prepare(`
      INSERT INTO free_queue_deliveries (user_id, payload_envelope, expires_at, delivered_at, status)
      VALUES (?, ?, datetime('now', '+1 day'), datetime('now', '-2 day'), 'delivered')
    `).run('local', '{"source":"news"}');

    // Old expired row (eligible for purge)
    db.prepare(`
      INSERT INTO free_queue_deliveries (user_id, payload_envelope, expires_at, status)
      VALUES (?, ?, datetime('now', '-2 day'), 'expired')
    `).run('local', '{"source":"news"}');

    cleanupGlobal(db);

    const remaining = db.prepare(
      `SELECT status FROM free_queue_deliveries WHERE user_id = ?`
    ).all('local') as Array<{ status: string }>;
    // The '-1 hour' queued row gets marked expired (not purged yet — purge requires 1 day old)
    expect(remaining).toEqual([{ status: 'expired' }]);
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

  it('returns enabled sources with last_sync from user_sources.last_sync_at', () => {
    db.prepare(`UPDATE user_sources SET enabled = 1, urls = ?, last_sync_at = ? WHERE user_id = 'local' AND name = 'youtube'`).run(
      JSON.stringify(['https://youtube.com/feed/subscriptions']),
      '2026-04-03T10:00:00Z'
    );

    const ctx = getSyncContext(db, 'local');
    const yt = ctx.sources.find(s => s.name === 'youtube');
    expect(yt!.enabled).toBe(true);
    expect(yt!.urls).toEqual(['https://youtube.com/feed/subscriptions']);
    expect(yt!.last_sync).toBe('2026-04-03T10:00:00Z');
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
