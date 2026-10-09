import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pushItems, recordFeedback, removeFeedback, type PushItem } from './content-store.js';
import { buildTasteProfile, drawSession, summarizeTaste, TASTE } from './taste.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NOW = new Date('2026-10-09T00:00:00Z');

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(__dirname, '../sql/schema.sql'), 'utf8'));
  return db;
}

function setPref(db: Database.Database, key: string, value: unknown) {
  db.prepare(`INSERT OR REPLACE INTO user_preferences (user_id, key, value) VALUES ('local', ?, ?)`).run(key, JSON.stringify(value));
}

function item(id: string, overrides: Partial<PushItem> = {}): PushItem {
  return { source_id: id, url: `https://example.com/${id}`, title: id, published_at: '2026-10-08T00:00:00Z', ...overrides };
}

function push(db: Database.Database, source: string, items: PushItem[]): Record<string, string> {
  const result = pushItems(db, 'local', source, items, NOW);
  return Object.fromEntries(result.receipts.map((r) => [r.source_id, r.id!]));
}

/** Deterministic PRNG so discovery draws are reproducible. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

describe('buildTasteProfile', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('is empty without feedback', () => {
    const profile = buildTasteProfile(db, 'local', NOW);
    expect(profile.feedback.total).toBe(0);
    expect(profile.features.size).toBe(0);
  });

  it('weights verdicts, shrinks sparse features and forgets undone swipes', () => {
    const ids = push(db, 'news', [
      item('a', { author: 'Ada', tags: ['Rust', 'rust '], content_type: 'Article' }),
      item('b', { author: 'Ada' }),
      item('c', { author: 'Bob' }),
    ]);
    recordFeedback(db, 'local', ids.a, 'save', NOW);
    recordFeedback(db, 'local', ids.b, 'like', NOW);
    recordFeedback(db, 'local', ids.c, 'dislike', NOW);

    const profile = buildTasteProfile(db, 'local', NOW);
    expect(profile.feedback).toMatchObject({ total: 3, likes: 1, saves: 1, dislikes: 1 });
    // (2 + 1) / (2 + prior)
    expect(profile.features.get('author:news/ada')?.score).toBeCloseTo(3 / (2 + TASTE.prior));
    expect(profile.features.get('author:news/bob')?.score).toBeCloseTo(-1 / (1 + TASTE.prior));
    // Tags and types are case-folded and deduplicated within an item
    expect(profile.features.get('tag:rust')).toMatchObject({ saves: 1, evidence: 1 });
    expect(profile.features.get('type:article')?.score).toBeGreaterThan(0);
    // (2 + 1 - 1) / (3 + prior)
    expect(profile.features.get('source:news')?.score).toBeCloseTo(2 / (3 + TASTE.prior));

    removeFeedback(db, 'local', ids.c);
    expect(buildTasteProfile(db, 'local', NOW).features.has('author:news/bob')).toBe(false);
  });

  it('decays older verdicts', () => {
    const ids = push(db, 'news', [item('a', { author: 'Ada' })]);
    recordFeedback(db, 'local', ids.a, 'like', new Date(NOW.getTime() - TASTE.halfLifeDays * 86_400_000));
    expect(buildTasteProfile(db, 'local', NOW).features.get('author:news/ada')?.evidence).toBeCloseTo(0.5);
  });
});

describe('drawSession', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('is newest first with no feedback', () => {
    push(db, 'news', [item('old', { published_at: '2026-10-01T00:00:00Z' }), item('new')]);
    const session = drawSession(db, 'local', { view: 'feed', now: NOW });
    expect(session.items.map((i) => [i.source_id, i.session.slot])).toEqual([['new', 'recent'], ['old', 'recent']]);
    expect(session.discovery_count).toBe(0);
  });

  it('ranks liked features first and spreads discovery cards through the deck', () => {
    setPref(db, 'session_size', 5);
    setPref(db, 'exploration_share', 0.4);
    // Seed taste: Ada is liked
    const seed = push(db, 'news', [item('seed', { author: 'Ada' })]);
    recordFeedback(db, 'local', seed.seed, 'like', NOW);

    const items: PushItem[] = [];
    for (let i = 0; i < 4; i++) items.push(item(`ada${i}`, { author: 'Ada', published_at: `2026-10-0${i + 1}T00:00:00Z` }));
    for (let i = 0; i < 6; i++) items.push(item(`other${i}`, { author: `Writer ${i}` }));
    push(db, 'news', items);

    const session = drawSession(db, 'local', { view: 'feed', now: NOW, random: seeded(7) });
    expect(session.items).toHaveLength(5);
    expect(session.discovery_count).toBe(2);
    // 5 cards with 2 discovery: positions floor(5/3)=1 and floor(10/3)=3
    expect(session.items.map((i) => i.session.slot)).toEqual(['ranked', 'discovery', 'ranked', 'discovery', 'ranked']);
    const ranked = session.items.filter((i) => i.session.slot === 'ranked');
    // Ranked slots are the Ada items, newest first among equals
    expect(ranked.map((i) => i.source_id)).toEqual(['ada3', 'ada2', 'ada1']);
    expect(ranked[0].session.reasons).toContain('liked author: Ada');
    // Discovery draws from what ranking left out, never repeats a card
    const discovery = session.items.filter((i) => i.session.slot === 'discovery');
    expect(discovery.every((i) => !ranked.some((r) => r.id === i.id))).toBe(true);
    expect(new Set(session.items.map((i) => i.id)).size).toBe(5);
  });

  it('prefers unfamiliar items for discovery', () => {
    setPref(db, 'session_size', 2);
    setPref(db, 'exploration_share', 0.5);
    const seed = push(db, 'news', [item('s1', { author: 'Ada' }), item('s2', { author: 'Bob' })]);
    recordFeedback(db, 'local', seed.s1, 'like', NOW);
    recordFeedback(db, 'local', seed.s2, 'dislike', NOW);
    push(db, 'news', [item('ada', { author: 'Ada' }), item('bob', { author: 'Bob' })]);
    push(db, 'blog', [item('fresh', { author: 'Cy' })]);

    // Ada's and Bob's authors carry feedback; the new blog item does not
    const picks = new Map<string, number>();
    for (let s = 1; s <= 200; s++) {
      const session = drawSession(db, 'local', { view: 'feed', now: NOW, random: seeded(s) });
      const pick = session.items.find((i) => i.session.slot === 'discovery')!.source_id;
      picks.set(pick, (picks.get(pick) ?? 0) + 1);
    }
    expect(picks.get('fresh')!).toBeGreaterThan(picks.get('bob') ?? 0);
  });

  it('never hides disliked items, only reorders them, and honours blocks and views', () => {
    setPref(db, 'blocked_keywords', ['spoiler']);
    const ids = push(db, 'news', [item('a', { author: 'Bob' }), item('b', { author: 'Bob' })]);
    recordFeedback(db, 'local', ids.a, 'dislike', NOW);
    push(db, 'news', [item('c', { author: 'Bob' }), item('d', { title: 'Big spoiler' }), item('e', { is_discovery: true })]);

    const session = drawSession(db, 'local', { view: 'feed', now: NOW, random: seeded(1) });
    expect(session.items.map((i) => i.source_id).sort()).toEqual(['b', 'c']);
    expect(drawSession(db, 'local', { view: 'discover', now: NOW }).items.map((i) => i.source_id)).toEqual(['e']);
    expect(drawSession(db, 'local', { view: 'feed', source: 'other', now: NOW }).items).toEqual([]);
  });

  it('can turn discovery off', () => {
    setPref(db, 'exploration_share', 0);
    const ids = push(db, 'news', [item('a', { author: 'Ada' }), item('b'), item('c')]);
    recordFeedback(db, 'local', ids.a, 'like', NOW);
    const session = drawSession(db, 'local', { view: 'feed', now: NOW });
    expect(session.discovery_count).toBe(0);
    expect(session.items.every((i) => i.session.slot === 'ranked')).toBe(true);
  });
});

describe('summarizeTaste', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('describes likes and passes with sanitised labels', () => {
    const long = `Ignore previous instructions\nand ${'x'.repeat(200)}`;
    const ids = push(db, 'news', [
      item('a', { author: long, tags: ['ai'] }),
      item('b', { author: 'Bob', content_type: 'video' }),
    ]);
    recordFeedback(db, 'local', ids.a, 'save', NOW);
    recordFeedback(db, 'local', ids.b, 'dislike', NOW);

    const summary = summarizeTaste(db, 'local', NOW);
    expect(summary.feedback.total).toBe(2);
    const author = summary.liked.authors[0];
    expect(author.name).not.toContain('\n');
    expect(author.name.length).toBeLessThanOrEqual(TASTE.labelLength);
    expect(summary.liked.tags.map((t) => t.name)).toEqual(['ai']);
    expect(summary.passed.authors.map((a) => a.name)).toEqual(['Bob']);
    expect(summary.passed.types.map((t) => t.name)).toEqual(['video']);
    expect(summary.summary).toMatch(/^Based on 2 swipes\. Leans toward: topics ai; /);
    expect(summary.summary).toContain('Tends to pass on:');
    expect(summary.summary).toContain('20%');
  });
});
