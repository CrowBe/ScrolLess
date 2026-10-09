import type Database from 'better-sqlite3';
import { listSessionCandidates, type ContentItem } from './content-store.js';
import { readPreferences } from './preferences.js';
import { FEATURE_KINDS, readRankingConfig, type FeatureKind, type RankingConfig } from './ranking-config.js';

// Learned taste and preference-ranked reader sessions.
//
// Swipe verdicts in item_feedback carry a feature snapshot (source, author,
// content type, tags). The profile is a deterministic aggregate of those
// verdicts; nothing here calls inference. A session ranks unread items by the
// profile and reserves a share of cards for discovery so the feed does not
// collapse onto what was already liked. Ranking only reorders eligible items:
// it never hides an item, and a dislike is a weight, not a block.
//
// Every tunable lives in RankingConfig (server/ranking-config.ts) and every
// card carries the arithmetic behind its score. docs/RANKING.md walks through it.

export const RANKING_VERSION = 'rank3';

export const SUMMARY = {
  /** Minimum |score| for a signal to appear in the agent summary. */
  threshold: 0.2,
  limit: 8,
  labelLength: 80,
} as const;

export type { FeatureKind };

export interface FeatureStat {
  key: string;
  kind: FeatureKind;
  label: string;
  /** Source the author belongs to; authors are scoped per source. */
  source?: string;
  likes: number;
  saves: number;
  dislikes: number;
  /** Swipe count after fading older swipes. */
  evidence: number;
  /** Faded verdict sum / (evidence + prior); > 0 leans liked, < 0 leans passed. */
  score: number;
  /** Muted signals are listed for review but ignored by ranking and summaries. */
  muted: boolean;
  /** Has at least evidence.min_signal_swipes swipes; until then the signal is still learning and has no effect. */
  qualified: boolean;
}

export type SignalStatus = 'active' | 'learning' | 'muted' | 'off';

/** Why a learned signal does or does not affect ranking. */
export function signalStatus(stat: FeatureStat, config: RankingConfig): SignalStatus {
  if (stat.muted) return 'muted';
  if (!config.signals[stat.kind].enabled) return 'off';
  return stat.qualified ? 'active' : 'learning';
}

