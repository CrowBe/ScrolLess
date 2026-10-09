import { useState, useEffect, useCallback } from 'preact/hooks';
import { getSources, getTokens, createToken, revokeToken, getPreferences, updatePreferences, getTaste } from './api';
import type { UserSource } from './types';
import type { AgentToken, AppPreferences } from './api';
import { SourceList } from './components/source-list';
import { AddSourceForm } from './components/add-source-form';
import { openScrollessDb } from './idb';

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
      const message = err instanceof Error ? err.message : 'Could not create token. Please try again.';
      setCreateError(message);
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

function AgentConnectionSection() {
  return (
    <section class="settings__section">
      <h2 class="settings__heading">Agent Connection</h2>
      <p class="settings__help">
        Your agent collects content and pushes it here over MCP. On the machine running ScrolLess,
        run <code>npm run mcp:config</code> and add the printed command to your MCP client
        (Claude Code, Claude Desktop, …). Agents on other machines can use <code>/mcp</code> over HTTP
        with an agent token below.
      </p>
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
  const [tasteSummary, setTasteSummary] = useState<string | null>(null);

  const loadPreferences = useCallback(async () => {
    // Optional context; the preferences form works without it
    getTaste()
      .then((taste) => setTasteSummary(taste.summary))
      .catch((err) => console.warn('Failed to load taste summary:', err));
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
        max_items_per_source: preferences.max_items_per_source,
        session_size: preferences.session_size,
        exploration_share: preferences.exploration_share,
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
      {tasteSummary && <p class="settings__help">Learned taste: {tasteSummary}</p>}
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
          <span class="settings__help">Comma-separated. Matching items are hidden from your feed and stored without their content.</span>
        </label>

        <label class="settings__prefs-field">
          <span class="settings__prefs-label">Cards per session</span>
          <input
            class="form-input settings__prefs-number"
            type="number"
            min="5"
            max="100"
            value={String(preferences.session_size)}
            onInput={(e) => {
              setPreferences({
                ...preferences,
                session_size: Number((e.target as HTMLInputElement).value),
              });
              setSaved(false);
            }}
          />
          <span class="settings__help">How many cards each swipe session holds before you're caught up.</span>
        </label>

        <label class="settings__prefs-field">
          <span class="settings__prefs-label">Discovery share (%)</span>
          <input
            class="form-input settings__prefs-number"
            type="number"
            min="0"
            max="50"
            step="5"
            value={String(Math.round(preferences.exploration_share * 100))}
            onInput={(e) => {
              setPreferences({
                ...preferences,
                exploration_share: Number((e.target as HTMLInputElement).value) / 100,
              });
              setSaved(false);
            }}
          />
          <span class="settings__help">
            Sessions are ranked by what you like. This share of each session is held back for things you
            haven't shown a taste for yet.
          </span>
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

      <AgentConnectionSection />

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
  const [busy, setBusy] = useState(false);

  async function handleUnregisterDevice() {
    if (!confirm('Sign this device out? Its key will be deleted and it will re-enroll on reload.')) return;
    setBusy(true);
    try {
      const db = await openScrollessDb();
      await db.clear('device');
      await db.clear('preferences');
      location.reload();
    } catch (err) {
      console.error('Failed to unregister device:', err);
      setBusy(false);
    }
  }

  return (
    <section class="settings__section settings__section--danger">
      <h2 class="settings__heading">Danger Zone</h2>
      <div class="settings__danger-actions">
        <button
          class="btn btn--ghost btn--sm settings__danger-btn"
          onClick={handleUnregisterDevice}
          disabled={busy}
        >
          Sign out this device
        </button>
      </div>
    </section>
  );
}
