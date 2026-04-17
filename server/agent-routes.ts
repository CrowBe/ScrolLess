import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { AgentFeedResponse, AgentState, AgentPreferences, AgentSyncContext, AgentSyncSource, AgentEncryptedFeedPayload } from './types.js';
import type { SseManager } from './sse-manager.js';
import { readPreferences } from './preferences.js';

// Augment FastifyRequest to include userId attached by auth hook
declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

export type PushCallback = (userId: string, source: string, count: number, latestTitle?: string) => Promise<void>;
const FREE_QUEUE_TTL_MINUTES = 15;

// ── Shared business logic (used by both REST routes and MCP tools) ──

export function getSyncContext(db: Database.Database, userId: string): AgentSyncContext {
  const device = db.prepare(
    `SELECT public_key FROM device_registrations WHERE user_id = ?`
  ).get(userId) as { public_key: string } | undefined;

  const sourceRows = db.prepare(
    `SELECT name, enabled, urls, max_items, scraping_notes, last_sync_at FROM user_sources WHERE user_id = ?`
  ).all(userId) as Array<{
    name: string;
    enabled: number;
    urls: string;
    max_items: number | null;
    scraping_notes: string | null;
    last_sync_at: string | null;
  }>;

  const prefs = readPreferences(db, userId);
  const globalMaxItems = prefs.max_items_per_source;
  const blockedKeywords = prefs.blocked_keywords;

  const sources: AgentSyncSource[] = sourceRows.map(row => {
    if (!row.enabled) {
      return { name: row.name, enabled: false };
    }
    return {
      name: row.name,
      enabled: true,
      urls: JSON.parse(row.urls) as string[],
      last_sync: row.last_sync_at ?? null,
      max_items: row.max_items ?? globalMaxItems,
      scraping_resource: `scrolless://platforms/${row.name}`,
    };
  });

  return {
    encryption: {
      public_key: device?.public_key ?? '',
      algorithm: 'ECIES-P256-AES256GCM',
    },
    sources,
    filters: { blocked_keywords: blockedKeywords },
  };
}

export interface SubmitPayloadResult {
  relayed?: number;
  queued?: number;
  queue_ttl_minutes?: number;
}

export function submitEncryptedPayload(
  db: Database.Database,
  userId: string,
  payload: AgentEncryptedFeedPayload,
  sseManager: SseManager | undefined,
  pushCallback: PushCallback | undefined
): SubmitPayloadResult {
  const relayed = sseManager?.send(userId, 'feed_items', payload) ?? false;
  const status = relayed ? 'relayed' : 'device_offline';

  db.prepare(`
    INSERT INTO sync_attempts (user_id, source, item_count, status)
    VALUES (?, ?, ?, ?)
  `).run(userId, payload.source, payload.items.length, status);

  if (!relayed) {
    const queueCount = (db.prepare(
      `SELECT COUNT(*) as n FROM free_queue_deliveries WHERE user_id = ? AND status = 'queued'`
    ).get(userId) as { n: number }).n;
    if (queueCount >= 500) {
      return { queued: 0, queue_ttl_minutes: FREE_QUEUE_TTL_MINUTES };
    }
    db.prepare(`
      INSERT INTO free_queue_deliveries (user_id, payload_envelope, expires_at, status)
      VALUES (?, ?, datetime('now', '+' || ? || ' minutes'), 'queued')
    `).run(userId, JSON.stringify(payload), FREE_QUEUE_TTL_MINUTES);
    pushCallback?.(userId, payload.source, payload.items.length, undefined).catch(() => {});
    return { queued: payload.items.length, queue_ttl_minutes: FREE_QUEUE_TTL_MINUTES };
  }

  db.prepare(`
    UPDATE user_sources
    SET last_sync_at = datetime('now')
    WHERE user_id = ? AND name = ?
  `).run(userId, payload.source);

  return { relayed: payload.items.length };
}

// ── REST route registration ──

