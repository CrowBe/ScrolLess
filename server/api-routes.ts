import { randomBytes, createHash, createPublicKey, createVerify, timingSafeEqual } from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import fastifyRateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { readPreferences, sanitizeBlockedKeywords } from './preferences.js';
import { ContentError, getStats, listItems, markAllRead, recordFeedback, removeFeedback, updateItemState } from './content-store.js';

const SESSION_SIZE_MIN = 5;
const SESSION_SIZE_MAX = 100;

interface ApiRouteOptions {
  deviceEnrollmentToken?: string;
}

const deviceIdSchema = z.string().regex(/^dev_[A-Za-z0-9._-]+$/, 'device_id must start with dev_');
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
const pushSubscribeSchema = z.object({
  endpoint: z.string().url('endpoint must be a valid URL'),
  keys: z.object({
    p256dh: z.string().min(1, 'keys.p256dh is required'),
    auth: z.string().min(1, 'keys.auth is required'),
  }),
});
const preferencesPatchSchema = z.object({
  blocked_keywords: z.array(z.string()).optional(),
  max_items_per_source: z.number().int().min(1).max(500).optional(),
  session_size: z.number().int().min(SESSION_SIZE_MIN).max(SESSION_SIZE_MAX).optional(),
}).refine(
  (body) =>
    body.blocked_keywords !== undefined ||
    body.max_items_per_source !== undefined ||
    body.session_size !== undefined,
  { message: 'nothing to update' }
);

const itemsQuerySchema = z.object({
  view: z.enum(['feed', 'discover', 'saved', 'all']).optional(),
  unread: z.enum(['0', '1']).optional(),
  source: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(1_000).optional(),
});
const itemPatchSchema = z.object({
  is_read: z.boolean().optional(),
  is_saved: z.boolean().optional(),
  expected_version: z.number().int().min(0).optional(),
}).refine((body) => body.is_read !== undefined || body.is_saved !== undefined, {
  message: 'nothing to update',
});
const feedbackSchema = z.object({
  verdict: z.enum(['like', 'dislike', 'save']),
});
const markReadSchema = z.object({
  source: z.string().trim().min(1).max(64).optional(),
});

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

function lookupSessionToken(plain: string, db: Database.Database): string | null {
  const tokenHash = createHash('sha256').update(plain).digest('hex');
  const session = db.prepare(
    `SELECT device_id FROM device_sessions WHERE token_hash = ? AND expires_at > datetime('now')`
  ).get(tokenHash) as { device_id: string } | undefined;
  return session ? session.device_id : null;
}

/**
 * The personal host has a single owner, 'local'. Reader devices authenticate
 * with a session token from challenge/verify; every authenticated device acts
 * for that owner. Returns the owner ID, or null when unauthenticated.
 */
function getRequestUserId(req: FastifyRequest, db: Database.Database): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader) {
    const match = /^Bearer (dsess_[A-Za-z0-9]+)$/.exec(authHeader);
    // Unrecognised Authorization header — reject even in dev mode
    return match && lookupSessionToken(match[1], db) ? 'local' : null;
  }

  // No auth headers: fall back to 'local' in non-production only
  return process.env.NODE_ENV === 'production' ? null : 'local';
}

