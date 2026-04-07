import { useState, useEffect, useCallback } from 'preact/hooks';
import { getSources, getTokens, createToken, revokeToken } from './api';
import type { UserSource } from './types';
import type { AgentToken } from './api';
import { SourceList } from './components/source-list';
import { AddSourceForm } from './components/add-source-form';

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
      await navigator.clipboard.writeText(newToken);
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

      <section class="settings__section settings__section--danger">
        <h2 class="settings__heading">About</h2>
        <p class="settings__help">ScrolLess — personal feed aggregator PoC</p>
      </section>
    </div>
  );
}
