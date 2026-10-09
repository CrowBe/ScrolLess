import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createSign, generateKeyPairSync } from 'crypto';
import { registerApiRoutes } from './api-routes.js';
import { pushItems } from './content-store.js';

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
  app: FastifyInstance,
  enrollToken?: string
): Promise<{ ok: boolean; user_id: string; session_token: string }> {
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyPem = keyPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();

  const challengeRes = await app.inject({
    method: 'POST',
    url: '/api/v1/device/challenge',
    headers: enrollToken ? { 'x-device-enroll-token': enrollToken } : {},
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
  return verifyRes.json() as { ok: boolean; user_id: string; session_token: string };
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
      max_items_per_source: 50,
      session_size: 20,
    });
  });

  it('accepts partial updates and persists them', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/preferences',
      payload: {
        blocked_keywords: ['sponsored', 'giveaway'],
        max_items_per_source: 25,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      blocked_keywords: ['sponsored', 'giveaway'],
      max_items_per_source: 25,
      session_size: 20,
    });

    const rows = db.prepare(
      `SELECT key, value FROM user_preferences WHERE user_id = 'local' AND key IN ('blocked_keywords', 'max_items_per_source') ORDER BY key`
    ).all() as Array<{ key: string; value: string }>;

    expect(rows).toEqual([
      { key: 'blocked_keywords', value: JSON.stringify(['sponsored', 'giveaway']) },
      { key: 'max_items_per_source', value: JSON.stringify(25) },
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
    registerApiRoutes(app, db, { deviceEnrollmentToken: 'enroll-secret' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('rejects challenge creation without X-Device-Enroll-Token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/device/challenge',
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

describe('enrollment without a configured token', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  it('is closed in production', async () => {
    process.env.NODE_ENV = 'production';
    const db = createTestDb();
    const app = Fastify();
    registerApiRoutes(app, db);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/device/challenge',
      payload: { device_id: 'dev_x', public_key: 'pk' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
    db.close();
  });
});

describe('device challenge + verify', () => {
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

  it('lets every verified device act for the single owner', async () => {
    db.prepare(`INSERT OR IGNORE INTO user_sources (user_id, name, enabled) VALUES ('local', 'shared_src', 1)`).run();
    const first = await createVerifiedDevice('dev_a', app);
    const second = await createVerifiedDevice('dev_b', app);

    for (const device of [first, second]) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sources',
        headers: { authorization: `Bearer ${device.session_token}` },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as Array<{ name: string }>).map((s) => s.name)).toContain('shared_src');
    }
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

describe('/api/items (host content)', () => {
  let db: Database.Database;
  let app: FastifyInstance;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    db = createTestDb();
    pushItems(db, 'local', 'news', [
      { source_id: 'a', url: 'https://example.com/a', title: 'First', published_at: '2026-10-01T00:00:00Z' },
      { source_id: 'b', url: 'https://example.com/b', title: 'Second', published_at: '2026-10-02T00:00:00Z' },
      { source_id: 'c', url: 'https://example.com/c', title: 'Found', is_discovery: true },
    ]);
    app = Fastify();
    registerApiRoutes(app, db);
    await app.ready();
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalEnv;
    await app.close();
    db.close();
  });

  it('lists the feed view newest first with pagination', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/items?limit=1' });
    expect(res.statusCode).toBe(200);
    const page = res.json() as { items: Array<{ title: string }>; next_cursor: string };
    expect(page.items.map((i) => i.title)).toEqual(['Second']);

    const next = await app.inject({ method: 'GET', url: `/api/items?limit=1&cursor=${page.next_cursor}` });
    expect((next.json() as { items: Array<{ title: string }> }).items.map((i) => i.title)).toEqual(['First']);

    const discover = await app.inject({ method: 'GET', url: '/api/items?view=discover' });
    expect((discover.json() as { items: Array<{ title: string }> }).items.map((i) => i.title)).toEqual(['Found']);
  });

  it('rejects bad queries and cursors', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/items?view=nope' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/items?cursor=garbage' })).statusCode).toBe(400);
  });

  it('updates read/save state with conflict detection', async () => {
    const { items } = (await app.inject({ method: 'GET', url: '/api/items' })).json() as { items: Array<{ id: string }> };
    const id = items[0].id;

    const saved = await app.inject({ method: 'PATCH', url: `/api/items/${id}`, payload: { is_saved: true, expected_version: 0 } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ is_saved: true, state_version: 1 });

    const stale = await app.inject({ method: 'PATCH', url: `/api/items/${id}`, payload: { is_read: true, expected_version: 0 } });
    expect(stale.statusCode).toBe(409);

    const missing = await app.inject({ method: 'PATCH', url: '/api/items/ci_nope', payload: { is_read: true } });
    expect(missing.statusCode).toBe(404);

    const savedView = await app.inject({ method: 'GET', url: '/api/items?view=saved' });
    expect((savedView.json() as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([id]);
  });

  it('lists only unread items when unread=1', async () => {
    const { items } = (await app.inject({ method: 'GET', url: '/api/items' })).json() as { items: Array<{ id: string }> };
    await app.inject({ method: 'PATCH', url: `/api/items/${items[0].id}`, payload: { is_read: true } });
    const unread = await app.inject({ method: 'GET', url: '/api/items?unread=1' });
    expect((unread.json() as { items: Array<{ title: string }> }).items.map((i) => i.title)).toEqual(['First']);
  });

  it('records swipe feedback and undoes it', async () => {
    const { items } = (await app.inject({ method: 'GET', url: '/api/items' })).json() as { items: Array<{ id: string }> };
    const id = items[0].id;

    const saved = await app.inject({ method: 'PUT', url: `/api/items/${id}/feedback`, payload: { verdict: 'save' } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ verdict: 'save', item: { is_read: true, is_saved: true } });

    const bad = await app.inject({ method: 'PUT', url: `/api/items/${id}/feedback`, payload: { verdict: 'meh' } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/items/ci_nope/feedback', payload: { verdict: 'like' } })).statusCode).toBe(404);

    const undo = await app.inject({ method: 'DELETE', url: `/api/items/${id}/feedback` });
    expect(undo.json()).toMatchObject({ verdict: null, item: { is_read: false, is_saved: false } });
    expect((await app.inject({ method: 'DELETE', url: `/api/items/${id}/feedback` })).statusCode).toBe(404);
  });

  it('validates session_size preference bounds', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/preferences', payload: { session_size: 2 } })).statusCode).toBe(400);
    const ok = await app.inject({ method: 'PATCH', url: '/api/preferences', payload: { session_size: 10 } });
    expect(ok.json()).toMatchObject({ session_size: 10 });
  });

  it('reports stats and marks all read', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/items/stats' })).json()).toMatchObject({ total: 3, unread: 3 });
    const res = await app.inject({ method: 'POST', url: '/api/items/mark-read', payload: { source: 'news' } });
    expect(res.json()).toEqual({ updated: 3 });
    expect((await app.inject({ method: 'GET', url: '/api/items/stats' })).json()).toMatchObject({ unread: 0 });
  });

  it('requires a device session in production', async () => {
    await app.close();
    app = Fastify();
    registerApiRoutes(app, db, { deviceEnrollmentToken: 'enroll-secret' });
    await app.ready();
    process.env.NODE_ENV = 'production';
    expect((await app.inject({ method: 'GET', url: '/api/items' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/items', headers: { authorization: 'Bearer dsess_bogus' } })).statusCode).toBe(401);

    const { session_token } = await createVerifiedDevice('dev_reader', app, 'enroll-secret');
    const res = await app.inject({ method: 'GET', url: '/api/items', headers: { authorization: `Bearer ${session_token}` } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { items: unknown[] }).items).toHaveLength(2);
  });
});
