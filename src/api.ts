import type { SyncLogEntry, UserSource } from './types';
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

export function getSyncStatus(): Promise<{ missed: SyncLogEntry[]; next_sync_estimate: string | null }> {
  return req<{ missed: SyncLogEntry[]; next_sync_estimate: string | null }>('/api/sync/status');
}

export interface AppPreferences {
  blocked_keywords: string[];
  retention_days: number;
  max_items_per_source: number;
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

export async function syncPreferencesToIdb(): Promise<void> {
  const { openScrollessDb } = await import('./idb');
  const prefs = await getPreferences();
  const db = await openScrollessDb();
  const entries: Array<{ key: import('./idb').PreferenceKey; value: unknown }> = [
    { key: 'blocked_keywords', value: prefs.blocked_keywords },
    { key: 'retention_days', value: prefs.retention_days },
    { key: 'max_items_per_source', value: prefs.max_items_per_source },
  ];
  await Promise.all(entries.map(e => db.put('preferences', e)));
}

// Host content (agent-push v1). Items pushed by the local MCP agent live on
// the host; ids start with "ci_" so the reader can tell them from legacy
// IndexedDB items.
export interface HostItem {
  id: string;
  source: string;
  source_id: string;
  url: string;
  title: string;
  author: string | null;
  content_preview: string | null;
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

export interface HostItemPage {
  items: HostItem[];
  next_cursor: string | null;
}

export interface HostItemStats {
  total: number;
  unread: number;
  by_source: Array<{ source: string; count: number; unread: number }>;
}

export function isHostItemId(id: string): boolean {
  return id.startsWith('ci_');
}

export function getHostItems(params: { view?: string; source?: string; cursor?: string | null; limit?: number }): Promise<HostItemPage> {
  const query = new URLSearchParams();
  if (params.view) query.set('view', params.view);
  if (params.source) query.set('source', params.source);
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  return req<HostItemPage>(`/api/items?${query.toString()}`);
}

export function getHostItemStats(): Promise<HostItemStats> {
  return req<HostItemStats>('/api/items/stats');
}

export function updateHostItem(
  id: string,
  data: { is_read?: boolean; is_saved?: boolean; expected_version?: number }
): Promise<{ id: string; is_read: boolean; is_saved: boolean; state_version: number }> {
  return req(`/api/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function markHostItemsRead(source?: string): Promise<{ updated: number }> {
  return req('/api/items/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source ? { source } : {}),
  });
}

// Re-export for convenience
export type { FeedItemResponse } from './types';
