import { randomBytes, createHash, createPublicKey, createVerify } from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { SseManager } from './sse-manager.js';

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

function parseMetadata(raw: string | null): Record<string, string | number | boolean | null> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function getRequestUserId(req: FastifyRequest, db: Database.Database): string | null {
  const userIdHeader = req.headers['x-device-id'];
  const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;

  if (!userId) {
    return process.env.NODE_ENV === 'production' ? null : 'local';
  }
  if (!userId.startsWith('dev_')) {
    return null;
  }

  const registration = db.prepare(
    `SELECT user_id FROM device_registrations WHERE user_id = ?`
  ).get(userId) as { user_id: string } | undefined;
  if (!registration) {
    return null;
  }

  const rotation = db.prepare(
    `SELECT active_device_id, previous_active_device_id, grace_expires_at
     FROM free_device_rotation
     WHERE scope_id = 1`
  ).get() as {
    active_device_id: string;
    previous_active_device_id: string | null;
    grace_expires_at: string | null;
  } | undefined;

  if (!rotation) {
    return userId;
  }

  if (rotation.active_device_id === userId) {
    return userId;
  }
  if (rotation.previous_active_device_id === userId && rotation.grace_expires_at) {
    if (new Date(rotation.grace_expires_at) > new Date()) {
      return userId;
    }
  }
  return null;
}


function getStreamUserId(req: FastifyRequest, db: Database.Database): string | null {
  const fromHeader = getRequestUserId(req, db);
  if (fromHeader) return fromHeader;

  const q = req.query as { device_id?: string };
  if (!q.device_id || !q.device_id.startsWith('dev_')) return null;

  const registration = db.prepare(
    `SELECT user_id FROM device_registrations WHERE user_id = ?`
  ).get(q.device_id) as { user_id: string } | undefined;
  if (!registration) return null;

  return q.device_id;
}

