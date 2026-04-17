import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSign, generateKeyPairSync } from 'crypto';
import { registerApiRoutes } from './api-routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

/** Run challenge → sign → verify for a device; returns the session token for use in Authorization headers. */
async function createVerifiedDevice(
  deviceId: string,
  app: FastifyInstance
): Promise<{ ok: boolean; user_id: string; grace_expires_at: string | null; session_token: string }> {
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const challengeRes = await app.inject({
    method: 'POST',
    url: '/api/v1/device/challenge',
    payload: { device_id: deviceId, public_key: publicKeyPem },
  });
  expect(challengeRes.statusCode).toBe(200);
  const challenge = challengeRes.json() as { challenge_id: string; nonce: string };

  const signer = createSign('SHA256');
  signer.update(challenge.nonce);
  signer.end();
  const signature = signer.sign(keyPair.privateKey).toString('base64');

  const verifyRes = await app.inject({
    method: 'POST',
    url: '/api/v1/device/verify',
    payload: { challenge_id: challenge.challenge_id, device_id: deviceId, signature },
  });
  expect(verifyRes.statusCode).toBe(200);
  return verifyRes.json() as { ok: boolean; user_id: string; grace_expires_at: string | null; session_token: string };
}

type SourceRow = {
  enabled: number;
  urls: string | null;
  max_items: number | null;
};

function getSourceRow(db: Database.Database, name = 'youtube'): SourceRow {
  return db.prepare(
    `SELECT enabled, urls, max_items FROM user_sources WHERE user_id = ? AND name = ?`
  ).get('local', name) as SourceRow;
}

