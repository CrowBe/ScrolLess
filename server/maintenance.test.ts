import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cleanupExpired } from './maintenance.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('cleanupExpired', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
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

    cleanupExpired(db);

    const sessions = db.prepare('SELECT token_hash FROM device_sessions').all() as { token_hash: string }[];
    expect(sessions.map(s => s.token_hash)).toEqual(['hash_active']);

    const challenges = db.prepare('SELECT challenge_id FROM device_challenges').all() as { challenge_id: string }[];
    expect(challenges.map(c => c.challenge_id)).toEqual(['chal_active']);
  });

  it('purges expired OAuth codes and fully expired tokens', () => {
    db.prepare(`INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, expires_at)
      VALUES ('old', 'c', 'local', 'https://x', 'ch', datetime('now', '-1 minute'))`).run();
    db.prepare(`INSERT INTO oauth_tokens (access_token_hash, refresh_token_hash, client_id, user_id, access_expires, refresh_expires)
      VALUES ('a1', 'r1', 'c', 'local', datetime('now', '-1 hour'), datetime('now', '+1 day'))`).run();
    db.prepare(`INSERT INTO oauth_tokens (access_token_hash, refresh_token_hash, client_id, user_id, access_expires, refresh_expires)
      VALUES ('a2', 'r2', 'c', 'local', datetime('now', '-1 hour'), datetime('now', '-1 minute'))`).run();

    cleanupExpired(db);

    expect(db.prepare('SELECT code FROM oauth_auth_codes').all()).toHaveLength(0);
    expect((db.prepare('SELECT access_token_hash FROM oauth_tokens').all() as Array<{ access_token_hash: string }>)
      .map(r => r.access_token_hash)).toEqual(['a1']);
  });
});
