import { createHash, randomBytes } from 'crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { hashUrl, normaliseUrl } from './db.js';
import { readPreferences } from './preferences.js';

// Host-owned readable content (agent-push contract v1).
//
// A trusted agent pushes readable items through MCP; the host stores them and
// readers fetch them through the authenticated /api/items routes. Pushed text
// is untrusted data: it is length-limited, URLs must be http(s), and nothing in
// an item can change sources, preferences or permissions.

export const CONTENT_CONTRACT_VERSION = 1;
const FINGERPRINT_VERSION = 'fp1';

export const LIMITS = {
  itemsPerPush: 200,
  title: 1_000,
  author: 300,
  contentPreview: 4_000,
  body: 100_000,
  url: 2_048,
  tags: 20,
  tag: 100,
  metadataBytes: 8_000,
  sourceId: 512,
  listPage: 100,
} as const;

export const SOURCE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const metadataValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

// Structural schema shared by the MCP tool. Semantic checks (URL scheme,
// sizes) happen per item in validateItem so one bad item gets its own
// rejected receipt instead of failing the whole batch.
export const pushItemSchema = z.object({
  source_id: z.string().describe('Stable source-native ID, e.g. YouTube video ID or article URL'),
  url: z.string().describe('Canonical http(s) URL of the item'),
  title: z.string().describe('Title or first line of the item'),
  author: z.string().optional().describe('Author, channel or account name'),
  content_preview: z.string().optional().describe('Short excerpt or summary shown on the card'),
  body: z.string().optional().describe('Full readable text, when captured'),
  thumbnail_url: z.string().optional().describe('http(s) image URL'),
  content_type: z.string().optional().describe('Card hint: "video", "post", "article" or custom'),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), metadataValue).optional().describe('Small flat map of extra facts (duration, views, ...)'),
  published_at: z.string().optional().describe('Publication time as shown by the source; ISO 8601 preferred. Omit when unknown — never guess'),
  is_discovery: z.boolean().optional().describe('true for recommendations/trending rather than subscriptions'),
});

export type PushItem = z.infer<typeof pushItemSchema>;

export type ReceiptStatus = 'created' | 'updated' | 'unchanged' | 'blocked' | 'rejected';

export interface PushReceipt {
  source_id: string;
  status: ReceiptStatus;
  id?: string;
  revision?: number;
  reason?: string;
}

export interface PushResult {
  contract_version: number;
  source: string;
  counts: Record<ReceiptStatus, number>;
  receipts: PushReceipt[];
}

interface ContentRow {
  id: string;
  user_id: string;
  source: string;
  source_id: string;
  url: string;
  url_hash: string;
  title: string;
  author: string | null;
  content_preview: string | null;
  body: string | null;
  thumbnail_url: string | null;
  content_type: string | null;
  tags: string;
  metadata: string | null;
  is_discovery: number;
  published_at: string | null;
  published_at_raw: string | null;
  sort_at: string;
  fingerprint: string;
  revision: number;
  eligibility: 'accepted' | 'blocked';
  eligibility_reason: string | null;
  is_read: number;
  is_saved: number;
  state_version: number;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
}

export interface ContentItem {
  id: string;
  source: string;
  source_id: string;
  url: string;
  title: string;
  author: string | null;
  content_preview: string | null;
  body: string | null;
  thumbnail_url: string | null;
  content_type: string | null;
  tags: string[];
  metadata: Record<string, string | number | boolean | null> | null;
  is_discovery: boolean;
  published_at: string | null;
  published_at_raw: string | null;
  first_seen_at: string;
  last_seen_at: string;
  revision: number;
  eligibility: 'accepted' | 'blocked';
  eligibility_reason: string | null;
  is_read: boolean;
  is_saved: boolean;
  state_version: number;
}