export function registerApiRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  sseManager?: SseManager
): void {
  const isPaidTier = (userId: string): boolean => userId.startsWith('usr_');

  const verifySignature = (publicKey: string, nonce: string, signature: string): boolean => {
    try {
      const normalizedSignature = signature.trim();
      const signatureBuffer = Buffer.from(normalizedSignature, 'base64');
      if (signatureBuffer.length === 0) {
        return false;
      }

      const normalizedKey = publicKey.trim();
      const key = normalizedKey.includes('BEGIN PUBLIC KEY')
        ? createPublicKey(normalizedKey)
        : createPublicKey({ key: Buffer.from(normalizedKey, 'base64'), format: 'der', type: 'spki' });
      const verifier = createVerify('SHA256');
      verifier.update(nonce);
      verifier.end();
      return verifier.verify(key, signatureBuffer);
    } catch {
      return false;
    }
  };

  const registerDeviceHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { public_key?: string; device_id?: string };

    if (!body?.public_key || !body?.device_id) {
      return reply.status(400).send({ error: 'public_key and device_id are required' });
    }
    if (!body.device_id.startsWith('dev_')) {
      return reply.status(400).send({ error: 'device_id must start with dev_' });
    }

    db.prepare(`
      INSERT INTO device_registrations (user_id, public_key, last_seen)
      VALUES (?, ?, NULL)
      ON CONFLICT(user_id) DO UPDATE SET
        public_key = excluded.public_key,
        last_seen = NULL
    `).run(body.device_id, body.public_key);

    return reply.status(201).send({ user_id: body.device_id });
  };
  // POST /api/v1/device/register
  fastify.post('/api/v1/device/register', registerDeviceHandler);

  // POST /api/v1/device/challenge
  fastify.post('/api/v1/device/challenge', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { device_id?: string; public_key?: string };
    if (!body?.device_id || !body?.public_key) {
      return reply.status(400).send({ error: 'device_id and public_key are required' });
    }
    if (!body.device_id.startsWith('dev_')) {
      return reply.status(400).send({ error: 'device_id must start with dev_' });
    }

    const challengeId = `chal_${randomBytes(12).toString('hex')}`;
    const nonce = randomBytes(32).toString('base64');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1000);

    db.prepare(`
      INSERT INTO device_challenges (challenge_id, device_id, public_key, nonce, issued_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      challengeId,
      body.device_id,
      body.public_key,
      nonce,
      issuedAt.toISOString(),
      expiresAt.toISOString()
    );

    return reply.send({
      challenge_id: challengeId,
      nonce,
      issued_at: issuedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  });

  // POST /api/v1/device/verify
  fastify.post('/api/v1/device/verify', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { challenge_id?: string; device_id?: string; signature?: string };
    if (!body?.challenge_id || !body?.device_id || !body?.signature) {
      return reply.status(400).send({ error: 'challenge_id, device_id and signature are required' });
    }

    const challenge = db.prepare(`
      SELECT challenge_id, device_id, public_key, nonce, expires_at, consumed_at
      FROM device_challenges
      WHERE challenge_id = ?
    `).get(body.challenge_id) as {
      challenge_id: string;
      device_id: string;
      public_key: string;
      nonce: string;
      expires_at: string;
      consumed_at: string | null;
    } | undefined;

    if (!challenge || challenge.device_id !== body.device_id) {
      return reply.status(401).send({ error: 'invalid challenge' });
    }
    if (challenge.consumed_at) {
      return reply.status(401).send({ error: 'challenge already used' });
    }
    if (new Date(challenge.expires_at) <= new Date()) {
      return reply.status(401).send({ error: 'challenge expired' });
    }
    if (!verifySignature(challenge.public_key, challenge.nonce, body.signature)) {
      return reply.status(401).send({ error: 'invalid signature' });
    }

    db.prepare(
      `UPDATE device_challenges SET consumed_at = ? WHERE challenge_id = ?`
    ).run(new Date().toISOString(), body.challenge_id);

    db.prepare(`
      INSERT INTO device_registrations (user_id, public_key, last_seen)
      VALUES (?, ?, NULL)
      ON CONFLICT(user_id) DO UPDATE SET
        public_key = excluded.public_key,
        last_seen = NULL
    `).run(body.device_id, challenge.public_key);

    const existingRotation = db.prepare(
      `SELECT active_device_id FROM free_device_rotation WHERE scope_id = 1`
    ).get() as { active_device_id: string } | undefined;

    let graceExpiresAt: string | null = null;
    if (!existingRotation) {
      db.prepare(`
        INSERT INTO free_device_rotation (scope_id, active_device_id, previous_active_device_id, grace_expires_at)
        VALUES (1, ?, NULL, NULL)
      `).run(body.device_id);
    } else if (existingRotation.active_device_id !== body.device_id) {
      graceExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      db.prepare(`
        UPDATE free_device_rotation
        SET previous_active_device_id = active_device_id,
            active_device_id = ?,
            grace_expires_at = ?
        WHERE scope_id = 1
      `).run(body.device_id, graceExpiresAt);
    }

    return reply.send({ ok: true, user_id: body.device_id, grace_expires_at: graceExpiresAt });
  });

  // GET /api/stream
  fastify.get('/api/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getStreamUserId(req, db);
    if (!userId || !userId.startsWith('dev_')) {
      return reply.status(401).send({ error: 'Missing or invalid X-Device-Id header for registered device' });
    }
    if (!sseManager) {
      return reply.status(503).send({ error: 'SSE manager unavailable' });
    }

    sseManager.register(userId, reply);
    db.prepare(`UPDATE device_registrations SET last_seen = datetime('now') WHERE user_id = ?`).run(userId);

    req.raw.on('close', () => {
      sseManager.remove(userId, reply);
    });
  });

  // GET /api/feed
  fastify.get('/api/feed', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as FeedQuery;
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    if (!isPaidTier(userId)) {
      return reply.status(403).send({ error: 'feed endpoint disabled for free tier; use paid queue workflow' });
    }
    const limit = Math.min(Math.max(1, parseInt(q.limit ?? '50', 10) || 50), 200);
    const offset = Math.max(0, parseInt(q.offset ?? '0', 10) || 0);

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
      SELECT id, user_id, source, source_type, content_type, card_type, title, author, url, content_preview,
             thumbnail_url, tags, is_discovery, published_at, fetched_at, is_read, is_saved, action_label, action_icon, metadata_json
      FROM feed_items
      ${where}
      ORDER BY published_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<{
      id: string;
      source: string;
      source_type: string | null;
      content_type: string | null;
      card_type: string | null;
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
      action_label: string | null;
      action_icon: string | null;
      metadata_json: string | null;
    }>;

    const items = rows.map((row) => ({
      ...row,
      tags: parseTags(row.tags),
      is_discovery: row.is_discovery === 1,
      is_read: row.is_read === 1,
      is_saved: row.is_saved === 1,
      metadata: parseMetadata(row.metadata_json),
    }));

    return reply.send({ items, total: countRow.total, limit, offset });
  });

  // PATCH /api/feed/:id/read
  fastify.patch('/api/feed/:id/read', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const result = db.prepare(
      `UPDATE feed_items SET is_read = 1 WHERE id = ? AND user_id = ?`
    ).run(decodeURIComponent(id), userId);
    return reply.send({ ok: result.changes > 0 });
  });

  // PATCH /api/feed/:id/unread
  fastify.patch('/api/feed/:id/unread', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const result = db.prepare(
      `UPDATE feed_items SET is_read = 0 WHERE id = ? AND user_id = ?`
    ).run(decodeURIComponent(id), userId);
    return reply.send({ ok: result.changes > 0 });
  });

  // PATCH /api/feed/:id/save
  fastify.patch('/api/feed/:id/save', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const result = db.prepare(
      `UPDATE feed_items SET is_saved = 1 WHERE id = ? AND user_id = ?`
    ).run(decodeURIComponent(id), userId);
    return reply.send({ ok: result.changes > 0 });
  });

  // PATCH /api/feed/:id/unsave
  fastify.patch('/api/feed/:id/unsave', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const result = db.prepare(
      `UPDATE feed_items SET is_saved = 0 WHERE id = ? AND user_id = ?`
    ).run(decodeURIComponent(id), userId);
    return reply.send({ ok: result.changes > 0 });
  });

  // POST /api/feed/mark-all-read
  fastify.post('/api/feed/mark-all-read', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { source?: string };
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    if (q.source) {
      db.prepare(
        `UPDATE feed_items SET is_read = 1 WHERE user_id = ? AND source = ? AND is_read = 0`
      ).run(userId, q.source);
    } else {
      db.prepare(
        `UPDATE feed_items SET is_read = 1 WHERE user_id = ? AND is_read = 0`
      ).run(userId);
    }
    return reply.send({ ok: true });
  });

  // GET /api/stats
  fastify.get('/api/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as { discovery?: string };
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    let discoveryFilter = '';
    if (q.discovery === 'true' || q.discovery === '1') {
      discoveryFilter = ' AND is_discovery = 1';
    } else if (q.discovery === 'false' || q.discovery === '0') {
      discoveryFilter = ' AND is_discovery = 0';
    }

    const total = (db.prepare(
      `SELECT COUNT(*) as n FROM feed_items WHERE user_id = ?${discoveryFilter}`
    ).get(userId) as { n: number }).n;

    const unread = (db.prepare(
      `SELECT COUNT(*) as n FROM feed_items WHERE user_id = ? AND is_read = 0${discoveryFilter}`
    ).get(userId) as { n: number }).n;

    const bySource = db.prepare(`
      SELECT source,
             COUNT(*) as count,
             SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM feed_items
      WHERE user_id = ?${discoveryFilter}
      GROUP BY source
    `).all(userId) as Array<{ source: string; count: number; unread: number }>;

    return reply.send({ total, unread, by_source: bySource });
  });

  // GET /api/sync/status
  fastify.get('/api/sync/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const missed = db.prepare(`
      SELECT source, attempted_at, status, item_count
      FROM sync_attempts
      WHERE user_id = ?
        AND status != 'relayed'
        AND attempted_at >= datetime('now', '-1 day')
      ORDER BY attempted_at DESC
    `).all(userId) as Array<{
      source: string;
      attempted_at: string;
      status: 'device_offline' | 'error';
      item_count: number;
    }>;

    const relayedRows = db.prepare(`
      SELECT attempted_at
      FROM sync_attempts
      WHERE user_id = ? AND status = 'relayed'
      ORDER BY attempted_at DESC
      LIMIT 10
    `).all(userId) as Array<{
      attempted_at: string;
    }>;

    let nextSyncEstimate: string | null = null;
    if (relayedRows.length >= 2) {
      const timestamps = relayedRows
        .map((row) => Date.parse(row.attempted_at))
        .filter((ts) => !Number.isNaN(ts))
        .sort((a, b) => a - b);
      if (timestamps.length >= 2) {
        const intervals = timestamps.slice(1).map((ts, idx) => ts - timestamps[idx]);
        const avgInterval = intervals.reduce((sum, n) => sum + n, 0) / intervals.length;
        const last = timestamps[timestamps.length - 1];
        nextSyncEstimate = new Date(last + avgInterval).toISOString();
      }
    }

    return reply.send({ missed, next_sync_estimate: nextSyncEstimate });
  });

  // GET /api/push/vapid-key
  fastify.get('/api/push/vapid-key', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const row = db.prepare(
      `SELECT value FROM user_preferences WHERE user_id = ? AND key = 'vapid_public_key'`
    ).get(userId) as { value: string } | undefined;
    // Vapid key comes from config, exposed via a stored pref set at startup
    return reply.send({ key: row?.value ?? null });
  });

  // POST /api/push/subscribe
  fastify.post('/api/push/subscribe', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const body = req.body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return reply.status(400).send({ error: 'endpoint and keys.p256dh and keys.auth are required' });
    }

    db.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
      VALUES (?, ?, ?, ?)
    `).run(userId, body.endpoint, body.keys.p256dh, body.keys.auth);

    return reply.send({ ok: true });
  });

  // POST /api/push/unsubscribe
  fastify.post('/api/push/unsubscribe', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const body = req.body as { endpoint: string };

    if (!body?.endpoint) {
      return reply.status(400).send({ error: 'endpoint is required' });
    }

    db.prepare(
      `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`
    ).run(userId, body.endpoint);

    return reply.send({ ok: true });
  });

  // GET /api/sources
  fastify.get('/api/sources', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const rows = db.prepare(
      `SELECT name, enabled, urls, max_items, created_at FROM user_sources WHERE user_id = ? ORDER BY name`
    ).all(userId) as Array<{ name: string; enabled: number; urls: string | null; max_items: number | null; created_at: string }>;

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
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
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
        `INSERT INTO user_sources (user_id, name, urls, max_items) VALUES (?, ?, ?, ?)`
      ).run(userId, name, urls, maxItems);
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
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const { name } = req.params as { name: string };
    const body = req.body as { enabled?: number; urls?: string[]; max_items?: number | null };

    const sets: string[] = [];
    const setParams: unknown[] = [];
    const whereParams: unknown[] = [userId, decodeURIComponent(name)];

    if (body.enabled != null) {
      sets.push('enabled = ?');
      setParams.push(body.enabled);
    }
    if (body.urls != null) {
      sets.push('urls = ?');
      setParams.push(JSON.stringify(body.urls));
    }
    if (body.max_items !== undefined) {
      sets.push('max_items = ?');
      setParams.push(body.max_items);
    }

    if (sets.length === 0) {
      return reply.status(400).send({ error: 'nothing to update' });
    }

    const result = db.prepare(
      `UPDATE user_sources SET ${sets.join(', ')} WHERE user_id = ? AND name = ?`
    ).run(...setParams, ...whereParams);

    if (result.changes === 0) {
      return reply.status(404).send({ error: 'source not found' });
    }

    return reply.send({ ok: true });
  });

  // DELETE /api/sources/:name
  fastify.delete('/api/sources/:name', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const { name } = req.params as { name: string };
    const result = db.prepare(
      `DELETE FROM user_sources WHERE user_id = ? AND name = ?`
    ).run(userId, decodeURIComponent(name));

    if (result.changes === 0) {
      return reply.status(404).send({ error: 'source not found' });
    }

    return reply.send({ ok: true });
  });

  const listTokensHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const rows = db.prepare(
      `SELECT token_hash, label, created_at, last_used FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC`
    ).all(userId) as Array<{ token_hash: string; label: string | null; created_at: string; last_used: string | null }>;
    return reply.send(rows);
  };
  // GET /api/v1/tokens
  fastify.get('/api/v1/tokens', listTokensHandler);

  const createTokenHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const body = req.body as { label?: string } | null;
    const label = (body?.label ?? '').trim() || 'agent';
    const plain = randomBytes(32).toString('hex');
    const hash = createHash('sha256').update(plain).digest('hex');
    db.prepare(
      `INSERT INTO agent_tokens (token_hash, user_id, label) VALUES (?, ?, ?)`
    ).run(hash, userId, label);
    return reply.status(201).send({ token: plain, token_hash: hash, label });
  };
  // POST /api/v1/tokens
  fastify.post('/api/v1/tokens', createTokenHandler);

  const revokeTokenHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const { hash } = req.params as { hash: string };
    const result = db.prepare(
      `DELETE FROM agent_tokens WHERE token_hash = ? AND user_id = ?`
    ).run(hash, userId);
    if (result.changes === 0) {
      return reply.status(404).send({ error: 'token not found' });
    }
    return reply.send({ ok: true });
  };
  // DELETE /api/v1/tokens/:hash
  fastify.delete('/api/v1/tokens/:hash', revokeTokenHandler);

  // POST /api/v1/queue/ack
  fastify.post('/api/v1/queue/ack', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as { delivery_id?: string; device_id?: string };
    if (!body?.delivery_id || !body?.device_id) {
      return reply.status(400).send({ error: 'delivery_id and device_id are required' });
    }

    const existing = db.prepare(`
      SELECT user_id, acked_at
      FROM paid_queue_deliveries
      WHERE delivery_id = ? AND device_id = ?
    `).get(body.delivery_id, body.device_id) as { user_id: string; acked_at: string | null } | undefined;

    if (!existing) {
      return reply.status(404).send({ error: 'delivery not found' });
    }

    if (!existing.acked_at) {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE paid_queue_deliveries
        SET acked_at = ?, status = 'acked'
        WHERE delivery_id = ? AND device_id = ?
      `).run(now, body.delivery_id, body.device_id);

      const hasAnyAck = db.prepare(`
        SELECT 1 as ok
        FROM paid_queue_deliveries
        WHERE delivery_id = ? AND acked_at IS NOT NULL
        LIMIT 1
      `).get(body.delivery_id) as { ok: number } | undefined;

      if (hasAnyAck) {
        db.prepare(`
          INSERT INTO paid_queue_cursor (user_id, last_acked_delivery_id, last_acked_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            last_acked_delivery_id = excluded.last_acked_delivery_id,
            last_acked_at = excluded.last_acked_at
        `).run(existing.user_id, body.delivery_id, now);
      }
    }

    return reply.send({ ok: true, status: 'acked' });
  });
}
