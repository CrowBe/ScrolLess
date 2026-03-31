import { randomBytes, createHash } from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';

interface FeedQuery {
  limit?: string;
  offset?: string;
  source?: string;
  unread_only?: string;
  discovery?: string;
  saved?: string;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function registerApiRoutes(
  fastify: FastifyInstance,
  db: Database.Database
): void {
  // GET /api/feed
  fastify.get('/api/feed', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as FeedQuery;
    const userId = 'local';
    const limit = Math.min(parseInt(q.limit ?? '50', 10), 200);
    const offset = parseInt(q.offset ?? '0', 10);

    let where = 'WHERE user_id = ?';
    const params: unknown[] = [userId];

    if (q.source) {
      where += ' AND source = ?';
      params.push(q.source);
    }
    if (q.unread_only === 'true' || q.unread_only === '1') {
      where += ' AND is_read = 0';
    }
    if (q.saved === 'true' || q.saved === '1') {
      where += ' AND is_saved = 1';
    }
    if (q.discovery === 'true' || q.discovery === '1') {
      where += ' AND is_discovery = 1';
    } else if (q.discovery === 'false' || q.discovery === '0') {
      where += ' AND is_discovery = 0';
    }

    const countRow = db.prepare(
      `SELECT COUNT(*) as total FROM feed_items ${where}`
    ).get(...params) as { total: number };

    const rows = db.prepare(`
      SELECT id, user_id, source, title, author, url, content_preview,
             thumbnail_url, tags, is_discovery, published_at, fetched_at, is_read, is_saved
      FROM feed_items
      ${where}
      ORDER BY published_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<{
      id: string;
      source: string;
      title: string;
      author: string | null;
      url: string;
      content_preview: string | null;
      thumbnail_url: string | null;
      tags: string | null;
      is_discovery: number;
      published_at: string;
      fetched_at: string;
      is_read: number;
      is_saved: number;
    }>;

    const items = rows.map((row) => ({
      ...row,
      tags: parseTags(row.tags),
      is_discovery: row.is_discovery === 1,
      is_read: row.is_read === 1,
      is_saved: row.is_saved === 1,
    }));

    return reply.send({ items, total: countRow.total, limit, offset });
  });

  // PATCH /api/feed/:id/read
  fastify.patch('/api/feed/:id/read', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const result = db.prepare(
      `UPDATE feed_items SET is_read = 1 WHERE id = ? AND user_id = 'local'`
    ).run(decodeURIComponent(id));
    return reply.send({ ok: result.changes > 0 });
  });

  // PATCH /api/feed/:id/unread
  fastify.patch('/api/feed/:id/unread', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const result = db.prepare(
      `UPDATE feed_items SET is_read = 0 WHERE id = ? AND user_id = 'local'`
    ).run(decodeURIComponent(id));
    return reply.send({ ok: result.changes > 0 });
  });

  // PATCH /api/feed/:id/save
  fastify.patch('/api/feed/:id/save', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const result = db.prepare(
      `UPDATE feed_items SET is_saved = 1 WHERE id = ? AND user_id = 'local'`
    ).run(decodeURIComponent(id));
    return reply.send({ ok: result.changes > 0 });
  });

  // PATCH /api/feed/:id/unsave
  fastify.patch('/api/feed/:id/unsave', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const result = db.prepare(
      `UPDATE feed_items SET is_saved = 0 WHERE id = ? AND user_id = 'local'`
    ).run(decodeURIComponent(id));
    return reply.send({ ok: result.changes > 0 });
  });

  // POST /api/feed/mark-all-read
  fastify.post('/api/feed/mark-all-read', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { source?: string };
    if (q.source) {
      db.prepare(
        `UPDATE feed_items SET is_read = 1 WHERE user_id = 'local' AND source = ? AND is_read = 0`
      ).run(q.source);
    } else {
      db.prepare(
        `UPDATE feed_items SET is_read = 1 WHERE user_id = 'local' AND is_read = 0`
      ).run();
    }
    return reply.send({ ok: true });
  });

  // GET /api/stats
  fastify.get('/api/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { discovery?: string };
    let discoveryFilter = '';
    if (q.discovery === 'true' || q.discovery === '1') {
      discoveryFilter = ' AND is_discovery = 1';
    } else if (q.discovery === 'false' || q.discovery === '0') {
      discoveryFilter = ' AND is_discovery = 0';
    }

    const total = (db.prepare(
      `SELECT COUNT(*) as n FROM feed_items WHERE user_id = 'local'${discoveryFilter}`
    ).get() as { n: number }).n;

    const unread = (db.prepare(
      `SELECT COUNT(*) as n FROM feed_items WHERE user_id = 'local' AND is_read = 0${discoveryFilter}`
    ).get() as { n: number }).n;

    const bySource = db.prepare(`
      SELECT source,
             COUNT(*) as count,
             SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM feed_items
      WHERE user_id = 'local'${discoveryFilter}
      GROUP BY source
    `).all() as Array<{ source: string; count: number; unread: number }>;

    return reply.send({ total, unread, by_source: bySource });
  });

  // GET /api/sync/status
  fastify.get('/api/sync/status', async (_req: FastifyRequest, reply: FastifyReply) => {
    const rows = db.prepare(`
      SELECT source, synced_at, items_added, items_duped, error
      FROM sync_log
      WHERE user_id = 'local'
      GROUP BY source
      HAVING synced_at = MAX(synced_at)
      ORDER BY synced_at DESC
    `).all() as Array<{
      source: string;
      synced_at: string;
      items_added: number;
      items_duped: number;
      error: string | null;
    }>;

    return reply.send(rows);
  });

  // GET /api/push/vapid-key
  fastify.get('/api/push/vapid-key', async (_req: FastifyRequest, reply: FastifyReply) => {
    const row = db.prepare(
      `SELECT value FROM user_preferences WHERE user_id = 'local' AND key = 'vapid_public_key'`
    ).get() as { value: string } | undefined;
    // Vapid key comes from config, exposed via a stored pref set at startup
    return reply.send({ key: row?.value ?? null });
  });

  // POST /api/push/subscribe
  fastify.post('/api/push/subscribe', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return reply.status(400).send({ error: 'endpoint and keys.p256dh and keys.auth are required' });
    }

    db.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
      VALUES ('local', ?, ?, ?)
    `).run(body.endpoint, body.keys.p256dh, body.keys.auth);

    return reply.send({ ok: true });
  });

