import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { normaliseUrl, hashUrl } from './db.js';
import type { AgentFeedPayload, AgentFeedResponse, AgentState, AgentPreferences } from './types.js';

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

export function registerAgentRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  onNewItems?: PushCallback
): void {
  // POST /agent/feed-items
  fastify.post('/agent/feed-items', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = req.userId ?? 'local';
    const body = req.body as AgentFeedPayload;

    // Validation
    if (!body || typeof body.source !== 'string' || !body.source.trim()) {
      return reply.status(400).send({ error: '`source` is required and must be a non-empty string' });
    }
    if (!Array.isArray(body.items)) {
      return reply.status(400).send({ error: '`items` is required and must be an array' });
    }

    const source = body.source.trim();
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

        // Per-item validation
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
        // Validate ISO 8601
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

    try {
      insertAll(body.items);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return reply.status(400).send({ error: message });
    }

    // Log to sync_log
    db.prepare(`
      INSERT INTO sync_log (user_id, source, items_added, items_duped)
      VALUES (?, ?, ?, ?)
    `).run(userId, source, inserted, duplicates);

    // Trigger push notifications if items were inserted
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

    const response: AgentFeedResponse = { inserted, duplicates };
    return reply.status(201).send(response);
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

  const deletedItems = itemResult.changes;
  const deletedLogs = logResult.changes;

  console.log(`[cleanup] Deleted ${deletedItems} feed items and ${deletedLogs} sync log entries`);
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