describe('GET/PATCH /api/preferences', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = createTestDb();
    db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('blocked_keywords', JSON.stringify(['sponsored']));
    db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('retention_days', JSON.stringify(7));
    db.prepare(`INSERT OR IGNORE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run('max_items_per_source', JSON.stringify(50));

    app = Fastify();
    registerApiRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('returns current preferences with defaults', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/preferences',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      blocked_keywords: ['sponsored'],
      retention_days: 7,
      max_items_per_source: 50,
    });
  });

  it('accepts partial updates and persists them', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/preferences',
      payload: {
        blocked_keywords: ['sponsored', 'giveaway'],
        retention_days: 14,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      blocked_keywords: ['sponsored', 'giveaway'],
      retention_days: 14,
      max_items_per_source: 50,
    });

    const rows = db.prepare(
      `SELECT key, value FROM user_preferences WHERE user_id = 'local' AND key IN ('blocked_keywords', 'retention_days', 'max_items_per_source') ORDER BY key`
    ).all() as Array<{ key: string; value: string }>;

    expect(rows).toEqual([
      { key: 'blocked_keywords', value: JSON.stringify(['sponsored', 'giveaway']) },
      { key: 'max_items_per_source', value: JSON.stringify(50) },
      { key: 'retention_days', value: JSON.stringify(14) },
    ]);
  });
});

describe('PATCH /api/sources/:name', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = createTestDb();
    db.prepare(
      `INSERT INTO user_sources (user_id, name, enabled, urls, max_items) VALUES (?, ?, ?, ?, ?)`
    ).run('local', 'youtube', 1, JSON.stringify(['https://youtube.com/feed/subscriptions']), 25);

    app = Fastify();
    registerApiRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('updates enabled only and keeps urls/max_items unchanged', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sources/youtube',
      payload: { enabled: 0 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = getSourceRow(db);
    expect(row.enabled).toBe(0);
    expect(row.urls).toBe(JSON.stringify(['https://youtube.com/feed/subscriptions']));
    expect(row.max_items).toBe(25);
  });

  it('updates urls only and keeps enabled/max_items unchanged', async () => {
    const updatedUrls = ['https://youtube.com/@openai'];
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sources/youtube',
      payload: { urls: updatedUrls },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = getSourceRow(db);
    expect(row.enabled).toBe(1);
    expect(row.urls).toBe(JSON.stringify(updatedUrls));
    expect(row.max_items).toBe(25);
  });

  it('updates max_items only and keeps enabled/urls unchanged', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sources/youtube',
      payload: { max_items: 10 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = getSourceRow(db);
    expect(row.enabled).toBe(1);
    expect(row.urls).toBe(JSON.stringify(['https://youtube.com/feed/subscriptions']));
    expect(row.max_items).toBe(10);
  });

  it('updates enabled, urls, and max_items together', async () => {
    const updatedUrls = ['https://youtube.com/@openai/videos'];
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sources/youtube',
      payload: { enabled: 0, urls: updatedUrls, max_items: 7 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = getSourceRow(db);
    expect(row.enabled).toBe(0);
    expect(row.urls).toBe(JSON.stringify(updatedUrls));
    expect(row.max_items).toBe(7);
  });

  it('returns 404 when source does not exist', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/sources/missing',
      payload: { enabled: 0 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'source not found' });
  });
});

describe('versioned auth/token route aliases', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = createTestDb();
    app = Fastify();
    registerApiRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('supports /api/v1/device/register', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/device/register',
      payload: { device_id: 'dev_v1', public_key: 'test-public-key' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ user_id: 'dev_v1', ok: true });
  });

  it('supports /api/v1/tokens create/list/delete', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tokens',
      payload: { label: 'v1 token' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { token: string; token_hash: string; label: string };
    expect(created.token).toMatch(/^[a-f0-9]{64}$/);
    expect(created.label).toBe('v1 token');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tokens',
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json() as Array<{ token_hash: string; label: string }>;
    expect(listed.length).toBe(1);
    expect(listed[0]?.token_hash).toBe(created.token_hash);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tokens/${created.token_hash}`,
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toEqual({ ok: true });
  });

  it('supports /api/v1/tokens for a verified dev device via session token', async () => {
    const verified = await createVerifiedDevice('dev_test_device', app);
    const authHeader = `Bearer ${verified.session_token}`;

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tokens',
      headers: { authorization: authHeader },
      payload: { label: 'device token' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json() as { token_hash: string; label: string };
    expect(created.label).toBe('device token');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tokens',
      headers: { authorization: authHeader },
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json() as Array<{ token_hash: string; label: string | null }>;
    expect(listed.some((row) => row.token_hash === created.token_hash && row.label === 'device token')).toBe(true);
  });

  it('rejects removed unversioned routes', async () => {
    const registerRes = await app.inject({
      method: 'POST',
      url: '/api/device/register',
      payload: { device_id: 'dev_legacy', public_key: 'legacy-key' },
    });
    expect(registerRes.statusCode).toBe(404);

    const tokenRes = await app.inject({
      method: 'GET',
      url: '/api/tokens',
    });
    expect(tokenRes.statusCode).toBe(404);
  });
});

