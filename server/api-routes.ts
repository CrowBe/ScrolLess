import { randomBytes, createHash, createPublicKey, createVerify, timingSafeEqual } from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { SseManager } from './sse-manager.js';
import { DEFAULT_PREFERENCES, readPreferences, sanitizeBlockedKeywords } from './preferences.js';

interface ApiRouteOptions {
  deviceEnrollmentToken?: string;
}

const deviceIdSchema = z.string().regex(/^dev_[A-Za-z0-9._-]+$/, 'device_id must start with dev_');
const deviceRegisterSchema = z.object({
  public_key: z.string().trim().min(1, 'public_key is required'),
  device_id: deviceIdSchema,
});
const deviceChallengeSchema = z.object({
  device_id: deviceIdSchema,
  public_key: z.string().trim().min(1, 'public_key is required'),
});
const deviceVerifySchema = z.object({
  challenge_id: z.string().trim().min(1, 'challenge_id is required'),
  device_id: deviceIdSchema,
  signature: z.string().trim().min(1, 'signature is required'),
});
const sourceCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  urls: z.array(z.string().url('Invalid URL')).min(1, 'at least one url is required'),
  max_items: z.number().int().positive().max(500).optional(),
});
const sourcePatchSchema = z.object({
  enabled: z.union([z.literal(0), z.literal(1)]).optional(),
  urls: z.array(z.string().url('Invalid URL')).min(1, 'at least one url is required').optional(),
  max_items: z.number().int().positive().max(500).nullable().optional(),
}).refine((body) => body.enabled !== undefined || body.urls !== undefined || body.max_items !== undefined, {
  message: 'nothing to update',
});
const queueAckSchema = z.object({
  delivery_id: z.string().trim().min(1, 'delivery_id is required'),
  device_id: deviceIdSchema,
});
const pushSubscribeSchema = z.object({
  endpoint: z.string().url('endpoint must be a valid URL'),
  keys: z.object({
    p256dh: z.string().min(1, 'keys.p256dh is required'),
    auth: z.string().min(1, 'keys.auth is required'),
  }),
});
const preferencesPatchSchema = z.object({
  blocked_keywords: z.array(z.string()).optional(),
  retention_days: z.number().int().min(1).max(365).optional(),
  max_items_per_source: z.number().int().min(1).max(500).optional(),
}).refine(
  (body) =>
    body.blocked_keywords !== undefined ||
    body.retention_days !== undefined ||
    body.max_items_per_source !== undefined,
  { message: 'nothing to update' }
);

function parseBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  reply: FastifyReply
): T | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    reply.status(400).send({ error: first?.message ?? 'invalid request' });
    return null;
  }
  return parsed.data;
}