export function registerAgentRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  onNewItems?: PushCallback,
  sseManager?: SseManager
): void {
  // GET /agent/sync-context
  fastify.get('/agent/sync-context', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId ?? 'local';
    return reply.send(getSyncContext(db, userId));
  });

  // POST /agent/feed-items
  fastify.post('/agent/feed-items', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId ?? 'local';
    const body = req.body as AgentEncryptedFeedPayload;

    if (!body || typeof body.source !== 'string' || !body.source.trim()) {
      return reply.status(400).send({ error: '`source` is required and must be a non-empty string' });
    }
    if (!Array.isArray(body.items)) {
      return reply.status(400).send({ error: '`items` is required and must be an array' });
    }
    if (body.items.length > 200) {
      return reply.status(400).send({ error: '`items` must not exceed 200 per batch' });
    }

    if (!body.ephemeral_public_key || typeof body.ephemeral_public_key !== 'string') {
      return reply.status(400).send({ error: '`ephemeral_public_key` is required for encrypted relay payloads' });
    }
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];
      if (!item.source_id || typeof item.source_id !== 'string') {
        return reply.status(400).send({ error: `items[${i}].source_id is required` });
      }
      if (!item.url || typeof item.url !== 'string') {
        return reply.status(400).send({ error: `items[${i}].url is required` });
      }
      if (item.url.length > 2048) {
        return reply.status(400).send({ error: `items[${i}].url must not exceed 2048 characters` });
      }
      // Validate URL format
      try {
        new URL(item.url);
      } catch {
        return reply.status(400).send({ error: `items[${i}].url must be a valid URL` });
      }
      if (!item.published_at || typeof item.published_at !== 'string' || Number.isNaN(Date.parse(item.published_at))) {
        return reply.status(400).send({ error: `items[${i}].published_at must be a valid ISO 8601 date string` });
      }
      if (!item.encrypted_fields || typeof item.encrypted_fields !== 'string') {
        return reply.status(400).send({ error: `items[${i}].encrypted_fields is required` });
      }
      if (item.encrypted_fields.length > 64_000) {
        return reply.status(400).send({ error: `items[${i}].encrypted_fields must not exceed 64,000 characters` });
      }
    }

    const result = submitEncryptedPayload(db, userId, body, sseManager, onNewItems);
    const httpStatus = result.queued !== undefined ? 202 : 200;
    return reply.status(httpStatus).send(result satisfies AgentFeedResponse);
  });

  // GET /agent/state
  fastify.get('/agent/state', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId ?? 'local';

    const rows = db.prepare(`
      SELECT us.name as source,
             us.last_sync_at as last_sync,
             COALESCE(sa.item_count, 0) as item_count
      FROM user_sources us
      LEFT JOIN (
        SELECT source, item_count
        FROM sync_attempts s1
        WHERE user_id = ?
          AND status = 'relayed'
          AND attempted_at = (
            SELECT MAX(s2.attempted_at)
            FROM sync_attempts s2
            WHERE s2.user_id = s1.user_id
              AND s2.source = s1.source
              AND s2.status = 'relayed'
          )
      ) sa ON sa.source = us.name
      WHERE us.user_id = ?
    `).all(userId, userId) as Array<{ source: string; last_sync: string | null; item_count: number }>;

    const sources: AgentState['sources'] = {};
    for (const row of rows) {
      sources[row.source] = {
        last_sync: row.last_sync,
        item_count: row.item_count,
      };
    }

    return reply.send({ sources } satisfies AgentState);
  });

  // GET /agent/preferences
  fastify.get('/agent/preferences', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId ?? 'local';
    const prefs = readPreferences(db, userId);
    return reply.send({
      blocked_keywords: prefs.blocked_keywords,
      max_items_per_source: prefs.max_items_per_source,
    } satisfies AgentPreferences);
  });
}

/**
 * Global cleanup — runs across all users.
 * Purges expired OAuth codes/tokens, stale free queue rows, and old sync_attempts.
 */
export function cleanupGlobal(db: Database.Database): void {
  // Expire and purge stale free queue rows
  db.prepare(`
    UPDATE free_queue_deliveries
    SET status = 'expired'
    WHERE status = 'queued' AND expires_at <= datetime('now')
  `).run();

  const freeQueueResult = db.prepare(`
    DELETE FROM free_queue_deliveries
    WHERE (status = 'delivered' AND delivered_at < datetime('now', '-1 day'))
       OR (status = 'expired' AND expires_at < datetime('now', '-1 day'))
  `).run();

  // Purge acked/expired paid queue rows
  const paidQueueResult = db.prepare(`
    DELETE FROM paid_queue_deliveries
    WHERE (status = 'acked' AND acked_at IS NOT NULL AND acked_at < datetime('now', '-1 day'))
       OR (status = 'expired' AND expires_at < datetime('now', '-1 day'))
  `).run();

  // Purge expired OAuth codes (global — not scoped per user)
  const authCodesResult = db.prepare(
    `DELETE FROM oauth_auth_codes WHERE expires_at < datetime('now')`
  ).run();

  // Purge OAuth tokens where both access and refresh have expired
  const oauthTokensResult = db.prepare(
    `DELETE FROM oauth_tokens WHERE access_expires < datetime('now') AND (refresh_expires IS NULL OR refresh_expires < datetime('now'))`
  ).run();

  // Purge old sync_attempts (30-day server-side retention across all users)
  const logsResult = db.prepare(
    `DELETE FROM sync_attempts WHERE attempted_at < datetime('now', '-30 days')`
  ).run();

  // Purge expired device session tokens
  const deviceSessionsResult = db.prepare(
    `DELETE FROM device_sessions WHERE expires_at < datetime('now')`
  ).run();

  // Purge consumed or expired device challenges (short-lived, no reason to retain)
  const deviceChallengesResult = db.prepare(
    `DELETE FROM device_challenges WHERE consumed_at IS NOT NULL OR expires_at < datetime('now')`
  ).run();

  console.log(
    `[cleanup] free_queue=${freeQueueResult.changes} paid_queue=${paidQueueResult.changes}` +
    ` auth_codes=${authCodesResult.changes} oauth_tokens=${oauthTokensResult.changes}` +
    ` sync_attempts=${logsResult.changes} device_sessions=${deviceSessionsResult.changes}` +
    ` device_challenges=${deviceChallengesResult.changes}`
  );
}

export function scheduleCleanup(db: Database.Database): void {
  const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

  cleanupGlobal(db);
  console.log(`[cleanup] Next run scheduled in ${Math.round(CLEANUP_INTERVAL_MS / (60 * 60 * 1000))} hours`);
  const interval = setInterval(() => cleanupGlobal(db), CLEANUP_INTERVAL_MS);
  interval.unref();
}
