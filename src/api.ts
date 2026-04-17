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

// Re-export for convenience
export type { FeedItemResponse } from './types';
