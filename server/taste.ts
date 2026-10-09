import type Database from 'better-sqlite3';
import { listSessionCandidates, type ContentItem } from './content-store.js';
import { readPreferences } from './preferences.js';

// Learned taste and preference-ranked reader sessions (slice B).
//
// Swipe verdicts in item_feedback carry a feature snapshot (source, author,
// content type, tags). The profile is a deterministic aggregate of those
// verdicts; nothing here calls inference. A session ranks unread items by the
// profile and reserves a share of cards for discovery so the feed does not
// collapse onto what was already liked. Ranking only reorders eligible items:
// it never hides an item, and a dislike is a weight, not a block.

export const RANKING_VERSION = 'rank1';

export const TASTE = {
  /** Verdict weights: save is the strongest positive signal. */
  verdictWeight: { like: 1, save: 2, dislike: -1 } as Record<string, number>,
  /** Older verdicts count less; weight halves every this many days. */
  halfLifeDays: 45,
  /** Pseudo-count shrinking sparse features toward neutral. */
  prior: 2,
  /** Per-feature contribution to an item's score. */
  featureWeight: { source: 1, author: 1.5, type: 0.5, tag: 1 } as Record<FeatureKind, number>,
  /** Newer items get a small boost that halves every this many hours. */
  freshness: { weight: 0.3, halfLifeHours: 48 },
  /** Candidate pool drawn before ranking. */
  poolSize: 500,
  /** Minimum |score| for a feature to appear in the agent summary. */
  summaryThreshold: 0.2,
  summaryLimit: 8,
  labelLength: 80,
} as const;

export type FeatureKind = 'source' | 'author' | 'type' | 'tag';

export interface FeatureStat {
  kind: FeatureKind;
  label: string;
  /** Source the author belongs to; authors are scoped per source. */
  source?: string;
  likes: number;
  saves: number;
  dislikes: number;
  /** Decayed verdict count. */
  evidence: number;
  /** Shrunk, decayed mean verdict weight; > 0 leans liked, < 0 leans disliked. */
  score: number;
}

export interface TasteProfile {
  ranking_version: string;
  feedback: { total: number; likes: number; saves: number; dislikes: number; latest_at: string | null };
  features: Map<string, FeatureStat>;
}

interface FeedbackRow {
  verdict: string;
  source: string;
  author: string | null;
  content_type: string | null;
  tags: string;
  created_at: string;
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}

/** Feature keys for one item or feedback snapshot. */
function featureKeys(item: { source: string; author: string | null; content_type: string | null; tags: string[] }): Array<{ key: string; kind: FeatureKind; label: string; source?: string }> {
  const keys: Array<{ key: string; kind: FeatureKind; label: string; source?: string }> = [
    { key: `source:${item.source}`, kind: 'source', label: item.source },
  ];
  if (item.author?.trim()) {
    keys.push({ key: `author:${item.source}/${norm(item.author)}`, kind: 'author', label: item.author.trim(), source: item.source });
  }
  if (item.content_type?.trim()) {
    keys.push({ key: `type:${norm(item.content_type)}`, kind: 'type', label: norm(item.content_type) });
  }
  for (const tag of new Set(item.tags.map(norm).filter(Boolean))) {
    keys.push({ key: `tag:${tag}`, kind: 'tag', label: tag });
  }
  return keys;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Aggregate swipe verdicts into per-feature scores. Undone swipes are already deleted. */
export function buildTasteProfile(db: Database.Database, userId: string, now: Date = new Date()): TasteProfile {
  const rows = db.prepare(
    `SELECT verdict, source, author, content_type, tags, created_at
     FROM item_feedback WHERE user_id = ? ORDER BY created_at DESC`
  ).all(userId) as FeedbackRow[];

  const sums = new Map<string, FeatureStat & { weighted: number }>();
  const feedback = { total: 0, likes: 0, saves: 0, dislikes: 0, latest_at: rows[0]?.created_at ?? null };

  for (const row of rows) {
    const weight = TASTE.verdictWeight[row.verdict];
    if (weight === undefined) continue;
    feedback.total++;
    if (row.verdict === 'like') feedback.likes++;
    if (row.verdict === 'save') feedback.saves++;
    if (row.verdict === 'dislike') feedback.dislikes++;

    const ageDays = Math.max(0, (now.getTime() - Date.parse(row.created_at)) / 86_400_000);
    const decay = Number.isFinite(ageDays) ? 0.5 ** (ageDays / TASTE.halfLifeDays) : 1;

    for (const f of featureKeys({ source: row.source, author: row.author, content_type: row.content_type, tags: parseTags(row.tags) })) {
      let stat = sums.get(f.key);
      if (!stat) {
        // Rows are newest first, so the label keeps the most recent casing
        stat = { kind: f.kind, label: f.label, source: f.source, likes: 0, saves: 0, dislikes: 0, evidence: 0, score: 0, weighted: 0 };
        sums.set(f.key, stat);
      }
      if (row.verdict === 'like') stat.likes++;
      if (row.verdict === 'save') stat.saves++;
      if (row.verdict === 'dislike') stat.dislikes++;
      stat.evidence += decay;
      stat.weighted += weight * decay;
    }
  }

  const features = new Map<string, FeatureStat>();
  for (const [key, { weighted, ...stat }] of sums) {
    features.set(key, { ...stat, score: weighted / (stat.evidence + TASTE.prior) });
  }
  return { ranking_version: RANKING_VERSION, feedback, features };
}

function reasonFor(stat: FeatureStat): string {
  return `${stat.score >= 0 ? 'liked' : 'passed'} ${stat.kind}: ${safeLabel(stat.label)}`;
}

export interface ItemScore {
  score: number;
  /** Total decayed feedback behind the item's features; low means unfamiliar. */
  evidence: number;
  reasons: string[];
}

/** Score one item against the profile: taste contributions plus a freshness boost. */
export function scoreItem(profile: TasteProfile, item: ContentItem, now: Date = new Date()): ItemScore {
  let taste = 0;
  let evidence = 0;
  const contributions: Array<{ value: number; reason: string }> = [];
  const tags: FeatureStat[] = [];

  for (const f of featureKeys(item)) {
    const stat = profile.features.get(f.key);
    if (!stat) continue;
    evidence += stat.evidence;
    if (f.kind === 'tag') {
      tags.push(stat);
      continue;
    }
    const value = TASTE.featureWeight[f.kind] * stat.score;
    taste += value;
    contributions.push({ value, reason: reasonFor(stat) });
  }
  // Mean over known tags so items are not favoured for tag volume
  for (const stat of tags) {
    const value = (TASTE.featureWeight.tag * stat.score) / tags.length;
    taste += value;
    contributions.push({ value, reason: reasonFor(stat) });
  }

  const seenAt = Date.parse(item.published_at ?? item.first_seen_at);
  const ageHours = Number.isFinite(seenAt) ? Math.max(0, (now.getTime() - seenAt) / 3_600_000) : Infinity;
  const freshness = TASTE.freshness.weight * 0.5 ** (ageHours / TASTE.freshness.halfLifeHours);

  const reasons = contributions
    .filter((c) => Math.abs(c.value) >= 0.05)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 3)
    .map((c) => c.reason);
  return { score: taste + freshness, evidence, reasons };
}