function toItem(row: ContentRow): ContentItem {
  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    url: row.url,
    title: row.title,
    author: row.author,
    content_preview: row.content_preview,
    body: row.body,
    thumbnail_url: row.thumbnail_url,
    content_type: row.content_type,
    tags: JSON.parse(row.tags) as string[],
    metadata: row.metadata ? JSON.parse(row.metadata) as ContentItem['metadata'] : null,
    is_discovery: row.is_discovery === 1,
    published_at: row.published_at,
    published_at_raw: row.published_at_raw,
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    revision: row.revision,
    eligibility: row.eligibility,
    eligibility_reason: row.eligibility_reason,
    is_read: row.is_read === 1,
    is_saved: row.is_saved === 1,
    state_version: row.state_version,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

interface NormalisedItem {
  source_id: string;
  url: string;
  title: string;
  author: string | null;
  content_preview: string | null;
  body: string | null;
  thumbnail_url: string | null;
  content_type: string | null;
  tags: string[];
  metadata: Record<string, string | number | boolean | null> | null;
  is_discovery: boolean;
  published_at: string | null;
  published_at_raw: string | null;
}

function validateItem(item: PushItem): { ok: true; value: NormalisedItem } | { ok: false; reason: string } {
  const sourceId = item.source_id.trim();
  if (!sourceId) return { ok: false, reason: 'source_id is required' };
  if (sourceId.length > LIMITS.sourceId) return { ok: false, reason: `source_id exceeds ${LIMITS.sourceId} characters` };

  const url = item.url.trim();
  if (url.length > LIMITS.url) return { ok: false, reason: `url exceeds ${LIMITS.url} characters` };
  if (!isHttpUrl(url)) return { ok: false, reason: 'url must be an http(s) URL' };

  const title = item.title.trim();
  if (!title) return { ok: false, reason: 'title is required' };
  if (title.length > LIMITS.title) return { ok: false, reason: `title exceeds ${LIMITS.title} characters` };

  const author = clean(item.author);
  if (author && author.length > LIMITS.author) return { ok: false, reason: `author exceeds ${LIMITS.author} characters` };
  const preview = clean(item.content_preview);
  if (preview && preview.length > LIMITS.contentPreview) {
    return { ok: false, reason: `content_preview exceeds ${LIMITS.contentPreview} characters` };
  }
  const body = clean(item.body);
  if (body && body.length > LIMITS.body) return { ok: false, reason: `body exceeds ${LIMITS.body} characters` };

  const thumbnail = clean(item.thumbnail_url);
  if (thumbnail && (thumbnail.length > LIMITS.url || !isHttpUrl(thumbnail))) {
    return { ok: false, reason: 'thumbnail_url must be an http(s) URL' };
  }

  const tags = (item.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (tags.length > LIMITS.tags) return { ok: false, reason: `at most ${LIMITS.tags} tags` };
  if (tags.some((t) => t.length > LIMITS.tag)) return { ok: false, reason: `tags must be at most ${LIMITS.tag} characters` };

  const metadata = item.metadata && Object.keys(item.metadata).length > 0 ? item.metadata : null;
  if (metadata && JSON.stringify(metadata).length > LIMITS.metadataBytes) {
    return { ok: false, reason: `metadata exceeds ${LIMITS.metadataBytes} bytes` };
  }

  // Keep the supplied text; only store a parsed instant when it is unambiguous.
  const publishedRaw = clean(item.published_at);
  const parsed = publishedRaw ? Date.parse(publishedRaw) : NaN;
  const publishedAt = Number.isNaN(parsed) ? null : new Date(parsed).toISOString();

  return {
    ok: true,
    value: {
      source_id: sourceId,
      url,
      title,
      author,
      content_preview: preview,
      body,
      thumbnail_url: thumbnail,
      content_type: clean(item.content_type),
      tags,
      metadata,
      is_discovery: item.is_discovery ?? false,
      published_at: publishedAt,
      published_at_raw: publishedRaw,
    },
  };
}

function fingerprint(item: NormalisedItem): string {
  const material = JSON.stringify([
    item.url, item.title, item.author, item.content_preview, item.body, item.thumbnail_url,
    item.content_type, item.tags, item.metadata, item.is_discovery, item.published_at_raw,
  ]);
  return `${FINGERPRINT_VERSION}:${createHash('sha256').update(material).digest('hex')}`;
}

function matchBlockedKeyword(item: NormalisedItem, keywords: string[]): string | null {
  const haystack = [item.title, item.author, item.content_preview, item.body]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return keywords.find((kw) => haystack.includes(kw.toLowerCase())) ?? null;
}

function emptyCounts(): Record<ReceiptStatus, number> {
  return { created: 0, updated: 0, unchanged: 0, blocked: 0, rejected: 0 };
}

/**
 * Upsert a batch of readable items for one source. Idempotent: replaying the
 * same payload returns `unchanged` receipts. Identity is (owner, source,
 * source_id); read/save state survives content updates. Items matching a
 * blocked keyword are recorded metadata-only (no preview/body/thumbnail) so
 * the ledger remembers them without retaining hidden content.
 */
export function pushItems(
  db: Database.Database,
  userId: string,
  source: string,
  items: PushItem[],
  now: Date = new Date()
): PushResult {
  const sourceName = source.trim().toLowerCase();
  if (!SOURCE_NAME_RE.test(sourceName)) {
    throw new ContentError('invalid_source', 'source must match ^[a-z0-9][a-z0-9_-]{0,63}$');
  }
  if (items.length > LIMITS.itemsPerPush) {
    throw new ContentError('too_many_items', `at most ${LIMITS.itemsPerPush} items per push`);
  }

  const { blocked_keywords: blockedKeywords } = readPreferences(db, userId);
  const nowIso = now.toISOString();

  const select = db.prepare(
    `SELECT * FROM content_items WHERE user_id = ? AND source = ? AND source_id = ?`
  );
  const insert = db.prepare(`
    INSERT INTO content_items (
      id, user_id, source, source_id, url, url_hash, title, author, content_preview, body,
      thumbnail_url, content_type, tags, metadata, is_discovery, published_at, published_at_raw,
      sort_at, fingerprint, revision, eligibility, eligibility_reason,
      first_seen_at, last_seen_at, updated_at
    ) VALUES (
      @id, @user_id, @source, @source_id, @url, @url_hash, @title, @author, @content_preview, @body,
      @thumbnail_url, @content_type, @tags, @metadata, @is_discovery, @published_at, @published_at_raw,
      @sort_at, @fingerprint, 1, @eligibility, @eligibility_reason,
      @now, @now, @now
    )
  `);
  const update = db.prepare(`
    UPDATE content_items SET
      url = @url, url_hash = @url_hash, title = @title, author = @author,
      content_preview = @content_preview, body = @body, thumbnail_url = @thumbnail_url,
      content_type = @content_type, tags = @tags, metadata = @metadata, is_discovery = @is_discovery,
      published_at = @published_at, published_at_raw = @published_at_raw, sort_at = @sort_at,
      fingerprint = @fingerprint, revision = @revision,
      eligibility = @eligibility, eligibility_reason = @eligibility_reason,
      last_seen_at = @now, updated_at = @now
    WHERE id = @id
  `);
  const touch = db.prepare(`UPDATE content_items SET last_seen_at = ? WHERE id = ?`);
  const markSourceSynced = db.prepare(
    `UPDATE user_sources SET last_sync_at = ? WHERE user_id = ? AND name = ?`
  );

  const receipts: PushReceipt[] = [];
  const counts = emptyCounts();
  const seen = new Set<string>();

  const run = db.transaction(() => {
    for (const raw of items) {
      const validated = validateItem(raw);
      if (!validated.ok) {
        receipts.push({ source_id: raw.source_id, status: 'rejected', reason: validated.reason });
        counts.rejected++;
        continue;
      }
      const item = validated.value;
      if (seen.has(item.source_id)) {
        receipts.push({ source_id: item.source_id, status: 'rejected', reason: 'duplicate source_id in batch' });
        counts.rejected++;
        continue;
      }
      seen.add(item.source_id);

      const blockedBy = matchBlockedKeyword(item, blockedKeywords);
      const eligibility = blockedBy ? 'blocked' : 'accepted';
      const fp = fingerprint(item);
      const existing = select.get(userId, sourceName, item.source_id) as ContentRow | undefined;

      const params = {
        user_id: userId,
        source: sourceName,
        source_id: item.source_id,
        url: item.url,
        url_hash: hashUrl(normaliseUrl(item.url)),
        title: item.title,
        author: item.author,
        // Metadata-only retention for blocked items
        content_preview: blockedBy ? null : item.content_preview,
        body: blockedBy ? null : item.body,
        thumbnail_url: blockedBy ? null : item.thumbnail_url,
        metadata: blockedBy || !item.metadata ? null : JSON.stringify(item.metadata),
        content_type: item.content_type,
        tags: JSON.stringify(item.tags),
        is_discovery: item.is_discovery ? 1 : 0,
        published_at: item.published_at,
        published_at_raw: item.published_at_raw,
        fingerprint: fp,
        eligibility,
        eligibility_reason: blockedBy ? `blocked_keyword:${blockedBy}` : null,
        now: nowIso,
      };

      if (!existing) {
        const id = `ci_${randomBytes(12).toString('hex')}`;
        insert.run({ ...params, id, sort_at: item.published_at ?? nowIso });
        const status = blockedBy ? 'blocked' : 'created';
        receipts.push({ source_id: item.source_id, status, id, revision: 1, ...(blockedBy ? { reason: params.eligibility_reason! } : {}) });
        counts[status]++;
        continue;
      }

      if (existing.fingerprint === fp && existing.eligibility === eligibility) {
        touch.run(nowIso, existing.id);
        const status = eligibility === 'blocked' ? 'blocked' : 'unchanged';
        receipts.push({ source_id: item.source_id, status, id: existing.id, revision: existing.revision, ...(blockedBy ? { reason: params.eligibility_reason! } : {}) });
        counts[status]++;
        continue;
      }

      const revision = existing.fingerprint === fp ? existing.revision : existing.revision + 1;
      update.run({
        ...params,
        id: existing.id,
        revision,
        sort_at: item.published_at ?? existing.first_seen_at,
      });
      const status = blockedBy ? 'blocked' : 'updated';
      receipts.push({ source_id: item.source_id, status, id: existing.id, revision, ...(blockedBy ? { reason: params.eligibility_reason! } : {}) });
      counts[status]++;
    }

    if (counts.created + counts.updated + counts.unchanged + counts.blocked > 0) {
      markSourceSynced.run(nowIso, userId, sourceName);
    }
  });
  run();

  return { contract_version: CONTENT_CONTRACT_VERSION, source: sourceName, counts, receipts };
}

export class ContentError extends Error {
  constructor(readonly code: 'invalid_source' | 'too_many_items' | 'invalid_cursor' | 'not_found' | 'conflict', message: string) {
    super(message);
  }
}

export type FeedView = 'feed' | 'discover' | 'saved' | 'all';

export interface ListOptions {
  view?: FeedView;
  source?: string;
  limit?: number;
  cursor?: string;
  includeBlocked?: boolean;
  unreadOnly?: boolean;
}

export interface ListResult {
  items: ContentItem[];
  next_cursor: string | null;
}

function encodeCursor(sortAt: string, id: string): string {
  return Buffer.from(JSON.stringify([sortAt, id])).toString('base64url');
}

function decodeCursor(cursor: string): [string, string] {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parsed) && parsed.length === 2 && parsed.every((v) => typeof v === 'string')) {
      return parsed as [string, string];
    }
  } catch {
    // fall through
  }
  throw new ContentError('invalid_cursor', 'invalid cursor');
}

