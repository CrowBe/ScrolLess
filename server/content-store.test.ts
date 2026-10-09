import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ContentError, getStats, listItems, markAllRead, pushItems, updateItemState, type PushItem } from './content-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8'));
  db.prepare(`INSERT INTO user_preferences (user_id, key, value) VALUES ('local', 'blocked_keywords', ?)`).run(JSON.stringify(['sponsored']));
  db.prepare(`INSERT INTO user_sources (user_id, name, enabled) VALUES ('local', 'news', 1)`).run();
  return db;
}

function item(overrides: Partial<PushItem> = {}): PushItem {
  return {
    source_id: 'a1',
    url: 'https://example.com/a1',
    title: 'Hello world',
    content_preview: 'Preview text',
    published_at: '2026-10-01T10:00:00Z',
    ...overrides,
  };
}

describe('pushItems', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('creates items and is idempotent on replay', () => {
    const first = pushItems(db, 'local', 'news', [item()]);
    expect(first.counts.created).toBe(1);
    const id = first.receipts[0].id;

    const replay = pushItems(db, 'local', 'news', [item()]);
    expect(replay.receipts[0]).toMatchObject({ status: 'unchanged', id, revision: 1 });
    expect(listItems(db, 'local').items).toHaveLength(1);
  });

  it('records a new revision on edit and keeps read/save state', () => {
    const { receipts } = pushItems(db, 'local', 'news', [item()]);
    const id = receipts[0].id!;
    updateItemState(db, 'local', id, { is_saved: true });

    const edited = pushItems(db, 'local', 'news', [item({ title: 'Hello world (updated)' })]);
    expect(edited.receipts[0]).toMatchObject({ status: 'updated', id, revision: 2 });

    const [stored] = listItems(db, 'local').items;
    expect(stored.title).toBe('Hello world (updated)');
    expect(stored.is_saved).toBe(true);
  });

  it('rejects invalid items individually', () => {
    const result = pushItems(db, 'local', 'news', [
      item({ source_id: 'ok' }),
      item({ source_id: 'bad-url', url: 'javascript:alert(1)' }),
      item({ source_id: 'bad-thumb', thumbnail_url: 'data:image/png;base64,xx' }),
      item({ source_id: 'ok' }),
    ]);
    expect(result.counts).toMatchObject({ created: 1, rejected: 3 });
    expect(result.receipts[1].reason).toMatch(/http/);
    expect(result.receipts[3].reason).toMatch(/duplicate/);
  });

  it('stores blocked items metadata-only and hides them', () => {
    const result = pushItems(db, 'local', 'news', [
      item({ source_id: 'ad', title: 'A Sponsored post', body: 'buy now', thumbnail_url: 'https://example.com/t.jpg' }),
    ]);
    expect(result.receipts[0]).toMatchObject({ status: 'blocked', reason: 'blocked_keyword:sponsored' });
    expect(listItems(db, 'local').items).toHaveLength(0);

    const [hidden] = listItems(db, 'local', { includeBlocked: true }).items;
    expect(hidden.eligibility).toBe('blocked');
    expect(hidden.body).toBeNull();
    expect(hidden.thumbnail_url).toBeNull();
  });

  it('applies newly blocked keywords at read time', () => {
    pushItems(db, 'local', 'news', [item({ title: 'Crypto news' })]);
    expect(getStats(db, 'local').total).toBe(1);
    db.prepare(`UPDATE user_preferences SET value = ? WHERE key = 'blocked_keywords'`).run(JSON.stringify(['crypto']));
    expect(listItems(db, 'local').items).toHaveLength(0);
    expect(getStats(db, 'local').total).toBe(0);
  });

  it('keeps unparseable publication times raw instead of inventing one', () => {
    pushItems(db, 'local', 'news', [item({ published_at: '3 hours ago' })]);
    const [stored] = listItems(db, 'local').items;
    expect(stored.published_at).toBeNull();
    expect(stored.published_at_raw).toBe('3 hours ago');
  });

  it('rejects invalid source names', () => {
    expect(() => pushItems(db, 'local', '../etc', [item()])).toThrow(ContentError);
  });

  it('updates source last_sync_at', () => {
    pushItems(db, 'local', 'news', [item()], new Date('2026-10-09T00:00:00Z'));
    const row = db.prepare(`SELECT last_sync_at FROM user_sources WHERE name = 'news'`).get() as { last_sync_at: string };
    expect(row.last_sync_at).toBe('2026-10-09T00:00:00.000Z');
  });
});

describe('listItems / state', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('paginates newest first with a stable cursor and filters views', () => {
    const items = Array.from({ length: 5 }, (_, i) => item({
      source_id: `n${i}`,
      url: `https://example.com/${i}`,
      published_at: `2026-10-0${i + 1}T00:00:00Z`,
      is_discovery: i === 4,
    }));
    pushItems(db, 'local', 'news', items);

    const page1 = listItems(db, 'local', { view: 'feed', limit: 2 });
    expect(page1.items.map((i) => i.source_id)).toEqual(['n3', 'n2']);
    const page2 = listItems(db, 'local', { view: 'feed', limit: 2, cursor: page1.next_cursor! });
    expect(page2.items.map((i) => i.source_id)).toEqual(['n1', 'n0']);
    expect(page2.next_cursor).toBeNull();
    expect(listItems(db, 'local', { view: 'discover' }).items.map((i) => i.source_id)).toEqual(['n4']);
    expect(() => listItems(db, 'local', { cursor: 'garbage' })).toThrow(ContentError);
  });

  it('detects version conflicts and marks all read', () => {
    const { receipts } = pushItems(db, 'local', 'news', [item(), item({ source_id: 'b', url: 'https://example.com/b' })]);
    const id = receipts[0].id!;

    const first = updateItemState(db, 'local', id, { is_read: true, expected_version: 0 });
    expect(first).toMatchObject({ ok: true, state: { is_read: true, state_version: 1 } });
    const stale = updateItemState(db, 'local', id, { is_saved: true, expected_version: 0 });
    expect(stale).toMatchObject({ ok: false, code: 'conflict', state: { state_version: 1 } });
    expect(updateItemState(db, 'local', 'ci_missing', { is_read: true })).toMatchObject({ ok: false, code: 'not_found' });

    expect(getStats(db, 'local')).toMatchObject({ total: 2, unread: 1 });
    expect(markAllRead(db, 'local', 'news')).toBe(1);
    expect(getStats(db, 'local').unread).toBe(0);
  });
});
