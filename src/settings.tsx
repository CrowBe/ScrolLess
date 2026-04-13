import { useState, useEffect, useCallback } from 'preact/hooks';
import { getSources, getTokens, createToken, revokeToken, getPreferences, updatePreferences, getSyncStatus } from './api';
import type { UserSource, SyncLogEntry as MissedSyncLogEntry } from './types';
import type { AgentToken, AppPreferences } from './api';
import { SourceList } from './components/source-list';
import { AddSourceForm } from './components/add-source-form';
import { openScrollessDb, type SyncLogEntry as LocalSyncLogEntry } from './idb';
import { displayName } from './source-labels';
import { relativeTime } from './utils';

function AgentTokens() {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [createError, setCreateError] = useState<string | null>(null);

  const trimmedLabel = newLabel.trim();
  const canCreate = trimmedLabel.length >= 3 && !busy;

  const load = useCallback(async () => {
    try { setTokens(await getTokens()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (trimmedLabel.length < 3) {
      setCreateError('Token name must be at least 3 characters.');
      return;
    }

    setBusy(true);
    setCreateError(null);
    try {
      const res = await createToken(trimmedLabel);
      setNewToken(res.token);
      setCopyState('idle');
      setNewLabel('');
      await load();
    } catch (err) {
      console.error('Failed to create token:', err);
      setCreateError('Could not create token. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(hash: string) {
    try {
      await revokeToken(hash);
      await load();
    } catch (err) {
      console.error('Failed to revoke token:', err);
    }
  }

  async function handleCopyToken() {
    if (!newToken) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(newToken);
      } else {
        const input = document.createElement('textarea');
        input.value = newToken;
        input.setAttribute('readonly', '');
        input.style.position = 'absolute';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(input);
        if (!copied) throw new Error('execCommand copy failed');
      }
      setCopyState('copied');
    } catch (err) {
      console.error('Failed to copy token:', err);
      setCopyState('error');
    }
  }

  return (
    <section class="settings__section">
      <h2 class="settings__heading">Agent Tokens</h2>
      {newToken && (
        <div class="settings__token-reveal">
          <p class="settings__help">Copy this token now — it will not be shown again.</p>
          <code class="settings__token-value">{newToken}</code>
          <div class="settings__token-actions">
            <button class="btn btn--primary btn--sm" onClick={handleCopyToken}>Copy token</button>
            <button class="btn btn--ghost btn--sm" onClick={() => { setNewToken(null); setCopyState('idle'); }}>Dismiss</button>
          </div>
          {copyState === 'copied' && <p class="settings__token-copy-state">Copied to clipboard.</p>}
          {copyState === 'error' && <p class="settings__token-copy-state settings__token-copy-state--error">Clipboard unavailable. Copy manually.</p>}
        </div>
      )}
      {tokens.length > 0 && (
        <ul class="settings__token-list">
          {tokens.map((t) => (
            <li key={t.token_hash} class="settings__token-item">
              <span class="settings__token-label">{t.label ?? 'agent'}</span>
              <span class="settings__token-meta">
                Created {new Date(t.created_at).toLocaleDateString()}
                {t.last_used ? ` · Last used ${new Date(t.last_used).toLocaleDateString()}` : ' · Never used'}
              </span>
              <button
                class="btn btn--ghost btn--sm settings__token-revoke"
                onClick={() => handleRevoke(t.token_hash)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="settings__token-create">
        <input
          class="form-input"
          type="text"
          placeholder="Token label (e.g. my-agent)"
          value={newLabel}
          onInput={(e) => {
            setNewLabel((e.target as HTMLInputElement).value);
            if (createError) setCreateError(null);
          }}
        />
        <button class="btn btn--primary btn--sm" type="button" onClick={handleCreate} disabled={!canCreate}>
          {busy ? '…' : 'Create token'}
        </button>
      </div>
      {createError && <p class="settings__token-copy-state settings__token-copy-state--error">{createError}</p>}
    </section>
  );
}

interface SourceHealthRow {
  source: string;
  latestSuccess: LocalSyncLogEntry | null;
  latestMissed: MissedSyncLogEntry | null;
}

function newestBy<T extends { source: string }>(rows: T[], getTs: (row: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    const prev = map.get(row.source);
    if (!prev || Date.parse(getTs(row)) > Date.parse(getTs(prev))) {
      map.set(row.source, row);
    }
  }
  return map;
}

function SyncHealthSection() {
  const [rows, setRows] = useState<SourceHealthRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [sources, syncStatus, localSyncLog] = await Promise.all([
        getSources(),
        getSyncStatus(),
        openScrollessDb().then((db) => db.getAll('sync_log')).catch(() => [] as LocalSyncLogEntry[]),
      ]);

      const successBySource = newestBy(localSyncLog, (row) => row.synced_at);
      const missedBySource = newestBy(syncStatus.missed, (row) => row.attempted_at);
      const sourceNames = Array.from(new Set([
        ...sources.map((source) => source.name),
        ...localSyncLog.map((row) => row.source),
        ...syncStatus.missed.map((row) => row.source),
      ])).sort();

      setRows(
        sourceNames.map((source) => ({
          source,
          latestSuccess: successBySource.get(source) ?? null,
          latestMissed: missedBySource.get(source) ?? null,
        }))
      );
    } catch (err) {
      console.error('Failed to load sync health:', err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section class="settings__section">
      <h2 class="settings__heading">Sync Health</h2>
      <p class="settings__help">Inspect source-level sync health instead of relying only on the global header status.</p>
      {loading ? (
        <p class="settings__help">Loading sync health…</p>
      ) : rows.length === 0 ? (
        <p class="settings__help">No sync activity yet.</p>
      ) : (
        <ul class="settings__sync-list">
          {rows.map(({ source, latestSuccess, latestMissed }) => {
            const lastSuccessAt = latestSuccess ? Date.parse(latestSuccess.synced_at) : -Infinity;
            const lastMissedAt = latestMissed ? Date.parse(latestMissed.attempted_at) : -Infinity;
            const latestIssueWins = lastMissedAt > lastSuccessAt;
            const state = latestIssueWins
              ? 'issue'
              : latestSuccess
                ? 'ok'
                : 'idle';

            return (
              <li key={source} class={`settings__sync-item settings__sync-item--${state}`}>
                <div class="settings__sync-header">
                  <span class="settings__sync-source">{displayName(source)}</span>
                  <span class={`settings__sync-badge settings__sync-badge--${state}`}>
                    {state === 'issue' ? 'Needs attention' : state === 'ok' ? 'Healthy' : 'Not synced yet'}
                  </span>
                </div>

                {latestSuccess ? (
                  <p class="settings__help">
                    Last successful sync {relativeTime(latestSuccess.synced_at)} · added {latestSuccess.items_added} item{latestSuccess.items_added === 1 ? '' : 's'}
                  </p>
                ) : (
                  <p class="settings__help">No successful sync recorded on this device yet.</p>
                )}

                {latestMissed && (
                  <p class="settings__token-copy-state settings__token-copy-state--error">
                    Last issue: {latestMissed.status === 'device_offline' ? 'device offline' : 'sync error'} {relativeTime(latestMissed.attempted_at)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PreferencesSection() {
  const [preferences, setPreferences] = useState<AppPreferences | null>(null);
  const [blockedKeywordsInput, setBlockedKeywordsInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadPreferences = useCallback(async () => {
    try {
      const prefs = await getPreferences();
      setPreferences(prefs);
      setBlockedKeywordsInput(prefs.blocked_keywords.join(', '));
    } catch (err) {
      console.error('Failed to load preferences:', err);
      setError('Could not load preferences.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  async function handleSave(event: Event) {
    event.preventDefault();
    if (!preferences) return;

    setSaving(true);
    setSaved(false);
    setError(null);

    const nextBlockedKeywords = blockedKeywordsInput
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    try {
      const updated = await updatePreferences({
        blocked_keywords: nextBlockedKeywords,
        retention_days: preferences.retention_days,
        max_items_per_source: preferences.max_items_per_source,
      });
      setPreferences(updated);
      setBlockedKeywordsInput(updated.blocked_keywords.join(', '));
      setSaved(true);
    } catch (err) {
      console.error('Failed to save preferences:', err);
      setError('Could not save preferences. Check your values and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section class="settings__section">
        <h2 class="settings__heading">Preferences</h2>
        <p class="settings__help">Loading preferences…</p>
      </section>
    );
  }

  if (!preferences) {
    return (
      <section class="settings__section">
        <h2 class="settings__heading">Preferences</h2>
        {error && <p class="settings__token-copy-state settings__token-copy-state--error">{error}</p>}
      </section>
    );
  }

  return (
    <section class="settings__section">
      <h2 class="settings__heading">Preferences</h2>
      <p class="settings__help">Control feed filtering and storage behavior.</p>
      <form class="settings__prefs-form" onSubmit={handleSave}>
        <label class="settings__prefs-field">
          <span class="settings__prefs-label">Blocked keywords</span>
          <input
            class="form-input"
            type="text"
            value={blockedKeywordsInput}
            placeholder="sponsored, giveaway"
            onInput={(e) => {
              setBlockedKeywordsInput((e.target as HTMLInputElement).value);
              setSaved(false);
            }}
          />
          <span class="settings__help">Comma-separated. Matching items are filtered from agent sync results.</span>
        </label>

        <label class="settings__prefs-field">
          <span class="settings__prefs-label">Retention days</span>
          <input
            class="form-input settings__prefs-number"
            type="number"
            min="1"
            max="365"
            value={String(preferences.retention_days)}
            onInput={(e) => {
              setPreferences({
                ...preferences,
                retention_days: Number((e.target as HTMLInputElement).value),
              });
              setSaved(false);
            }}
          />
          <span class="settings__help">Older unsaved feed items are deleted after this many days.</span>
        </label>

        <label class="settings__prefs-field">
          <span class="settings__prefs-label">Max items per source</span>
          <input
            class="form-input settings__prefs-number"
            type="number"
            min="1"
            max="500"
            value={String(preferences.max_items_per_source)}
            onInput={(e) => {
              setPreferences({
                ...preferences,
                max_items_per_source: Number((e.target as HTMLInputElement).value),
              });
              setSaved(false);
            }}
          />
          <span class="settings__help">Default limit used by the agent when a source does not override it.</span>
        </label>

        <div class="settings__prefs-actions">
          <button class="btn btn--primary btn--sm" type="submit" disabled={saving}>
            {saving ? '…' : 'Save preferences'}
          </button>
          {saved && <span class="settings__token-copy-state">Preferences saved.</span>}
          {error && <span class="settings__token-copy-state settings__token-copy-state--error">{error}</span>}
        </div>
      </form>
    </section>
  );
}

export function Settings() {
  const [sources, setSources] = useState<UserSource[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSources = useCallback(async () => {
    try {
      setSources(await getSources());
    } catch (err) {
      console.error('Failed to load sources:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSources(); }, [loadSources]);

  return (
    <div class="settings">
      <PreferencesSection />

      <SyncHealthSection />

      <AgentTokens />

      <section class="settings__section">
        <h2 class="settings__heading">Connected Sources</h2>
        {loading ? (
          <div style="display:flex;justify-content:center;padding:1rem"><div class="spinner spinner--sm" /></div>
        ) : (
          <SourceList sources={sources} onRefresh={loadSources} />
        )}
      </section>

      <AddSourceForm onAdded={loadSources} />

      <DangerZone />
    </div>
  );
}

function DangerZone() {
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);

  async function handleClearFeedData() {
    if (!confirm('Delete all locally stored feed items and sync history? This cannot be undone.')) return;
    setClearing(true);
    try {
      const db = await openScrollessDb();
      await db.clear('feed_items');
      await db.clear('sync_log');
      window.dispatchEvent(new CustomEvent('scrolless:idb-updated'));
      setCleared(true);
    } catch (err) {
      console.error('Failed to clear feed data:', err);
    } finally {
      setClearing(false);
    }
  }

  async function handleUnregisterDevice() {
    if (!confirm('Unregister this device? Your keypair will be deleted and you will need to re-register. This cannot be undone.')) return;
    setClearing(true);
    try {
      const db = await openScrollessDb();
      await db.clear('feed_items');
      await db.clear('sync_log');
      await db.clear('device');
      await db.clear('preferences');
      window.dispatchEvent(new CustomEvent('scrolless:idb-updated'));
      // Reload to trigger fresh device registration
      location.reload();
    } catch (err) {
      console.error('Failed to unregister device:', err);
      setClearing(false);
    }
  }

  return (
    <section class="settings__section settings__section--danger">
      <h2 class="settings__heading">Danger Zone</h2>
      <p class="settings__help">These actions are permanent and cannot be undone.</p>
      {cleared && <p class="settings__help" style="color:var(--color-success)">Feed data cleared.</p>}
      <div class="settings__danger-actions">
        <button
          class="btn btn--ghost btn--sm"
          onClick={handleClearFeedData}
          disabled={clearing}
        >
          {clearing ? '…' : 'Clear local feed data'}
        </button>
        <button
          class="btn btn--ghost btn--sm settings__danger-btn"
          onClick={handleUnregisterDevice}
          disabled={clearing}
        >
          Unregister this device
        </button>
      </div>
    </section>
  );
}
