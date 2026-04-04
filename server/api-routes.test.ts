import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
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
    expect(res.json()).toEqual({ user_id: 'dev_v1' });
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
