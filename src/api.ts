import type { UserSource } from './types';
import { apiUrl } from './config';
import { getCachedSessionToken } from './bootstrap/device-session';

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers ?? {});
  const sessionToken = getCachedSessionToken();
  if (sessionToken) {
    headers.set('Authorization', `Bearer ${sessionToken}`);
  }
  const res = await fetch(apiUrl(url), { ...options, headers });
  if (!res.ok) {
    let detail = '';
    try {
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = await res.json() as { error?: string };
        detail = body.error ? `: ${body.error}` : '';
      } else {
        const text = (await res.text()).trim();
        if (text) detail = `: ${text.slice(0, 200)}`;
      }
    } catch {
      // ignore body parse failures, status is still useful
    }
    throw new Error(`${options?.method ?? 'GET'} ${url} → ${res.status}${detail}`);
  }
  return res.json() as Promise<T>;
}

export interface AppPreferences {
  blocked_keywords: string[];
  max_items_per_source: number;
  session_size: number;
}

export function getPreferences(): Promise<AppPreferences> {
  return req<AppPreferences>('/api/preferences');
}

export function updatePreferences(data: Partial<AppPreferences>): Promise<AppPreferences> {
  return req<AppPreferences>('/api/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function getVapidKey(): Promise<{ key: string }> {
  return req<{ key: string }>('/api/push/vapid-key');
}

export function subscribePush(sub: PushSubscriptionJSON): Promise<{ ok: boolean }> {
  return req('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth },
    }),
  });
}

export function unsubscribePush(endpoint: string): Promise<{ ok: boolean }> {
  return req('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}

// Sources management
export function getSources(): Promise<UserSource[]> {
  return req<UserSource[]>('/api/sources');
}

export function addSource(data: { name: string; urls: string[]; max_items?: number }): Promise<{ ok: boolean }> {
  return req('/api/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function updateSource(
  name: string,
  data: { enabled?: number; urls?: string[]; max_items?: number | null }
): Promise<{ ok: boolean }> {
  return req(`/api/sources/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteSource(name: string): Promise<{ ok: boolean }> {
  return req(`/api/sources/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// Agent token management
export interface AgentToken {
  token_hash: string;
  label: string | null;
  created_at: string;
  last_used: string | null;
}

export function getTokens(): Promise<AgentToken[]> {
  return req<AgentToken[]>('/api/v1/tokens');
}

export function createToken(label: string): Promise<{ token: string; token_hash: string; label: string }> {
  return req('/api/v1/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
}

export function revokeToken(hash: string): Promise<{ ok: boolean }> {
  return req(`/api/v1/tokens/${encodeURIComponent(hash)}`, { method: 'DELETE' });
}

// Feed content pushed by the agent over MCP, stored on the host.
export interface FeedItem {
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
  first_seen_at: string;
  is_read: boolean;
  is_saved: boolean;
  state_version: number;
}

export interface FeedPage {
  items: FeedItem[];
  next_cursor: string | null;
}

export interface FeedStats {
  total: number;
  unread: number;
  by_source: Array<{ source: string; count: number; unread: number }>;
}

export function getFeedItems(params: { view?: string; source?: string; cursor?: string | null; limit?: number; unreadOnly?: boolean }): Promise<FeedPage> {
  const query = new URLSearchParams();
  if (params.unreadOnly) query.set('unread', '1');
  if (params.view) query.set('view', params.view);
  if (params.source) query.set('source', params.source);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  return req<FeedPage>(`/api/items?${query.toString()}`);
}

export type SessionSlot = 'ranked' | 'discovery' | 'recent';
export type SignalKind = 'source' | 'author' | 'type' | 'tag';

/** One line of a card's score: learned value × weight = contribution. */
export interface ScorePart {
  part: SignalKind | 'freshness';
  key?: string;
  label: string;
  value: number;
  weight: number;
  contribution: number;
}

export interface SessionCard {
  slot: SessionSlot;
  score: number;
  evidence: number;
  reasons: string[];
  breakdown: ScorePart[];
}

export interface SessionItem extends FeedItem {
  session: SessionCard;
}

/** Every tunable the session ranker uses; see docs/RANKING.md. */
export interface RankingConfig {
  signals: Record<SignalKind, { enabled: boolean; weight: number }>;
  verdicts: { like: number; save: number; dislike: number };
  memory: { decay: boolean; half_life_days: number };
  prior: number;
  freshness: { enabled: boolean; weight: number; half_life_hours: number };
  discovery: { enabled: boolean; share: number };
  pool_size: number;
  muted_features: string[];
}

export type RankingPatch = {
  [K in keyof RankingConfig]?: RankingConfig[K] extends string[] | number
    ? RankingConfig[K]
    : K extends 'signals'
      ? Partial<Record<SignalKind, Partial<RankingConfig['signals'][SignalKind]>>>
      : Partial<RankingConfig[K]>;
};

export interface SessionPage {
  ranking_version: string;
  size: number;
  config: RankingConfig;
  discovery_count: number;
  feedback_count: number;
  items: SessionItem[];
}

/** Draw one swipe session ranked by learned taste, with discovery cards mixed in. */
export function getSession(params: { view: 'feed' | 'discover'; source?: string }): Promise<SessionPage> {
  const query = new URLSearchParams({ view: params.view });
  if (params.source) query.set('source', params.source);
  return req<SessionPage>(`/api/items/session?${query.toString()}`);
}

export interface LearnedSignal {
  key: string;
  kind: SignalKind;
  label: string;
  source?: string;
  likes: number;
  saves: number;
  dislikes: number;
  evidence: number;
  score: number;
  muted: boolean;
  /** False when muted or its kind is switched off. */
  active: boolean;
}

export interface RankingReview {
  ranking_version: string;
  config: RankingConfig;
  feedback: { total: number; likes: number; saves: number; dislikes: number; latest_at: string | null };
  summary: string;
  signals: LearnedSignal[];
}

/** The ranking config and every learned signal. */
export function getRanking(): Promise<RankingReview> {
  return req<RankingReview>('/api/ranking');
}

export function updateRanking(patch: RankingPatch): Promise<RankingReview> {
  return req<RankingReview>('/api/ranking', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Restore default weights; swipe history is kept. */
export function resetRanking(): Promise<RankingReview> {
  return req<RankingReview>('/api/ranking/reset', { method: 'POST' });
}

export function getFeedStats(): Promise<FeedStats> {
  return req<FeedStats>('/api/items/stats');
}

export function updateFeedItem(
  id: string,
  data: { is_read?: boolean; is_saved?: boolean; expected_version?: number }
): Promise<{ id: string; is_read: boolean; is_saved: boolean; state_version: number }> {
  return req(`/api/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function markAllRead(source?: string): Promise<{ updated: number }> {
  return req('/api/items/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source ? { source } : {}),
  });
}

export type Verdict = 'like' | 'dislike' | 'save';

export interface FeedbackResult {
  item: { id: string; is_read: boolean; is_saved: boolean; state_version: number };
  verdict: Verdict | null;
}

/** Record a swipe verdict. Marks the item read; 'save' also saves it. */
export function sendFeedback(id: string, verdict: Verdict): Promise<FeedbackResult> {
  return req(`/api/items/${encodeURIComponent(id)}/feedback`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verdict }),
  });
}

/** Undo a swipe, restoring the item's pre-swipe read/save state. */
export function undoFeedback(id: string): Promise<FeedbackResult> {
  return req(`/api/items/${encodeURIComponent(id)}/feedback`, { method: 'DELETE' });
}

// Re-export for convenience
export type { FeedItemResponse } from './types';