/**
 * Current blocked keywords apply at read time too, so tightening preferences
 * hides already-stored items immediately.
 */
function keywordFilter(db: Database.Database, userId: string): { sql: string; params: string[] } {
  const keywords = readPreferences(db, userId).blocked_keywords.map((k) => k.toLowerCase());
  if (keywords.length === 0) return { sql: '', params: [] };
  const clause = keywords
    .map(() => `instr(lower(title || char(10) || coalesce(author, '') || char(10) || coalesce(content_preview, '') || char(10) || coalesce(body, '')), ?) = 0`)
    .join(' AND ');
  return { sql: ` AND ${clause}`, params: keywords };
}

export function listItems(db: Database.Database, userId: string, opts: ListOptions = {}): ListResult {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), LIMITS.listPage);
  const where: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];

  if (!opts.includeBlocked) where.push(`eligibility = 'accepted'`);
  if (opts.view === 'feed') where.push('is_discovery = 0');
  if (opts.view === 'discover') where.push('is_discovery = 1');
  if (opts.view === 'saved') where.push('is_saved = 1');
  if (opts.unreadOnly) where.push('is_read = 0');
  if (opts.source) {
    where.push('source = ?');
    params.push(opts.source);
  }
  if (opts.cursor) {
    const [sortAt, id] = decodeCursor(opts.cursor);
    where.push('(sort_at < ? OR (sort_at = ? AND id < ?))');
    params.push(sortAt, sortAt, id);
  }

  const kw = opts.includeBlocked ? { sql: '', params: [] } : keywordFilter(db, userId);
  const rows = db.prepare(
    `SELECT * FROM content_items WHERE ${where.join(' AND ')}${kw.sql}
     ORDER BY sort_at DESC, id DESC LIMIT ?`
  ).all(...params, ...kw.params, limit + 1) as ContentRow[];

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toItem),
    next_cursor: rows.length > limit && last ? encodeCursor(last.sort_at, last.id) : null,
  };
}

