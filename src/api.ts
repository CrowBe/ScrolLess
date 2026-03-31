import type { FeedResponse, Stats, SyncLogEntry, FeedItemResponse, UserSource } from './types';

const base = '';

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(base + url, options);
  if (!res.ok) throw new Error(`${options?.method ?? 'GET'} ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface FeedParams {
  limit?: number;
  offset?: number;
  source?: string;
  unread_only?: boolean;
  discovery?: boolean;
  saved?: boolean;
}

export function getFeed(params: FeedParams = {}): Promise<FeedResponse> {
  const q = new URLSearchParams();
  if (params.limit != null) q.set('limit', String(params.limit));
  if (params.offset != null) q.set('offset', String(params.offset));
  if (params.source) q.set('source', params.source);
  if (params.unread_only != null) q.set('unread_only', String(params.unread_only));
  if (params.discovery != null) q.set('discovery', String(params.discovery));
  if (params.saved != null) q.set('saved', String(params.saved));
  return req<FeedResponse>(`/api/feed?${q}`);
}

export function markRead(id: string): Promise<{ ok: boolean }> {
  return req(`/api/feed/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export function markUnread(id: string): Promise<{ ok: boolean }> {
  return req(`/api/feed/${encodeURIComponent(id)}/unread`, { method: 'PATCH' });
}

export function saveItem(id: string): Promise<{ ok: boolean }> {
  return req(`/api/feed/${encodeURIComponent(id)}/save`, { method: 'PATCH' });
}

export function unsaveItem(id: string): Promise<{ ok: boolean }> {
  return req(`/api/feed/${encodeURIComponent(id)}/unsave`, { method: 'PATCH' });
}

export function markAllRead(source?: string): Promise<{ ok: boolean }> {
  const q = source ? `?source=${encodeURIComponent(source)}` : '';
  return req(`/api/feed/mark-all-read${q}`, { method: 'POST' });
}

export function getStats(discovery?: boolean): Promise<Stats> {
  const q = discovery != null ? `?discovery=${discovery}` : '';
  return req<Stats>(`/api/stats${q}`);
}

export function getSyncStatus(): Promise<SyncLogEntry[]> {
  return req<SyncLogEntry[]>('/api/sync/status');
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
  return req<AgentToken[]>('/api/tokens');
}

export function createToken(label: string): Promise<{ token: string; token_hash: string; label: string }> {
  return req('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  });
}

export function revokeToken(hash: string): Promise<{ ok: boolean }> {
  return req(`/api/tokens/${encodeURIComponent(hash)}`, { method: 'DELETE' });
}

// Re-export FeedItemResponse for convenience
export type { FeedItemResponse };