  // POST /api/push/unsubscribe
  fastify.post('/api/push/unsubscribe', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { endpoint: string };

    if (!body?.endpoint) {
      return reply.status(400).send({ error: 'endpoint is required' });
    }

    db.prepare(
      `DELETE FROM push_subscriptions WHERE user_id = 'local' AND endpoint = ?`
    ).run(body.endpoint);

    return reply.send({ ok: true });
  });

  // GET /api/sources
  fastify.get('/api/sources', async (_req: FastifyRequest, reply: FastifyReply) => {
    const rows = db.prepare(
      `SELECT name, enabled, urls, max_items, created_at FROM user_sources WHERE user_id = 'local' ORDER BY name`
    ).all() as Array<{ name: string; enabled: number; urls: string | null; max_items: number | null; created_at: string }>;

    const sources = rows.map((r) => ({
      name: r.name,
      enabled: r.enabled === 1,
      urls: r.urls ? JSON.parse(r.urls) as string[] : [],
      max_items: r.max_items,
      created_at: r.created_at,
    }));

    return reply.send(sources);
  });

  // POST /api/sources
  fastify.post('/api/sources', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { name?: string; urls?: string[]; max_items?: number };

    if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
      return reply.status(400).send({ error: 'name is required' });
    }
    if (!Array.isArray(body.urls) || body.urls.length === 0) {
      return reply.status(400).send({ error: 'at least one url is required' });
    }

    const name = body.name.trim().toLowerCase();
    const urls = JSON.stringify(body.urls.filter((u) => typeof u === 'string' && u.trim()));
    const maxItems = body.max_items != null ? body.max_items : null;

    try {
      db.prepare(
        `INSERT INTO user_sources (user_id, name, urls, max_items) VALUES ('local', ?, ?, ?)`
      ).run(name, urls, maxItems);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        return reply.status(409).send({ error: 'source already exists' });
      }
      throw err;
    }

    return reply.status(201).send({ ok: true });
  });

  // PATCH /api/sources/:name
  fastify.patch('/api/sources/:name', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const body = req.body as { enabled?: number; urls?: string[]; max_items?: number | null };

    const sets: string[] = [];
    const params: unknown[] = [];

    if (body.enabled != null) {
      sets.push('enabled = ?');
      params.push(body.enabled);
    }
    if (body.urls != null) {
      sets.push('urls = ?');
      params.push(JSON.stringify(body.urls));
    }
    if (body.max_items !== undefined) {
      sets.push('max_items = ?');
      params.push(body.max_items);
    }

    if (sets.length === 0) {
      return reply.status(400).send({ error: 'nothing to update' });
    }

    params.push(decodeURIComponent(name));
    const result = db.prepare(
      `UPDATE user_sources SET ${sets.join(', ')} WHERE user_id = 'local' AND name = ?`
    ).run(...params);

    if (result.changes === 0) {
      return reply.status(404).send({ error: 'source not found' });
    }

    return reply.send({ ok: true });
  });

  // DELETE /api/sources/:name
  fastify.delete('/api/sources/:name', async (req: FastifyRequest, reply: FastifyReply) => {
    const { name } = req.params as { name: string };
    const result = db.prepare(
      `DELETE FROM user_sources WHERE user_id = 'local' AND name = ?`
    ).run(decodeURIComponent(name));

    if (result.changes === 0) {
      return reply.status(404).send({ error: 'source not found' });
    }

    return reply.send({ ok: true });
  });

  // GET /api/tokens — list agent tokens (hashes are safe to expose; plain tokens are never stored)
  fastify.get('/api/tokens', async (_req: FastifyRequest, reply: FastifyReply) => {
    const rows = db.prepare(
      `SELECT token_hash, label, created_at, last_used FROM agent_tokens WHERE user_id = 'local' ORDER BY created_at DESC`
    ).all() as Array<{ token_hash: string; label: string | null; created_at: string; last_used: string | null }>;
    return reply.send(rows);
  });

  // POST /api/tokens — create a new agent token; returns the plain token once
  fastify.post('/api/tokens', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { label?: string } | null;
    const label = (body?.label ?? '').trim() || 'agent';
    const plain = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(plain).digest('hex');
    db.prepare(
      `INSERT INTO agent_tokens (token_hash, user_id, label) VALUES (?, 'local', ?)`
    ).run(hash, label);
    return reply.status(201).send({ token: plain, token_hash: hash, label });
  });

  // DELETE /api/tokens/:hash — revoke a token by its hash
  fastify.delete('/api/tokens/:hash', async (req: FastifyRequest, reply: FastifyReply) => {
    const { hash } = req.params as { hash: string };
    const result = db.prepare(
      `DELETE FROM agent_tokens WHERE token_hash = ? AND user_id = 'local'`
    ).run(hash);
    if (result.changes === 0) {
      return reply.status(404).send({ error: 'token not found' });
    }
    return reply.send({ ok: true });
  });
}
