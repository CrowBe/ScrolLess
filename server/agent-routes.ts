import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { normaliseUrl, hashUrl } from './db.js';
import type { AgentFeedPayload, AgentFeedResponse, AgentState, AgentPreferences, AgentSyncContext, AgentSyncSource } from './types.js';

// Augment FastifyRequest to include userId attached by auth hook
declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

export type PushCallback = (
  userId: string,
  source: string,
  count: number,
  latestTitle?: string
) => Promise<void>;

// ── Shared business logic (used by both REST routes and MCP tools) ──

export function getSyncContext(db: Database.Database, userId: string): AgentSyncContext {
  const sourceRows = db.prepare(
    `SELECT name, enabled, urls, max_items, scraping_notes FROM user_sources WHERE user_id = ?`
  ).all(userId) as Array<{
    name: string;
    enabled: number;
    urls: string;
    max_items: number | null;
    scraping_notes: string | null;
  }>;

  const prefRows = db.prepare(
    `SELECT key, value FROM user_preferences WHERE user_id = ? AND key IN ('max_items_per_source', 'blocked_keywords')`
  ).all(userId) as Array<{ key: string; value: string }>;
  const prefs = new Map(prefRows.map(r => [r.key, r.value]));
  const globalMaxItems = parseInt(JSON.parse(prefs.get('max_items_per_source') ?? '50'), 10);
  const blockedKeywords: string[] = JSON.parse(prefs.get('blocked_keywords') ?? '[]');

  const syncRows = db.prepare(
    `SELECT source, MAX(synced_at) as last_sync FROM sync_log WHERE user_id = ? GROUP BY source`
  ).all(userId) as Array<{ source: string; last_sync: string }>;
  const syncMap = new Map(syncRows.map(r => [r.source, r.last_sync]));

  const sources: AgentSyncSource[] = sourceRows.map(row => {
    if (!row.enabled) {
      return { name: row.name, enabled: false };
    }
    return {
      name: row.name,
      enabled: true,
      urls: JSON.parse(row.urls) as string[],
      last_sync: syncMap.get(row.name) ?? null,
      max_items: row.max_items ?? globalMaxItems,
      scraping_resource: `scrolless://platforms/${row.name}`,
    };
  });

  return {
    sources,
    filters: { blocked_keywords: blockedKeywords },
  };
}

export function insertFeedItems(
  db: Database.Database,
  userId: string,
  payload: AgentFeedPayload,
  onNewItems?: PushCallback
): AgentFeedResponse {
  const source = payload.source.trim();
  let inserted = 0;
  let duplicates = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO feed_items
      (id, user_id, source, title, author, url, url_hash, content_preview, thumbnail_url, tags, is_discovery, published_at, raw_json)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction((items: AgentFeedPayload['items']) => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item.source_id || typeof item.source_id !== 'string') {
        throw new Error(`items[${i}].source_id is required`);
      }
      if (!item.title || typeof item.title !== 'string') {
        throw new Error(`items[${i}].title is required`);
      }
      if (!item.url || typeof item.url !== 'string') {
        throw new Error(`items[${i}].url is required`);
      }
      if (!item.published_at || typeof item.published_at !== 'string') {
        throw new Error(`items[${i}].published_at is required`);
      }
      if (isNaN(Date.parse(item.published_at))) {
        throw new Error(`items[${i}].published_at must be a valid ISO 8601 date string`);
      }
      if (item.tags !== undefined && !Array.isArray(item.tags)) {
        throw new Error(`items[${i}].tags must be an array of strings if provided`);
      }

      const id = `${source}:${item.source_id}`;
      const normUrl = normaliseUrl(item.url);
      const urlHash = hashUrl(normUrl);
      const tagsJson = item.tags ? JSON.stringify(item.tags) : null;

      const result = insertStmt.run(
        id,
        userId,
        source,
        item.title,
        item.author ?? null,
        normUrl,
        urlHash,
        item.content_preview ?? null,
        item.thumbnail_url ?? null,
        tagsJson,
        item.is_discovery ? 1 : 0,
        item.published_at,
        JSON.stringify(item)
      );

      if (result.changes > 0) {
        inserted++;
      } else {
        duplicates++;
      }
    }
  });

  insertAll(payload.items);

  db.prepare(`
    INSERT INTO sync_log (user_id, source, items_added, items_duped)
    VALUES (?, ?, ?, ?)
  `).run(userId, source, inserted, duplicates);

  if (inserted > 0 && onNewItems) {
    const latest = db.prepare(`
      SELECT title FROM feed_items
      WHERE user_id = ? AND source = ?
      ORDER BY published_at DESC LIMIT 1
    `).get(userId, source) as { title: string } | undefined;

    onNewItems(userId, source, inserted, latest?.title).catch((err) => {
      console.error('Push notification error:', err);
    });
  }

  return { inserted, duplicates };
}