/** Ranking reorders sessions only once there are this many swipes in total. */
export function rankingActive(profile: TasteProfile, config: RankingConfig): boolean {
  return profile.feedback.total > 0 && profile.feedback.total >= config.evidence.min_swipes;
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

const VERDICTS = ['like', 'save', 'dislike'] as const;
type VerdictName = (typeof VERDICTS)[number];

function isVerdict(value: string): value is VerdictName {
  return (VERDICTS as readonly string[]).includes(value);
}

/** Aggregate swipe verdicts into per-signal scores. Undone swipes are already deleted. */
export function buildTasteProfile(
  db: Database.Database,
  userId: string,
  config: RankingConfig = readRankingConfig(db, userId),
  now: Date = new Date()
): TasteProfile {
  const rows = db.prepare(
    `SELECT verdict, source, author, content_type, tags, created_at
     FROM item_feedback WHERE user_id = ? ORDER BY created_at DESC`
  ).all(userId) as FeedbackRow[];

  const muted = new Set(config.muted_features);
  const sums = new Map<string, FeatureStat & { weighted: number }>();
  const feedback = { total: 0, likes: 0, saves: 0, dislikes: 0, latest_at: rows[0]?.created_at ?? null };

  for (const row of rows) {
    if (!isVerdict(row.verdict)) continue;
    const weight = config.verdicts[row.verdict];
    feedback.total++;
    if (row.verdict === 'like') feedback.likes++;
    if (row.verdict === 'save') feedback.saves++;
    if (row.verdict === 'dislike') feedback.dislikes++;

    const ageDays = Math.max(0, (now.getTime() - Date.parse(row.created_at)) / 86_400_000);
    const fade = config.memory.decay && Number.isFinite(ageDays) ? 0.5 ** (ageDays / config.memory.half_life_days) : 1;

    for (const f of featureKeys({ source: row.source, author: row.author, content_type: row.content_type, tags: parseTags(row.tags) })) {
      let stat = sums.get(f.key);
      if (!stat) {
        // Rows are newest first, so the label keeps the most recent casing
        stat = {
          key: f.key, kind: f.kind, label: f.label, source: f.source,
          likes: 0, saves: 0, dislikes: 0, evidence: 0, score: 0, muted: muted.has(f.key), qualified: false, weighted: 0,
        };
        sums.set(f.key, stat);
      }
      if (row.verdict === 'like') stat.likes++;
      if (row.verdict === 'save') stat.saves++;
      if (row.verdict === 'dislike') stat.dislikes++;
      stat.evidence += fade;
      stat.weighted += weight * fade;
    }
  }

  const features = new Map<string, FeatureStat>();
  for (const [key, { weighted, ...stat }] of sums) {
    const denominator = stat.evidence + config.prior;
    const swipes = stat.likes + stat.saves + stat.dislikes;
    features.set(key, {
      ...stat,
      score: denominator > 0 ? weighted / denominator : 0,
      qualified: swipes >= config.evidence.min_signal_swipes,
    });
  }
  return { ranking_version: RANKING_VERSION, feedback, features };
}

/** One line of a card's score: learned score × weight = contribution. */
export interface ScorePart {
  part: FeatureKind | 'freshness';
  /** Signal key, for muting. Absent for freshness. */
  key?: string;
  label: string;
  /** Learned signal score, or the freshness factor (1 = brand new, 0.5 = one half-life old). */
  value: number;
  /** Effective weight; tag weights are split across the item's learned tags. */
  weight: number;
  contribution: number;
}

export interface ItemScore {
  score: number;
  /** Total faded swipes behind the item's active signals; low means unfamiliar. */
  evidence: number;
  breakdown: ScorePart[];
  reasons: string[];
}

function reasonFor(part: ScorePart): string {
  if (part.part === 'freshness') return 'new';
  return `${part.value >= 0 ? 'liked' : 'passed'} ${part.part}: ${safeLabel(part.label)}`;
}

/**
 * Score one item: for each enabled, unmuted signal with enough swipes it carries, add
 * learned score × signal weight (tag weight split evenly across its learned
 * tags), then add freshness weight × 0.5^(age / half-life).
 */
export function scoreItem(profile: TasteProfile, item: ContentItem, config: RankingConfig, now: Date = new Date()): ItemScore {
  const breakdown: ScorePart[] = [];
  let evidence = 0;
  const tags: FeatureStat[] = [];

  for (const f of featureKeys(item)) {
    const stat = profile.features.get(f.key);
    if (!stat || stat.muted || !config.signals[f.kind].enabled) continue;
    evidence += stat.evidence;
    // Still learning: counts toward familiarity for discovery, not toward the score
    if (!stat.qualified) continue;
    if (f.kind === 'tag') {
      tags.push(stat);
      continue;
    }
    const weight = config.signals[f.kind].weight;
    breakdown.push({ part: f.kind, key: f.key, label: stat.label, value: round(stat.score), weight, contribution: weight * stat.score });
  }
  // Mean over learned tags so items are not favoured for tag volume
  for (const stat of tags) {
    const weight = config.signals.tag.weight / tags.length;
    breakdown.push({ part: 'tag', key: stat.key, label: stat.label, value: round(stat.score), weight: round(weight), contribution: weight * stat.score });
  }

  if (config.freshness.enabled) {
    const seenAt = Date.parse(item.published_at ?? item.first_seen_at);
    const ageHours = Number.isFinite(seenAt) ? Math.max(0, (now.getTime() - seenAt) / 3_600_000) : Infinity;
    const factor = 0.5 ** (ageHours / config.freshness.half_life_hours);
    breakdown.push({ part: 'freshness', label: 'freshness', value: round(factor), weight: config.freshness.weight, contribution: config.freshness.weight * factor });
  }

  const score = breakdown.reduce((sum, p) => sum + p.contribution, 0);
  const reasons = breakdown
    .filter((p) => p.part !== 'freshness' && Math.abs(p.contribution) >= 0.05)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 3)
    .map(reasonFor);
  return {
    score,
    evidence,
    breakdown: breakdown.map((p) => ({ ...p, contribution: round(p.contribution) })),
    reasons,
  };
}