export function registerApiRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  options?: ApiRouteOptions
): void {
  const enrollmentToken = options?.deviceEnrollmentToken?.trim() || null;

  const hasValidEnrollmentToken = (providedRaw: string | undefined): boolean => {
    // Without a configured token, enrollment is open outside production only
    if (!enrollmentToken) return process.env.NODE_ENV !== 'production';
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

  const challengeHandler = async (req: FastifyRequest, reply: FastifyReply) => {
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
  };

  const verifyHandler = async (req: FastifyRequest, reply: FastifyReply) => {
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

    const sessionPlain = `dsess_${randomBytes(24).toString('hex')}`;
    const sessionHash = createHash('sha256').update(sessionPlain).digest('hex');
    const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO device_sessions (token_hash, device_id, expires_at) VALUES (?, ?, ?)`
    ).run(sessionHash, body.device_id, sessionExpiresAt);

    return reply.send({
      ok: true,
      user_id: body.device_id,
      session_token: sessionPlain,
      session_expires_at: sessionExpiresAt,
    });
  };

  // Rate-limited scope for the three unauthenticated device endpoints
  // (enrollment-token-gated, but still brute-forceable over the wire).
  fastify.register(async (scope) => {
    await scope.register(fastifyRateLimit, {
      max: 20,
      timeWindow: '1 minute',
      keyGenerator: (req) => req.ip,
    });
    scope.post('/api/v1/device/challenge', challengeHandler);
    scope.post('/api/v1/device/verify', verifyHandler);
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
      max_items_per_source: body.max_items_per_source ?? current.max_items_per_source,
      session_size: body.session_size ?? current.session_size,
    };

    const save = db.transaction(() => {
      const upsert = db.prepare(
        `INSERT INTO user_preferences (user_id, key, value)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
      );
      upsert.run(userId, 'blocked_keywords', JSON.stringify(next.blocked_keywords));
      upsert.run(userId, 'max_items_per_source', JSON.stringify(next.max_items_per_source));
      upsert.run(userId, 'session_size', JSON.stringify(next.session_size));
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

  // ── Host content ──
  const requireReader = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const owner = getRequestUserId(req, db);
    if (!owner) reply.status(401).send({ error: 'Unauthorized device' });
    return owner;
  };

  // GET /api/items — readable host feed, newest first, cursor-paginated
  fastify.get('/api/items', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireReader(req, reply);
    if (!owner) return;
    const query = parseBody(itemsQuerySchema, req.query, reply);
    if (!query) return;

    try {
      const result = listItems(db, owner, {
        view: query.view ?? 'feed',
        source: query.source?.toLowerCase(),
        limit: query.limit ?? 50,
        cursor: query.cursor,
        unreadOnly: query.unread === '1',
      });
      return reply.send(result);
    } catch (err) {
      if (err instanceof ContentError && err.code === 'invalid_cursor') {
        return reply.status(400).send({ error: err.message });
      }
      throw err;
    }
  });

  // GET /api/items/stats — counts for the source filter
  fastify.get('/api/items/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireReader(req, reply);
    if (!owner) return;
    return reply.send(getStats(db, owner));
  });

  // POST /api/items/mark-read — mark all (or one source's) items read
  fastify.post('/api/items/mark-read', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireReader(req, reply);
    if (!owner) return;
    const body = parseBody(markReadSchema, req.body ?? {}, reply);
    if (!body) return;
    return reply.send({ updated: markAllRead(db, owner, body.source?.toLowerCase()) });
  });

  // PUT /api/items/:id/feedback — record a swipe verdict (marks read; save also saves)
  fastify.put('/api/items/:id/feedback', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireReader(req, reply);
    if (!owner) return;
    const { id } = req.params as { id: string };
    const body = parseBody(feedbackSchema, req.body, reply);
    if (!body) return;
    const result = recordFeedback(db, owner, id, body.verdict);
    if (!result) return reply.status(404).send({ error: 'item not found' });
    return reply.send(result);
  });

  // DELETE /api/items/:id/feedback — undo a swipe
  fastify.delete('/api/items/:id/feedback', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireReader(req, reply);
    if (!owner) return;
    const { id } = req.params as { id: string };
    const result = removeFeedback(db, owner, id);
    if (!result) return reply.status(404).send({ error: 'feedback not found' });
    return reply.send(result);
  });

  // PATCH /api/items/:id — read/save state with optional optimistic concurrency
  fastify.patch('/api/items/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const owner = requireReader(req, reply);
    if (!owner) return;
    const { id } = req.params as { id: string };
    const body = parseBody(itemPatchSchema, req.body, reply);
    if (!body) return;

    const result = updateItemState(db, owner, id, body);
    if (!result.ok) {
      if (result.code === 'not_found') return reply.status(404).send({ error: 'item not found' });
      return reply.status(409).send({ error: 'version conflict', current: result.state });
    }
    return reply.send(result.state);
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


}
