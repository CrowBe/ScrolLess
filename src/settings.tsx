import { useState, useEffect, useCallback } from 'preact/hooks';
import { getSources } from './api';
import type { UserSource } from './types';
import { SourceList } from './components/source-list';
import { AddSourceForm } from './components/add-source-form';

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
      <section class="settings__section">
        <h2 class="settings__heading">Agent Token</h2>
        <p class="settings__help">
          Generate a token with <code>npm run generate-token</code>, hash it with SHA-256,
          and add it to <code>config.json</code> as <code>agent_token_hash</code>.
        </p>
      </section>

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