/**
 * Unread, currently eligible items for a reader session, newest first. The
 * session ranker (server/taste.ts) reorders this pool; it never widens it.
 */
export function listSessionCandidates(
  db: Database.Database,
  userId: string,
  opts: { view: 'feed' | 'discover'; source?: string; limit: number }
): ContentItem[] {
  const where = [`user_id = ?`, `eligibility = 'accepted'`, `is_read = 0`, opts.view === 'discover' ? 'is_discovery = 1' : 'is_discovery = 0'];
  const params: unknown[] = [userId];
  if (opts.source) {
    where.push('source = ?');
    params.push(opts.source);
  }
  const kw = keywordFilter(db, userId);
  const rows = db.prepare(
    `SELECT * FROM content_items WHERE ${where.join(' AND ')}${kw.sql}
     ORDER BY sort_at DESC, id DESC LIMIT ?`
  ).all(...params, ...kw.params, opts.limit) as ContentRow[];
  return rows.map(toItem);
}

export interface ContentStats {
  total: number;
  unread: number;
  by_source: Array<{ source: string; count: number; unread: number }>;
}

export function getStats(db: Database.Database, userId: string): ContentStats {
  const kw = keywordFilter(db, userId);
  const rows = db.prepare(
    `SELECT source, COUNT(*) AS count, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread
     FROM content_items WHERE user_id = ? AND eligibility = 'accepted'${kw.sql}
     GROUP BY source ORDER BY source`
  ).all(userId, ...kw.params) as Array<{ source: string; count: number; unread: number }>;

  return {
    total: rows.reduce((n, r) => n + r.count, 0),
    unread: rows.reduce((n, r) => n + r.unread, 0),
    by_source: rows,
  };
}

