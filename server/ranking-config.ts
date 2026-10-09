import type Database from 'better-sqlite3';
import { z } from 'zod';

// User-editable ranking configuration. Every number the session ranker uses
// lives here, stored on the host under user_preferences key "ranking", so the
// owner can review, reweight or switch off any part of the algorithm.
// docs/RANKING.md explains each parameter in plain language.

export const FEATURE_KINDS = ['source', 'author', 'type', 'tag'] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

export interface RankingConfig {
  /** Learned signals: whether each kind counts and how much. */
  signals: Record<FeatureKind, { enabled: boolean; weight: number }>;
  /** What one swipe of each kind teaches. */
  verdicts: { like: number; save: number; dislike: number };
  /** Older swipes fade: their weight halves every half_life_days. */
  memory: { decay: boolean; half_life_days: number };
  /** Pseudo-swipes of "neutral" added to every signal so one swipe is not a verdict. */
  prior: number;
  /** Small boost for newer items, halving every half_life_hours. */
  freshness: { enabled: boolean; weight: number; half_life_hours: number };
  /** Share of each session drawn from outside the top-ranked items. */
  discovery: { enabled: boolean; share: number };
  /** Newest unread items considered for a session. */
  pool_size: number;
  /** Learned signal keys to ignore (e.g. "author:youtube/some channel"). */
  muted_features: string[];
}

export const DEFAULT_RANKING: RankingConfig = {
  signals: {
    source: { enabled: true, weight: 1 },
    author: { enabled: true, weight: 1.5 },
    type: { enabled: true, weight: 0.5 },
    tag: { enabled: true, weight: 1 },
  },
  verdicts: { like: 1, save: 2, dislike: -1 },
  memory: { decay: true, half_life_days: 45 },
  prior: 2,
  freshness: { enabled: true, weight: 0.3, half_life_hours: 48 },
  discovery: { enabled: true, share: 0.2 },
  pool_size: 500,
  muted_features: [],
};

export const RANKING_LIMITS = {
  signalWeight: 5,
  verdictWeight: 5,
  halfLifeDays: [1, 3650],
  prior: 50,
  freshnessWeight: 5,
  halfLifeHours: [1, 8760],
  discoveryShare: 0.5,
  poolSize: [20, 2000],
  mutedFeatures: 500,
  featureKey: 500,
} as const;

const signal = z.object({
  enabled: z.boolean(),
  weight: z.number().min(0).max(RANKING_LIMITS.signalWeight),
}).partial();
const verdict = z.number().min(-RANKING_LIMITS.verdictWeight).max(RANKING_LIMITS.verdictWeight);

/** A patch may set any subset of fields; omitted fields keep their value. */
export const rankingPatchSchema = z.object({
  signals: z.object({ source: signal, author: signal, type: signal, tag: signal }).partial(),
  verdicts: z.object({ like: verdict, save: verdict, dislike: verdict }).partial(),
  memory: z.object({
    decay: z.boolean(),
    half_life_days: z.number().min(RANKING_LIMITS.halfLifeDays[0]).max(RANKING_LIMITS.halfLifeDays[1]),
  }).partial(),
  prior: z.number().min(0).max(RANKING_LIMITS.prior),
  freshness: z.object({
    enabled: z.boolean(),
    weight: z.number().min(0).max(RANKING_LIMITS.freshnessWeight),
    half_life_hours: z.number().min(RANKING_LIMITS.halfLifeHours[0]).max(RANKING_LIMITS.halfLifeHours[1]),
  }).partial(),
  discovery: z.object({
    enabled: z.boolean(),
    share: z.number().min(0).max(RANKING_LIMITS.discoveryShare),
  }).partial(),
  pool_size: z.number().int().min(RANKING_LIMITS.poolSize[0]).max(RANKING_LIMITS.poolSize[1]),
  muted_features: z.array(z.string().min(1).max(RANKING_LIMITS.featureKey)).max(RANKING_LIMITS.mutedFeatures),
}).partial().strict();

export type RankingPatch = z.infer<typeof rankingPatchSchema>;

function merge(base: RankingConfig, patch: RankingPatch): RankingConfig {
  const signals = { ...base.signals };
  for (const kind of FEATURE_KINDS) {
    signals[kind] = { ...base.signals[kind], ...patch.signals?.[kind] };
  }
  return {
    signals,
    verdicts: { ...base.verdicts, ...patch.verdicts },
    memory: { ...base.memory, ...patch.memory },
    prior: patch.prior ?? base.prior,
    freshness: { ...base.freshness, ...patch.freshness },
    discovery: { ...base.discovery, ...patch.discovery },
    pool_size: patch.pool_size ?? base.pool_size,
    muted_features: patch.muted_features ? [...new Set(patch.muted_features)] : base.muted_features,
  };
}

/** Stored config over defaults. An unreadable stored value falls back to defaults. */
export function readRankingConfig(db: Database.Database, userId: string): RankingConfig {
  const row = db.prepare(
    `SELECT value FROM user_preferences WHERE user_id = ? AND key = 'ranking'`
  ).get(userId) as { value: string } | undefined;
  if (!row) return DEFAULT_RANKING;
  try {
    const parsed = rankingPatchSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? merge(DEFAULT_RANKING, parsed.data) : DEFAULT_RANKING;
  } catch {
    return DEFAULT_RANKING;
  }
}

export function updateRankingConfig(db: Database.Database, userId: string, patch: RankingPatch): RankingConfig {
  const next = merge(readRankingConfig(db, userId), patch);
  db.prepare(
    `INSERT INTO user_preferences (user_id, key, value) VALUES (?, 'ranking', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
  ).run(userId, JSON.stringify(next));
  return next;
}

/** Restore default weights. Swipe history is kept. */
export function resetRankingConfig(db: Database.Database, userId: string): RankingConfig {
  db.prepare(`DELETE FROM user_preferences WHERE user_id = ? AND key = 'ranking'`).run(userId);
  return DEFAULT_RANKING;
}
