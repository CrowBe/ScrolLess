import { useState, useEffect } from 'preact/hooks';
import { getSyncStatus } from '../api';
import type { SyncLogEntry } from '../types';
import { relativeTime } from '../utils';

export function SyncStatus() {
  const [entries, setEntries] = useState<SyncLogEntry[]>([]);
  const [error, setError] = useState(false);

  async function load() {
    try {
      const data = await getSyncStatus();
      setEntries(data);
      setError(false);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (entries.length === 0 && !error) return null;
  if (error) return (
    <div class="sync-status sync-status--error">
      <span class="material-symbols-outlined sync-status__icon">sync_problem</span>
      <span class="sync-status__text">Sync unavailable</span>
    </div>
  );

  const hasErrors = entries.some((e) => e.error);
  const latest = entries.reduce<SyncLogEntry | null>((best, e) => {
    if (!best) return e;
    return e.synced_at > best.synced_at ? e : best;
  }, null);

  return (
    <div class={`sync-status${hasErrors ? ' sync-status--error' : ''}`}>
      <span class="material-symbols-outlined sync-status__icon">
        {hasErrors ? 'warning' : 'sync'}
      </span>
      <span class="sync-status__text">
        {latest ? `Synced ${relativeTime(latest.synced_at)}` : 'Never synced'}
      </span>
      {hasErrors && (
        <span class="sync-status__err-badge">Sync error</span>
      )}
    </div>
  );
}