export type SessionSlot = 'ranked' | 'discovery' | 'recent';

export interface SessionCard {
  slot: SessionSlot;
  score: number;
  /** Faded swipes behind this card's signals; discovery favours low values. */
  evidence: number;
  reasons: string[];
  breakdown: ScorePart[];
}

export interface SessionItem extends ContentItem {
  session: SessionCard;
}

export interface SessionResult {
  ranking_version: string;
  size: number;
  /** The configuration this session was ranked with. */
  config: RankingConfig;
  /** Cards drawn for discovery in this session. */
  discovery_count: number;
  /** Swipes behind the profile. */
  feedback_count: number;
  /** False until feedback_count reaches evidence.min_swipes; the session is then newest first. */
  ranking_active: boolean;
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
 * Draw one reader session of `session_size` unread eligible cards from the
 * newest `pool_size`. Most slots go to the highest-scoring items; when
 * discovery is enabled, `share` of them are drawn from the rest, weighted by
 * 1 / (1 + evidence) so unfamiliar items are likelier, and spread through the
 * deck. Until there are evidence.min_swipes swipes the session is newest first.
 */
export function drawSession(db: Database.Database, userId: string, opts: SessionOptions): SessionResult {
  const now = opts.now ?? new Date();
  const random = opts.random ?? Math.random;
  const size = readPreferences(db, userId).session_size;
  const config = readRankingConfig(db, userId);
  const profile = buildTasteProfile(db, userId, config, now);
  const candidates = listSessionCandidates(db, userId, { view: opts.view, source: opts.source, limit: config.pool_size });
  const active = rankingActive(profile, config);
  const base = { ranking_version: RANKING_VERSION, size, config, feedback_count: profile.feedback.total, ranking_active: active };

  if (!active) {
    const items = candidates.slice(0, size).map((item) => ({
      ...item,
      session: { slot: 'recent' as const, score: 0, evidence: 0, reasons: [], breakdown: [] },
    }));
    return { ...base, discovery_count: 0, items };
  }

  const scored = candidates.map((item) => ({ item, score: scoreItem(profile, item, config, now) })).sort(compareRanked);
  const total = Math.min(size, scored.length);
  // Keep at least one ranked card; a pool no bigger than the session is shown whole
  const share = config.discovery.enabled ? config.discovery.share : 0;
  const discoveryTarget = Math.min(Math.round(total * share), Math.max(0, total - 1));
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
      session: {
        slot: fromDiscovery ? 'discovery' : 'ranked',
        score: round(score.score),
        evidence: round(score.evidence),
        reasons: score.reasons,
        breakdown: score.breakdown,
      },
    });
  }

  return { ...base, discovery_count: discovery.length, items: deck };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// --- Review and agent-facing summary ----------------------------------------

/** Labels come from pushed content: keep them short, single-line data. */
function safeLabel(value: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY.labelLength ? `${flat.slice(0, SUMMARY.labelLength - 1)}…` : flat;
}

function publicStat(stat: FeatureStat): FeatureStat {
  return { ...stat, label: safeLabel(stat.label), evidence: round(stat.evidence), score: round(stat.score) };
}

export interface TasteEntry {
  name: string;
  source?: string;
  score: number;
  likes: number;
  saves: number;
  dislikes: number;
}

type Groups = Record<'sources' | 'authors' | 'types' | 'tags', TasteEntry[]>;

export interface TasteSummary {
  ranking_version: string;
  feedback: TasteProfile['feedback'];
  /** Read-only copy of how sessions are ranked; only the user changes it. */
  config: RankingConfig;
  liked: Groups;
  passed: Groups;
  summary: string;
  /** False until there are evidence.min_swipes swipes; liked/passed are empty until then. */
  ranking_active: boolean;
}

const KIND_GROUP: Record<FeatureKind, keyof Groups> = {
  source: 'sources', author: 'authors', type: 'types', tag: 'tags',
};