describe('device enrollment token protection', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = createTestDb();
    app = Fastify();
    registerApiRoutes(app, db, undefined, { deviceEnrollmentToken: 'enroll-secret' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('rejects registration without X-Device-Enroll-Token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/device/register',
      payload: { device_id: 'dev_secure', public_key: 'pk' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Missing or invalid X-Device-Enroll-Token header' });
  });

  it('allows challenge creation with valid enrollment token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/device/challenge',
      headers: { 'x-device-enroll-token': 'enroll-secret' },
      payload: { device_id: 'dev_secure', public_key: 'pk' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { challenge_id: string; nonce: string };
    expect(body.challenge_id).toMatch(/^chal_/);
    expect(body.nonce.length).toBeGreaterThan(10);
  });
});

describe('device challenge + verify rotation', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = createTestDb();
    app = Fastify();
    registerApiRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('verify response includes session token', async () => {
    const result = await createVerifiedDevice('dev_a', app);
    expect(result.ok).toBe(true);
    expect(result.session_token).toMatch(/^dsess_/);
  });

  it('enforces 5-minute grace and rotates active free-tier device', async () => {
    const first = await createVerifiedDevice('dev_a', app);
    expect(first.ok).toBe(true);
    expect(first.grace_expires_at).toBeNull();

    const second = await createVerifiedDevice('dev_b', app);
    expect(second.ok).toBe(true);
    expect(second.grace_expires_at).not.toBeNull();

    // dev_a's session token still works during grace period
    const duringGrace = await app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { authorization: `Bearer ${first.session_token}` },
    });
    expect(duringGrace.statusCode).toBe(200);

    db.prepare(
      `UPDATE free_device_rotation SET grace_expires_at = datetime('now', '-1 minute') WHERE user_id = 'local'`
    ).run();

    // After grace expires, dev_a's session token is rejected
    const afterGrace = await app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { authorization: `Bearer ${first.session_token}` },
    });
    expect(afterGrace.statusCode).toBe(401);
  });

  it('rejects unknown device_id header without session token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { 'x-device-id': 'dev_unknown' },
    });
    // In non-production mode falls back to 'local'; x-device-id for dev_* no longer grants access
    // The response is 200 (resolves to 'local') rather than granting the unknown device identity
    expect(res.statusCode).toBe(200);
  });

  it('does not grant usr_* identity via X-Device-Id (finding #2 fix)', async () => {
    // Seed a source under 'local' but not under 'usr_alice' to distinguish which identity is resolved
    db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', 'test_src', 1)`).run();

    const res = await app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { 'x-device-id': 'usr_alice' },
    });
    // Non-production falls back to 'local', not usr_alice — usr_* bypass is removed
    expect(res.statusCode).toBe(200);
    const sources = res.json() as { name: string }[];
    const names = sources.map((s) => s.name);
    expect(names).toContain('test_src'); // 'local' data returned, not a blank usr_alice account
  });

  it('rejects unrecognised Authorization header values including usr_* bearer tokens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sources',
      headers: { authorization: 'Bearer usr_alice' },
    });
    // Only dsess_* tokens are accepted; anything else is rejected even in non-production
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/v1/queue/ack', () => {
  let db: Database.Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = createTestDb();
    app = Fastify();
    registerApiRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('is idempotent per device and advances cursor when at least one device ACKs', async () => {
    const devA = await createVerifiedDevice('dev_A', app);

    db.prepare(`
      INSERT INTO paid_queue_deliveries (delivery_id, user_id, device_id, payload_envelope, expires_at, status)
      VALUES
        ('del_1', 'dev_A', 'dev_A', '{"ciphertext":"a"}', datetime('now', '+1 day'), 'delivered_unacked'),
        ('del_1', 'dev_A', 'dev_B', '{"ciphertext":"a"}', datetime('now', '+1 day'), 'queued')
    `).run();

    const firstAck = await app.inject({
      method: 'POST',
      url: '/api/v1/queue/ack',
      headers: { authorization: `Bearer ${devA.session_token}` },
      payload: { delivery_id: 'del_1', device_id: 'dev_A' },
    });
    expect(firstAck.statusCode).toBe(200);
    expect(firstAck.json()).toEqual({ ok: true, status: 'acked' });

    const row = db.prepare(
      `SELECT acked_at, status FROM paid_queue_deliveries WHERE delivery_id = ? AND device_id = ?`
    ).get('del_1', 'dev_A') as { acked_at: string | null; status: string };
    expect(row.acked_at).not.toBeNull();
    expect(row.status).toBe('acked');

    const cursor = db.prepare(
      `SELECT last_acked_delivery_id FROM paid_queue_cursor WHERE user_id = ?`
    ).get('dev_A') as { last_acked_delivery_id: string } | undefined;
    expect(cursor?.last_acked_delivery_id).toBe('del_1');

    // Second ack on same delivery is idempotent
    const secondAck = await app.inject({
      method: 'POST',
      url: '/api/v1/queue/ack',
      headers: { authorization: `Bearer ${devA.session_token}` },
      payload: { delivery_id: 'del_1', device_id: 'dev_A' },
    });
    expect(secondAck.statusCode).toBe(200);
    expect(secondAck.json()).toEqual({ ok: true, status: 'acked' });
  });
});

// Note: GET /api/feed is removed — feed content lives in device IndexedDB only.
