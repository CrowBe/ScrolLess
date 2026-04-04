import { useState, useEffect } from 'preact/hooks';
import { getSyncStatus } from '../api';
import type { SyncLogEntry } from '../types';
import { relativeTime } from '../utils';

export function SyncStatus() {
  const [entries, setEntries] = useState<SyncLogEntry[]>([]);
  const [nextSyncEstimate, setNextSyncEstimate] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    try {
      const data = await getSyncStatus();
      setEntries(data.missed);
      setNextSyncEstimate(data.next_sync_estimate);
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

  if (entries.length === 0 && !error && !nextSyncEstimate) return null;
  if (error) return (
    <div class="sync-status sync-status--error">
      <span class="material-symbols-outlined sync-status__icon">sync_problem</span>
      <span class="sync-status__text">Sync unavailable</span>
    </div>
  );

  const hasErrors = entries.length > 0;
  const statusText = hasErrors
    ? `Missed ${entries.length} sync${entries.length === 1 ? '' : 's'}`
    : nextSyncEstimate
      ? `Next sync ${relativeTime(nextSyncEstimate)}`
      : 'Sync healthy';

  return (
    <div class={`sync-status${hasErrors ? ' sync-status--error' : ''}`}>
      <span class="material-symbols-outlined sync-status__icon">
        {hasErrors ? 'warning' : 'sync'}
      </span>
      <span class="sync-status__text">
        {statusText}
      </span>
      {hasErrors && (
        <span class="sync-status__err-badge">Sync error</span>
      )}
    </div>
  );
}
