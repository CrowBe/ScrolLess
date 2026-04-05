import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import type { AgentFeedResponse, AgentState, AgentPreferences, AgentSyncContext, AgentSyncSource, AgentEncryptedFeedPayload } from './types.js';
import type { SseManager } from './sse-manager.js';

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

  const prefRows = db.prepare(
    `SELECT key, value FROM user_preferences WHERE user_id = ? AND key IN ('max_items_per_source', 'blocked_keywords')`
  ).all(userId) as Array<{ key: string; value: string }>;
  const prefs = new Map(prefRows.map(r => [r.key, r.value]));
  const globalMaxItems = parseInt(JSON.parse(prefs.get('max_items_per_source') ?? '50'), 10);
  const blockedKeywords: string[] = JSON.parse(prefs.get('blocked_keywords') ?? '[]');

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
      if (!item.published_at || typeof item.published_at !== 'string' || Number.isNaN(Date.parse(item.published_at))) {
        return reply.status(400).send({ error: `items[${i}].published_at must be a valid ISO 8601 date string` });
      }
      if (!item.encrypted_fields || typeof item.encrypted_fields !== 'string') {
        return reply.status(400).send({ error: `items[${i}].encrypted_fields is required` });
      }
    }

    const relayed = sseManager?.send(userId, 'feed_items', body) ?? false;
    const status = relayed ? 'relayed' : 'device_offline';

    db.prepare(`
      INSERT INTO sync_attempts (user_id, source, item_count, status)
      VALUES (?, ?, ?, ?)
    `).run(userId, body.source, body.items.length, status);

    if (!relayed) {
      db.prepare(`
        INSERT INTO free_queue_deliveries (user_id, payload_envelope, expires_at, status)
        VALUES (?, ?, datetime('now', '+' || ? || ' minutes'), 'queued')
      `).run(userId, JSON.stringify(body), FREE_QUEUE_TTL_MINUTES);
      onNewItems?.(userId, body.source, body.items.length, undefined).catch(() => {});
      return reply.status(202).send({
        queued: body.items.length,
        queue_ttl_minutes: FREE_QUEUE_TTL_MINUTES,
      } satisfies AgentFeedResponse);
    }

    db.prepare(`
      UPDATE user_sources
      SET last_sync_at = datetime('now')
      WHERE user_id = ? AND name = ?
    `).run(userId, body.source);

    return reply.status(200).send({ relayed: body.items.length } satisfies AgentFeedResponse);
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

    const getVal = (key: string): string | null => {
      const row = db.prepare(
        'SELECT value FROM user_preferences WHERE user_id = ? AND key = ?'
      ).get(userId, key) as { value: string } | undefined;
      return row?.value ?? null;
    };

    const prefs: AgentPreferences = {
      blocked_keywords: JSON.parse(getVal('blocked_keywords') ?? '[]'),
      max_items_per_source: parseInt(JSON.parse(getVal('max_items_per_source') ?? '50'), 10),
    };

    return reply.send(prefs);
  });
}

export function cleanupOldItems(
  db: Database.Database,
  userId: string,
  retentionDays: number
): { deletedItems: number; deletedLogs: number; deletedQueueRows: number } {
  const logResult = db.prepare(`
    DELETE FROM sync_attempts
    WHERE user_id = ? AND attempted_at < datetime('now', '-' || ? || ' days')
  `).run(userId, retentionDays);

  // Clean up expired OAuth auth codes
  const authCodesResult = db.prepare(
    `DELETE FROM oauth_auth_codes WHERE user_id = ? AND expires_at < datetime('now')`
  ).run(userId);

  // Clean up expired OAuth tokens (access expired AND no valid refresh)
  const oauthTokensResult = db.prepare(
    `DELETE FROM oauth_tokens WHERE user_id = ? AND access_expires < datetime('now') AND (refresh_expires IS NULL OR refresh_expires < datetime('now'))`
  ).run(userId);

  // Expire any queued free-tier rows that passed their storage window
  db.prepare(`
    UPDATE free_queue_deliveries
    SET status = 'expired'
    WHERE user_id = ?
      AND status = 'queued'
      AND expires_at <= datetime('now')
  `).run(userId);

  // Purge delivered/expired queue rows after a short grace period to keep DB size bounded
  const freeQueueResult = db.prepare(`
    DELETE FROM free_queue_deliveries
    WHERE user_id = ?
      AND (
        (status = 'delivered' AND delivered_at IS NOT NULL AND delivered_at < datetime('now', '-1 day'))
        OR
        (status = 'expired' AND expires_at < datetime('now', '-1 day'))
      )
  `).run(userId);

  // Purge old paid queue rows once they are acked or expired
  const paidQueueResult = db.prepare(`
    DELETE FROM paid_queue_deliveries
    WHERE user_id = ?
      AND (
        (status = 'acked' AND acked_at IS NOT NULL AND acked_at < datetime('now', '-1 day'))
        OR
        (status = 'expired' AND expires_at < datetime('now', '-1 day'))
      )
  `).run(userId);

  const deletedItems = 0;
  const deletedLogs = logResult.changes;
  const deletedQueueRows = freeQueueResult.changes + paidQueueResult.changes;

  console.log(`[cleanup] Deleted ${deletedLogs} sync attempt entries, ${authCodesResult.changes} expired auth codes, ${oauthTokensResult.changes} expired OAuth tokens, ${deletedQueueRows} queue rows`);
  return { deletedItems, deletedLogs, deletedQueueRows };
}

export function scheduleCleanup(db: Database.Database, userId: string): void {
  const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

  function runCleanup() {
    const retentionRow = db.prepare(
      `SELECT value FROM user_preferences WHERE user_id = ? AND key = 'retention_days'`
    ).get(userId) as { value: string } | undefined;
    const retentionDays = parseInt(JSON.parse(retentionRow?.value ?? '7'), 10);
    cleanupOldItems(db, userId, retentionDays);
  }

  runCleanup();
  console.log(`[cleanup] Next run scheduled in ${Math.round(CLEANUP_INTERVAL_MS / (60 * 60 * 1000))} hours`);
  const interval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  interval.unref();
}