export type SessionSlot = 'ranked' | 'discovery' | 'recent';

export interface SessionItem extends ContentItem {
  session: { slot: SessionSlot; score: number; reasons: string[] };
}

export interface SessionResult {
  ranking_version: string;
  size: number;
  exploration_share: number;
  /** Cards reserved for discovery in this session. */
  discovery_count: number;
  /** Swipes behind the profile; 0 means the session fell back to newest first. */
  feedback_count: number;
  items: SessionItem[];
}

export interface SessionOptions {
  view: 'feed' | 'discover';
  source?: string;
  now?: Date;
  /** Injected for deterministic tests. */
  random?: () => number;
}

function compareRanked(a: { item: ContentItem; score: ItemScore }, b: { item: ContentItem; score: ItemScore }): number {
  if (b.score.score !== a.score.score) return b.score.score - a.score.score;
  const at = a.item.published_at ?? a.item.first_seen_at;
  const bt = b.item.published_at ?? b.item.first_seen_at;
  if (at !== bt) return at < bt ? 1 : -1;
  return a.item.id < b.item.id ? 1 : -1;
}

/**
 * Draw one reader session: `session_size` unread eligible cards. Most slots go
 * to the highest-scoring items; `exploration_share` of them go to items drawn
 * from the rest, weighted toward unfamiliar features, and are spread through
 * the deck. With no feedback yet the session is newest first.
 */