export interface StatePatch {
  is_read?: boolean;
  is_saved?: boolean;
  expected_version?: number;
}

export interface ItemState {
  id: string;
  is_read: boolean;
  is_saved: boolean;
  state_version: number;
}

/** Update read/save state. A stale expected_version is a conflict that returns the current state. */
export function updateItemState(
  db: Database.Database,
  userId: string,
  id: string,
  patch: StatePatch
): { ok: true; state: ItemState } | { ok: false; code: 'not_found' | 'conflict'; state?: ItemState } {
  const run = db.transaction(() => {
    const row = db.prepare(
      `SELECT id, is_read, is_saved, state_version FROM content_items WHERE user_id = ? AND id = ?`
    ).get(userId, id) as { id: string; is_read: number; is_saved: number; state_version: number } | undefined;
    if (!row) return { ok: false as const, code: 'not_found' as const };

    const current: ItemState = {
      id: row.id,
      is_read: row.is_read === 1,
      is_saved: row.is_saved === 1,
      state_version: row.state_version,
    };
    if (patch.expected_version !== undefined && patch.expected_version !== row.state_version) {
      return { ok: false as const, code: 'conflict' as const, state: current };
    }

    const next = {
      is_read: patch.is_read ?? current.is_read,
      is_saved: patch.is_saved ?? current.is_saved,
    };
    if (next.is_read === current.is_read && next.is_saved === current.is_saved) {
      return { ok: true as const, state: current };
    }

    db.prepare(
      `UPDATE content_items SET is_read = ?, is_saved = ?, state_version = state_version + 1 WHERE id = ?`
    ).run(next.is_read ? 1 : 0, next.is_saved ? 1 : 0, id);
    return { ok: true as const, state: { id, ...next, state_version: row.state_version + 1 } };
  });
  return run();
}

