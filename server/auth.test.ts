import { createSign, generateKeyPairSync } from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { hashToken, verifyAgentToken, seedAgentToken, resolveApiAuth } from './auth.js';

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

    db.prepare(`INSERT INTO oauth_tokens (access_token, refresh_token, client_id, user_id, access_expires)
      VALUES (?, ?, ?, ?, ?)`).run(accessToken, 'refresh-1', 'client-1', 'local', futureDate);

    const result = verifyAgentToken(db, accessToken);
    expect(result.valid).toBe(true);
    expect(result.userId).toBe('local');
  });

  it('rejects expired OAuth access token', () => {
    const accessToken = 'expired-access-token';
    const pastDate = new Date(Date.now() - 3600000).toISOString();

    db.prepare(`INSERT INTO oauth_tokens (access_token, refresh_token, client_id, user_id, access_expires)
      VALUES (?, ?, ?, ?, ?)`).run(accessToken, 'refresh-2', 'client-1', 'local', pastDate);

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

describe('resolveApiAuth', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    delete process.env.SCROLLESS_ALLOW_DEV_AUTH_BYPASS;
    process.env.NODE_ENV = 'test';
  });
  afterEach(() => { db.close(); });

  it('accepts valid device signature proof', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const deviceId = 'dev_auth_test';
    db.prepare(`INSERT INTO device_registrations (user_id, public_key) VALUES (?, ?)`)
      .run(deviceId, publicKey.export({ type: 'spki', format: 'pem' }).toString());

    const ts = Math.floor(Date.now() / 1000).toString();
    const url = '/api/sources';
    const method = 'POST';
    const payload = `${ts}.${method}.${url}`;
    const signer = createSign('sha256');
    signer.update(payload);
    signer.end();
    const signature = signer.sign(privateKey).toString('base64');

    const req = {
      headers: {
        'x-device-id': deviceId,
        'x-device-proof-ts': ts,
        'x-device-proof-signature': signature,
      },
      method,
      url,
    } as unknown as Parameters<typeof resolveApiAuth>[0];

    const auth = resolveApiAuth(req, db);
    expect(auth?.userId).toBe(deviceId);
    expect(auth?.hasDeviceProof).toBe(true);
  });

  it('rejects missing proof headers for registered device', () => {
    db.prepare(`INSERT INTO device_registrations (user_id, public_key) VALUES ('dev_missing', 'not-a-real-key')`).run();
    const req = {
      headers: {
        'x-device-id': 'dev_missing',
      },
      method: 'GET',
      url: '/api/feed',
    } as unknown as Parameters<typeof resolveApiAuth>[0];

    expect(resolveApiAuth(req, db)).toBeNull();
  });

  it('allows fallback only when explicit dev bypass env var is set', () => {
    const req = {
      headers: {},
      method: 'GET',
      url: '/api/feed',
    } as unknown as Parameters<typeof resolveApiAuth>[0];

    expect(resolveApiAuth(req, db)).toBeNull();

    process.env.SCROLLESS_ALLOW_DEV_AUTH_BYPASS = 'true';
    const auth = resolveApiAuth(req, db);
    expect(auth?.userId).toBe('local');
    expect(auth?.authMethod).toBe('dev-bypass');
  });
});
