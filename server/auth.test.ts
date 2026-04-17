import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hashToken, verifyAgentToken, seedAgentToken } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

describe('hashToken', () => {
  it('returns consistent SHA-256 hex', () => {
    const h = hashToken('test-token');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('test-token')).toBe(h);
  });

  it('different tokens produce different hashes', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('verifyAgentToken', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('validates a seeded bearer token', () => {
    const plain = 'my-secret-agent-token';
    const hash = hashToken(plain);
    seedAgentToken(db, hash, 'test');

    const result = verifyAgentToken(db, plain);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe('local');
  });

  it('rejects an unknown token', () => {
    const result = verifyAgentToken(db, 'nonexistent-token');
    expect(result.valid).toBe(false);
    expect(result.userId).toBeNull();
  });

  it('updates last_used on successful verification', () => {
    const plain = 'my-token';
    const hash = hashToken(plain);
    seedAgentToken(db, hash, 'test');

    const before = db.prepare('SELECT last_used FROM agent_tokens WHERE token_hash = ?').get(hash) as { last_used: string | null };
    expect(before.last_used).toBeNull();

    verifyAgentToken(db, plain);

    const after = db.prepare('SELECT last_used FROM agent_tokens WHERE token_hash = ?').get(hash) as { last_used: string | null };
    expect(after.last_used).not.toBeNull();
    // Should be ISO format with Z suffix
    expect(after.last_used).toMatch(/Z$/);
  });

  it('validates OAuth access token', () => {
    const accessToken = 'oauth-access-token-abc';
    const futureDate = new Date(Date.now() + 3600000).toISOString();

    db.prepare(`INSERT INTO oauth_tokens (access_token_hash, refresh_token_hash, client_id, user_id, access_expires)
      VALUES (?, ?, ?, ?, ?)`).run(hashToken(accessToken), hashToken('refresh-1'), 'client-1', 'local', futureDate);

    const result = verifyAgentToken(db, accessToken);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe('local');
  });

  it('rejects expired OAuth access token', () => {
    const accessToken = 'expired-access-token';
    const pastDate = new Date(Date.now() - 3600000).toISOString();

    db.prepare(`INSERT INTO oauth_tokens (access_token_hash, refresh_token_hash, client_id, user_id, access_expires)
      VALUES (?, ?, ?, ?, ?)`).run(hashToken(accessToken), hashToken('refresh-2'), 'client-1', 'local', pastDate);

    const result = verifyAgentToken(db, accessToken);
    expect(result.valid).toBe(false);
  });
});

describe('seedAgentToken', () => {
  let db: Database.Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('inserts a token with label', () => {
    seedAgentToken(db, 'hash123', 'my-agent');
    const row = db.prepare('SELECT * FROM agent_tokens WHERE token_hash = ?').get('hash123') as { label: string; user_id: string };
    expect(row.label).toBe('my-agent');
    expect(row.user_id).toBe('local');
  });

  it('does not overwrite existing token (INSERT OR IGNORE)', () => {
    seedAgentToken(db, 'hash123', 'first');
    seedAgentToken(db, 'hash123', 'second');
    const row = db.prepare('SELECT label FROM agent_tokens WHERE token_hash = ?').get('hash123') as { label: string };
    expect(row.label).toBe('first');
  });
});
