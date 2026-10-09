import type Database from 'better-sqlite3';

export interface AppPreferences {
  blocked_keywords: string[];
  max_items_per_source: number;
  session_size: number;
  /** Share of each session reserved for discovery cards (0–0.5). */
  exploration_share: number;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  blocked_keywords: [],
  max_items_per_source: 50,
  session_size: 20,
  exploration_share: 0.2,
};

export const EXPLORATION_SHARE_MAX = 0.5;

export function sanitizeBlockedKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_PREFERENCES.blocked_keywords;
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

export function readPreferences(db: Database.Database, userId: string): AppPreferences {
  const rows = db.prepare(
    `SELECT key, value FROM user_preferences WHERE user_id = ? AND key IN ('blocked_keywords', 'max_items_per_source', 'session_size', 'exploration_share')`
  ).all(userId) as Array<{ key: string; value: string }>;

  const values = new Map(rows.map((row) => [row.key, row.value]));

  const getJsonValue = (key: keyof AppPreferences): unknown => {
    const raw = values.get(key);
    if (raw == null) return DEFAULT_PREFERENCES[key];
    try {
      return JSON.parse(raw);
    } catch {
      return DEFAULT_PREFERENCES[key];
    }
  };

  const maxItemsPerSource = Number(getJsonValue('max_items_per_source'));
  const sessionSize = Number(getJsonValue('session_size'));
  const explorationShare = Number(getJsonValue('exploration_share'));

  return {
    blocked_keywords: sanitizeBlockedKeywords(getJsonValue('blocked_keywords')),
    max_items_per_source: Number.isFinite(maxItemsPerSource) ? maxItemsPerSource : DEFAULT_PREFERENCES.max_items_per_source,
    session_size: Number.isFinite(sessionSize) ? sessionSize : DEFAULT_PREFERENCES.session_size,
    exploration_share: Number.isFinite(explorationShare)
      ? Math.min(Math.max(explorationShare, 0), EXPLORATION_SHARE_MAX)
      : DEFAULT_PREFERENCES.exploration_share,
  };
}