function getRequestUserId(req: FastifyRequest, db: Database.Database): string | null {
  const userIdHeader = req.headers['x-device-id'];
  const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;

  if (!userId) {
    return process.env.NODE_ENV === 'production' ? null : 'local';
  }
  if (userId.startsWith('usr_')) {
    return userId;
  }
  if (!userId.startsWith('dev_')) {
    return process.env.NODE_ENV === 'production' ? null : 'local';
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
  sseManager?: SseManager,
  options?: ApiRouteOptions
): void {
  const enrollmentToken = options?.deviceEnrollmentToken?.trim() || null;

  const hasValidEnrollmentToken = (providedRaw: string | undefined): boolean => {
    if (!enrollmentToken) return true;
    if (!providedRaw) return false;
    const expected = Buffer.from(enrollmentToken);
    const received = Buffer.from(providedRaw);
    if (expected.length !== received.length) return false;
    return expected.length > 0 && timingSafeEqual(expected, received);
  };

  const requireEnrollmentToken = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const header = req.headers['x-device-enroll-token'];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!hasValidEnrollmentToken(provided)) {
      reply.status(401).send({ error: 'Missing or invalid X-Device-Enroll-Token header' });
      return false;
    }
    return true;
  };

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
    if (!requireEnrollmentToken(req, reply)) return;
    const body = parseBody(deviceRegisterSchema, req.body, reply);
    if (!body) return;

    db.prepare(`
      INSERT INTO device_registrations (user_id, public_key, last_seen)
      VALUES (?, ?, NULL)
      ON CONFLICT(user_id) DO UPDATE SET
        public_key = excluded.public_key,
        last_seen = NULL
    `).run(body.device_id, body.public_key);

    return reply.status(201).send({ user_id: body.device_id, ok: true });
  };
  // POST /api/v1/device/register
  fastify.post('/api/v1/device/register', registerDeviceHandler);

  // POST /api/v1/device/challenge
  fastify.post('/api/v1/device/challenge', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!requireEnrollmentToken(req, reply)) return;
    const body = parseBody(deviceChallengeSchema, req.body, reply);
    if (!body) return;

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
    const body = parseBody(deviceVerifySchema, req.body, reply);
    if (!body) return;

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

  // GET /api/stream — SSE relay endpoint
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

    // Expire stale queued rows
    db.prepare(`
      UPDATE free_queue_deliveries
      SET status = 'expired'
      WHERE user_id = ?
        AND status = 'queued'
        AND expires_at <= datetime('now')
    `).run(userId);

    // Drain any queued payloads immediately on reconnect
    const queuedRows = db.prepare(`
      SELECT id, payload_envelope
      FROM free_queue_deliveries
      WHERE user_id = ?
        AND status = 'queued'
        AND expires_at > datetime('now')
      ORDER BY queued_at ASC
      LIMIT 25
    `).all(userId) as Array<{ id: number; payload_envelope: string }>;

    for (const row of queuedRows) {
      try {
        const payload = JSON.parse(row.payload_envelope) as Record<string, unknown>;
        const delivered = sseManager.send(userId, 'feed_items', payload);
        if (delivered) {
          db.prepare(`
            UPDATE free_queue_deliveries
            SET status = 'delivered', delivered_at = datetime('now')
            WHERE id = ?
          `).run(row.id);
        } else {
          break;
        }
      } catch {
        db.prepare(`
          UPDATE free_queue_deliveries
          SET status = 'expired'
          WHERE id = ?
        `).run(row.id);
      }
    }

    req.raw.on('close', () => {
      sseManager.remove(userId, reply);
    });
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
    `).all(userId) as Array<{ attempted_at: string }>;

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

  // GET /api/preferences
  fastify.get('/api/preferences', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    return reply.send(readPreferences(db, userId));
  });

  // PATCH /api/preferences
  fastify.patch('/api/preferences', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const body = parseBody(preferencesPatchSchema, req.body, reply);
    if (!body) return;

    const current = readPreferences(db, userId);
    const next = {
      blocked_keywords:
        body.blocked_keywords !== undefined
          ? sanitizeBlockedKeywords(body.blocked_keywords)
          : current.blocked_keywords,
      retention_days: body.retention_days ?? current.retention_days,
      max_items_per_source: body.max_items_per_source ?? current.max_items_per_source,
    };

    const save = db.transaction(() => {
      const upsert = db.prepare(
        `INSERT INTO user_preferences (user_id, key, value)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
      );
      upsert.run(userId, 'blocked_keywords', JSON.stringify(next.blocked_keywords));
      upsert.run(userId, 'retention_days', JSON.stringify(next.retention_days));
      upsert.run(userId, 'max_items_per_source', JSON.stringify(next.max_items_per_source));
    });

    save();
    return reply.send(next);
  });

  // GET /api/push/vapid-key — VAPID key is global server config, not per-user
  fastify.get('/api/push/vapid-key', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const row = db.prepare(
      `SELECT value FROM user_preferences WHERE user_id = 'local' AND key = 'vapid_public_key'`
    ).get() as { value: string } | undefined;
    return reply.send({ key: row?.value ?? null });
  });

  // POST /api/push/subscribe
  fastify.post('/api/push/subscribe', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const body = parseBody(pushSubscribeSchema, req.body, reply);
    if (!body) return;

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
    const body = parseBody(sourceCreateSchema, req.body, reply);
    if (!body) return;

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
    const body = parseBody(sourcePatchSchema, req.body, reply);
    if (!body) return;

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

  // GET /api/v1/tokens
  fastify.get('/api/v1/tokens', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });
    const rows = db.prepare(
      `SELECT token_hash, label, created_at, last_used FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC`
    ).all(userId) as Array<{ token_hash: string; label: string | null; created_at: string; last_used: string | null }>;
    return reply.send(rows);
  });

  // POST /api/v1/tokens
  fastify.post('/api/v1/tokens', async (req: FastifyRequest, reply: FastifyReply) => {
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
  });

  // DELETE /api/v1/tokens/:hash
  fastify.delete('/api/v1/tokens/:hash', async (req: FastifyRequest, reply: FastifyReply) => {
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
  });

  // POST /api/v1/queue/ack
  fastify.post('/api/v1/queue/ack', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getRequestUserId(req, db);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized device' });

    const body = parseBody(queueAckSchema, req.body, reply);
    if (!body) return;

    // Verify the device_id in the body belongs to the authenticated user
    const deviceRow = db.prepare(
      `SELECT user_id FROM device_registrations WHERE user_id = ?`
    ).get(body.device_id) as { user_id: string } | undefined;

    if (!deviceRow || deviceRow.user_id !== userId) {
      return reply.status(403).send({ error: 'device_id does not belong to authenticated user' });
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