// ── REST route registration ──

export function registerAgentRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  onNewItems?: PushCallback
): void {
  // GET /agent/sync-context
  fastify.get('/agent/sync-context', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId ?? 'local';
    return reply.send(getSyncContext(db, userId));
  });

  // POST /agent/feed-items
  fastify.post('/agent/feed-items', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId ?? 'local';
    const body = req.body as AgentFeedPayload;

    if (!body || typeof body.source !== 'string' || !body.source.trim()) {
      return reply.status(400).send({ error: '`source` is required and must be a non-empty string' });
    }
    if (!Array.isArray(body.items)) {
      return reply.status(400).send({ error: '`items` is required and must be an array' });
    }

    try {
      const response = insertFeedItems(db, userId, body, onNewItems);
      return reply.status(201).send(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return reply.status(400).send({ error: message });
    }
  });

  // GET /agent/state
  fastify.get('/agent/state', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId ?? 'local';

    const rows = db.prepare(`
      SELECT source,
             MAX(published_at) as last_sync,
             COUNT(*) as item_count
      FROM feed_items
      WHERE user_id = ?
      GROUP BY source
    `).all(userId) as Array<{ source: string; last_sync: string | null; item_count: number }>;

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
      blocked_sources: JSON.parse(getVal('blocked_sources') ?? '[]'),
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
): { deletedItems: number; deletedLogs: number } {
  const itemResult = db.prepare(`
    DELETE FROM feed_items
    WHERE user_id = ? AND fetched_at < datetime('now', '-' || ? || ' days')
  `).run(userId, retentionDays);

  const logResult = db.prepare(`
    DELETE FROM sync_log WHERE synced_at < datetime('now', '-30 days')
  `).run();

  // Clean up expired OAuth auth codes
  const authCodesResult = db.prepare(
    `DELETE FROM oauth_auth_codes WHERE expires_at < datetime('now')`
  ).run();

  // Clean up expired OAuth tokens (access expired AND no valid refresh)
  const oauthTokensResult = db.prepare(
    `DELETE FROM oauth_tokens WHERE access_expires < datetime('now') AND (refresh_expires IS NULL OR refresh_expires < datetime('now'))`
  ).run();

  const deletedItems = itemResult.changes;
  const deletedLogs = logResult.changes;

  console.log(`[cleanup] Deleted ${deletedItems} feed items, ${deletedLogs} sync log entries, ${authCodesResult.changes} expired auth codes, ${oauthTokensResult.changes} expired OAuth tokens`);
  return { deletedItems, deletedLogs };
}

export function scheduleCleanup(db: Database.Database, userId: string): void {
  function runCleanup() {
    const retentionRow = db.prepare(
      `SELECT value FROM user_preferences WHERE user_id = ? AND key = 'retention_days'`
    ).get(userId) as { value: string } | undefined;
    const retentionDays = parseInt(JSON.parse(retentionRow?.value ?? '7'), 10);
    cleanupOldItems(db, userId, retentionDays);
  }

  function scheduleNextRun() {
    const now = new Date();
    const next3am = new Date(now);
    next3am.setHours(3, 0, 0, 0);
    if (next3am <= now) {
      next3am.setDate(next3am.getDate() + 1);
    }
    const msUntil3am = next3am.getTime() - now.getTime();
    console.log(`[cleanup] Next run scheduled at ${next3am.toISOString()}`);
    setTimeout(() => {
      runCleanup();
      setInterval(runCleanup, 24 * 60 * 60 * 1000); // subsequent runs every 24h
    }, msUntil3am);
  }

  scheduleNextRun();
}