function emptyGroups(): Groups {
  return { sources: [], authors: [], types: [], tags: [] };
}

/** Learned signals the current config actually uses, strongest first. */
function activeStats(profile: TasteProfile, config: RankingConfig): FeatureStat[] {
  return [...profile.features.values()]
    .filter((s) => signalStatus(s, config) === 'active')
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}

/** Compact, agent-readable summary of learned tastes for steering collection. */
export function summarizeTaste(db: Database.Database, userId: string, now: Date = new Date()): TasteSummary {
  const config = readRankingConfig(db, userId);
  const profile = buildTasteProfile(db, userId, config, now);
  const liked = emptyGroups();
  const passed = emptyGroups();

  // Below the evidence bar there is nothing to steer collection with yet
  const stats = rankingActive(profile, config) ? activeStats(profile, config) : [];
  for (const stat of stats) {
    if (Math.abs(stat.score) < SUMMARY.threshold) continue;
    const group = (stat.score > 0 ? liked : passed)[KIND_GROUP[stat.kind]];
    if (group.length >= SUMMARY.limit) continue;
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
    config,
    liked,
    passed,
    summary: describe(profile.feedback.total, liked, passed, config),
    ranking_active: rankingActive(profile, config),
  };
}

export interface RankingReview {
  ranking_version: string;
  config: RankingConfig;
  feedback: TasteProfile['feedback'];
  summary: string;
  ranking_active: boolean;
  /** Every learned signal, strongest first, with whether and why it affects ranking. */
  signals: Array<FeatureStat & { status: SignalStatus; swipes: number }>;
}

/** Everything the ranker knows and uses, for the owner to review. */
export function reviewRanking(db: Database.Database, userId: string, now: Date = new Date()): RankingReview {
  const config = readRankingConfig(db, userId);
  const profile = buildTasteProfile(db, userId, config, now);
  const signals = [...profile.features.values()]
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .map((s) => ({ ...publicStat(s), status: signalStatus(s, config), swipes: s.likes + s.saves + s.dislikes }));
  return {
    ranking_version: RANKING_VERSION,
    config,
    feedback: profile.feedback,
    summary: summarizeTaste(db, userId, now).summary,
    ranking_active: rankingActive(profile, config),
    signals,
  };
}

function describeGroups(groups: Groups): string {
  const parts: string[] = [];
  const list = (entries: TasteEntry[], fmt: (e: TasteEntry) => string) => entries.slice(0, 5).map(fmt).join(', ');
  if (groups.tags.length) parts.push(`topics ${list(groups.tags, (e) => e.name)}`);
  if (groups.authors.length) parts.push(`authors ${list(groups.authors, (e) => `${e.name} (${e.source})`)}`);
  if (groups.sources.length) parts.push(`sources ${list(groups.sources, (e) => e.name)}`);
  if (groups.types.length) parts.push(`formats ${list(groups.types, (e) => e.name)}`);
  return parts.join('; ');
}

function describe(total: number, liked: Groups, passed: Groups, config: RankingConfig): string {
  if (total === 0) return 'No swipe feedback yet. Collect broadly; sessions are newest first until the user swipes.';
  if (total < config.evidence.min_swipes) {
    return `${total} of ${config.evidence.min_swipes} swipes needed before ranking starts. Collect broadly; sessions are newest first until then.`;
  }
  const lines = [`Based on ${total} swipe${total === 1 ? '' : 's'}.`];
  const likes = describeGroups(liked);
  const passes = describeGroups(passed);
  lines.push(likes ? `Leans toward: ${likes}.` : 'No clear likes yet.');
  if (passes) lines.push(`Tends to pass on: ${passes}.`);
  const off = FEATURE_KINDS.filter((k) => !config.signals[k].enabled);
  if (off.length) lines.push(`The user switched off ranking by ${off.join(', ')}.`);
  if (config.discovery.enabled && config.discovery.share > 0) {
    lines.push(`About ${Math.round(config.discovery.share * 100)}% of each session is reserved for unfamiliar items, so keep some variety.`);
  }
  return lines.join(' ');
}