export function markAllRead(db: Database.Database, userId: string, source?: string): number {
  const result = source
    ? db.prepare(
      `UPDATE content_items SET is_read = 1, state_version = state_version + 1
       WHERE user_id = ? AND is_read = 0 AND source = ?`
    ).run(userId, source)
    : db.prepare(
      `UPDATE content_items SET is_read = 1, state_version = state_version + 1
       WHERE user_id = ? AND is_read = 0`
    ).run(userId);
  return result.changes;
}

export type Verdict = 'like' | 'dislike' | 'save';

export interface FeedbackResult {
  item: ItemState;
  verdict: Verdict | null;
}

/**
 * Record a swipe verdict. Swiping marks the item read; `save` also saves it.
 * Re-swiping replaces the verdict but keeps the original pre-swipe state so
 * undo always restores what the reader saw before the first swipe.
 */
export function recordFeedback(
  db: Database.Database,
  userId: string,
  id: string,
  verdict: Verdict,
  now: Date = new Date()
): FeedbackResult | null {
  const run = db.transaction(() => {
    const row = db.prepare(
      `SELECT id, source, author, content_type, tags, is_read, is_saved, state_version
       FROM content_items WHERE user_id = ? AND id = ?`
    ).get(userId, id) as Pick<ContentRow, 'id' | 'source' | 'author' | 'content_type' | 'tags' | 'is_read' | 'is_saved' | 'state_version'> | undefined;
    if (!row) return null;

    const existing = db.prepare(
      `SELECT prev_is_read, prev_is_saved FROM item_feedback WHERE user_id = ? AND item_id = ?`
    ).get(userId, id) as { prev_is_read: number; prev_is_saved: number } | undefined;

    db.prepare(`
      INSERT INTO item_feedback (user_id, item_id, verdict, source, author, content_type, tags, prev_is_read, prev_is_saved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, item_id) DO UPDATE SET verdict = excluded.verdict, created_at = excluded.created_at
    `).run(
      userId, id, verdict, row.source, row.author, row.content_type, row.tags,
      existing?.prev_is_read ?? row.is_read, existing?.prev_is_saved ?? row.is_saved, now.toISOString()
    );

    // Re-swiping away from save restores the pre-swipe saved state
    const isSaved = verdict === 'save' ? 1 : (existing?.prev_is_saved ?? row.is_saved);
    db.prepare(
      `UPDATE content_items SET is_read = 1, is_saved = ?, state_version = state_version + 1 WHERE id = ?`
    ).run(isSaved, id);

    return {
      item: { id, is_read: true, is_saved: isSaved === 1, state_version: row.state_version + 1 },
      verdict,
    };
  });
  return run();
}

/** Undo a swipe: delete the verdict and restore the pre-swipe read/save state. */
export function removeFeedback(db: Database.Database, userId: string, id: string): FeedbackResult | null {
  const run = db.transaction(() => {
    const feedback = db.prepare(
      `SELECT prev_is_read, prev_is_saved FROM item_feedback WHERE user_id = ? AND item_id = ?`
    ).get(userId, id) as { prev_is_read: number; prev_is_saved: number } | undefined;
    if (!feedback) return null;

    db.prepare(`DELETE FROM item_feedback WHERE user_id = ? AND item_id = ?`).run(userId, id);
    db.prepare(
      `UPDATE content_items SET is_read = ?, is_saved = ?, state_version = state_version + 1 WHERE id = ?`
    ).run(feedback.prev_is_read, feedback.prev_is_saved, id);
    const row = db.prepare(`SELECT state_version FROM content_items WHERE id = ?`).get(id) as { state_version: number };

    return {
      item: { id, is_read: feedback.prev_is_read === 1, is_saved: feedback.prev_is_saved === 1, state_version: row.state_version },
      verdict: null,
    };
  });
  return run();
}