export function drawSession(db: Database.Database, userId: string, opts: SessionOptions): SessionResult {
  const now = opts.now ?? new Date();
  const random = opts.random ?? Math.random;
  const prefs = readPreferences(db, userId);
  const size = prefs.session_size;
  const profile = buildTasteProfile(db, userId, now);
  const candidates = listSessionCandidates(db, userId, { view: opts.view, source: opts.source, limit: TASTE.poolSize });

  const base = {
    ranking_version: RANKING_VERSION,
    size,
    exploration_share: prefs.exploration_share,
    feedback_count: profile.feedback.total,
  };

  if (profile.feedback.total === 0) {
    const items = candidates.slice(0, size).map((item) => ({ ...item, session: { slot: 'recent' as const, score: 0, reasons: [] } }));
    return { ...base, discovery_count: 0, items };
  }

  const scored = candidates.map((item) => ({ item, score: scoreItem(profile, item, now) })).sort(compareRanked);
  const total = Math.min(size, scored.length);
  // Keep at least one ranked card; a pool no bigger than the session is shown whole
  const discoveryTarget = Math.min(Math.round(total * prefs.exploration_share), Math.max(0, total - 1));
  const ranked = scored.slice(0, total - discoveryTarget);

  // Weighted draw without replacement; unfamiliar items are likelier
  const pool = scored.slice(ranked.length);
  const discovery: typeof scored = [];
  while (discovery.length < discoveryTarget && pool.length > 0) {
    const weights = pool.map((s) => 1 / (1 + s.score.evidence));
    let pick = random() * weights.reduce((a, b) => a + b, 0);
    let index = 0;
    while (index < pool.length - 1 && pick >= weights[index]) {
      pick -= weights[index];
      index++;
    }
    discovery.push(pool.splice(index, 1)[0]);
  }

  // Spread discovery cards evenly through the deck instead of trailing it
  const discoveryAt = new Set(discovery.map((_, i) => Math.floor(((i + 1) * total) / (discovery.length + 1))));
  const deck: SessionItem[] = [];
  let r = 0;
  let d = 0;
  for (let position = 0; position < total; position++) {
    const fromDiscovery = discoveryAt.has(position) && d < discovery.length;
    const { item, score } = fromDiscovery ? discovery[d++] : ranked[r++];
    deck.push({
      ...item,
      session: { slot: fromDiscovery ? 'discovery' : 'ranked', score: round(score.score), reasons: score.reasons },
    });
  }

  return { ...base, discovery_count: discovery.length, items: deck };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// --- Agent-facing summary ---------------------------------------------------

export interface TasteEntry {
  name: string;
  source?: string;
  score: number;
  likes: number;
  saves: number;
  dislikes: number;
}

export interface TasteSummary {
  ranking_version: string;
  feedback: TasteProfile['feedback'];
  exploration_share: number;
  liked: Record<'sources' | 'authors' | 'types' | 'tags', TasteEntry[]>;
  passed: Record<'sources' | 'authors' | 'types' | 'tags', TasteEntry[]>;
  summary: string;
}

const KIND_GROUP: Record<FeatureKind, 'sources' | 'authors' | 'types' | 'tags'> = {
  source: 'sources', author: 'authors', type: 'types', tag: 'tags',
};

/** Labels come from pushed content: keep them short, single-line data. */
function safeLabel(value: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > TASTE.labelLength ? `${flat.slice(0, TASTE.labelLength - 1)}…` : flat;
}

function emptyGroups(): TasteSummary['liked'] {
  return { sources: [], authors: [], types: [], tags: [] };
}

/** Compact, agent-readable summary of learned tastes for steering collection. */
export function summarizeTaste(db: Database.Database, userId: string, now: Date = new Date()): TasteSummary {
  const profile = buildTasteProfile(db, userId, now);
  const { exploration_share } = readPreferences(db, userId);
  const liked = emptyGroups();
  const passed = emptyGroups();

  const ordered = [...profile.features.values()].sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  for (const stat of ordered) {
    if (Math.abs(stat.score) < TASTE.summaryThreshold) continue;
    const group = (stat.score > 0 ? liked : passed)[KIND_GROUP[stat.kind]];
    if (group.length >= TASTE.summaryLimit) continue;
    group.push({
      name: safeLabel(stat.label),
      ...(stat.source ? { source: stat.source } : {}),
      score: round(stat.score),
      likes: stat.likes,
      saves: stat.saves,
      dislikes: stat.dislikes,
    });
  }

  return {
    ranking_version: RANKING_VERSION,
    feedback: profile.feedback,
    exploration_share,
    liked,
    passed,
    summary: describe(profile.feedback.total, liked, passed, exploration_share),
  };
}

function describeGroups(groups: TasteSummary['liked']): string {
  const parts: string[] = [];
  const list = (entries: TasteEntry[], fmt: (e: TasteEntry) => string) => entries.slice(0, 5).map(fmt).join(', ');
  if (groups.tags.length) parts.push(`topics ${list(groups.tags, (e) => e.name)}`);
  if (groups.authors.length) parts.push(`authors ${list(groups.authors, (e) => `${e.name} (${e.source})`)}`);
  if (groups.sources.length) parts.push(`sources ${list(groups.sources, (e) => e.name)}`);
  if (groups.types.length) parts.push(`formats ${list(groups.types, (e) => e.name)}`);
  return parts.join('; ');
}

function describe(total: number, liked: TasteSummary['liked'], passed: TasteSummary['passed'], share: number): string {
  if (total === 0) return 'No swipe feedback yet. Collect broadly; sessions are newest first until the user swipes.';
  const lines = [`Based on ${total} swipe${total === 1 ? '' : 's'}.`];
  const likes = describeGroups(liked);
  const passes = describeGroups(passed);
  lines.push(likes ? `Leans toward: ${likes}.` : 'No clear likes yet.');
  if (passes) lines.push(`Tends to pass on: ${passes}.`);
  lines.push(`About ${Math.round(share * 100)}% of each session is reserved for unfamiliar items, so keep some variety.`);
  return lines.join(' ');
}
